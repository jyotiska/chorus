"""Repository experiment phase, authority, and cancellation regressions."""
import asyncio
import json
from pathlib import Path
import re
from uuid import uuid4
from types import SimpleNamespace

import pytest

from chorus.harness.models import ExperimentConfig, HarnessCommand
from chorus.harness.experiment import event
from chorus.harness.experiment_tools import definitions
from chorus.harness.service import HarnessService
from chorus.services.errors import ChorusError


PARTICIPANTS = ["general-agent", "frontend-engineer", "backend-engineer"]


def tool(name, **args):
    return {"id": str(uuid4()), "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def result(*tools, content=""):
    return {"message": {"content": content, "tool_calls": list(tools)}, "prompt_eval_count": 20, "eval_count": 10}


def prior_tools(messages):
    return [json.loads(item["content"]) for item in messages if item["role"] == "tool"]


@pytest.fixture
def starter(tmp_path, monkeypatch):
    scaffold = tmp_path / "starters"
    for folder in ("frontend", "backend"):
        project = scaffold / folder
        project.mkdir(parents=True)
        project.joinpath("package.json").write_text(json.dumps({"name": folder}) + "\n")
    monkeypatch.setenv("CHORUS_EXPERIMENT_SCAFFOLD", str(scaffold))
    monkeypatch.setenv("CHORUS_CLOUD_CONCURRENCY", "4")
    return scaffold


def create(svc, participants=PARTICIPANTS):
    return svc.experiments.create(ExperimentConfig(problemId="todoist", participantIds=participants))


def command(svc, sid, action):
    current = svc.repo.get(sid)
    return svc.command(sid, HarnessCommand(action=action, commandId=str(uuid4()), expectedRevision=current.revision))


async def wait_until(svc, sid, predicate):
    async with asyncio.timeout(6):
        while True:
            current = svc.repo.get(sid)
            if predicate(current):
                return current
            await asyncio.sleep(.01)


class LifecycleProvider:
    def __init__(self):
        self.allow_second = asyncio.Event()
        self.allow_last = asyncio.Event()
        self.prompts = {}
        self.judge_attempts = 0
        self.judge_observed = []

    async def __call__(self, model, messages, **options):
        phase = options["phase"]
        if phase == "judge":
            return self.judge(messages)
        prompt = messages[0]["content"]
        actor = re.search(r"Your identifier is ([a-z-]+)\.", prompt)[1]
        self.prompts[(actor, phase)] = prompt
        if phase == "plan":
            return await self.plan(actor)
        if actor != "general-agent":
            remaining = [{"task": "Add the task list view.", "reason": "The frontend view was not implemented."}] if actor == "frontend-engineer" else []
            return result(tool("agent_finish", reason="No further implementation work.", remaining=remaining))
        past = prior_tools(messages)
        if not past:
            return result(tool("spec_edit", section="tasks", taskOwner=actor, markdown="- [ ] Implement the task API.",
                               revision=2, reason="Record work during Build.", verification=""),
                          tool("workspace_write", path="backend/api.js", content="export const tasks = [];\n"),
                          tool("workspace_read", path="backend/api.js"),
                          tool("git_commit", message="Add a task API module"),
                          tool("pr_open", description="Add the task API module.", tasks=["Implement the task API."]))
        opened = next((entry for entry in past if entry.get("status") == "open"), None)
        assert opened, past
        return result(tool("pr_merge", id=opened["id"]),
                      tool("spec_edit", section="tasks", taskOwner=actor, markdown="- [x] Implement the task API.",
                           revision=3, reason="Record the verified module.", verification="Read backend/api.js and confirmed that it exports tasks."),
                      tool("agent_finish", reason="Merged the task API module.", remaining=[]))

    async def plan(self, actor):
        if actor == "general-agent":
            return result(tool("workspace_write", path="backend/premature.js", content="// Invalid planning write.\n"),
                          tool("spec_edit", section="product", taskOwner="", markdown="Create and list tasks.",
                               revision=0, reason="Define the core workflow.", verification=""),
                          tool("plan_complete"))
        if actor == "frontend-engineer":
            await self.allow_second.wait()
            return result(tool("spec_edit", section="tasks", taskOwner=actor, markdown="- [ ] Add the task list view.",
                               revision=1, reason="Record the frontend commitment.", verification=""), tool("plan_complete"))
        await self.allow_last.wait()
        return result(tool("plan_complete"))

    def judge(self, messages):
        outputs = prior_tools(messages)
        if not outputs:
            self.judge_attempts += 1
            return result(tool("workspace_read", path="backend/api.js"))
        self.judge_observed.append(outputs[-1]["content"])
        if self.judge_attempts == 1:
            return result(content="Invalid report from first attempt.")
        criterion = {"score": "not_assessable", "explanation": "This check was not observed.", "evidenceIds": []}
        planning = {"score": 3, "explanation": "The general agent contributed before finishing Plan.", "evidenceIds": ["plan_completion:general-agent"]}
        return result(content=json.dumps({
            "summary": "Participants independently developed and integrated a small portion of the planned application.",
            "application": [criterion] * 5,
            "agents": [{"agentId": actor, "criteria": ([planning] + [criterion] * 4 if actor == "general-agent" else [criterion] * 5)}
                       for actor in PARTICIPANTS],
            "collaboration": [criterion] * 5,
            "missingWork": ["The task list view was not delivered."],
        }))


async def test_all_planners_finish_before_build_and_retry_uses_frozen_snapshot(store, starter):
    provider = LifecycleProvider()
    svc = HarnessService(store, provider)
    try:
        created = create(svc)
        sid = created.id
        assert created.experiment.planningCompletions == []
        command(svc, sid, "start")
        planned = await wait_until(svc, sid, lambda s: len(s.experiment.planningCompletions) == 1)
        assert planned.experiment.phase == "plan"
        assert planned.experiment.planningCompletions[0].agentId == "general-agent"
        assert planned.canvasVersion == 1
        assert planned.workers[0].state == "finished"
        runtime = svc.experiments
        blocked = runtime.handle(sid, "general-agent", planned.generation, "plan", tool(
            "spec_edit", section="product", taskOwner="", markdown="Attempt a late edit.", revision=1,
            reason="Already finished planning.", verification=""), "blocked")
        assert blocked["code"] == "FORBIDDEN"
        duplicate = runtime.handle(sid, "general-agent", planned.generation, "plan", tool("plan_complete"), "duplicate")
        assert duplicate["code"] == "FORBIDDEN"
        readable = runtime.handle(sid, "general-agent", planned.generation, "plan", tool("spec_read"), "read")
        assert readable["revision"] == 1

        provider.allow_second.set()
        second = await wait_until(svc, sid, lambda s: len(s.experiment.planningCompletions) == 2)
        assert second.experiment.phase == "plan"
        assert not any(phase == "build" for _, phase in provider.prompts)
        provider.allow_last.set()
        failed = await wait_until(svc, sid, lambda s: s.status in {"judge_failed", "completed", "paused"})
        assert failed.status == "judge_failed", failed.error
        assert failed.canvasVersion == 4
        assert [item.agentId for item in failed.experiment.planningCompletions] == PARTICIPANTS
        assert all(worker.state == "finished" for worker in failed.workers)
        assert failed.workers[1].remainingTasks[0].task == "Add the task list view."
        assert failed.workers[1].remainingTasks[0].reason == "The frontend view was not implemented."
        assert svc.repo.all(sid, "change")[-1].data["verification"] == "Read backend/api.js and confirmed that it exports tasks."
        assert svc.repo.all(sid, "commit")[0].agentId == "general-agent"
        assert [entry.data["status"] for entry in svc.repo.all(sid, "pr")] == ["open", "merged"]
        repo = failed.experiment.repository
        assert repo.mainCommit != repo.baselineCommit
        assert repo.mainCommit == failed.experiment.frozen.mainCommit
        assert Path(repo.path, "backend", "api.js").exists()
        assert not Path(repo.path, "backend", "premature.js").exists()
        assert not starter.joinpath("backend", "api.js").exists()
        assert "Role:" not in provider.prompts[("general-agent", "plan")]
        assert "Background:" not in provider.prompts[("general-agent", "build")]
        assert "Role: Front-end engineer" in provider.prompts[("frontend-engineer", "plan")]
        with pytest.raises(ChorusError, match="phase authority"):
            runtime.handle(sid, "general-agent", planned.generation, "plan", tool("board_write", text="Late post."), "late")

        frozen = failed.experiment.frozen
        Path(repo.path, "backend", "api.js").write_text("// Uncommitted work after freezing.\n")
        command(svc, sid, "retry_judge")
        final = await wait_until(svc, sid, lambda s: s.status != "reviewing")
        assert final.status == "completed", final.error
        assert final.experiment.frozen == frozen
        assert final.experiment.report.application[0].score == "not_assessable"
        assert provider.judge_observed == ["export const tasks = [];\n"] * 2
        assert final.experiment.judgeAttempts == 2
        assert [entry.data["status"] for entry in svc.repo.all(sid, "assessment")] == ["started", "failed", "started", "completed"]
    finally:
        await svc.close()


async def test_luna_build_replays_complete_exchanges_beyond_old_history_limit(store, starter):
    observed = []

    async def provider(model, messages, **options):
        observed.extend(messages)
        return result(tool("agent_finish", reason="Build checked.", remaining=[]))

    provider.catalog = SimpleNamespace(models=[SimpleNamespace(id="gpt-6-luna", provider="openai")])
    svc = HarnessService(store, provider)
    try:
        sid = create(svc, ["general-agent"]).id
        def start_build(state):
            state.status = "running"
            state.experiment.phase = "build"

        state = svc.repo.change(sid, start_build)
        runtime = svc.experiments
        actor = "general-agent"
        runtime.conversation(sid, actor, state.generation, "plan", {"role": "assistant", "content": "Old phase."})
        history = []
        for index in range(51):
            call = tool("workspace_read", path=f"frontend/file-{index}.js")
            history.extend([
                {"role": "assistant", "content": "", "tool_calls": [call]},
                {"role": "tool", "tool_call_id": call["id"], "content": "const application = {};" * 50},
            ])
        for message in history:
            runtime.conversation(sid, actor, state.generation, "build", message)
        await runtime.worker(sid, actor, state.generation, "build")
        assert observed[2:] == history
        assert svc.repo.get(sid).workers[0].state == "finished"
        assert svc.repo.all(sid, "call")[0].data["outcome"] == "success"
        assert len(svc.repo.all(sid, "conversation", actor)) > len(history)
    finally:
        await svc.close()


@pytest.mark.parametrize("valid_report", [True, False])
async def test_judge_reserves_final_call_and_carries_evidence_pages(store, starter, monkeypatch, valid_report):
    monkeypatch.setattr("chorus.harness.experiment.JUDGE_CALL_LIMIT", 4)
    requests = []
    criterion = {"score": "not_assessable", "explanation": "No observation.", "evidenceIds": []}

    async def provider(model, messages, **options):
        requests.append((messages, options))
        if options.get("tools"):
            return result(tool("evidence_read", kind="commit", after=0, limit=50))
        if not valid_report:
            return result(content="Incomplete report.")
        return result(content=json.dumps({
            "summary": "No merged changes.", "application": [criterion] * 5,
            "agents": [{"agentId": "general-agent", "criteria": [criterion] * 5}],
            "collaboration": [criterion] * 5, "missingWork": ["Application implementation"],
        }))

    svc = HarnessService(store, provider)
    try:
        sid = create(svc, ["general-agent"]).id
        def start_build(state):
            state.status = "running"
            state.experiment.phase = "build"

        state = svc.repo.change(sid, start_build)
        svc.experiments.freeze(sid, state.generation)
        await svc.experiments.judge(sid, state.generation)
        assert len(requests) == 4
        assert all(options["tools"] == definitions("judge") for _, options in requests[:3])
        assert "tools" not in requests[-1][1]
        assert "Submit the complete JSON report now" in requests[-1][0][-1]["content"]
        assert requests[-1][0][-1]["content"].count("commit after 0: end") == 1
        final = svc.repo.get(sid)
        if valid_report:
            assert final.status == "completed" and final.experiment.report
        else:
            assert final.status == "judge_failed" and "used all 3 evidence calls" in final.error
            assert svc.repo.all(sid, "assessment")[-1].data["code"] == "JUDGE_CALL_BUDGET"
    finally:
        await svc.close()


async def test_judge_resolves_only_matching_frozen_citation_aliases(store, starter):
    async def provider(*args, **options):
        pytest.fail("A valid saved judge draft should be reused before calling the model.")

    svc = HarnessService(store, provider)
    try:
        actor = "general-agent"
        sid = create(svc, [actor]).id
        def start_build(state):
            state.status = "running"
            state.experiment.phase = "build"

        state = svc.repo.change(sid, start_build, records=[event("board", actor, {"text": "Agreed on scope."})])
        svc.experiments.freeze(sid, state.generation)
        before = svc.repo.all(sid, "board")[0]
        after = svc.repo.append(sid, "board", actor, 0, {"text": "Late evidence."})
        state = svc.repo.get(sid)
        assert before.sequence <= state.frozenSequence < after.sequence
        criterion = {"score": "not_assessable", "explanation": "No observation.", "evidenceIds": []}

        def payload(evidence_ids):
            return json.dumps({
                "summary": "Inspected the frozen project.", "application": [criterion] * 5,
                "agents": [{"agentId": actor, "criteria": [criterion] * 5}],
                "collaboration": [dict(criterion, evidenceIds=evidence_ids)] + [criterion] * 4,
                "missingWork": [],
            })

        report = svc.experiments.validate_report(state, [actor], payload([f"board:{before.sequence}", before.id]))
        assert report.collaboration[0].evidenceIds == [before.id]
        for alias in (f"change:{before.sequence}", f"board:{after.sequence}", "board:99999"):
            with pytest.raises(ValueError, match="invalid evidence citation"):
                svc.experiments.validate_report(state, [actor], payload([alias]))

        def mark_failed(current):
            current.status = "judge_failed"
            current.experiment.judgeAttempts = 1

        draft = svc.repo.append(sid, "output", "judge", 0, {"message": {"content": payload([f"board:{before.sequence}"])}})
        svc.repo.append(sid, "output", "judge", 0, {"message": {"content": payload([f"board:{after.sequence}"])}})
        svc.repo.change(sid, mark_failed)
        command(svc, sid, "retry_judge")
        final = await wait_until(svc, sid, lambda current: current.status != "reviewing")
        assert final.status == "completed"
        assert final.experiment.report.collaboration[0].evidenceIds == [before.id]
        assert svc.repo.all(sid, "assessment")[-1].data["reusedDraftId"] == draft.id
        assert svc.repo.all(sid, "call") == []
    finally:
        await svc.close()


async def test_finish_waits_for_own_prs_through_conflict_and_replacement(store, starter):
    svc = HarnessService(store)
    try:
        sid = create(svc, PARTICIPANTS[:2]).id
        owner, peer = PARTICIPANTS[:2]

        def start_build(state):
            state.status = "running"
            state.experiment.phase = "build"

        state = svc.repo.change(sid, start_build)
        runtime = svc.experiments

        def run(actor, name, **args):
            return runtime.handle(sid, actor, state.generation, "build", tool(name, **args), "test")

        def open_pr(actor):
            run(actor, "workspace_write", path="backend/shared.txt", content=f"{actor}\n")
            assert "commit" in run(actor, "git_commit", message="Add shared file")
            return run(actor, "pr_open", description="Add the shared file.", tasks=[])["id"]

        first = open_pr(owner)
        second = open_pr(peer)
        denied = run(owner, "agent_finish", reason="Ready to finish.", remaining=[])
        assert denied["code"] == "PRS_NOT_INTEGRATED"
        assert [pr["id"] for pr in denied["pendingPullRequests"]] == [first]
        assert svc.repo.get(sid).workers[0].state != "finished"

        assert run(peer, "pr_merge", id=second)["status"] == "merged"
        assert run(peer, "agent_finish", reason="Merged my own PR.", remaining=[]) == {"accepted": True}
        merge = tool("pr_merge", id=first)
        feedback = runtime.handle(sid, owner, state.generation, "build", merge, "test")
        assert feedback["code"] == "PR_STALE_TARGET" and feedback["id"] == first
        assert "Reconcile" in feedback["error"]
        assert runtime.handle(sid, owner, state.generation, "build", merge, "test") == feedback
        blocked = run(owner, "agent_finish", reason="Ready to finish.", remaining=[])
        assert blocked["pendingPullRequests"][0]["status"] == "stale"

        conflict = run(owner, "git_commit", message="Sync with main")
        assert conflict["code"] == "GIT_CONFLICT"
        assert "backend/shared.txt" in conflict["error"]
        run(owner, "workspace_write", path="backend/shared.txt", content="reconciled\n")
        assert "commit" in run(owner, "git_resolve", message="Resolve shared file")
        replacement = run(owner, "pr_open", description="Integrate the reconciled file.", tasks=[])["id"]
        assert run(owner, "pr_merge", id=replacement)["status"] == "merged"
        assert run(owner, "agent_finish", reason="Merged the replacement PR.", remaining=[]) == {"accepted": True}
        assert all(worker.state == "finished" for worker in svc.repo.get(sid).workers)
    finally:
        await svc.close()


async def test_deliverables_require_verification_and_open_items_require_explanations(store, starter):
    svc = HarnessService(store)
    try:
        owner, peer = PARTICIPANTS[:2]
        sid = create(svc, [owner, peer]).id
        svc.repo.change(sid, lambda state: setattr(state, "status", "running"))
        runtime = svc.experiments

        def run(actor, name, **args):
            state = svc.repo.get(sid)
            return runtime.handle(sid, actor, state.generation, state.experiment.phase, tool(name, **args), "checklist")

        def edit(markdown, verification="", actor=owner):
            return run(actor, "spec_edit", section="tasks", taskOwner=owner, markdown=markdown,
                       revision=svc.repo.get(sid).canvasVersion, reason="Update the checklist.", verification=verification)

        open_list = "- [ ] Add search\n- [ ] Add filters"
        one_checked = "- [x] Add search\n- [ ] Add filters"
        assert edit("- Add search")["code"] == "INVALID_ACTION"
        assert edit(one_checked, "Read the search module.")["code"] == "INVALID_ACTION"
        assert edit(open_list)["version"] == 1
        run(owner, "plan_complete")
        run(peer, "plan_complete")

        assert edit(one_checked)["code"] == "INVALID_ACTION"
        assert edit("- [x] Add search\n- [x] Add filters", "Read both modules.")["code"] == "INVALID_ACTION"
        assert edit(one_checked, "Read the search module.", actor=peer)["code"] == "FORBIDDEN"
        assert edit(one_checked, "Inspected search and confirmed it matches case-insensitively.")["version"] == 2
        assert edit("- [x] Add search")["code"] == "INVALID_ACTION"
        assert run(owner, "agent_finish", reason="Search is ready.", remaining=[])["code"] == "INVALID_ACTION"
        assert svc.repo.get(sid).workers[0].state != "finished"

        gaps = [{"task": "Add filters", "reason": "The data source does not provide categories."}]
        assert run(owner, "agent_finish", reason="Search is ready.", remaining=gaps) == {"accepted": True}
        saved = svc.repo.get(sid)
        assert saved.workers[0].state == "finished"
        assert [gap.model_dump() for gap in saved.workers[0].remainingTasks] == gaps
        assert runtime.spec.agent_tasks(saved, saved.agents[0]) == one_checked
    finally:
        await svc.close()


async def test_resume_retries_only_unfinished_planners(store, starter):
    plan_calls = {}

    async def provider(model, messages, **options):
        phase = options["phase"]
        if phase == "judge":
            return result(content="No report.")
        if phase == "build":
            return result(tool("agent_finish", reason="No further implementation work.", remaining=[]))
        actor = re.search(r"Your identifier is ([a-z-]+)\.", messages[0]["content"])[1]
        plan_calls[actor] = plan_calls.get(actor, 0) + 1
        if actor == "frontend-engineer" and plan_calls[actor] == 1:
            raise ValueError("Planning provider failed once.")
        return result(tool("plan_complete"))

    svc = HarnessService(store, provider)
    try:
        sid = create(svc, PARTICIPANTS[:2]).id
        command(svc, sid, "start")
        paused = await wait_until(svc, sid, lambda state: state.status == "paused")
        assert paused.experiment.phase == "plan"
        assert [item.agentId for item in paused.experiment.planningCompletions] == ["general-agent"]
        assert [worker.state for worker in paused.workers] == ["finished", "failed"]

        command(svc, sid, "resume")
        built = await wait_until(svc, sid, lambda state: state.experiment.phase != "plan")
        assert [item.agentId for item in built.experiment.planningCompletions] == PARTICIPANTS[:2]
        assert plan_calls == {"general-agent": 1, "frontend-engineer": 2}
    finally:
        await svc.close()


@pytest.mark.parametrize("active_phase", ["plan", "judge"])
async def test_kill_fences_a_cancellation_resistant_provider(store, starter, active_phase):
    dispatched = asyncio.Event()
    cancellation_received = asyncio.Event()
    release_response = asyncio.Event()

    async def provider(model, messages, **options):
        phase = options["phase"]
        if phase != active_phase:
            if phase == "plan":
                return result(tool("plan_complete"))
            assert phase == "build"
            return result(tool("agent_finish", reason="No more work.", remaining=[]))
        dispatched.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancellation_received.set()
            await release_response.wait()
            return result(tool("spec_edit", section="product", taskOwner="", markdown="Late cancelled edit.", revision=0,
                               reason="This response ignored cancellation.", verification=""), tool("plan_complete"))

    svc = HarnessService(store, provider)
    try:
        sid = create(svc, ["general-agent"]).id
        command(svc, sid, "start")
        await asyncio.wait_for(dispatched.wait(), 3)
        assert command(svc, sid, "kill").status == "stopping"
        await asyncio.wait_for(cancellation_received.wait(), 3)
        assert svc.repo.get(sid).status == "stopping"
        release_response.set()
        killed = await wait_until(svc, sid, lambda s: s.status == "killed")
        assert killed.canvasVersion == 0
        assert killed.experiment.phase == active_phase
        assert len(killed.experiment.planningCompletions) == (1 if active_phase == "judge" else 0)
        assert killed.experiment.judgeAttempts == (1 if active_phase == "judge" else 0)
        assert killed.experiment.report is None
        assert not svc.repo.all(sid, "change")
        late_call = next(entry for entry in svc.repo.all(sid, "call") if entry.data["phase"] == active_phase)
        assert late_call.data["outcome"] == "cancelled"
        assert "outputRecordId" not in late_call.data
        assert Path(killed.experiment.repository.path).is_dir()
    finally:
        release_response.set()
        await svc.close()
