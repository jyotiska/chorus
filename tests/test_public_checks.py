"""Checked commits, shared agent feedback, and interruption boundaries."""

import asyncio
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import io
from pathlib import Path
import re
import tarfile

from fastapi.testclient import TestClient
import pytest

from chorus.api import create_app
from chorus.harness import deepswe, public_checks
from chorus.harness.experiment import event
from chorus.harness.models import DeepSWECondition, DeepSWEResult, DeepSWESlot, ExperimentConfig
from chorus.harness.service import HarnessService
from chorus.runtime import checks
from tests.test_deepswe import profile as profile, start_api, wait_api
from tests.test_experiment import command, prior_tools, result, tool, wait_until


@pytest.fixture
def check_profile(tmp_path, monkeypatch):
    path = tmp_path / "public-checks.toml"
    path.write_text(f'''name = "Fixture checks"
image = "public/project:1@sha256:{'a' * 64}"
platform = "linux/amd64"
maxRuns = 2

[[commands]]
id = "unit"
argv = ["pytest", "-q"]
''')
    monkeypatch.setenv("CHORUS_PUBLIC_CHECK_PROFILE", str(path))
    return public_checks.configured_profile()


class CheckingTeam:
    async def __call__(self, model, messages, **options):
        actor = re.search(r"Your identifier is (worker-\d+)\.", messages[0]["content"])[1]
        names = {entry["function"]["name"] for entry in options["tools"]}
        if options["phase"] == "plan":
            assert "public_check_run" not in names
            return result(tool("plan_complete"))
        assert "public_check_run" in names and "public_checks_read" in names
        previous = prior_tools(messages)
        if actor == "worker-1":
            if not previous:
                return result(tool("public_checks_read", commit="", checkId=""))
            if len(previous) == 1:
                return result(tool("public_check_run", commit=previous[-1]["commit"], checkId="unit"))
            if len(previous) == 2:
                assert previous[-1]["status"] == "failed"
                return result(tool("board_write", text="@worker-2 Please investigate the failed public check and merge a repair."))
            return result(tool("agent_finish", reason="Handed off the failure.", remaining=[]))

        if previous and previous[-1].get("status") == "passed":
            return result(tool("agent_finish", reason="Rechecked the merged repair.", remaining=[]))
        if previous and previous[-1].get("status") == "merged":
            return result(tool("public_checks_read", commit="", checkId="unit"))
        if previous and previous[-1].get("status") == "unchecked" and any(p.get("status") == "merged" for p in previous):
            return result(tool("public_check_run", commit=previous[-1]["commit"], checkId="unit"))
        if previous and previous[-1].get("status") == "open":
            return result(tool("pr_merge", id=previous[-1]["id"]))
        if previous and previous[-1].get("status") == "failed":
            assert previous[-1]["requestedBy"] == "worker-1"
            assert previous[-1]["output"] == "Expected 42 but found 0."
            return result(tool("workspace_write", path="src.ts", content="export const answer = 42;\n"),
                          tool("workspace_write", path="tests/public.test.ts", content="// Public regression: expect 42.\n"),
                          tool("git_commit", message="Fix the result and add a public regression."),
                          tool("pr_open", description="Repair the failing public check.", tasks=[]))
        return result(tool("public_checks_read", commit="", checkId="unit"))


def test_swarm_checks_its_own_repair_before_official_grading(tmp_path, profile, check_profile, monkeypatch):
    executed = []

    async def run_public(settings, check, archive):
        assert settings == check_profile.profile and check.id == "unit"
        with tarfile.open(fileobj=io.BytesIO(archive)) as files:
            paths = files.getnames()
            assert not any(path.startswith((".git", "solution", "tests/hidden")) for path in paths)
            contents = files.extractfile("src.ts").read()
            executed.append(contents)
            if b"42" in contents:
                assert "tests/public.test.ts" in paths
                return checks.CheckResult("passed", "Public regression passed.", 0)
        return checks.CheckResult("failed", "Expected 42 but found 0.", 1)

    async def official_grade(self, patch, tree):
        assert len(executed) == 2
        assert b"tests/public.test.ts" in patch and b"export const answer = 42" in patch
        return DeepSWEResult(reward=1)

    monkeypatch.setattr(public_checks, "run_check", run_public)
    monkeypatch.setattr(deepswe.Profile, "grade", official_grade)
    db = str(tmp_path / "swarm.sqlite3")
    condition = {"name": "Team", "model": "qwen3.5:4b-mlx", "slots": [{"guidance": "neutral"}] * 2,
                 "callLimit": 120, "solvingSeconds": 20, "publicChecks": check_profile.digest}
    with TestClient(create_app(db, CheckingTeam(), pacing=0)) as client:
        assert client.get("/api/v2/deepswe/catalog").json()["publicCheckProfile"]["digest"] == check_profile.digest
        created = client.post("/api/v2/deepswe/sessions", json={"task": profile.task.model_dump(), "condition": condition})
        assert created.status_code == 201
        state = created.json()
        sid = state["id"]
        assert state["engineVersion"].endswith(public_checks.VERSION)
        assert not executed
        assert start_api(client, sid, "start", state["revision"]).status_code == 200
        final = wait_api(client, sid, "completed")
        exported = client.get(f"/api/v2/sessions/{sid}/export").json()["records"]
        runs = exported["public_check"]
        assert [row["data"]["status"] for row in runs] == ["running", "failed", "running", "passed"]
        assert [row["agentId"] for row in runs] == ["worker-1", "worker-1", "worker-2", "worker-2"]
        assert runs[1]["data"]["commit"] == profile.task.baseCommit
        frozen = final["experiment"]["frozen"]
        assert runs[-1]["data"]["commit"] == frozen["mainCommit"]
        assert frozen["publicChecks"] == [{"checkId": "unit", "status": "passed", "recordId": runs[-1]["id"]}]
        assert next(row for row in exported["pr"] if row["data"]["status"] == "merged")["agentId"] == "worker-2"
        assert "investigate" in exported["board"][0]["data"]["text"]


@pytest.mark.asyncio
async def test_shared_result_stays_on_its_commit_across_a_merge(store, check_profile, monkeypatch):
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def run_public(settings, check, archive):
        calls.append(archive)
        entered.set()
        await release.wait()
        return checks.CheckResult("passed", exit_code=0) if len(calls) == 1 else checks.CheckResult("unavailable")

    monkeypatch.setattr(public_checks, "run_check", run_public)
    svc = HarnessService(store, CheckingTeam())
    runtime = svc.experiments
    first, second = "frontend-engineer", "qa-engineer"
    state = runtime.create(ExperimentConfig(problemId="todoist", participantIds=[first, second], publicChecks=check_profile.digest))
    sid = state.id
    try:
        def building(current):
            current.status, current.experiment.phase = "running", "build"
        state = svc.repo.change(sid, building)
        base = state.experiment.repository.mainCommit
        original = asyncio.create_task(runtime.public_checks.request(state, first, "original", "unit", base))
        async with asyncio.timeout(5):
            await entered.wait()
        duplicate = asyncio.create_task(runtime.public_checks.request(state, second, "duplicate", "unit", base))
        await asyncio.sleep(0)
        checkout = state.experiment.repository.worktrees[0]
        Path(checkout.path, "frontend", "new.txt").write_text("new commit\n")
        runtime.git.commit(sid, first, "New commit")
        pr = runtime.git.open_pr(sid, first, "Merge while a check runs", [])
        runtime.git.merge_pr(sid, first, pr)
        release.set()
        for outcome in await asyncio.gather(original, duplicate):
            assert outcome["status"] == "passed" and outcome["current"] is False and outcome["commit"] == base
            assert outcome["recordId"] == "public-check:original"
        assert len(calls) == 1
        latest = runtime.git.main_commit(sid)
        assert latest != base
        assert runtime.public_checks.read(state, {"commit": "", "checkId": "unit"})["status"] == "unchecked"
        assert (await runtime.public_checks.request(state, first, "stale", "unit", base))["status"] == "stale"
        assert (await runtime.public_checks.request(state, first, "latest", "unit", latest))["status"] == "unavailable"
        assert (await runtime.public_checks.request(state, first, "retry", "unit", latest))["status"] == "limit_reached"
        assert len(calls) == 2
    finally:
        release.set()
        await svc.close()


class CheckingWorker:
    async def __call__(self, model, messages, **options):
        if options["phase"] == "plan":
            return result(tool("plan_complete"))
        previous = prior_tools(messages)
        if not previous:
            return result(tool("public_checks_read", commit="", checkId=""))
        if previous[-1].get("status") == "cancelled":
            return result(tool("agent_finish", reason="The check was interrupted.", remaining=[]))
        return result(tool("public_check_run", commit=previous[-1]["commit"], checkId="unit"))


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", ["kill", "deadline"])
async def test_solving_stop_cancels_public_check(store, check_profile, profile, monkeypatch, stop):
    entered, stopped = asyncio.Event(), asyncio.Event()

    async def run_public(*args):
        entered.set()
        try:
            await asyncio.Future()
        finally:
            stopped.set()

    async def grade(*args):
        assert stopped.is_set()
        return DeepSWEResult(reward=0)

    monkeypatch.setattr(public_checks, "run_check", run_public)
    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    svc = HarnessService(store, CheckingWorker())
    condition = DeepSWECondition(name="Solo", model="qwen3.5:4b-mlx", slots=[DeepSWESlot(guidance="neutral")],
                                 callLimit=20, solvingSeconds=3, publicChecks=check_profile.digest)
    sid = svc.experiments.create_deepswe(profile, condition).id
    try:
        command(svc, sid, "start")
        async with asyncio.timeout(5):
            await entered.wait()
        if stop == "kill":
            command(svc, sid, "kill")
            await wait_until(svc, sid, lambda state: state.status == "killed")
        else:
            done = await wait_until(svc, sid, lambda state: state.status == "completed")
            assert done.experiment.deepswe.stopReason == "deadline"
            assert [summary.status for summary in done.experiment.frozen.publicChecks] == ["cancelled"]
        assert stopped.is_set()
        assert [record.data["status"] for record in svc.repo.all(sid, public_checks.KIND)] == ["running", "cancelled"]
    finally:
        await svc.close()


@pytest.mark.asyncio
async def test_restart_settles_interrupted_request_without_rerunning(store, profile, check_profile, monkeypatch):
    async def unexpected(*args):
        pytest.fail("An interrupted check must not rerun implicitly.")

    async def grade(*args):
        return DeepSWEResult(reward=0)

    monkeypatch.setattr(public_checks, "run_check", unexpected)
    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    condition = DeepSWECondition(name="Solo", model="qwen3.5:4b-mlx", slots=[DeepSWESlot(guidance="neutral")],
                                 callLimit=20, solvingSeconds=30, publicChecks=check_profile.digest)
    factory = HarnessService(store, CheckingWorker())
    state = factory.experiments.create_deepswe(profile, condition)
    sid, actor, model_call_id = state.id, "worker-1", "model-call"
    sha = state.experiment.repository.mainCommit
    call = tool("public_check_run", commit=sha, checkId="unit")
    key = sha256(f"{actor}:{model_call_id}:{call['id']}".encode()).hexdigest()

    def interrupted(current):
        current.status, current.experiment.phase = "running", "build"
        current.experiment.deepswe.deadlineAt = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()

    factory.repo.change(sid, interrupted, records=[
        event("conversation", actor, {"phase": "build", "message": {"role": "assistant", "content": "", "tool_calls": [call]},
                                       "modelCallId": model_call_id}),
        event(public_checks.KIND, actor, {"runId": key, "checkId": "unit", "commit": sha, "status": "running"},
              id=f"public-check-start:{key}"),
    ])
    svc = HarnessService(store, CheckingWorker())
    try:
        assert svc.repo.get(sid).status == "paused"
        command(svc, sid, "resume")
        done = await wait_until(svc, sid, lambda current: current.status == "completed")
        assert done.experiment.frozen.publicChecks[0].status == "cancelled"
        assert [record.data["status"] for record in svc.repo.all(sid, public_checks.KIND)] == ["running", "cancelled"]
    finally:
        await svc.close()
        await factory.close()


@pytest.mark.asyncio
async def test_runner_uses_fixed_offline_container_and_removes_it(check_profile, monkeypatch):
    observed = []

    async def docker(*args, data=None):
        observed.append((args, data))
        if "--workdir" in args:
            return 1, b"test output\x00\n", True
        return 0, b"true", False

    monkeypatch.setattr(checks, "docker", docker)
    settings = check_profile.profile
    outcome = await checks.run_check(settings, settings.commands[0], b"archive")
    assert outcome == checks.CheckResult("failed", "test output\n", 1, True)
    launch = observed[0][0]
    assert {"--rm", "--network=none", "--read-only", "--user=1000:1000", "--cap-drop=ALL"} <= set(launch)
    assert "--mount" not in launch and "-v" not in launch
    assert observed[1][1] == b"archive"
    assert observed[2][0][-2:] == ("pytest", "-q")
    assert observed[-1][0][:2] == ("rm", "-f")
