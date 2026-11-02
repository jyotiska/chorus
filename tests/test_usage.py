import asyncio
import copy
import json
import sqlite3

import httpx
import pytest

from chorus.contracts import SessionConfig, Snapshot, Turn
from chorus.llm.caching import CACHE_SCOPE, cache_identity, openai_options
from chorus.llm.openai import OpenAITransport, normalize_response as openai_response
from chorus.llm.openrouter import OpenRouterTransport, normalize_response as router_response
from chorus.llm.providers import ProviderRouter
from chorus.services.catalog import load_catalog
from chorus.services.errors import ChorusError
from chorus.services.generation import run_turn
from chorus.services.prompts import canvas_messages, spoken_messages
from chorus.services.sessions import SessionService
from chorus.storage import Store
from tests.conftest import CONFIG, FakeModel
from tests.test_platform import command, settle
from tests.test_providers import response
from tests.test_openrouter import response as router_raw
from tests.test_judge_compatibility import PlainModel


@pytest.mark.parametrize("normalize,raw,input_key,output_key,details_key", [
    (openai_response, response, "input_tokens", "output_tokens", "input_tokens_details"),
    (router_response, router_raw, "prompt_tokens", "completion_tokens", "prompt_tokens_details"),
])
def test_cache_reads_zero_missing_and_invalid_are_distinct(normalize, raw, input_key, output_key, details_key):
    for reads in (0, 80, None, -1, True, 101, "80"):
        usage = {input_key: 100, output_key: 20, details_key: {"cached_tokens": reads}}
        result = normalize(raw(usage=usage), False)
        expected = reads if type(reads) is int and 0 <= reads <= 100 else None
        assert result.get("usage_details", {}).get("cachedInput") == expected
        assert result["prompt_eval_count"] == 100 and result["eval_count"] == 20
    result = normalize(raw(usage={input_key: 100, output_key: 20}), False)
    assert "cachedInput" not in result.get("usage_details", {})


def test_write_and_reasoning_accounting_does_not_double_count():
    raw = response(id="resp-123", usage={"input_tokens": 100, "output_tokens": 30,
                   "input_tokens_details": {"cached_tokens": 60, "cache_write_tokens": 30},
                   "output_tokens_details": {"reasoning_tokens": 20}})
    result = openai_response(raw, False)
    assert result["prompt_eval_count"] == 100 and result["eval_count"] == 30
    assert result["usage_details"] == {"cachedInput": 60, "cacheWriteInput": 30, "reasoningOutput": 20, "requestId": "resp-123"}
    raw["usage"]["input_tokens_details"]["cache_write_tokens"] = 90
    assert "cachedInput" not in openai_response(raw, False)["usage_details"]
    for cost in (-1, float("nan"), float("inf"), True):
        assert "costUSD" not in router_response(router_raw(usage={"prompt_tokens": 10, "completion_tokens": 2, "cost": cost}), False).get("usage_details", {})


def test_cache_identity_survives_calls_and_isolates_agents_models_and_phases():
    token = CACHE_SCOPE.set("session-123:agent-a:epoch-0")
    try:
        identity = cache_identity("model", "spoken")
        assert identity == cache_identity("model", "spoken")
        assert identity != cache_identity("model", "canvas") != cache_identity("other-model", "canvas")
        assert len(identity) <= 64 and "session-123" not in identity
        other = CACHE_SCOPE.set("session-123:agent-b:epoch-0")
        assert cache_identity("model", "spoken") != identity
        CACHE_SCOPE.reset(other)
        assert cache_identity("model", "spoken") == identity
    finally:
        CACHE_SCOPE.reset(token)


def test_openai_explicit_and_disabled_modes_are_capability_checked_and_do_not_mutate(monkeypatch):
    original = [{"role": "system", "content": "Stable instructions."}, {"role": "user", "content": "Current work."}]
    before = copy.deepcopy(original)
    monkeypatch.setenv("CHORUS_OPENAI_CACHE_MODE", "explicit")
    inputs, options = openai_options("gpt-6-luna", original, "spoken")
    assert inputs[0]["content"][0]["prompt_cache_breakpoint"] == {"mode": "explicit"}
    assert inputs[1] == before[1] and original == before
    assert options["prompt_cache_options"] == {"mode": "explicit", "ttl": "30m"}
    assert "prompt_cache_options" not in openai_options("gpt-4.1", original, "spoken")[1]
    monkeypatch.setenv("CHORUS_OPENAI_CACHE_MODE", "disabled")
    assert openai_options("gpt-6-luna", original, "spoken")[0] == original
    assert openai_options("gpt-6-luna", original, "spoken")[1]["prompt_cache_options"]["mode"] == "explicit"


def test_participant_prefix_is_stable_while_current_state_and_work_change(snapshot):
    speaker = snapshot.agents[0]
    canvas_before = canvas_messages(snapshot, speaker)
    spoken_before = spoken_messages(snapshot, speaker, "", False)
    snapshot.turns.append(Turn(kind="agent", turnNumber=1, speakerId=snapshot.agents[1].id, speakerName="Peer", text="A new proposal."))
    speaker.energy, speaker.confidence = 10, 20
    canvas_after = canvas_messages(snapshot, speaker)
    spoken_after = spoken_messages(snapshot, speaker, "A revised canvas.", True)
    assert canvas_before[0] == canvas_after[0]
    assert spoken_before[0] == spoken_after[0]
    assert canvas_before[1] != canvas_after[1]
    assert "Current energy: 10/100; confidence: 20/100" in spoken_after[1]["content"]


async def test_successful_reply_metrics_exclude_retries_canvas_and_journal(snapshot, model):
    attempts = 0
    async def metered(*args, **options):
        nonlocal attempts
        result = await model(*args, **options)
        if options["phase"] == "spoken":
            attempts += 1
            if attempts == 1:
                result["message"]["content"] = ""
            result.update(prompt_eval_count=1000, eval_count=20, usage_details={"cachedInput": 800})
        return result
    result = await run_turn(snapshot, snapshot.agents[0], metered)
    details = result.usage_details
    assert len(details.calls) == 4 and details.response.phase == "spoken"
    assert details.response.attempt == 2 and details.response.input == 1000
    assert details.response.cachedInput == 800 and details.response.cacheStatus == "hit"
    assert details.response.context.inputSource == "provider" and details.response.context.inputTokens == 1000
    assert result.usage.input == 2040 and result.usage.output == 60
    assert details.calls[1].accepted is False and details.response.accepted is True
    assert "PRIVATE-JOURNAL" not in details.model_dump_json()


async def test_journal_failure_preserves_reply_and_records_unknown_attempt(snapshot, model):
    model.fail_journal = True
    result = await run_turn(snapshot, snapshot.agents[0], model)
    assert result.usage_details.response.input == 20
    assert result.usage_details.response.cachedInput is None
    assert result.usage_details.calls[-1].outcome == "TIMEOUT"
    assert result.usage_details.calls[-1].input is None


async def test_skips_do_not_publish_pending_response_or_accept_canvas(snapshot, model):
    model.invalid_speech = True
    result = await run_turn(snapshot, snapshot.agents[0], model)
    assert result.skipped and result.usage_details.response is None
    assert not any(call.accepted for call in result.usage_details.calls)
    assert result.usage_details.calls[0].validationPassed is True
    assert all(c.validationPassed is False and c.rejectionReason for c in result.usage_details.calls if c.phase == "spoken")


async def test_skipped_rejection_reasons_and_rolled_back_canvas_survive_restart(tmp_path):
    path = str(tmp_path / "skipped.sqlite3")
    store = Store(path)
    model = FakeModel()
    model.invalid_speech = True
    svc = SessionService(store, load_catalog(), model, pacing=0)
    session = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 1}))
    command(svc, session.id, "start")
    saved = await settle(svc, session.id)
    assert saved.turns[0].kind == "skipped"
    await svc.close()
    store.close()
    restored = Store(path)
    calls = restored.calls(session.id)
    assert not any(c.accepted for c in calls)
    assert calls[0].validationPassed is True and calls[0].rejectionReason is None
    assert all(c.validationPassed is False and c.rejectionReason for c in calls if c.phase == "spoken")
    assert [c.model_dump() for c in calls] == [c.model_dump() for c in restored.get(session.id).turns[0].usageDetails.calls]
    restored.close()


async def test_openrouter_sticky_session_and_response_cache_opt_out(snapshot, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-secret")
    identities = []
    fake = FakeModel()
    async def handler(request):
        body = json.loads(request.content)
        assert request.headers["X-OpenRouter-Cache"] == "false"
        assert body["provider"] == {"require_parameters": True} if "response_format" in body else True
        phase = "canvas" if "response_format" in body else "journal" if "private first-person journal" in str(body["messages"]) else "spoken"
        identities.append((phase, body["session_id"]))
        result = await fake(body["model"], body["messages"], phase=phase)
        text = result["message"]["content"]
        return httpx.Response(200, json=router_raw(json.dumps({"result": json.loads(text)}) if phase == "canvas" else text,
                             usage={"prompt_tokens": 1000, "completion_tokens": 20, "prompt_tokens_details": {"cached_tokens": 900}, "cost": 0.001}))
    snapshot.config.model = "deepseek/deepseek-v4.1-flash-1017"
    call = OpenRouterTransport(transport=httpx.MockTransport(handler))
    for _ in range(2):
        result = await run_turn(snapshot, snapshot.agents[0], call)
    assert identities[:3] == identities[3:]
    assert len(set(identity for _, identity in identities)) == 3
    assert result.usage_details.response.costUSD == 0.001
    assert result.usage_details.response.route == "openrouter"
    assert result.usage_details.response.context.modelWindowTokens == 1048576
    assert result.usage_details.response.context.effectiveWindowTokens == 32768


async def test_call_ledger_and_published_metadata_survive_restart(tmp_path, model):
    path = str(tmp_path / "calls.sqlite3")
    store = Store(path)
    svc = SessionService(store, load_catalog(), model, pacing=0)
    session = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 1}))
    command(svc, session.id, "start")
    saved = await settle(svc, session.id)
    assert len(store.calls(session.id)) == 3
    assert all(call.accepted for call in store.calls(session.id))
    assert saved.turns[0].usageDetails.response.input == 20
    await svc.close()
    store.close()
    restored = Store(path)
    assert restored.get(session.id).turns == saved.turns
    assert len(restored.calls(session.id)) == 3
    assert "PRIVATE-JOURNAL" not in json.dumps([call.model_dump() for call in restored.calls(session.id)])
    restored.close()


async def test_cancelled_attempt_is_recorded_without_publication(svc, snapshot, model):
    model.delay = 1
    command(svc, snapshot.id, "start")
    while not model.calls:
        await asyncio.sleep(0)
    command(svc, snapshot.id, "pause")
    await asyncio.sleep(0.01)
    assert svc.store.get(snapshot.id).turns == []
    calls = svc.store.calls(snapshot.id)
    assert len(calls) == 1 and calls[0].outcome == "CANCELLED" and not calls[0].accepted
    await svc.close()


async def test_judge_capability_probe_is_in_the_call_ledger_and_final_usage(store):
    model = PlainModel()
    svc = SessionService(store, load_catalog(), model, pacing=0)
    session = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 1, "judgeEnabled": True}))
    command(svc, session.id, "start")
    saved = await settle(svc, session.id)
    assert saved.status == "completed"
    final_calls = saved.finalUsageDetails.calls
    assert sum(call.phase == "judge_format" for call in final_calls) == 1
    assert len(store.calls(session.id)) == len(model.calls)
    assert saved.finalUsageDetails.response is None  # The review combines several small answers.
    await svc.close()


def test_budget_counts_structured_output_schema():
    from chorus.llm.transport import assert_budget
    with pytest.raises(ChorusError) as error:
        assert_budget([{"role": "user", "content": "Small input."}], format={"enum": ["x" * 33000]})
    assert error.value.code == "CONTEXT_LIMIT"


def test_schema_one_upgrade_preserves_old_sessions_and_missing_telemetry(tmp_path, model):
    path = str(tmp_path / "migration.sqlite3")
    store = Store(path)
    svc = SessionService(store, load_catalog(), model, pacing=0)
    snap = svc.create(SessionConfig(**CONFIG))
    store.close()
    with sqlite3.connect(path) as db:
        db.execute("DROP TABLE model_calls")
        db.execute("DELETE FROM schema_version WHERE id >= 2")
    upgraded = Store(path)
    assert upgraded.get(snap.id).finalUsageDetails is None
    assert upgraded.calls(snap.id) == []
    old = snap.model_dump(exclude={"finalUsageDetails"})
    old["turns"] = [Turn(kind="agent", turnNumber=1, speakerId="a", speakerName="A", text="A proposal.").model_dump(exclude={"usageDetails"})]
    assert Snapshot.model_validate(old).turns[0].usageDetails is None
    upgraded.close()
