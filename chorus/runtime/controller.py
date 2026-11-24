"""Private Docker controller and separate loopback preview listener."""

import asyncio
from contextlib import AsyncExitStack, asynccontextmanager, suppress
import os
from pathlib import Path
import re
import sys
import time
from uuid import uuid4

from aiohttp import ClientError, ClientSession, ClientTimeout, DummyCookieJar, UnixConnector, web
from yarl import URL

from chorus.runtime.gateway import FRAME, headers, proxy, serve_frame, stream
from chorus.runtime.workspace import MAX_SNAPSHOT, Workspace, docker


CONTROL = Path("/runtime/control.sock")
REGISTRY = Path("/registry/npm.sock")
_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,79}")
_REVISION = re.compile(r"(?:[a-f0-9]{40}|[a-f0-9]{64})")
_ORIGIN = re.compile(r"http://(?:localhost|127\.0\.0\.1):\d{1,5}")


class Controller:
    def __init__(self):
        self.group = os.environ["CHORUS_RUNTIME_GROUP"]
        self.image = os.environ["CHORUS_WORKSPACE_IMAGE"]
        self.registry = os.environ["CHORUS_REGISTRY_VOLUME"]
        self.port = int(os.getenv("CHORUS_RUNTIME_PORT", "43192"))
        self.origins = set(os.environ["CHORUS_RUNTIME_ORIGINS"].split(","))
        self.npm = URL(os.getenv("CHORUS_NPM_UPSTREAM", "https://registry.npmjs.org"))
        if (not _ID.fullmatch(self.group) or not self.origins or not all(_ORIGIN.fullmatch(o) for o in self.origins)
                or self.npm.scheme not in {"http", "https"} or self.npm != self.npm.origin()):
            raise ValueError("Invalid Chorus runtime configuration")
        self.workspaces = {}
        self.tickets = {}
        self.lock = asyncio.Lock()
        self.client = None

    async def clean_orphans(self):
        code, ids, _ = await docker("ps", "-aq", "--filter", f"label=org.chorus.runtime={self.group}")
        if code:
            raise RuntimeError("Chorus cannot reach Docker. Check the controller Docker socket mount.")
        if ids.strip():
            code, _, _ = await docker("rm", "-f", *ids.decode("ascii").split())
            if code:
                raise RuntimeError("Chorus could not remove its previous preview containers.")

    async def control(self, request):
        sid = request.match_info["sid"]
        if not _ID.fullmatch(sid):
            raise web.HTTPBadRequest(text="Invalid experiment identifier.")
        action = request.match_info.get("action")
        if request.method == "GET" and action is None:
            workspace = self.workspaces.get(sid)
            return web.json_response(workspace.status() if workspace else {"state": "stopped"})
        if action == "prepare":
            return await self.prepare(sid, request)
        workspace = self.workspaces.get(sid)
        if action == "reset":
            async with self.lock:
                if workspace := self.workspaces.pop(sid, None):
                    async with workspace.lock:
                        await workspace.close()
            return web.json_response({"state": "stopped"})
        if workspace is None:
            if action == "stop":
                return web.json_response({"state": "stopped"})
            raise web.HTTPConflict(text="Initialize the workspace and retry.")
        async with workspace.lock:
            if self.workspaces.get(sid) is not workspace:
                raise web.HTTPConflict(text="This workspace was reset. Open it again.")
            if action == "run":
                workspace.start()
            elif action == "stop":
                await workspace.stop()
            elif action == "forward":
                params = await request.json()
                port = params.get("port")
                if type(port) is not int or not 1024 <= port <= 65535 or port == 4873:
                    raise web.HTTPBadRequest(text="Choose a workspace port between 1024 and 65535 (except 4873).")
                if (await docker("exec", workspace.name, "python3", "/opt/chorus/runner.py", "listening",
                                 str(port), timeout=5))[0]:
                    raise web.HTTPConflict(text=f"Nothing is listening on workspace port {port}.")
                try:
                    await workspace.forward(port)
                except RuntimeError as error:
                    raise web.HTTPConflict(text=str(error)) from None
            elif action == "terminal":
                params = await request.json()
                origin = params.get("origin")
                if origin not in self.origins:
                    raise web.HTTPForbidden(text="Open Terminal from the local Chorus interface.")
                now = time.monotonic()
                self.tickets = {key: value for key, value in self.tickets.items() if value[0] > now}
                self.tickets = {key: value for key, value in self.tickets.items() if value[2] is not workspace}
                token = uuid4().hex
                self.tickets[token] = (now + 20, origin, workspace)
                return web.json_response({"url": f"ws://127.0.0.1:{self.port}/terminal/{token}"})
            else:
                raise web.HTTPNotFound()
        return web.json_response(workspace.status())

    async def prepare(self, sid, request):
        revision = request.headers.get("X-Chorus-Revision", "")
        if not _REVISION.fullmatch(revision):
            raise web.HTTPBadRequest(text="Invalid workspace revision.")
        async with self.lock:
            if existing := self.workspaces.get(sid):
                return web.json_response(existing.status())
            if len(self.workspaces) >= 6:
                raise web.HTTPConflict(text="Six workspaces are open. Reset one before opening another.")
            workspace = Workspace(revision, self.port)
            try:
                data = await request.read()
                await workspace.create(data, self.image, self.group, self.registry)
            except (OSError, TimeoutError, RuntimeError):
                with suppress(OSError, TimeoutError):
                    await workspace.remove()
                raise web.HTTPServiceUnavailable(text="Docker could not prepare the workspace. Check Compose and rebuild.") from None
            self.workspaces[sid] = workspace
            return web.json_response(workspace.status())

    async def public(self, request):
        if request.host == f"127.0.0.1:{self.port}" and request.path.startswith("/terminal/"):
            return await self.terminal(request)
        for workspace in self.workspaces.values():
            for route in workspace.forwards.values():
                if request.host == f"{route.host}:{self.port}":
                    if request.path.startswith(FRAME):
                        return await serve_frame(request, self.origins)
                    return await proxy(request, self.client, route)
        raise web.HTTPNotFound(text="This forwarded port is closed.")

    async def terminal(self, request):
        if not web.WebSocketResponse().can_prepare(request).ok or request.headers.get("Origin") not in self.origins:
            raise web.HTTPForbidden()
        token = request.path.removeprefix("/terminal/")
        record = self.tickets.get(token)
        if not record or record[0] <= time.monotonic() or record[1] != request.headers["Origin"]:
            raise web.HTTPForbidden()
        _, _, workspace = self.tickets.pop(token)
        async with workspace.lock:
            if workspace not in self.workspaces.values():
                raise web.HTTPNotFound()
            terminal = await workspace.shell()
        return await terminal.attach(request)

    async def npm_proxy(self, request):
        if request.method not in {"GET", "HEAD"} or not request.raw_path.startswith("/"):
            raise web.HTTPForbidden()
        upstream_url = URL(str(self.npm).rstrip("/") + request.raw_path, encoded=True)
        if upstream_url.origin() != self.npm:
            raise web.HTTPForbidden()
        try:
            async with self.client.request(request.method, upstream_url, allow_redirects=False,
                                           headers={"Accept": request.headers.get("Accept", "*/*")}) as upstream:
                if 300 <= upstream.status < 400 and "Location" in upstream.headers:
                    raise web.HTTPBadGateway(text="The npm registry returned a redirect.")
                return await stream(request, upstream, response_headers=headers(upstream.headers, {"set-cookie"}))
        except (ClientError, TimeoutError):
            raise web.HTTPBadGateway(text="The npm registry is unavailable.") from None


@asynccontextmanager
async def serve(app, *, socket=None):
    runner = web.AppRunner(app, access_log=None, shutdown_timeout=3)
    await runner.setup()
    try:
        if socket:
            socket.unlink(missing_ok=True)
            await web.UnixSite(runner, str(socket)).start()
            socket.chmod(0o660 if socket == CONTROL else 0o666)
            if socket == CONTROL:
                os.chown(socket, 0, 1000)
        else:
            await web.TCPSite(runner, "0.0.0.0", 43192).start()
        yield
    finally:
        await runner.cleanup()
        if socket:
            socket.unlink(missing_ok=True)


async def health(_):
    return web.Response(text="ok")


async def main():
    controller = Controller()
    await controller.clean_orphans()
    control = web.Application(client_max_size=MAX_SNAPSHOT)
    control.router.add_get("/health", health)
    control.router.add_get("/workspaces/{sid}", controller.control)
    control.router.add_post("/workspaces/{sid}/{action}", controller.control)
    public = web.Application()
    public.router.add_route("*", "/{tail:.*}", controller.public)
    registry = web.Application()
    registry.router.add_route("*", "/{tail:.*}", controller.npm_proxy)
    event = asyncio.Event()
    import signal
    for signum in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(signum, event.set)
    async with ClientSession(timeout=ClientTimeout(total=None, connect=6, sock_read=60), auto_decompress=False,
                             cookie_jar=DummyCookieJar(), skip_auto_headers={"User-Agent", "Accept-Encoding"}) as client:
        controller.client = client
        try:
            async with AsyncExitStack() as stack:
                await stack.enter_async_context(serve(registry, socket=REGISTRY))
                await stack.enter_async_context(serve(public))
                await stack.enter_async_context(serve(control, socket=CONTROL))
                await event.wait()
        finally:
            await asyncio.gather(*(workspace.close() for workspace in controller.workspaces.values()), return_exceptions=True)
            await controller.clean_orphans()


async def check():
    async with ClientSession(connector=UnixConnector(path=str(CONTROL)), timeout=ClientTimeout(total=2)) as client:
        async with client.get("http://localhost/health") as response:
            return int(response.status != 200)


if __name__ == "__main__":
    if sys.argv[1:] == ["health"]:
        sys.exit(asyncio.run(check()))
    asyncio.run(main())
