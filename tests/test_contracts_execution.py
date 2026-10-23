import asyncio
import json
import pytest
from pydantic import ValidationError
from chorus.contracts import SessionConfig, Command, Turn
from chorus.services.generation import run_turn, run_review, review_evidence_error
from chorus.services.errors import ChorusError
from chorus.services.sessions import SessionService
from chorus.services.catalog import load_catalog
from chorus.llm.transport import assert_budget, input_estimate, OllamaTransport
from tests.conftest import CONFIG


@pytest.mark.parametrize("change", [{"maxTurns": 0}, {"maxTurns": 101}, {"maxTurns": True}, {"maxTurns": "5"}, {"judgeEnabled": "false"}, {"participantIds": ["a", "a"]}, {"canvas": "client cannot set state"}])
def test_invalid_setup_contract(change):
    with pytest.raises(ValidationError):
        SessionConfig(**{**CONFIG, **change})


async def test_context_overflow_fails_before_generation(snapshot, model):
    snapshot.turns = [Turn(kind="agent", turnNumber=i + 1, speakerId="software-engineer", speakerName="Riley", text="History " * 200) for i in range(30)]
    with pytest.raises(ChorusError) as error:
        await run_turn(snapshot, snapshot.agents[0], model)
    assert error.value.code == "CONTEXT_LIMIT"
    assert model.calls == []


async def test_journal_timeout_preserves_public_output(monkeypatch, snapshot, model):
    import chorus.services.generation as generation
    monkeypatch.setattr(generation, "JOURNAL_TIMEOUT", 0.005)
    async def slow_journal(*args, **kwargs):
        if kwargs["phase"] == "journal":
            await asyncio.sleep(10)
        return await model(*args, **kwargs)
    result = await run_turn(snapshot, snapshot.agents[0], slow_journal)
    assert result.canvas and result.text and result.journal is None


async def test_transport_failure_pauses_preserving_work_and_resume(svc, snapshot):
    from tests.test_platform import command, settle
    original = svc.call
    async def failed(*args, **kwargs):
        raise ChorusError("MODEL_UNAVAILABLE", "Unavailable model.")
    svc.call = failed
    command(svc, snapshot.id, "start")
    paused = await settle(svc, snapshot.id)
    assert paused.status == "paused" and paused.errorCode == "MODEL_UNAVAILABLE"
    assert paused.turns == []
    svc.call = original
    command(svc, snapshot.id, "resume")
    result = await settle(svc, snapshot.id)
    assert len(result.turns) == 20
    await svc.close()


async def test_failed_final_review_resumes_without_repeating_participant(svc, model):
    from tests.test_platform import command, settle
    original = svc.call
    async def reject_final(*args, **kwargs):
        result = await original(*args, **kwargs)
        if kwargs["phase"] == "final":
            result["message"]["content"] = "[]"
        return result
    svc.call = reject_final
    snap = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 1, "judgeEnabled": True}))
    command(svc, snap.id, "start")
    paused = await settle(svc, snap.id)
    assert paused.status == "paused" and len(paused.turns) == 1
    assert paused.canvas and not paused.finalJudgement
    svc.call = original
    command(svc, snap.id, "resume")
    complete = await settle(svc, snap.id)
    assert complete.status == "completed" and complete.finalJudgement and len(complete.turns) == 1
    await svc.close()


async def test_skips_count_toward_turn_limit_and_preserve_rotation(svc, model):
    from tests.test_platform import command, settle
    model.invalid_speech = True
    snap = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 5}))
    command(svc, snap.id, "start")
    result = await settle(svc, snap.id)
    assert [t.kind for t in result.turns] == ["skipped"] * 5
    assert result.canvas == "" and svc.store.journals(snap.id) == []
    assert [t.speakerId for t in result.turns] == [snap.agents[i % 2].id for i in range(5)]
    await svc.close()


async def test_invalid_judge_citations_and_verdicts_are_retried(snapshot, model):
    from chorus.services.canvas import evidence_block
    snapshot.canvas = evidence_block(snapshot.scenario.problem) + "\n\n# Plan\n\nA proposed safeguard requires human review."
    async def invalid(*args, **kwargs):
        result = await model(*args, **kwargs)
        raw = json.loads(result["message"]["content"])
        raw["strengths"] = ["The plan records [invented evidence]."]
        result["message"]["content"] = json.dumps(raw)
        return result
    with pytest.raises(ChorusError) as error:
        await run_review(snapshot, False, invalid)
    assert error.value.code == "GENERATION_FAILED"
    assert len([options for _, options in model.calls if options.get("format")]) == 2
    assert "invented evidence" not in json.dumps(model.calls[1][0])


async def test_ollama_payload_budgets_usage_errors_and_private_logging(monkeypatch, caplog):
    import httpx
    calls = []
    async def handle(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"message": {"content": "A complete contribution."}, "prompt_eval_count": 5, "eval_count": 3})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handle), **kw))
    with caplog.at_level("INFO"):
        result = await OllamaTransport()(CONFIG["model"], [{"role": "user", "content": "PRIVATE-INPUT"}], format={"type": "object"}, phase="spoken")
    assert result["eval_count"] == 3
    assert calls[0]["options"] == {"num_ctx": 32768, "num_predict": 300, "temperature": 0.3}
    assert calls[0]["stream"] is False and calls[0]["think"] is False
    assert "PRIVATE-INPUT" not in caplog.text
    with pytest.raises(ChorusError) as error:
        assert_budget([{"role": "user", "content": "X" * 33000}])
    assert error.value.code == "CONTEXT_LIMIT"


def test_generated_contracts_and_client_copies_match_authority():
    from pathlib import Path
    from chorus.api import create_app
    from chorus.contracts import Contracts
    root = Path(__file__).resolve().parents[1]
    assert json.loads((root / "sdk/contracts.schema.json").read_text()) == Contracts.model_json_schema(mode="serialization")
    assert json.loads((root / "sdk/openapi.json").read_text()) == create_app().openapi()
    for app, directory in (("nanoville", "src/api/chorus"), ("chorus-web", "lib/api/chorus")):
        for name in ("client.ts", "contracts.schema.json", "contracts.generated.ts"):
            assert (root / "sdk" / name).read_bytes() == (root.parent / app / directory / name).read_bytes()


async def test_sessions_from_another_engine_version_remain_readable_but_do_not_resume(svc, snapshot):
    from tests.test_platform import command
    snapshot.status = "paused"
    snapshot.engineVersion = "previous-engine"
    svc.store.save(snapshot, snapshot.revision)
    with pytest.raises(ChorusError) as error:
        command(svc, snapshot.id, "resume")
    assert error.value.code == "VERSION_MISMATCH"
    assert svc.store.get(snapshot.id).engineVersion == "previous-engine"
    await svc.close()


async def test_a_skipped_slot_counts_toward_checkpoint_timing(svc, model):
    from tests.test_platform import command, settle
    original = svc.call
    async def skip_second(model_name, messages, **options):
        result = await original(model_name, messages, **options)
        if options["phase"] == "spoken" and "Turn: 2 of" in messages[1]["content"]:
            result["message"]["content"] = ""
        return result
    svc.call = skip_second
    snap = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 6, "judgeEnabled": True}))
    command(svc, snap.id, "start")
    done = await settle(svc, snap.id)
    assert [t.kind for t in done.turns] == ["agent", "skipped", "agent", "agent", "agent", "judge", "agent"]
    assert done.turns[5].turnNumber == 5 and done.finalJudgement
    assert len(svc.store.journals(snap.id)) == 5
    await svc.close()


def test_multiline_supplied_evidence_is_never_counted_as_team_output():
    from chorus.services.canvas import evidence_block
    from chorus.services.generation import proposed_canvas
    evidence = "A supplied fact.\n\nAnother supplied fact."
    assert proposed_canvas(evidence_block(evidence), evidence) == ""
    assert proposed_canvas(evidence_block(evidence) + "\n\n# Proposal\n\nTeam output.", evidence) == "# Proposal\n\nTeam output."


def test_review_sentence_contract_and_decoder_preserve_completion_guards():
    from chorus.contracts import complete_sentence, Review
    from chorus.services.generation import decoding_schema
    for fragment in ("Well-shaped.", "AI.", "The plan ends with the."):
        with pytest.raises(ValueError):
            complete_sentence(fragment)
    assert complete_sentence("A clear proposal.") == "A clear proposal."
    schema = decoding_schema(Review.model_json_schema())
    assert schema["properties"]["summary"]["pattern"] == r'^[^"\\\n]*[.!?]$'
    assert schema["properties"]["strengths"]["items"]["pattern"] == r'^[^"\\\n]*[.!?]$'
    assert "maxLength" not in json.dumps(schema)


async def test_judge_prompt_explicitly_communicates_the_full_response_contract(snapshot, model):
    from chorus.services.generation import run_review
    from chorus.services.canvas import evidence_block
    snapshot.canvas = evidence_block(snapshot.scenario.problem) + "\n\n# Plan\n\nThe proposed trial requires human review."
    await run_review(snapshot, True, model)
    system = model.calls[0][0][0]["content"]
    assert '"verdict"' in system
    assert '"feedbackResponse"' in system
    assert '"requirements"' in system
    assert '"nextPriorities"' in system
    assert "nested inside the complete response" in system


def test_every_catalog_model_can_create_a_judged_session(svc):
    for model in svc.catalog.models:
        assert svc.create(SessionConfig(**{**CONFIG, "model": model.id, "judgeEnabled": True})).config.model == model.id


async def test_review_decoder_patterns_are_anchored_and_grammar_compatible(snapshot, model):
    import re
    from chorus.services.canvas import evidence_block
    snapshot.canvas = evidence_block(snapshot.scenario.problem) + "\n\n# Plan\n\nHuman review ($/unit) requires follow-up."
    await run_review(snapshot, True, model)
    def check(node):
        if isinstance(node, dict):
            if "pattern" in node:
                assert node["pattern"].startswith("^") and node["pattern"].endswith("$")
                assert r"\ " not in node["pattern"]
                assert r"\-" not in node["pattern"]
            for child in node.values():
                check(child)
        elif isinstance(node, list):
            for child in node:
                check(child)
    check(model.calls[0][1]["format"])
    pattern = model.calls[0][1]["format"]["properties"]["strengths"]["items"]["pattern"]
    assert re.fullmatch(pattern, "The canvas records [Human review ($/unit) requires follow-up.] as a proposal.")


async def test_empty_canvas_review_never_credits_written_work(snapshot, model):
    async def empty_review(*args, **kwargs):
        result = await model(*args, **kwargs)
        raw = json.loads(result["message"]["content"])
        raw["strengths"] = ["No written deliverable exists yet."]
        if kwargs["phase"] == "final":
            raw["verdict"] = "Needs more work"
            for item in raw["requirements"].values():
                item.update(status="Missing", evidence="No written deliverable exists yet.")
        result["message"]["content"] = json.dumps(raw)
        return result
    review, _, _ = await run_review(snapshot, True, empty_review)
    assert all(item.status == "Missing" for item in review.requirements)
    assert review.verdict == "Needs more work"


async def test_empty_canvas_review_rejects_hallucinated_strengths(snapshot, model):
    with pytest.raises(ChorusError, match="complete, evidence-based review"):
        await run_review(snapshot, False, model)
    assert len([options for _, options in model.calls if options.get("format")]) == 2
