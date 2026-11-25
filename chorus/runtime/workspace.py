"""Own the lifecycle of one disposable Docker workspace."""

import asyncio
from contextlib import suppress
from dataclasses import dataclass, field
from uuid import uuid4

from chorus.runtime.terminal import Terminal


RUNNER = ("python3", "/opt/chorus/runner.py")
MAX_SNAPSHOT = 105 * 1024 * 1024
CONTAINER_ISOLATION = (
    "--init", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--user=1000:1000", "--pids-limit=192", "--cpus=2", "--memory=2g", "--memory-swap=2g",
    "--tmpfs=/workspace:rw,exec,nosuid,nodev,size=768m,mode=0700,uid=1000,gid=1000",
    "--tmpfs=/tmp:rw,exec,nosuid,nodev,size=256m,mode=1777", "--log-driver=none",
)


async def docker(*args, data=None, timeout=45):
    process = await asyncio.create_subprocess_exec(
        "docker", *args, stdin=asyncio.subprocess.PIPE if data is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        output, error = await asyncio.wait_for(process.communicate(data), timeout)
    except BaseException:
        with suppress(ProcessLookupError):
            process.kill()
        await process.wait()
        raise
    return process.returncode, output, error


@dataclass
class Forward:
    port: int
    host: str = field(default_factory=lambda: f"{uuid4().hex}.localhost")
    listener: asyncio.AbstractServer | None = None
    connections: set = field(default_factory=set)

    @property
    def target(self):
        return self.listener.sockets[0].getsockname()[1]

    async def close(self):
        if self.listener:
            self.listener.close()
            await self.listener.wait_closed()
        for task in list(self.connections):
            task.cancel()
        await asyncio.gather(*self.connections, return_exceptions=True)


class Workspace:
    def __init__(self, revision, public_port):
        self.name = f"chorus-workspace-{uuid4().hex}"
        self.revision = revision
        self.public_port = public_port
        self.state = "stopped"
        self.error = None
        self.logs = {"frontend": "", "backend": ""}
        self.jobs = {}
        self.managed = set()
        self.forwards = {}
        self.run_task = None
        self.terminal = None
        self.lock = asyncio.Lock()

    def status(self):
        return {
            "revision": self.revision, "state": self.state, "error": self.error, "logs": self.logs,
            "forwards": [
                {"port": route.port, "url": f"http://{route.host}:{self.public_port}/"}
                for route in self.forwards.values()
            ],
        }

    async def create(self, data, image, group, registry):
        code, _, _ = await docker(
            "run", "-d", "--pull=never", "--name", self.name, "--label", f"org.chorus.runtime={group}",
            *CONTAINER_ISOLATION,
            "--mount", f"type=volume,src={registry},dst=/registry,readonly,volume-nocopy", image,
        )
        if code or (await docker("exec", "-i", self.name, *RUNNER, "unpack", data=data))[0]:
            await self.remove()
            raise RuntimeError("Could not prepare the Docker workspace. Check Compose and rebuild the workspace image.")

    async def remove(self):
        await docker("rm", "-f", self.name, timeout=12)

    async def pipe(self, forward, reader, writer):
        task = asyncio.current_task()
        forward.connections.add(task)
        process = None

        async def upload():
            try:
                while chunk := await reader.read(65536):
                    process.stdin.write(chunk)
                    await process.stdin.drain()
            finally:
                process.stdin.close()

        async def download():
            while chunk := await process.stdout.read(65536):
                writer.write(chunk)
                await writer.drain()

        try:
            if len(forward.connections) > 32:
                return
            process = await asyncio.create_subprocess_exec(
                "docker", "exec", "-i", self.name, *RUNNER, "relay", str(forward.port),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            sending = asyncio.create_task(upload())
            receiving = asyncio.create_task(download())
            try:
                done, _ = await asyncio.wait((sending, receiving), return_when=asyncio.FIRST_COMPLETED)
                # A half-closed request may still have a response on the other side.
                if sending in done and sending.exception() is None and receiving not in done:
                    await receiving
            finally:
                for transfer in (sending, receiving):
                    transfer.cancel()
                await asyncio.gather(sending, receiving, return_exceptions=True)
        except OSError:
            pass
        finally:
            writer.close()
            if process:
                process.stdin.close()
                with suppress(ProcessLookupError):
                    process.kill()
                await process.wait()
            forward.connections.discard(task)

    async def forward(self, port):
        if port not in self.forwards:
            if len(self.forwards) >= 8:
                raise RuntimeError("This workspace already has eight forwarded ports.")
            route = Forward(port)
            route.listener = await asyncio.start_server(lambda r, w: self.pipe(route, r, w), "127.0.0.1", 0)
            self.forwards[port] = route
        return self.forwards[port]

    async def unforward(self, port):
        if route := self.forwards.pop(port, None):
            await route.close()

    async def collect(self, role, process):
        while chunk := await process.stdout.read(4096):
            self.logs[role] = (self.logs[role] + chunk.decode("utf-8", errors="replace"))[-16000:]
        return await process.wait()

    async def start_service(self, role, port):
        if (await docker("exec", self.name, *RUNNER, "listening", str(port), timeout=5))[0] == 0:
            raise RuntimeError(f"Port {port} is already in use. Stop that server in Terminal or forward its port.")
        process = await asyncio.create_subprocess_exec(
            "docker", "exec", self.name, *RUNNER, "project", role,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        self.managed.add(role)
        job = asyncio.create_task(self.collect(role, process))
        self.jobs[role] = (job, process)
        probe = asyncio.create_task(docker("exec", self.name, *RUNNER, "wait", str(port), "90", timeout=95))
        try:
            done, _ = await asyncio.wait((job, probe), return_when=asyncio.FIRST_COMPLETED)
            if job in done:
                raise RuntimeError(f"The {role} exited during startup. Check its output below.")
            if (await probe)[0]:
                raise RuntimeError(f"The {role} did not respond on port {port}. Check its output below.")
        finally:
            probe.cancel()
            await asyncio.gather(probe, return_exceptions=True)

    async def run(self):
        try:
            await self.start_service("backend", 3001)
            await self.start_service("frontend", 3000)
            await self.forward(3000)
            self.state = "running"
            await asyncio.wait([job for job, _ in self.jobs.values()], return_when=asyncio.FIRST_COMPLETED)
            raise RuntimeError("A managed service exited. Check the service output below.")
        except asyncio.CancelledError:
            raise
        except (OSError, RuntimeError, TimeoutError) as error:
            self.error = str(error) if isinstance(error, RuntimeError) else "Docker could not start the application."
            self.state = "failed"
            await self.stop_services()

    def start(self):
        if self.run_task is None or self.run_task.done():
            self.error = None
            self.logs = {"frontend": "", "backend": ""}
            self.state = "starting"
            self.run_task = asyncio.create_task(self.run())

    async def stop_services(self):
        if "frontend" in self.managed:
            await self.unforward(3000)
        for role in tuple(self.managed):
            with suppress(OSError, TimeoutError):
                await docker("exec", self.name, *RUNNER, "stop", role, timeout=5)
        self.managed.clear()
        for job, process in self.jobs.values():
            try:
                await asyncio.wait_for(asyncio.shield(job), 2)
            except TimeoutError:
                with suppress(ProcessLookupError):
                    process.kill()
                await job
        self.jobs.clear()

    async def stop(self):
        if self.run_task and not self.run_task.done():
            if self.state != "failed":
                self.run_task.cancel()
            await asyncio.gather(self.run_task, return_exceptions=True)
        self.run_task = None
        await self.stop_services()
        self.state = "stopped"
        self.error = None

    async def close(self):
        await self.stop()
        if self.terminal:
            await self.terminal.close()
        for port in tuple(self.forwards):
            await self.unforward(port)
        await self.remove()

    async def shell(self):
        if not self.terminal or self.terminal.ended:
            if self.terminal:
                await self.terminal.close()
            self.terminal = await Terminal.start(self.name)
        return self.terminal
