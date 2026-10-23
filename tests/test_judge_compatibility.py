import asyncio
import json
import re

import pytest

from chorus.contracts import SessionConfig, Turn
from chorus.llm.transport import OllamaTransport
from chorus.services.canvas import evidence_block
from chorus.services.errors import ChorusError
from chorus.services.generation import run_review, review_evidence_error
from tests.conftest import CONFIG, FakeModel


class PlainModel(OllamaTransport):
    """An MLX-like runner: accepts format but never enforces it."""

    def __init__(self):
        super().__init__()
        self.calls = []
        self.bad_field = None
        self.bad_answer = ""
        self.failed_once = False
        self.fail_summary = False
        self.probe_error = None
        self.participants = FakeModel()

    async def __call__(self, model, messages, **options):
        self.calls.append((model, messages, options))
        phase = options.get("phase")
        field = re.search(r"CHORUS_REVIEW_FIELD: (\w+)", messages[0]["content"])
        if phase == "judge_format":
            if self.probe_error:
                raise self.probe_error
            text = "READY"
        elif phase in {"canvas", "spoken", "journal"}:
            return await self.participants(model, messages, **options)
        elif not field:
            text = json.dumps(options.get("format", {}))
        elif field[1] == self.bad_field and not self.failed_once:
            self.failed_once = True
            text = self.bad_answer
        elif field[1] == "summary" and self.fail_summary:
            text = "[]"
        elif field[1] in {"strength"} or field[1].startswith("citation_"):
            text = "1"
        elif field[1].startswith("rating_"):
            text = ("Missing", "Partially met", "Met")[int(field[1].split("_")[1]) % 3]
        else:
            text = {
                "summary": "The team has proposed a narrow trial.",
                "improvement": "The plan needs validation of the proposed measures.",
                "priority": "Validate the proposed safeguards before proceeding.",
                "feedback": "The team still needs to address the earlier concerns.",
            }[field[1]]
        return {"message": {"content": text}, "done_reason": "stop", "prompt_eval_count": 20, "eval_count": 10}


def written(snapshot):
    snapshot.canvas = evidence_block(snapshot.scenario.problem) + "\n\n# Plan\n\nProposed safeguards require human review."
    return snapshot


@pytest.mark.parametrize("model_id", ["qwen3:4b", "qwen3.5:0.8b-mlx", "qwen3.5:2b-mlx", "qwen3.5:4b-mlx", "gemma4:e2b-mlx", "gemma4:e4b-mlx"])
async def test_all_models_review_without_enforced_json(snapshot, model_id):
    snapshot = written(snapshot)
    snapshot.config.model = model_id
    model = PlainModel()
    checkpoint, _, _ = await run_review(snapshot, False, model)
    assert review_evidence_error(checkpoint, snapshot.canvas, snapshot.scenario.problem) is None
    final, usage, _ = await run_review(snapshot, True, model)
    assert len(final.requirements) == len(snapshot.scenario.guidelines) + 1
    assert final.verdict == "Partially meets requirements"
    assert final.feedbackResponse == "No previous judge feedback was given."
    assert review_evidence_error(final, snapshot.canvas, snapshot.scenario.problem) is None
    assert all(name == model_id for name, _, _ in model.calls)
    assert sum(options["phase"] == "judge_format" for _, _, options in model.calls) == 1
    assert all(not options.get("format") for _, _, options in model.calls[1:])
    final_calls = [options for _, _, options in model.calls if options["phase"] == "final"]
    assert usage.input == 20 * len(final_calls)
    assert usage.output == 10 * len(final_calls)


@pytest.mark.parametrize("field,answer", [
    ("strength", "9999"),
    ("summary", "A sentence " * 100 + "."),
    ("summary", "The canvas claims [UNPUBLISHED-SECRET] exists."),
    ("summary", "The plan ends with the."),
    ("improvement", "42"),
    ("rating_0", "Meets requirements"),
    ("citation_1", "9999"),
])
async def test_only_the_invalid_field_is_retried_without_its_draft(snapshot, field, answer):
    model = PlainModel()
    model.bad_field, model.bad_answer = field, answer
    review, usage, _ = await run_review(written(snapshot), True, model)
    assert review.requirements
    field_calls = [messages for _, messages, _ in model.calls if f"CHORUS_REVIEW_FIELD: {field}\n" in messages[0]["content"]]
    assert len(field_calls) == 2
    assert answer not in json.dumps([messages for _, messages, _ in model.calls])
    assert usage.input == 20 * len(model.calls)


async def test_full_object_schema_echo_falls_back_to_individual_answers(snapshot):
    # A runner can appear to support format and still fail a complex schema.
    model = PlainModel()
    model._structured_outputs[snapshot.config.model] = True
    review, _, _ = await run_review(written(snapshot), True, model)
    assert review.requirements
    assert sum(bool(options.get("format")) for _, _, options in model.calls) == 2
    assert any("CHORUS_REVIEW_FIELD" in messages[0]["content"] for _, messages, _ in model.calls)


@pytest.mark.parametrize("answer", ['```json\n{"selection": 1}\n```', '{"strength": "1"}', 'choice: 1', '1.', 'CHORUS_REVIEW_FIELD: 1'])
async def test_unambiguous_number_wrappers_are_accepted(snapshot, answer):
    model = PlainModel()
    model.bad_field, model.bad_answer = "strength", answer
    review, _, _ = await run_review(written(snapshot), False, model)
    assert review.strengths == ["The canvas records [Proposed safeguards require human review.] as a proposal."]
    assert sum("CHORUS_REVIEW_FIELD: strength" in messages[0]["content"] for _, messages, _ in model.calls) == 1


@pytest.mark.parametrize("answer", ['{"status": "Met"}', '```text\nPartially met\n```', 'Status: Missing.', 'CHORUS_REVIEW_FIELD: Partially met'])
async def test_status_labels_can_be_wrapped_but_are_never_inferred(snapshot, answer):
    model = PlainModel()
    model.bad_field, model.bad_answer = "rating_0", answer
    review, _, _ = await run_review(written(snapshot), True, model)
    assert review.requirements[0].status in answer
    assert sum("CHORUS_REVIEW_FIELD: rating_0" in messages[0]["content"] for _, messages, _ in model.calls) == 1


@pytest.mark.parametrize("answer", ['true', '1.5', '{"rating": 1, "other": 2}', '1 or 2', 'The plan needs 1 new safeguard.'])
async def test_ambiguous_or_invalid_choices_are_retried(snapshot, answer):
    model = PlainModel()
    model.bad_field, model.bad_answer = "strength", answer
    await run_review(written(snapshot), False, model)
    assert sum("CHORUS_REVIEW_FIELD: strength" in messages[0]["content"] for _, messages, _ in model.calls) == 2


@pytest.mark.parametrize("body", ['The proposed "human review" costs $5/unit.', '| Owner | Action |\n| Riley | Validate costs. |', 'Validate the [proposed] path before launch.'])
async def test_text_review_citations_come_from_actual_canvas_text(snapshot, body):
    snapshot.canvas = evidence_block(snapshot.scenario.problem) + "\n\n# Plan\n\n" + body
    review, _, _ = await run_review(snapshot, True, PlainModel())
    assert review_evidence_error(review, snapshot.canvas, snapshot.scenario.problem) is None


async def test_format_rejection_uses_text_but_transport_errors_do_not(snapshot):
    model = PlainModel()
    model.probe_error = ChorusError("MODEL_REQUEST_FAILED", "JSON schema format is unsupported.")
    assert (await run_review(written(snapshot), False, model))[0].summary
    model = PlainModel()
    model.probe_error = ChorusError("MODEL_UNAVAILABLE", "Connection failed.")
    with pytest.raises(ChorusError) as error:
        await run_review(snapshot, False, model)
    assert error.value.code == "MODEL_UNAVAILABLE"
    assert len(model.calls) == 1


async def test_empty_canvas_is_not_rated_as_written_work(snapshot):
    model = PlainModel()
    review, _, _ = await run_review(snapshot, True, model)
    assert review.strengths == ["No written deliverable exists yet."]
    assert review.verdict == "Needs more work"
    assert all(item.status == "Missing" for item in review.requirements)
    assert not any("rating_" in json.dumps(messages) or "citation_" in json.dumps(messages) for _, messages, _ in model.calls)


async def test_published_feedback_is_used_but_private_journals_are_not(snapshot):
    snapshot = written(snapshot)
    snapshot.turns = [Turn(kind="judge", turnNumber=5, speakerId="judge", speakerName="Judge", text="Validate the proposed measures.")]
    model = PlainModel()
    review, _, _ = await run_review(snapshot, True, model)
    assert review.feedbackResponse == "The team still needs to address the earlier concerns."
    assert any("CHORUS_REVIEW_FIELD: feedback" in messages[0]["content"] for _, messages, _ in model.calls)
    assert all("PRIVATE-JOURNAL" not in json.dumps(messages) for _, messages, _ in model.calls)


async def test_cancelled_field_cannot_return_a_review_or_start_another_field(snapshot):
    started, release = asyncio.Event(), asyncio.Event()
    model = PlainModel()

    async def delayed(name, messages, **options):
        if "CHORUS_REVIEW_FIELD: summary" in messages[0]["content"]:
            started.set()
            try:
                await release.wait()
            except asyncio.CancelledError:
                await release.wait()
        return await model(name, messages, **options)

    # The full-object attempts fail first, then the text summary is held.
    task = asyncio.create_task(run_review(written(snapshot), False, delayed))
    await started.wait()
    task.cancel()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not any("CHORUS_REVIEW_FIELD: improvement" in messages[0]["content"] for _, messages, _ in model.calls)


async def test_failed_text_review_resumes_without_repeating_participants(svc):
    from tests.test_platform import command, settle
    model = PlainModel()
    model.fail_summary = True
    svc.call = model
    snap = svc.create(SessionConfig(**{**CONFIG, "model": "qwen3.5:0.8b-mlx", "maxTurns": 5, "judgeEnabled": True}))
    command(svc, snap.id, "start")
    paused = await settle(svc, snap.id)
    assert paused.status == "paused" and len(paused.turns) == 5 and paused.canvas
    assert paused.finalJudgement is None
    model.fail_summary = False
    command(svc, snap.id, "resume")
    result = await settle(svc, snap.id)
    assert result.status == "completed" and len(result.turns) == 5 and result.finalJudgement
    assert len(svc.store.journals(snap.id)) == 5
    assert all("PRIVATE-JOURNAL" not in json.dumps(messages) for _, messages, _ in model.calls)
    await svc.close()


async def test_review_budget_is_checked_before_the_capability_probe(snapshot):
    model = PlainModel()
    snapshot.turns = [Turn(kind="agent", turnNumber=i + 1, speakerId="software-engineer", speakerName="Riley", text="Full public history. " * 70) for i in range(30)]
    with pytest.raises(ChorusError) as error:
        await run_review(snapshot, True, model)
    assert error.value.code == "CONTEXT_LIMIT"
    assert model.calls == []
