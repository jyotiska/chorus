"""DeepSWE task selection, submission, verification and recovery."""
import asyncio
from dataclasses import replace
from hashlib import sha256
import json
import re
import shlex
import subprocess
import sys
import time
import tomllib

from fastapi.testclient import TestClient
import pytest

from chorus.api import create_app
from chorus.harness import deepswe
from chorus.harness.experiment_catalog import DEFAULT_PARTICIPANT_IDS
from chorus.harness.experiment_git import _git
from chorus.harness.models import DeepSWEResult, DeepSWETask
from chorus.harness.service import HarnessService
from chorus.services.errors import ChorusError
from tests.test_experiment import command, prior_tools, result, tool, wait_until


IMAGE = "fixture/task:1@sha256:" + "a" * 64
VERIFIER_IMAGE = "fixture/verifier:1@sha256:" + "b" * 64
PUBLIC_INSTRUCTION = "Implement the public repository task."


def git_repo(path):
    path.mkdir()
    _git(path, "init", "--template=", "--initial-branch=main")
    return path


def commit_all(path):
    _git(path, "add", "--all")
    _git(path, "commit", "-m", "Fixture baseline")
    return _git(path, "rev-parse", "HEAD").stdout.strip()


@pytest.fixture
def profile(tmp_path, monkeypatch):
    repository = git_repo(tmp_path / "repo")
    repository.joinpath("SPEC.md").write_text("Repository-owned document.\n")
    repository.joinpath("src.ts").write_text("export const answer = 0;\n")
    base = commit_all(repository)
    tree = _git(repository, "rev-parse", "HEAD^{tree}").stdout.strip()
    dataset = git_repo(tmp_path / "dataset")
    task_dir = dataset / deepswe.TASK_DIR
    task_dir.mkdir(parents=True)
    task_dir.joinpath("instruction.md").write_text(PUBLIC_INSTRUCTION)
    task_dir.joinpath("task.toml").write_text(f"""
[metadata]
base_commit_hash = "{base}"
[environment]
docker_image = "fixture/task:1"
allow_internet = true
[[verifier.collect]]
from = "agent"
[verifier.environment]
docker_image = "fixture/verifier:1"
""")
    revision = commit_all(dataset)
    task = DeepSWETask(id=deepswe.TASK_ID, datasetCommit=revision, baseCommit=base, baseTree=tree,
                       image=IMAGE, verifierImage=VERIFIER_IMAGE, platform="linux/amd64", pierVersion=deepswe.PIER_VERSION)
    fixture = deepswe.Profile(task, PUBLIC_INSTRUCTION, dataset, repository, tmp_path / "pier",
                              task_dir.joinpath("task.toml").read_text())
    monkeypatch.setattr(deepswe.Profile, "load", lambda: fixture)
    monkeypatch.setattr(deepswe.Profile, "check_docker", lambda self: None)
    return fixture


class DefaultTeamProvider:
    def __init__(self):
        self.calls = []

    async def __call__(self, model, messages, **options):
        phase = options["phase"]
        actor = re.search(r"Your identifier is ([a-z-]+)\.", messages[0]["content"])[1]
        self.calls.append((actor, phase))
        if phase == "plan":
            assert messages[1]["content"] == PUBLIC_INSTRUCTION
            return result(tool("plan_complete"))
        if actor != DEFAULT_PARTICIPANT_IDS[0]:
            return result(tool("agent_finish", reason="Ready.", remaining=[]))
        if not prior_tools(messages):
            return result(tool("workspace_write", path="src.ts", content="export const answer = 42;\n"),
                          tool("workspace_write", path="SPEC.md", content="Updated repository document.\n"),
                          tool("git_commit", message="Implement the task."),
                          tool("pr_open", description="Complete the reference task.", tasks=[]))
        opened = next(entry for entry in prior_tools(messages) if entry.get("status") == "open")
        return result(tool("pr_merge", id=opened["id"]))


def start_api(client, sid, action, revision):
    return client.post(f"/api/v2/sessions/{sid}/commands", json={
        "commandId": action, "expectedRevision": revision, "action": action,
    })


def wait_api(client, sid, status):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        current = client.get(f"/api/v2/sessions/{sid}").json()
        if current["status"] == status:
            return current
        time.sleep(0.025)
    pytest.fail(f"Expected {status}, got {current['status']}: {current['error']}")


def test_default_team_merges_last_admitted_call_and_retries_frozen_patch(tmp_path, profile, monkeypatch):
    monkeypatch.setattr(deepswe, "CALL_LIMIT", 13)
    provider = DefaultTeamProvider()
    attempts = []

    async def grade(self, patch, tree):
        attempts.append((patch, tree))
        if len(attempts) == 1:
            raise deepswe.unavailable("Fixture verifier failed.")
        return DeepSWEResult(reward=1, tests=2, passed=2, failed=0)

    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    db = str(tmp_path / "chorus.sqlite3")
    with TestClient(create_app(db, provider, pacing=0)) as client:
        catalog = client.get("/api/v2/deepswe/catalog").json()
        assert catalog["problem"]["statement"] == PUBLIC_INSTRUCTION
        assert catalog["problem"]["participantIds"] == list(DEFAULT_PARTICIPANT_IDS)
        response = client.post("/api/v2/deepswe/sessions")
        assert response.status_code == 201
        created = response.json()
        sid = created["id"]
        assert created["config"]["participantIds"] == list(DEFAULT_PARTICIPANT_IDS)
        assert created["experiment"]["repository"]["baselineCommit"] == profile.task.baseCommit
        assert client.get(f"/api/v2/sessions/{sid}/runtime").status_code == 404
        assert start_api(client, sid, "start", created["revision"]).status_code == 200
        ungraded = wait_api(client, sid, "verify_failed")
        state = ungraded["experiment"]["deepswe"]
        patch = client.get(f"/api/v2/sessions/{sid}/deepswe/patch")
        assert patch.status_code == 200
        assert sha256(patch.content).hexdigest() == state["patchDigest"]
        assert b"+export const answer = 42;" in patch.content
        assert b"+Updated repository document." in patch.content
        assert b"Product specification" not in patch.content
        assert state["result"] is None
        assert state["callsReserved"] == len(provider.calls) == 13
        assert state["stopReason"] == "call_limit"
        assert ungraded["experiment"]["report"] is None
        assert client.get(f"/api/v2/sessions/{sid}/usage").json()["participants"]["callCount"] == 13

    with TestClient(create_app(db, provider, pacing=0)) as client:
        restored = client.get(f"/api/v2/sessions/{sid}").json()
        assert restored["experiment"]["deepswe"]["patchDigest"] == state["patchDigest"]
        assert start_api(client, sid, "retry_verification", restored["revision"]).status_code == 200
        completed = wait_api(client, sid, "completed")
        final = completed["experiment"]["deepswe"]
        assert final["result"] == {"reward": 1, "tests": 2, "passed": 2, "failed": 0, "compilationFailure": None}
        assert final["verificationAttempts"] == 2
        assert len(provider.calls) == 13
        assert attempts == [(patch.content, state["submittedTree"])] * 2


async def test_deadline_fences_provider_output_and_grades_the_empty_patch(store, profile, monkeypatch):
    monkeypatch.setattr(deepswe, "SOLVING_SECONDS", 1)
    entered = asyncio.Event()

    async def provider(model, messages, **options):
        entered.set()
        try:
            await asyncio.sleep(20)
        except asyncio.CancelledError:
            return result(tool("board_write", text="Late publication."))

    async def grade(self, patch, tree):
        assert patch == b""
        assert tree == profile.task.baseTree
        return DeepSWEResult(reward=0)

    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    svc = HarnessService(store, provider)
    try:
        state = svc.experiments.create_deepswe(profile)
        command(svc, state.id, "start")
        await asyncio.wait_for(entered.wait(), 2)
        completed = await wait_until(svc, state.id, lambda current: current.status == "completed")
        assert completed.experiment.deepswe.stopReason == "deadline"
        assert completed.experiment.deepswe.result.reward == 0
        assert completed.boardCount == 0
    finally:
        await svc.close()


def test_missing_verifier_leaves_other_launchers_available(tmp_path, model):
    with TestClient(create_app(str(tmp_path / "chorus.sqlite3"), model, pacing=0)) as client:
        catalog = client.get("/api/v2/deepswe/catalog").json()
        assert catalog["task"] is None
        assert "CHORUS_DEEPSWE_PROFILE" in catalog["unavailableReason"]
        assert client.post("/api/v2/deepswe/sessions").status_code == 503
        assert client.post("/api/v2/experiments", json={"problemId": "other", "customStatement": "Plan a trip.",
                           "participantIds": ["general-agent"]}).status_code == 201


def test_patch_replay_commits_the_expected_tree(tmp_path, profile):
    origin = profile.repository
    origin.joinpath("src.ts").write_text("export const answer = 42;\n")
    _git(origin, "add", "src.ts")
    patch = _git(origin, "diff", "--cached", "--binary", binary=True).stdout
    tree = _git(origin, "write-tree").stdout.strip()
    checkout = git_repo(tmp_path / "replay")
    _git(checkout, "fetch", str(origin), profile.task.baseCommit)
    _git(checkout, "checkout", "--detach", "FETCH_HEAD")
    # A prepared task image can have a dirty worktree or stale index stat data.
    (checkout / "src.ts").write_text("Image preparation modified this copy.")
    task = tmp_path / "task"
    task.mkdir()
    deepswe.install_replay(task, patch, profile.task.baseCommit, tree)
    script = task / "solution" / "solve.sh"
    script.write_text(script.read_text().replace("cd /app", "cd " + shlex.quote(str(checkout))))
    subprocess.run([str(script)], check=True, capture_output=True)
    assert _git(checkout, "rev-parse", "HEAD^{tree}").stdout.strip() == tree
    assert _git(checkout, "rev-parse", "HEAD^").stdout.strip() == profile.task.baseCommit


async def test_pier_subprocess_gets_pinned_offline_task_and_replay_files(profile, monkeypatch):
    monkeypatch.setenv("CHORUS_API_KEY", "do-not-forward")
    manifest = deepswe.pin_environment(profile.manifest, "environment", IMAGE)
    manifest = deepswe.pin_environment(manifest, "verifier.environment", VERIFIER_IMAGE)
    verifier = tomllib.loads(manifest)["verifier"]
    assert verifier["collect"] == [{"from": "agent"}]
    assert verifier["environment"] == {"docker_image": VERIFIER_IMAGE, "allow_internet": False}
    profile.pier.write_text(f"#!{sys.executable}\n" + '''
import json
import os
from pathlib import Path
import sys
import tomllib

args = sys.argv[1:]
assert args[0] == "run" and args[args.index("--agent") + 1] == "oracle"
assert "CHORUS_API_KEY" not in os.environ
assert os.environ["DOCKER_DEFAULT_PLATFORM"] == "linux/amd64"
task = Path(args[args.index("-p") + 1])
manifest = tomllib.loads((task / "task.toml").read_text())
assert manifest["environment"]["allow_internet"] is False
assert manifest["environment"]["docker_image"].startswith("fixture/task:1@sha256:")
assert (task / "solution" / "submission.patch").read_bytes() == b""
assert (task / "solution" / "solve.sh").exists()
trial = Path(args[args.index("--jobs-dir") + 1]) / args[args.index("--job-name") + 1] / "trial"
verifier = trial / "verifier"
verifier.mkdir(parents=True)
(trial / "artifacts").mkdir()
(trial / "artifacts" / "model.patch").write_bytes(b"")
(trial / "result.json").write_text(json.dumps({"verifier_result": {"rewards": {"reward": 0}}}))
(verifier / "reward.json").write_text(json.dumps({"reward": 0}))
(verifier / "ctrf.json").write_text(json.dumps({"results": {"summary": {"tests": 2, "passed": 1, "failed": 1}}}))
''')
    profile.pier.chmod(0o700)
    result = await replace(profile, manifest=manifest).grade(b"", profile.task.baseTree)
    assert result == DeepSWEResult(reward=0, tests=2, passed=1, failed=1)


@pytest.mark.parametrize(("reward", "reported", "exception", "accepted"), [
    (1, 1, None, 1), (0.0, 0, None, 0), (-1, -1, None, None), (0, 0, {"message": "crash"}, None),
    (True, 1, None, None), (1, 0, None, None), (None, 0, None, None),
])
def test_result_only_accepts_official_binary_rewards(tmp_path, reward, reported, exception, accepted):
    trial = tmp_path / "trial"
    verifier = trial / "verifier"
    verifier.mkdir(parents=True)
    trial.joinpath("result.json").write_text(json.dumps({
        "verifier_result": {"rewards": {"reward": reported}}, "exception_info": exception,
    }))
    if reward is not None:
        verifier.joinpath("reward.json").write_text(json.dumps({"reward": reward}))
    if accepted is None:
        with pytest.raises(ChorusError, match="valid binary reward"):
            deepswe.read_result(tmp_path)
    else:
        assert deepswe.read_result(tmp_path).reward == accepted


def study_manifest(profile, repeats=3):
    neutral = {"guidance": "neutral"}
    common = {"model": "gpt-6-luna", "callLimit": 24, "solvingSeconds": 120}
    return {
        "name": "Solo vs team", "requestId": "trial-study", "task": profile.task.model_dump(), "repeats": repeats,
        "conditions": [
            {**common, "name": "Solo", "slots": [neutral]},
            {**common, "name": "Team", "slots": [neutral, {**neutral, "model": "qwen3.5:4b-mlx"}, neutral]},
        ],
    }


def test_finished_submission_is_graded_without_solver_feedback(tmp_path, profile, monkeypatch):
    calls = []

    async def provider(model, messages, **options):
        calls.append(options["phase"])
        if options["phase"] == "plan":
            return result(tool("plan_complete"))
        if len(calls) == 2:
            return result(tool("workspace_write", path="src.ts", content="export const answer = 1;"),
                          tool("git_commit", message="Update feature"), tool("pr_open", description="Feature", tasks=[]))
        assert len(calls) == 3
        return result(tool("pr_merge", id=prior_tools(messages)[-1]["id"]),
                      tool("agent_finish", reason="Submitted.", remaining=[]))

    async def grade(self, patch, tree):
        assert b"+export const answer = 1;" in patch
        return DeepSWEResult(reward=0, compilationFailure="Observer-only diagnostic.")

    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    condition = study_manifest(profile)["conditions"][0]
    with TestClient(create_app(str(tmp_path / "clean.sqlite3"), provider, pacing=0)) as client:
        created = client.post("/api/v2/deepswe/sessions", json={"task": profile.task.model_dump(),
                              "condition": condition}).json()
        sid = created["id"]
        assert start_api(client, sid, "start", created["revision"]).status_code == 200
        completed = wait_api(client, sid, "completed")
        assert completed["experiment"]["deepswe"]["result"]["reward"] == 0
        assert calls == ["plan", "build", "build"]
        assert "Observer-only diagnostic." not in str(client.get(f"/api/v2/sessions/{sid}/export").json()["records"]["request"])


def test_verifier_reports_compile_failure_without_exposing_test_body(tmp_path):
    out = tmp_path / "test-stdout.txt"
    assert deepswe.compilation_failure(tmp_path) is None
    out.write_text("PASS baseline.test.ts\nFAIL feature.test.ts\n  ● Test suite failed to run\n"
                   "  src/example.ts:1:2 - \x1b[91merror\x1b[0m TS2394: incompatible overload.\n"
                   "  private test body\nTest Suites: 1 failed\nTests: 0 total\n")
    detail = deepswe.compilation_failure(tmp_path)
    assert "feature.test.ts" in detail and "TS2394" in detail and "private test body" not in detail
    out.write_text("FAIL feature.test.ts\nAssertion failed\nTest Suites: 1 failed\nTests: 1 failed\n")
    assert deepswe.compilation_failure(tmp_path) is None


def test_private_edits_and_unpublished_commits_cannot_finish(tmp_path, profile, monkeypatch):
    def finish():
        return tool("agent_finish", reason="Done.", remaining=[])
    integrated = asyncio.Event()
    content = "export const matchEach = 42;\n"

    async def provider(model, messages, **options):
        if options["phase"] == "plan":
            return result(tool("plan_complete"))
        history = prior_tools(messages)
        if "Your identifier is worker-2." in messages[0]["content"]:
            if not history:
                await asyncio.wait_for(integrated.wait(), 5)
                return result(tool("submission_status"))
            if "mainCommit" in history[-1]:
                # This reviewer's checkout still points at the original tree.
                assert history[-1]["workerCommit"] == profile.task.baseCommit
                return result(tool("main_read", path="new.ts", revision=history[-1]["mainCommit"], offset=0))
            assert history[-1]["content"] == content
            return result(finish())
        if not history:
            return result(tool("workspace_write", path="new.ts", content=content), finish())
        last = history[-1]
        if last.get("changedFileCount"):
            assert last["code"] == "WORK_NOT_SUBMITTED" and last["changes"] == ["?? new.ts"]
            return result(tool("git_commit", message="Implement feature"), finish())
        if last.get("unmergedCommits"):
            assert last["code"] == "WORK_NOT_SUBMITTED"
            return result(tool("main_read", path="new.ts", revision=last["workerCommit"], offset=0),
                          tool("pr_open", description="Publish feature", tasks=[]), finish())
        if last.get("code") == "PRS_NOT_INTEGRATED":
            assert history[-3]["code"] == "NOT_FOUND"
            return result(tool("pr_merge", id=history[-2]["id"]))
        assert last["status"] == "merged"
        integrated.set()
        return result(finish())

    async def grade(self, patch, tree):
        assert content.encode() in patch
        return DeepSWEResult(reward=1)

    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    condition = study_manifest(profile)["conditions"][0]
    condition["slots"] = [{"guidance": "neutral"}] * 2
    payload = {"task": profile.task.model_dump(), "condition": condition}
    with TestClient(create_app(str(tmp_path / "finish.sqlite3"), provider, pacing=0)) as client:
        created = client.post("/api/v2/deepswe/sessions", json=payload).json()
        sid = created["id"]
        assert start_api(client, sid, "start", created["revision"]).status_code == 200
        completed = wait_api(client, sid, "completed")
        assert [w["state"] for w in completed["workers"]] == ["finished", "finished"]
        assert completed["experiment"]["deepswe"]["result"]["reward"] == 1


def test_configurable_campaign_routes_models_and_compares_frozen_trials(tmp_path, profile, monkeypatch):
    seen = []
    async def provider(model, messages, **options):
        instructions = messages[0]["content"]
        assert "Background:" not in instructions and "Traits:" not in instructions
        actor = re.search(r"Your identifier is ([\w-]+)\.", instructions)[1]
        seen.append((actor, model))
        if options["phase"] == "plan":
            return result(tool("plan_complete"))
        if actor == "worker-2":
            if not prior_tools(messages):
                return result(tool("workspace_write", path="src.ts", content="export const answer = 42;\n"),
                              tool("git_commit", message="Implement feature"), tool("pr_open", description="Add feature", tasks=[]))
            records = prior_tools(messages)
            if not any(r.get("status") == "merged" for r in records):
                opened = next(r for r in records if r.get("status") == "open")
                return result(tool("pr_merge", id=opened["id"]))
        return result(tool("agent_finish", reason="Done.", remaining=[]))

    async def grade(self, patch, tree):
        return DeepSWEResult(reward=int(b"answer = 42" in patch))
    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    manifest = study_manifest(profile)
    base = "/api/v2/deepswe/campaigns"
    db = str(tmp_path / "study.sqlite3")
    with TestClient(create_app(db, provider, pacing=0)) as client:
        created = client.post(base, json=manifest)
        assert created.status_code == 201, created.text
        assert created.json()["callCeiling"] == 144
        assert client.post(base, json=manifest).json()["id"] == manifest["requestId"]
        assert client.post(base, json={**manifest, "repeats": 1}).status_code == 409
        endpoint = base + "/" + manifest["requestId"]
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            report = client.get(endpoint).json()
            if report["status"] != "running":
                break
            time.sleep(.1)
        assert report["status"] == "finished", report
        assert len({t["sessionId"] for t in report["trials"]}) == 6
        solo, team = report["scores"]
        assert [solo["passed"], solo["graded"], team["passed"], team["graded"]] == [0, 3, 3, 3]
        assert team["deltaPoints"] == 100 and team["pairedCount"] == 3
        comparison = client.get(endpoint + "/comparison", params={"other": manifest["requestId"], "candidate": "Team",
                                                                  "baseline": "Solo"}).json()
        assert (comparison["wins"], comparison["losses"], comparison["ties"], comparison["deltaPoints"]) == (3, 0, 0, 100)
        assert ("worker-2", "qwen3.5:4b-mlx") in seen and ("worker-1", "gpt-6-luna") in seen
        assert all(t["usage"]["callCount"] == t["calls"] for t in report["trials"])
    with TestClient(create_app(db, provider, pacing=0)) as client:
        assert client.get(endpoint).json() == report
        assert client.get(base).json()[0]["name"] == manifest["name"]


def test_deepswe_condition_guidance_and_task_validation(tmp_path, profile, model):
    condition = study_manifest(profile)["conditions"][0]
    condition["slots"] = [{"guidance": "role", "profileId": "frontend-engineer"},
                          {"guidance": "full", "profileId": "frontend-engineer"}]
    payload = {"task": profile.task.model_dump(), "condition": condition}
    with TestClient(create_app(str(tmp_path / "slots.sqlite3"), model, pacing=0)) as client:
        url = "/api/v2/deepswe/sessions"
        assert client.post(url, json={**payload, "task": {**payload["task"], "datasetCommit": "changed"}}).status_code == 409
        assert client.post(url, json={**payload, "condition": {**condition, "model": "unknown"}}).status_code == 400
        response = client.post(url, json=payload)
        assert response.status_code == 201, response.text
        state = response.json()
        assert state["engineVersion"] == deepswe.TEAM_VERSION
        role, full = state["agents"]
        assert role["role"] == full["role"] and role["id"] != full["id"]
        assert role["traits"] == [] and not role["introduction"] and full["traits"]


def test_registered_task_uses_its_own_pins_for_campaign_and_verification(tmp_path, profile, monkeypatch):
    task_id = "other-repository-task"
    repository = git_repo(tmp_path / "other-repo")
    repository.joinpath("feature.py").write_text("answer = 0\n")
    base_commit = commit_all(repository)
    source = profile.dataset / "tasks" / task_id
    source.mkdir()
    statement = "Implement the second repository task."
    source.joinpath("instruction.md").write_text(statement)
    source.joinpath("task.toml").write_text(profile.manifest.replace(profile.task.baseCommit, base_commit).replace(
        "[metadata]", f'[metadata]\ntask_id = "{task_id}"\ndisplay_title = "Second task"\nlanguage = "python"',
    ))
    dataset_commit = commit_all(profile.dataset)
    profile.pier.touch(mode=0o755)
    python = profile.pier.with_name("python")
    python.write_text(f"#!/bin/sh\nprintf '%s\\n' {deepswe.PIER_VERSION}\n")
    python.chmod(0o755)
    which = deepswe.shutil.which
    monkeypatch.setattr(deepswe.shutil, "which", lambda name: "/fake/docker" if name == "docker" else which(name))
    registry = tmp_path / "profiles"
    registry.mkdir()
    profile_path = registry / f"{task_id}.toml"
    settings = dict(task_id=task_id, dataset=str(profile.dataset), dataset_commit=dataset_commit,
                    repository=str(repository), base_commit=base_commit, image=IMAGE, verifier_image=VERIFIER_IMAGE,
                    platform=profile.task.platform, pier=str(profile.pier))
    profile_path.write_text("".join(f"{key} = {json.dumps(value)}\n" for key, value in settings.items()))
    monkeypatch.setenv("CHORUS_DEEPSWE_PROFILES_DIR", str(registry))
    selected = deepswe.Profile.from_file(profile_path)
    copied = selected.copy_task(tmp_path / "verifier")
    assert copied.name == task_id and copied.joinpath("instruction.md").read_text() == statement

    async def provider(model, messages, **options):
        if options["phase"] == "plan":
            assert messages[1]["content"] == statement
            return result(tool("plan_complete"))
        return result(tool("agent_finish", reason="Done.", remaining=[]))

    attempts = []

    async def grade(self, patch, tree):
        attempts.append(self.task)
        assert patch == b"" and tree == selected.task.baseTree
        if len(attempts) == 1:
            raise deepswe.unavailable("Fixture verifier failed.")
        return DeepSWEResult(reward=0)

    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    with TestClient(create_app(str(tmp_path / "registry.sqlite3"), provider, pacing=0)) as client:
        base = "/api/v2/deepswe"
        catalog = client.get(f"{base}/catalog").json()
        assert catalog["task"] == profile.task.model_dump()
        assert [entry["task"]["id"] for entry in catalog["tasks"]] == [deepswe.TASK_ID, task_id]
        option = catalog["tasks"][1]
        assert option["problem"]["domain"] == "DeepSWE · Python"
        assert option["problem"]["title"] == "Second task"

        manifest = study_manifest(selected, repeats=1)
        manifest["conditions"] = manifest["conditions"][:1]
        wrong = {**manifest, "task": {**option["task"], "baseTree": profile.task.baseTree}}
        assert client.post(f"{base}/campaigns", json=wrong).status_code == 409
        campaign = client.post(f"{base}/campaigns", json=manifest)
        assert campaign.status_code == 201, campaign.text
        endpoint = f"{base}/campaigns/{manifest['requestId']}"
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            report = client.get(endpoint).json()
            if report["status"] == "finished":
                break
            time.sleep(0.025)
        assert report["status"] == "finished", report
        sid = report["trials"][0]["sessionId"]
        failed = wait_api(client, sid, "verify_failed")
        assert failed["experiment"]["repository"]["baselineCommit"] == base_commit
        assert start_api(client, sid, "retry_verification", failed["revision"]).status_code == 200
        assert wait_api(client, sid, "completed")["experiment"]["deepswe"]["result"]["reward"] == 0
        assert attempts == [selected.task, selected.task]

        missing_default = tmp_path / "missing-default.toml"
        monkeypatch.setenv("CHORUS_DEEPSWE_PROFILE", str(missing_default))
        monkeypatch.setattr(deepswe.Profile, "load", lambda: deepswe.Profile.from_file(missing_default))
        catalog = client.get(f"{base}/catalog").json()
        assert catalog["task"] is None and catalog["tasks"] == [option]
        assert client.post(f"{base}/sessions").status_code == 503
        monkeypatch.delenv("CHORUS_DEEPSWE_PROFILE")
        assert client.get(f"{base}/catalog").json()["task"] == option["task"]


def test_campaign_recovers_without_recreating_trial(tmp_path, profile, monkeypatch):
    async def working(model, messages, **options):
        await asyncio.sleep(60)
    async def finished(model, messages, **options):
        if options["phase"] == "plan":
            return result(tool("plan_complete"))
        return result(tool("agent_finish", reason="Done", remaining=[]))
    async def grade(self, patch, tree):
        return DeepSWEResult(reward=0)
    monkeypatch.setattr(deepswe.Profile, "grade", grade)
    manifest = study_manifest(profile, 1)
    db = str(tmp_path / "recovery.sqlite3")
    base = "/api/v2/deepswe/campaigns"
    endpoint = base + "/" + manifest["requestId"]
    with TestClient(create_app(db, working, pacing=0)) as client:
        assert client.post(base, json=manifest).status_code == 201
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            first = client.get(endpoint).json()["trials"][0]
            if first["calls"]:
                break
            time.sleep(.05)
        assert first["sessionId"] and first["calls"] > 0
    with TestClient(create_app(db, finished, pacing=0)) as client:
        assert client.get(endpoint).json()["status"] == "paused"
        assert client.post(endpoint + "/resume").status_code == 200
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            report = client.get(endpoint).json()
            if report["status"] == "finished":
                break
            time.sleep(.1)
        assert report["status"] == "finished", report
        assert report["trials"][0]["sessionId"] == first["sessionId"]
        assert report["trials"][0]["calls"] > first["calls"]
        assert len(client.get("/api/v2/sessions").json()) == 2


def test_cancel_campaign_keeps_one_observation_and_coverage(tmp_path, profile):
    async def working(model, messages, **options):
        await asyncio.sleep(60)
    base = "/api/v2/deepswe/campaigns"
    manifest = study_manifest(profile, 2)
    with TestClient(create_app(str(tmp_path / "cancel.sqlite3"), working, pacing=0)) as client:
        assert client.post(base, json=manifest).status_code == 201
        endpoint = base + "/" + manifest["requestId"]
        cancelled = client.post(endpoint + "/cancel").json()
        assert cancelled["status"] == "cancelled"
        assert all(s["ratePercent"] is None and s["graded"] == 0 for s in cancelled["scores"])
        assert all(t["status"] == "cancelled" for t in cancelled["trials"] if t["sessionId"] is None)
        assert client.post(endpoint + "/resume").status_code == 409
        comparison = client.get(endpoint + "/comparison", params={"other": manifest["requestId"], "candidate": "Team",
                                                                 "baseline": "Solo"}).json()
        assert comparison["paired"] == 0 and comparison["deltaPoints"] is None
        assert "Effective roster" in comparison["changedSettings"]


def test_separate_verifier_builds_official_tests_on_pinned_base(tmp_path):
    source = "[environment]\ndocker_image = 'fixture/task:1'\n[verifier.environment]\ncpus = 2\n"
    manifest = deepswe.pin_environment(source, "verifier.environment", IMAGE, inherited=IMAGE)
    assert tomllib.loads(manifest)["verifier"]["environment"] == {"cpus": 2, "allow_internet": False}
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text("FROM fixture/task:1\nCOPY test.sh /tests/test.sh\n")
    deepswe.pin_verifier_base(dockerfile, IMAGE)
    assert dockerfile.read_text() == f"FROM {IMAGE}\nCOPY test.sh /tests/test.sh\n"
    with pytest.raises(ChorusError):
        deepswe.pin_verifier_base(dockerfile, VERIFIER_IMAGE)


def test_replay_errors_never_become_negative_scores(tmp_path, profile):
    trial = tmp_path / "trial-record"
    for folder in ("agent", "artifacts", "verifier"):
        (trial / folder).mkdir(parents=True)
    (trial / "agent/exit-code.txt").write_text("1")
    (trial / "result.json").write_text(json.dumps({"verifier_result": {"rewards": {"reward": 0}}}))
    (trial / "verifier/reward.json").write_text('{"reward":0}')
    with pytest.raises(ChorusError, match="submission agent failed"):
        deepswe.read_result(tmp_path)
    (trial / "agent/exit-code.txt").unlink()
    (trial / "artifacts/model.patch").write_bytes(b"")
    with pytest.raises(ChorusError, match="differs from the frozen submission"):
        deepswe.read_result(tmp_path, replay=(profile.repository, profile.task.baseCommit, "a" * 40))
