"""Behavioral regressions for the independent, tool-driven harness."""
import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from chorus.api import create_app
from chorus.harness.catalog import load_catalog
from chorus.harness.models import HarnessConfig, HarnessCommand, Record
from chorus.harness.service import HarnessService
from chorus.harness.tools import board_text
from chorus.harness.verification import verify
from chorus.harness.accounting import aggregate
from chorus.services.errors import ChorusError
from chorus.storage import Store, now


ANSWERS = {
    "deployment-schedule": {"jobs": [{"id": "A", "worker": 1, "start": 0, "end": 3}, {"id": "B", "worker": 2, "start": 0, "end": 2}, {"id": "C", "worker": 1, "start": 3, "end": 7}, {"id": "D", "worker": 2, "start": 3, "end": 5}, {"id": "E", "worker": 1, "start": 7, "end": 10}, {"id": "F", "worker": 1, "start": 10, "end": 11}], "makespan": 11},
    "transaction-ledger": {"accounts": {"A": 17000, "B": 15000, "C": 0}, "total": 32000, "duplicateIds": ["t2"]},
    "reservoir-mixture": {"lowLiters": 6, "middleLiters": 12, "highLiters": 12, "totalLiters": 30, "concentration": .34},
    "production-mix": {"x": 20, "y": 30, "contribution": 2200, "machineHours": 120, "finishingHours": 80},
    "process-inference": {"probabilityTwoSuccesses": .42, "posteriorP": 32 / 35},
}


class ScriptedModel:
    def __init__(self, *, finish=True, delay=0):
        self.catalog = load_catalog()
        self.finish, self.delay = finish, delay
        self.active, self.maximum = 0, 0
        self.steps = {}

    async def __call__(self, model, messages, **options):
        self.active += 1
        self.maximum = max(self.maximum, self.active)
        try:
            await asyncio.sleep(self.delay)
            phase = options["phase"]
            if phase == "summary":
                text = json.dumps({"approach": "Checked the supplied constraints.", "assumptions": [], "evidenceRefs": [], "decision": "Published only validated work.", "uncertainties": []})
            elif phase == "judge":
                prompt = messages[1]["content"]
                refs = list(dict.fromkeys(re.findall(r'(?:board|summary|change):[A-Za-z0-9_-]+', prompt)))
                if "Inspect every supplied" in prompt:
                    value = {"note": "The supplied records document concise contributions and explicit assumptions.", "evidenceIds": refs}
                elif "Grade the complete" in prompt:
                    value = {"summary": "The team produced a checked solution.", "scores": [3] * 5, "explanation": "The board contains relevant concise contributions.", "evidenceIds": [r for r in refs if r.startswith("board:")]}
                else:
                    actor = re.search(r"agentId='([^']+)'", prompt)[1]
                    value = {"agentId": actor, "scores": [3] * 5, "explanation": "The participant contributed relevant evidence and reviewed the constraints.", "evidenceIds": refs, "insufficientEvidence": not refs}
                text = json.dumps(value)
            else:
                actor = re.search(r'You are (\w+)\.', messages[0]["content"])[1].lower()
                cycle = next(re.search(r'Current cycle (\d+)', m["content"])[1] for m in reversed(messages) if m.get("role") == "user" and m["content"].startswith("Current cycle"))
                key = actor, cycle
                step = self.steps.get(key, 0)
                self.steps[key] = step + 1
                results = [json.loads(m["content"]) for m in messages if m.get("role") == "tool"]
                token = next((r["token"] for r in reversed(results) if "token" in r), "")
                canvas = next((r for r in reversed(results) if "canvas" in r), {"version": 0, "canvas": ""})
                actions = [
                    ("board_read", {"after": 0, "limit": 5}),
                    ("board_write", {"text": "I will check the constraints before changing the solution."}),
                    ("canvas_acquire_lock", {}),
                    ("canvas_read", {"version": 0}),
                    ("canvas_apply_edit", {"token": token, "baseVersion": canvas["version"], "operationJson": json.dumps({"op": "UNCHANGED"} if canvas["canvas"] else {"op": "CREATE_DOCUMENT", "document": '# Solution\n\n```solution\n' + json.dumps(ANSWERS["production-mix"]) + '\n```'}), "reason": "Publish a feasible optimal production mix."}),
                ]
                if step < len(actions):
                    name, args = actions[step]
                elif self.finish:
                    name, args = "agent_finish", {"reason": "My contribution is complete."}
                else:
                    return self.response("Cycle complete.")
                return self.response("", [{"id": str(uuid4()), "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}])
            return self.response(text)
        finally:
            self.active -= 1

    @staticmethod
    def response(text, calls=None):
        return {"message": {"content": text, **({"tool_calls": calls} if calls else {})}, "done_reason": "stop", "prompt_eval_count": 100, "eval_count": 20, "usage_details": {"cachedInput": 50}}


def config(**overrides):
    return HarnessConfig(problemId="production-mix", participantIds=["alex", "drew"], maxTurnsPerAgent=1, **overrides)


def command(svc, sid, action):
    return svc.command(sid, HarnessCommand(commandId=str(uuid4()), action=action, expectedRevision=svc.repo.get(sid).revision))


async def settled(svc, sid):
    for _ in range(2000):
        state = svc.repo.get(sid)
        if state.status in {"completed", "paused", "stopped"}:
            return state
        await asyncio.sleep(.005)
    raise AssertionError("Harness did not settle")


@pytest.mark.parametrize("problem", load_catalog().problems, ids=lambda p: p.id)
def test_verifiers_accept_witness_and_reject_wrong_and_malformed(problem):
    answer = ANSWERS[problem.id]
    canvas = '```solution\n' + json.dumps(answer) + '\n```'
    assert verify(problem, canvas, 1).status == "correct"
    wrong = json.loads(json.dumps(answer))
    key = next(k for k, v in wrong.items() if type(v) in (int, float))
    wrong[key] += 1
    assert verify(problem, '```solution\n' + json.dumps(wrong) + '\n```', 1).status == "incorrect"
    assert verify(problem, canvas + '\n' + canvas, 1).status == "incorrect"
    assert verify(problem, '```solution\n{}\n```', 1).status == "incorrect"


def test_catalog_fields_default_and_flat_board_validation():
    catalog = load_catalog()
    assert len(catalog.agents) == len({a.id for a in catalog.agents}) == 50
    assert len(catalog.problems) == 5 and catalog.defaultModel == "gpt-6-luna"
    assert "energy" not in catalog.model_dump_json() or "Energy systems" in catalog.model_dump_json()
    for agent in catalog.agents:
        assert all((agent.personality, agent.introduction, agent.strengths, agent.weaknesses, agent.avatarBrief))
    agents = catalog.agents[:2]
    text, mentions = board_text("@alex, the value is 0.5. I agree with Dr. Avery's check.", agents)
    assert text.startswith("@Alex") and mentions == ["alex"]
    for bad in ("First. Second. Third.", "No punctuation", "@Unknown, I disagree.", "A " * 80 + "."):
        with pytest.raises(ValueError):
            board_text(bad, agents)


async def test_independent_workers_final_judge_records_and_usage(store):
    model = ScriptedModel(delay=.002)
    svc = HarnessService(store, model)
    state = svc.create(config(judgeEnabled=True))
    command(svc, state.id, "start")
    final = await settled(svc, state.id)
    assert final.status == "completed", final.error
    assert model.maximum >= 2
    assert final.verification.status == "correct"
    assert final.report and len(final.report.agents) == 2
    assert all(w.turnsCompleted == 1 and w.turnsStarted == 1 for w in final.workers)
    assert len(svc.repo.all(state.id, "summary")) == 2
    assert len(svc.repo.all(state.id, "board")) == 2
    assert len(svc.repo.all(state.id, "change")) == final.canvasVersion == 1
    assert final.lease is None
    from chorus.harness.accounting import usage_report
    usage = usage_report(svc.repo, state.id)
    assert usage.total.callCount == len(svc.repo.all(state.id, "call"))
    assert usage.participants.cacheUtilizationPercent == 50
    assert usage.total.estimatedCostUSD > 0
    await svc.close()


async def test_pause_preserves_post_and_resume_keeps_cap(store):
    svc = HarnessService(store, ScriptedModel(finish=False, delay=.01))
    state = svc.create(config(judgeEnabled=False))
    command(svc, state.id, "start")
    while not svc.repo.all(state.id, "board"):
        await asyncio.sleep(.005)
    command(svc, state.id, "pause")
    before = svc.repo.get(state.id).boardCount
    await asyncio.sleep(.03)
    assert svc.repo.get(state.id).boardCount == before
    command(svc, state.id, "resume")
    final = await settled(svc, state.id)
    assert final.status == "completed", final.error
    assert all(w.turnsStarted == 1 for w in final.workers)
    await svc.close()


async def test_lock_expiry_fencing_readonly_and_idempotence(store):
    svc = HarnessService(store, ScriptedModel())
    state = svc.create(config(judgeEnabled=False))
    svc.repo.change(state.id, lambda s: setattr(s, "status", "running"))
    tools = svc.tools
    lease = await tools.execute(state.id, "alex", 0, "a", "canvas_acquire_lock", {})
    busy = await tools.execute(state.id, "drew", 0, "b", "canvas_acquire_lock", {})
    assert busy["busy"]
    posted = await tools.execute(state.id, "drew", 0, "post", "board_write", {"text": "@Alex, I checked the constraints."})
    assert await tools.execute(state.id, "drew", 0, "post", "board_write", {"text": "@Alex, I checked the constraints."}) == posted
    assert svc.repo.get(state.id).boardCount == 1
    old = svc.repo.lease(state.id)
    old["expiresAt"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    svc.repo.change(state.id, lambda _: None, lease=old)
    tools.tick(state.id)
    fresh = await tools.execute(state.id, "drew", 0, "c", "canvas_acquire_lock", {})
    assert fresh["fencing"] > lease["fencing"]
    with pytest.raises(ValueError):
        tools.require_lease(svc.repo.get(state.id), "alex", lease["token"])
    svc.repo.change(state.id, lambda s: setattr(s, "status", "reviewing"))
    with pytest.raises(ChorusError):
        await tools.execute(state.id, "judge", 0, "bad", "board_write", {"text": "Overwrite this."})
    await svc.close()


def test_weighted_aggregate_missing_zero_and_cost():
    def rec(i, data):
        return Record(id=str(i), sequence=i, kind="call", agentId="alex", turn=1, createdAt=now(), data=data)
    rows = [rec(1, {"inputTokens": 100, "outputTokens": 10, "cachedTokens": 100, "latencyMs": 100, "costUSD": .2, "costSource": "reported"}), rec(2, {"inputTokens": 900, "outputTokens": 10, "cachedTokens": 0, "latencyMs": 300}), rec(3, {})]
    result = aggregate(rows)
    assert result.cacheUtilizationPercent == 10
    assert result.unknownCacheCalls == 1 and result.unknownCostCalls == 2
    assert result.reportedCostUSD == .2 and result.p95LatencyMs == 300


def test_new_api_catalog_and_archived_sessions_remain_readable(tmp_path, model):
    with TestClient(create_app(str(tmp_path / "api.sqlite3"), model, pacing=0)) as client:
        catalog = client.get("/api/v2/catalog").json()
        assert len(catalog["agents"]) == 50 and catalog["defaultModel"] == "gpt-6-luna"
        created = client.post("/api/v2/sessions", json=config().model_dump())
        assert created.status_code == 201
        sid = created.json()["id"]
        assert client.get(f"/api/v2/sessions/{sid}/export").json()["session"]["config"]["maxTurnsPerAgent"] == 1
        assert client.post("/api/v2/sessions", json={**config().model_dump(), "maxTurns": 20}).status_code == 400
        from tests.conftest import CONFIG
        old = client.post("/api/v1/sessions", json=CONFIG)
        assert old.status_code == 201
        assert client.get(f'/api/v1/sessions/{old.json()["id"]}').status_code == 200


async def test_fifty_workers_restart_preserves_caps_records_and_usage(tmp_path):
    path = str(tmp_path / "fifty.sqlite3")
    store = Store(path)
    model = ScriptedModel(delay=.002)
    svc = HarnessService(store, model)
    roster = [a.id for a in svc.catalog.agents]
    state = svc.create(HarnessConfig(problemId="production-mix", participantIds=roster, maxTurnsPerAgent=1, judgeEnabled=False))
    command(svc, state.id, "start")
    for _ in range(2000):
        if svc.repo.get(state.id).boardCount >= 4:
            break
        await asyncio.sleep(.005)
    before = svc.repo.get(state.id).boardCount
    assert before >= 4
    await svc.close()
    store.close()
    store = Store(path)
    svc = HarnessService(store, model)
    assert svc.repo.get(state.id).status == "paused"
    assert svc.repo.get(state.id).boardCount >= before
    command(svc, state.id, "resume")
    result = await settled(svc, state.id)
    assert result.status == "completed", result.error
    assert len(result.workers) == 50 and all(w.turnsStarted == w.turnsCompleted == 1 for w in result.workers)
    board = svc.repo.all(state.id, "board")
    assert len(board) == 50 and len({r.id for r in board}) == 50
    assert result.canvasVersion == 1 and result.lease is None
    assert model.maximum <= 4
    from chorus.harness.accounting import usage_report
    usage = usage_report(svc.repo, state.id)
    assert usage.total.callCount == len(svc.repo.all(state.id, "call"))
    assert len(svc.repo.all(state.id, "request")) >= 300
    await svc.close()
    store.close()


async def test_partial_board_commit_is_idempotent_after_missing_tool_result(store):
    svc = HarnessService(store, ScriptedModel())
    state = svc.create(config(judgeEnabled=False))
    svc.repo.change(state.id, lambda s: setattr(s, "status", "running"))
    original = svc.repo.append
    def interrupted(sid, kind, *args, **kwargs):
        if kind == "tool":
            raise asyncio.CancelledError
        return original(sid, kind, *args, **kwargs)
    svc.repo.append = interrupted
    with pytest.raises(asyncio.CancelledError):
        await svc.tools.execute(state.id, "alex", 0, "crash-post", "board_write", {"text": "I checked this constraint."})
    svc.repo.append = original
    result = await svc.tools.execute(state.id, "alex", 0, "crash-post", "board_write", {"text": "I checked this constraint."})
    assert result["id"] == "board:crash-post" and svc.repo.get(state.id).boardCount == 1
    await svc.close()


async def test_shutdown_fences_an_adapter_that_suppresses_cancellation(store):
    class Late(ScriptedModel):
        async def __call__(self, model, messages, **options):
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                await asyncio.sleep(.01)
                return self.response("", [{"id": "late", "type": "function", "function": {"name": "board_write", "arguments": json.dumps({"text": "A late response must not publish."})}}])
    svc = HarnessService(store, Late())
    state = svc.create(config(judgeEnabled=False))
    command(svc, state.id, "start")
    await asyncio.sleep(.01)
    await svc.close()
    assert svc.repo.get(state.id).status == "paused"
    assert not svc.repo.all(state.id, "board")
    calls = svc.repo.all(state.id, "call")
    assert calls and all(r.data["outcome"] != "running" for r in calls)


def test_legacy_engine_cannot_create_new_runs_in_production(tmp_path):
    with TestClient(create_app(str(tmp_path / "read-only.sqlite3"))) as client:
        from tests.conftest import CONFIG
        response = client.post("/api/v1/sessions", json=CONFIG)
        assert response.status_code == 409 and response.json()["code"] == "VERSION_MISMATCH"


def test_cli_defaults_to_luna_relevant_roster_and_per_agent_cap(monkeypatch):
    import chorus.cli.main as cli
    from typer.testing import CliRunner
    captured = []
    def request(method, path, body=None):
        if path == "/catalog":
            return load_catalog().model_dump()
        if path == "/sessions" and method == "POST":
            captured.append(body)
            return {"id": "new-session", "revision": 0}
        if path.endswith("/commands"):
            return {}
        if "/records?" in path:
            return {"records": [], "cursor": 0}
        if path.endswith("/usage"):
            return {}
        return {"id": "new-session", "status": "completed", "error": "", "canvas": "A saved solution.", "verification": None, "report": None}
    monkeypatch.setattr(cli, "harness_request", request)
    result = CliRunner().invoke(cli.app, ["run", "production-mix", "--turns-per-agent", "2"])
    assert result.exit_code == 0, result.output
    assert captured[0]["model"] == "gpt-6-luna" and captured[0]["maxTurnsPerAgent"] == 2
    assert captured[0]["participantIds"] == next(p for p in load_catalog().problems if p.id == "production-mix").participantIds
    assert captured[0]["judgeEnabled"] is True
    rejected = CliRunner().invoke(cli.app, ["run", "production-mix", "--turns", "10"])
    plain_output = re.sub(r"\x1b\[[0-9;]*m", "", rejected.output)
    assert rejected.exit_code != 0 and "--turns-per-agent" in plain_output


async def test_summary_permissions_and_frozen_judge_reads(store):
    svc = HarnessService(store, ScriptedModel())
    state = svc.create(config(judgeEnabled=False))
    svc.repo.change(state.id, lambda s: setattr(s, "status", "running"))
    svc.repo.append(state.id, "summary", "alex", 1, {"decision": "ALEX-OWN-SUMMARY"})
    svc.repo.append(state.id, "summary", "drew", 1, {"decision": "DREW-OWN-SUMMARY"})
    own = await svc.tools.execute(state.id, "alex", 0, "read-own", "summary_read", {"after": 0, "limit": 10})
    assert "ALEX-OWN-SUMMARY" in json.dumps(own) and "DREW-OWN-SUMMARY" not in json.dumps(own)
    with pytest.raises(ChorusError):
        await svc.tools.execute(state.id, "alex", 0, "read-all", "evaluation_read", {"kind": "summary", "after": 0, "limit": 10})
    frozen = svc.repo.get(state.id).sequence
    svc.repo.change(state.id, lambda s: (setattr(s, "status", "reviewing"), setattr(s, "frozenSequence", frozen)))
    svc.repo.append(state.id, "board", "alex", 1, {"text": "This record is outside the frozen source set."})
    page = await svc.tools.execute(state.id, "judge", 0, "judge-board", "board_read", {"after": 0, "limit": 50})
    assert not page["records"] and page["highWater"] == frozen
    summaries = await svc.tools.execute(state.id, "judge", 0, "judge-summary", "evaluation_read", {"kind": "summary", "after": 0, "limit": 50})
    assert len(summaries["records"]) == 2
    await svc.close()


async def test_invalid_posts_exhaust_repairs_without_spending_extra_turns(store):
    class Invalid(ScriptedModel):
        async def __call__(self, model, messages, **options):
            if options["phase"] != "agent":
                return await super().__call__(model, messages, **options)
            return self.response("", [{"id": str(uuid4()), "type": "function", "function": {"name": "board_write", "arguments": json.dumps({"text": "First sentence. Second sentence. Third sentence."})}}])
    svc = HarnessService(store, Invalid())
    state = svc.create(config(judgeEnabled=False))
    command(svc, state.id, "start")
    result = await settled(svc, state.id)
    assert result.status == "completed" and result.boardCount == 0
    assert all(w.turnsStarted == 1 and w.repairsUsed == 3 and w.callsUsed == 4 for w in result.workers)
    assert result.verification.status == "incorrect"
    await svc.close()


def test_all_fifty_artwork_identities_and_animation_frames_are_packaged():
    from importlib.resources import files
    import hashlib
    import xml.etree.ElementTree as ET
    root = files("chorus.harness")
    manifest = json.loads(root.joinpath("art-manifest.json").read_text())
    assert set(manifest) == {a.id for a in load_catalog().agents}
    portraits, sprites = set(), set()
    for entry in manifest.values():
        assert entry["frames"] == 16 and entry["states"] == ["idle", "working", "posting", "editing"]
        portrait = root.joinpath("assets", entry["portrait"]).read_text()
        sprite = root.joinpath("assets", entry["sprite"]).read_text()
        assert len(ET.fromstring(sprite)) == 17
        assert "<script" not in sprite + portrait and "href=" not in sprite + portrait
        portraits.add(hashlib.sha256(portrait.encode()).hexdigest())
        sprites.add(hashlib.sha256(sprite.encode()).hexdigest())
    assert len(portraits) == len(sprites) == 50


async def test_unreported_explicit_cache_writes_do_not_invent_a_cost(store, monkeypatch):
    monkeypatch.setenv("CHORUS_OPENAI_CACHE_MODE", "explicit")
    svc = HarnessService(store, ScriptedModel())
    state = svc.create(config(judgeEnabled=False))
    svc.repo.change(state.id, lambda s: setattr(s, "status", "running"))
    await svc.meter.invoke(state.id, "alex", 0, [{"role": "system", "content": "Return a short summary."}], phase="summary")
    row = svc.repo.all(state.id, "call")[0]
    assert row.data["cacheMode"] == "explicit"
    assert row.data["costUSD"] is None and row.data["costSource"] == "unknown"
    await svc.close()


async def test_provider_tool_ids_are_scoped_to_the_model_response(store):
    svc = HarnessService(store, ScriptedModel())
    state = svc.create(config(judgeEnabled=False))
    svc.repo.change(state.id, lambda s: setattr(s, "status", "running"))
    first = await svc.tools.execute(state.id, "alex", 0, "call_0", "board_write", {"text": "The first request contributes this observation."}, "request-one")
    second = await svc.tools.execute(state.id, "alex", 0, "call_0", "board_write", {"text": "The second request contributes a different observation."}, "request-two")
    repeated = await svc.tools.execute(state.id, "alex", 0, "call_0", "board_write", {"text": "The first request contributes this observation."}, "request-one")
    assert first["id"] != second["id"] and repeated == first
    assert svc.repo.get(state.id).boardCount == 2
    await svc.close()
