"""Fixed entry points inside the workspace image, using only its local network."""

import asyncio
from contextlib import suppress
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tarfile
import time


ROOT = Path("/workspace")
ROLES = {"backend": 3001, "frontend": 3000}
REGISTRY = 4873


async def registry_relay(reader, writer):
    try:
        outgoing, upstream = await asyncio.open_unix_connection("/registry/npm.sock")
    except OSError:
        writer.close()
        return

    async def copy(source, target):
        while chunk := await source.read(65536):
            target.write(chunk)
            await target.drain()
        if target.can_write_eof():
            target.write_eof()

    try:
        async with asyncio.TaskGroup() as group:
            group.create_task(copy(reader, upstream))
            group.create_task(copy(outgoing, writer))
    except* OSError:
        pass
    finally:
        upstream.close()
        writer.close()


async def idle():
    async with await asyncio.start_server(registry_relay, "127.0.0.1", REGISTRY):
        await asyncio.Future()


def unpack():
    # The engine supplies only regular Git blobs. Enforce that contract again
    # before extraction so the scratch copy always consists of ordinary files.
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as archive:
        for member in archive:
            parts = member.name.split("/")
            if not member.isfile() or any(part in {"", ".", "..", ".git"} for part in parts):
                raise ValueError("Invalid workspace archive member")
            destination = ROOT.joinpath(*parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open("xb") as sink, archive.extractfile(member) as source:
                while chunk := source.read(65536):
                    sink.write(chunk)
            destination.chmod(0o755 if member.mode & 0o111 else 0o644)


def relay(port):
    if not 1024 <= port <= 65535 or port == REGISTRY:
        raise ValueError("Invalid preview port")
    with socket.create_connection(("127.0.0.1", port), timeout=4) as upstream:
        upstream.settimeout(None)

        def send():
            try:
                while chunk := os.read(0, 65536):
                    upstream.sendall(chunk)
                upstream.shutdown(socket.SHUT_WR)
            except OSError:
                pass

        from threading import Thread
        Thread(target=send, daemon=True).start()
        while chunk := upstream.recv(65536):
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()


def process_file(role):
    if role not in ROLES:
        raise ValueError("Unknown app service")
    return Path(f"/tmp/chorus-{role}.pid")


def stop(role):
    pidfile = process_file(role)
    try:
        pid = int(pidfile.read_text())
    except (FileNotFoundError, ValueError):
        return
    if pid > 1:
        with suppress(ProcessLookupError):
            os.killpg(pid, signal.SIGTERM)
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                os.killpg(pid, 0)
                time.sleep(0.05)
            os.killpg(pid, signal.SIGKILL)
    pidfile.unlink(missing_ok=True)


def check(port):
    with socket.socket() as probe:
        probe.settimeout(0.25)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def project(role):
    port = ROLES[role]
    directory = ROOT / role
    try:
        manifest = json.loads((directory / "package.json").read_text())
        scripts = manifest.get("scripts", {})
        script = next((name for name in ("dev", "start") if isinstance(scripts.get(name), str)), None)
        if not script:
            raise ValueError
    except (OSError, AttributeError, ValueError):
        print(f"{role}/package.json needs a dev or start script. Use Terminal for a custom launch.", flush=True)
        return 1

    if check(port):
        print(f"Port {port} is already in use. Stop the server in Terminal or forward its port.", flush=True)
        return 1

    if os.getpgrp() != os.getpid():
        os.setsid()
    pidfile = process_file(role)
    pidfile.write_text(str(os.getpid()))
    env = {**os.environ, "PORT": str(port), "HOST": "127.0.0.1",
           "BACKEND_URL": f"http://127.0.0.1:{ROLES['backend']}"}
    try:
        if manifest.get("dependencies") or manifest.get("devDependencies"):
            install = ["ci"] if (directory / "package-lock.json").is_file() else ["install", "--no-package-lock"]
            subprocess.run(["npm", *install], check=True, cwd=directory, env=env)
        command = ["npm", "run", script]
        if "vite" in scripts[script].split():
            command.extend(["--", "--port", str(port), "--strictPort"])
        return subprocess.run(command, cwd=directory, env=env).returncode
    except subprocess.CalledProcessError as error:
        return error.returncode
    finally:
        pidfile.unlink(missing_ok=True)


def wait(port, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
        try:
            connection.request("GET", "/")
            if connection.getresponse().status < 500:
                return 0
        except (OSError, http.client.HTTPException):
            pass
        finally:
            connection.close()
        time.sleep(0.25)
    return 1


if __name__ == "__main__":
    action, *args = sys.argv[1:]
    if action == "idle":
        asyncio.run(idle())
    elif action == "unpack":
        unpack()
    elif action == "relay":
        relay(int(args[0]))
    elif action == "project":
        sys.exit(project(args[0]))
    elif action == "stop":
        stop(args[0])
    elif action == "wait":
        sys.exit(wait(*map(int, args)))
    elif action == "listening":
        sys.exit(not check(int(args[0])))
