"""Agent-requested public checks and their commit-scoped evidence."""

import asyncio
from dataclasses import dataclass
from hashlib import sha256
import os
from pathlib import Path
import re
import tomllib

from chorus.harness.models import PublicCheckPin, PublicCheckProfile, PublicCheckSummary, Record
from chorus.runtime.checks import CheckResult, run_check
from chorus.services.errors import ChorusError
from chorus.storage import now


KIND = "public_check"
VERSION = "+public-checks-v1"
REVISION = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})")


def configured_profile():
    path = os.getenv("CHORUS_PUBLIC_CHECK_PROFILE")
    if not path:
        return None
    try:
        with Path(path).open("rb") as stream:
            content = stream.read(32_769)
        if len(content) > 32_768:
            raise ValueError("Profile is too large")
        profile = PublicCheckProfile.model_validate(tomllib.loads(content.decode("utf-8")))
    except (OSError, ValueError) as error:
        raise ChorusError("WORKSPACE_UNAVAILABLE", "Check the local public check profile configuration.", 503) from error
    return PublicCheckPin(digest=sha256(profile.model_dump_json().encode()).hexdigest(), profile=profile)


def available_profile():
    try:
        return configured_profile()
    except ChorusError:
        return None


def resolve_profile(digest):
    if digest is None:
        return None
    pin = configured_profile()
    if pin is None or pin.digest != digest:
        raise ChorusError("VERSION_MISMATCH", "The public check profile changed or is unavailable. Reload setup or restore the pinned profile.", 409)
    return pin


@dataclass
class PendingCheck:
    commit: str
    check_id: str
    task: asyncio.Task


class PublicChecks:
    def __init__(self, repo, git):
        self.repo = repo
        self.git = git
        self.pending: dict[str, PendingCheck] = {}

    def history(self, sid):
        return {record.data["runId"]: record for record in self.repo.all(sid, KIND)}

    def read(self, state, args):
        sid = state.id
        main = self.git.main_commit(sid)
        commit = args["commit"] or main
        if not REVISION.fullmatch(commit):
            raise ValueError("Use a full commit SHA or an empty string for current main.")
        profile = state.experiment.publicCheckProfile.profile
        checks = {command.id: command for command in profile.commands}
        check_id = args["checkId"]
        if check_id and check_id not in checks:
            raise ValueError("Choose an approved public check ID.")
        history = self.history(sid)
        latest = {item.data["checkId"]: item for item in history.values() if item.data["commit"] == commit}
        if check_id:
            record = latest.get(check_id)
            return self.view(state.id, record) if record else {"status": "unchecked", "commit": commit, "current": commit == main}
        return {"commit": commit, "current": commit == main, "runsUsed": len(history), "maxRuns": profile.maxRuns,
                "checks": [{"checkId": name, "status": latest[name].data["status"] if name in latest else "unchecked"}
                           for name in checks]}

    def view(self, sid, record):
        return {**record.data, "recordId": record.id, "requestedBy": record.agentId,
                "current": record.data["commit"] == self.git.main_commit(sid)}

    async def request(self, state, actor, key, check_id, commit, *, restoring=False):
        sid, generation = state.id, state.generation
        profile = state.experiment.publicCheckProfile.profile
        command = next((item for item in profile.commands if item.id == check_id), None)
        if command is None:
            raise ValueError("Choose an approved public check ID.")
        if result := self.repo.record(sid, f"public-check:{key}"):
            return self.view(sid, result)
        if restoring:
            return {"status": "cancelled", "message": "The request was interrupted. Request a new check if needed."}
        if commit != self.git.main_commit(sid):
            return {"status": "stale", "message": "Main moved. Use public_checks_read before making a new request."}
        if pending := self.pending.get(sid):
            if (pending.commit, pending.check_id) == (commit, check_id):
                return self.view(sid, await asyncio.shield(pending.task))
            return {"status": "busy", "message": "A public check is already running for this experiment."}
        if len(self.history(sid)) >= profile.maxRuns:
            return {"status": "limit_reached", "message": "The experiment has used its public check allowance."}
        if len(self.pending) >= 2:
            return {"status": "busy", "message": "The local public check worker is at capacity."}
        start = self.repo.append(sid, KIND, actor, 0, {"runId": key, "checkId": check_id, "commit": commit, "status": "running"},
                                 generation=generation, record_id=f"public-check-start:{key}")
        task = asyncio.create_task(self.execute(sid, generation, start, profile, command))
        self.pending[sid] = PendingCheck(commit, check_id, task)
        return self.view(sid, await asyncio.shield(task))

    async def execute(self, sid, generation, start, profile, command):
        try:
            try:
                archive = await asyncio.to_thread(self.git.runtime_snapshot, sid, start.data["commit"])
                result = await run_check(profile, command, archive)
            except (ChorusError, OSError, ValueError):
                result = CheckResult("unavailable", "The committed snapshot could not be checked.")
            record = self.finish(start, result)
            def publish(current):
                if current.status != "running" or current.experiment.phase != "build":
                    raise ChorusError("CANCELLED", "Build has ended.", 409)
            self.repo.change(sid, publish, records=[record], generation=generation)
            return record
        finally:
            self.pending.pop(sid, None)

    @staticmethod
    def finish(start, result):
        return Record(id=f"public-check:{start.data['runId']}", kind=KIND, agentId=start.agentId, turn=0,
                      sequence=0, createdAt=now(), data={**start.data, "status": result.status, "output": result.output,
                                                        "exitCode": result.exit_code, "truncated": result.truncated})

    async def cancel(self, sid):
        if pending := self.pending.get(sid):
            pending.task.cancel()
            await asyncio.gather(pending.task, return_exceptions=True)
            self.pending.pop(sid, None)

    def interruptions(self, state):
        if state.experiment.publicCheckProfile is None:
            return []
        return [self.finish(record, CheckResult("cancelled", "The experiment stopped or the check was interrupted."))
                for record in self.history(state.id).values() if record.data["status"] == "running"]

    def summaries(self, state, commit):
        pin = state.experiment.publicCheckProfile
        if not pin:
            return []
        latest = {item.data["checkId"]: item for item in self.history(state.id).values()
                  if item.data["commit"] == commit and item.data["status"] != "running"}
        return [PublicCheckSummary(checkId=command.id, status=latest[command.id].data["status"], recordId=latest[command.id].id)
                if command.id in latest else PublicCheckSummary(checkId=command.id, status="unchecked")
                for command in pin.profile.commands]
