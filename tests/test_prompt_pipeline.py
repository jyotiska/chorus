import pytest
from chorus.core.memory import AgentMemory, Episode
from chorus.core.state import AgentState
from chorus.core.types import AgentConfig, Archetype, Message
from chorus.prompts.pipeline import (
    ActionStage,
    ContextStage,
    IdentityStage,
    MemoryStage,
    PromptPipeline,
)
from chorus.prompts.token_budget import TokenBudgetManager, count_tokens, trim_conversation


@pytest.fixture
def config() -> AgentConfig:
    return AgentConfig(
        name="Tester",
        archetype=Archetype.ANALYTICAL,
        traits=["cautious", "detail-oriented"],
        description="A test agent.",
    )


@pytest.fixture
def state() -> AgentState:
    return AgentState()


@pytest.fixture
def memory() -> AgentMemory:
    return AgentMemory(working_capacity=5)


# IdentityStage

def test_identity_stage_contains_name(config):
    stage = IdentityStage()
    result = stage.build(config)
    assert "Tester" in result


def test_identity_stage_contains_archetype(config):
    stage = IdentityStage()
    result = stage.build(config)
    assert "analytical" in result


def test_identity_stage_contains_traits(config):
    stage = IdentityStage()
    result = stage.build(config)
    assert "cautious" in result


# ContextStage

def test_context_stage_contains_topic(state):
    stage = ContextStage()
    result = stage.build("Is this working?", state, turn_number=1)
    assert "Is this working?" in result


def test_context_stage_contains_mood(state):
    stage = ContextStage()
    result = stage.build("topic", state, turn_number=1)
    assert state.mood in result


def test_context_stage_adds_frustration_nudge():
    stage = ContextStage()
    state = AgentState(frustration=0.8)
    result = stage.build("topic", state, turn_number=1)
    assert "frustrated" in result.lower()


def test_context_stage_includes_context_and_expectations(state):
    stage = ContextStage()
    result = stage.build(
        "topic",
        state,
        turn_number=1,
        context="Some background.",
        expectations=["Deliver a result"],
    )
    assert "Some background." in result
    assert "Deliver a result" in result


# MemoryStage

def test_memory_stage_empty_returns_empty(memory):
    stage = MemoryStage()
    result = stage.build(memory, "query", [])
    assert result == ""


def test_memory_stage_includes_episodes(memory):
    stage = MemoryStage()
    memory.record_turn(Episode(turn=1, agent_name="Other", content="relevant content about query topic"))
    result = stage.build(memory, "query topic", ["Other"])
    assert "relevant" in result


# ActionStage

def test_action_stage_contains_response_format():
    stage = ActionStage()
    result = stage.build()
    assert "<response>" in result
    assert "<message>" in result
    assert "<thinking>" in result


# TokenBudgetManager

def test_count_tokens_approximation():
    text = "a" * 400
    assert count_tokens(text) == 100


def test_trim_conversation_respects_budget():
    messages = [Message(agent_name="A", content="x" * 400, turn=i) for i in range(5)]
    trimmed = trim_conversation(messages, budget=100)
    assert len(trimmed) < len(messages)


def test_trim_conversation_keeps_most_recent():
    messages = [Message(agent_name="A", content=f"msg {i}", turn=i) for i in range(5)]
    trimmed = trim_conversation(messages, budget=50)
    if trimmed:
        assert trimmed[-1].turn == 4  # most recent preserved


# Full pipeline

def test_pipeline_builds_system_prompt(config, state, memory):
    pipeline = PromptPipeline()
    prompt = pipeline.build_system_prompt(
        config=config,
        state=state,
        memory=memory,
        topic="Test topic",
        turn_number=1,
    )
    assert "Tester" in prompt
    assert "Test topic" in prompt
    assert "<response>" in prompt


def test_pipeline_conversation_messages_no_history(config, state, memory):
    pipeline = PromptPipeline()
    messages = pipeline.build_conversation_messages(
        agent_name="Tester",
        history=[],
        topic="Test topic",
        context=None,
        expectations=None,
        system_tokens=500,
    )
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "Test topic" in messages[0]["content"]


def test_pipeline_conversation_messages_with_history(config, state, memory):
    pipeline = PromptPipeline()
    history = [
        Message(agent_name="Tester", content="My previous message.", turn=0),
        Message(agent_name="Other", content="Their response.", turn=1),
    ]
    messages = pipeline.build_conversation_messages(
        agent_name="Tester",
        history=history,
        topic="Test topic",
        context=None,
        expectations=None,
        system_tokens=500,
    )
    roles = [m["role"] for m in messages]
    assert "assistant" in roles
    assert "user" in roles
    assert messages[-1]["role"] == "user"
