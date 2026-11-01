import json

import pytest

from chorus import ENGINE_VERSION, PROMPT_VERSION
from chorus.contracts import SessionConfig
from chorus.services.generation import run_turn
from chorus.services.policies import BRIEF_SPEECH_FORMAT, speech_error
from chorus.services.prompts import spoken_messages


@pytest.fixture
def web_session(svc):
    scenario = next(s for s in svc.catalog.scenarios if s.id == "chorus-web:debate")
    return svc.create(SessionConfig(scenarioId=scenario.id, participantIds=scenario.suggestedAgents,
                                    model="qwen3.5:4b-mlx", maxTurns=5))


@pytest.mark.parametrize("text", [
    "I propose human review.",
    "I propose human review. Keep the trial narrow.",
    "Propose " + "x" * 171 + ".",  # Exactly 180 characters.
    " ".join(["a"] * 29 + ["end."]),  # Exactly 30 words.
])
def test_brief_replies_accept_complete_one_or_two_sentence_contributions(text):
    assert speech_error(text, [], concise=True) is None


@pytest.mark.parametrize("text", [
    "",
    "Propose " + "x" * 172 + ".",
    " ".join(["a"] * 30 + ["end."]),
    "I propose review. Keep scope narrow. Validate safeguards.",
])
def test_brief_replies_reject_excess_length_without_truncating(text):
    assert speech_error(text, [], concise=True) == BRIEF_SPEECH_FORMAT
    if text:
        assert speech_error(text, []) is None


def test_brief_sentence_count_handles_decimals_and_quoted_endings():
    assert speech_error('Propose a 2.5% limit. Require "human review."', [], concise=True) is None
    assert speech_error('Propose "human review." Keep the scope narrow. Validate safeguards.', [], concise=True)


def test_concise_prompt_is_scoped_to_web_and_applies_to_adversaries(web_session, snapshot):
    for adversarial in (False, True):
        web_session.config.adversaryIds = [web_session.agents[0].id] if adversarial else []
        prompt = spoken_messages(web_session, web_session.agents[0], "", False)[0]["content"]
        assert BRIEF_SPEECH_FORMAT in prompt
        assert "40-80 words" not in prompt
        assert ("PRIVATE ADVERSARY ASSIGNMENT:" in prompt) is adversarial
    standard = spoken_messages(snapshot, snapshot.agents[0], "", False)[0]["content"]
    assert "2-4 short spoken sentences" in standard
    assert "40-80 words" in standard
    assert PROMPT_VERSION != ENGINE_VERSION


async def test_long_reply_is_retried_and_only_complete_short_reply_is_committed(web_session, model):
    draft = "I propose review. Keep scope narrow. Validate safeguards."
    accepted = "I propose human review. Keep the trial narrow."
    attempts = 0

    async def long_then_short(*args, **options):
        nonlocal attempts
        response = await model(*args, **options)
        if options["phase"] == "spoken":
            attempts += 1
            response["message"]["content"] = draft if attempts == 1 else accepted
        return response

    result = await run_turn(web_session, web_session.agents[0], long_then_short)
    assert not result.skipped and result.text == accepted
    assert result.canvas and result.journal
    spoken = [messages for messages, options in model.calls if options["phase"] == "spoken"]
    assert len(spoken) == 2
    assert BRIEF_SPEECH_FORMAT in spoken[1][-1]["content"]
    assert f"Previous attempt: {len(draft)} characters and {len(draft.split())} words." in spoken[1][-1]["content"]
    rejected = next(c for c in result.usage_details.calls if c.phase == "spoken" and c.attempt == 1)
    assert rejected.validationPassed is False and rejected.rejectionReason.startswith(BRIEF_SPEECH_FORMAT)
    assert "sentence limit exceeded" in rejected.rejectionReason
    assert result.usage_details.response.validationPassed is True
    assert draft not in json.dumps(spoken[1])


async def test_three_long_replies_skip_without_saving_pending_canvas_or_journal(web_session, model):
    async def always_long(*args, **options):
        response = await model(*args, **options)
        if options["phase"] == "spoken":
            response["message"]["content"] = "I propose review. Keep scope narrow. Validate safeguards."
        return response

    result = await run_turn(web_session, web_session.agents[0], always_long)
    assert result.skipped and result.text == "" and result.canvas == "" and result.journal is None
    assert len([options for _, options in model.calls if options["phase"] == "spoken"]) == 3
    assert not any(options["phase"] == "journal" for _, options in model.calls)
