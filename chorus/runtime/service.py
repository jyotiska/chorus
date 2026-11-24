"""Resolve runtime operations against the engine's saved experiments."""

import asyncio
import os

import httpx

from chorus.harness.models import TerminalTicket, WorkspaceRuntime
from chorus.services.errors import ChorusError


class RuntimeService:
    def __init__(self, harness):
        self.harness = harness
        path = os.getenv("CHORUS_RUNTIME_SOCKET")
        self.controller = httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds=path),
                                            base_url="http://localhost", timeout=60) if path else None

    async def close(self):
        if self.controller:
            await self.controller.aclose()

    def revision(self, sid):
        state = self.harness.repo.get(sid)
        if state.experiment is None:
            raise ChorusError("NOT_FOUND", "This session has no application repository.", 404)
        return state.experiment.frozen.mainCommit if state.experiment.frozen else state.experiment.repository.mainCommit

    async def request(self, sid, action=None, **kwargs):
        if self.controller is None:
            raise ChorusError("WORKSPACE_UNAVAILABLE", "Start Chorus with Docker Compose to use Browser and Terminal.", 503)
        path = f"/workspaces/{sid}"
        try:
            response = await self.controller.request("GET" if action is None else "POST",
                                                     f"{path}/{action}" if action else path, **kwargs)
            if response.status_code == 200:
                return response.json()
        except (httpx.HTTPError, ValueError):
            raise ChorusError("WORKSPACE_UNAVAILABLE", "The Docker controller is unavailable. Check Compose and retry.", 503) from None
        code = {400: "INVALID_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT"}.get(response.status_code)
        if code:
            raise ChorusError(code, response.text, response.status_code)
        raise ChorusError("WORKSPACE_UNAVAILABLE", "The Docker controller could not complete the request. Check Compose and retry.", 503)

    async def status(self, sid):
        revision = self.revision(sid)
        current = await self.request(sid) if self.controller else {}
        return WorkspaceRuntime(enabled=self.controller is not None, availableRevision=revision, **current)

    async def prepare(self, sid, revision):
        if (await self.request(sid)).get("revision") is None:
            archive = await asyncio.to_thread(self.harness.experiments.git.runtime_snapshot, sid, revision)
            await self.request(sid, "prepare", headers={"X-Chorus-Revision": revision}, content=archive)

    async def action(self, sid, command):
        revision = self.revision(sid)
        if command.action == "run":
            await self.prepare(sid, revision)
        if command.action == "forward" and command.port is None:
            raise ChorusError("INVALID_REQUEST", "Choose a port to forward.", 400)
        result = await self.request(sid, command.action, json={"port": command.port})
        return WorkspaceRuntime(enabled=True, availableRevision=self.revision(sid), **result)

    async def terminal(self, sid, origin):
        revision = self.revision(sid)
        await self.prepare(sid, revision)
        return TerminalTicket.model_validate(await self.request(sid, "terminal", json={"origin": origin}))
