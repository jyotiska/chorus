import pytest
from unittest.mock import AsyncMock
from chorus.core.agent import PersonalityAgent
from chorus.core.types import AgentConfig, Archetype, Message
from chorus.prompts.pipeline import PromptPipeline


@pytest.fixture
def agent_config() -> AgentConfig:
    return AgentConfig(
        name="Tester",
        archetype=Archetype.ANALYTICAL,
        traits=["cautious", "detail-oriented"],
        description="A test agent.",
    )


@pytest.fixture
def mock_adapter() -> AsyncMock:
    adapter = AsyncMock()
    adapter.model_name.return_value = "test-model"
    return adapter


@pytest.fixture
def agent(agent_config, mock_adapter) -> PersonalityAgent:
    return PersonalityAgent(config=agent_config, adapter=mock_adapter)


def test_agent_has_state(agent):
    assert agent.state is not None
    assert 0.0 <= agent.state.confidence <= 1.0
    assert 0.0 <= agent.state.energy <= 1.0


def test_agent_has_memory(agent):
    assert agent.memory is not None
    assert agent.memory.working is not None
    assert agent.memory.episodic is not None


def test_agent_initial_state_matches_archetype_baseline(agent):
    baselines = agent.baselines
    assert agent.state.confidence == pytest.approx(baselines["confidence"])
    assert agent.state.cooperation == pytest.approx(baselines["cooperation"])


def test_pipeline_system_prompt_contains_name(agent):
    pipeline = PromptPipeline()
    prompt = pipeline.build_system_prompt(
        config=agent.config,
        state=agent.state,
        memory=agent.memory,
        topic="Test topic",
        turn_number=1,
    )
    assert "Tester" in prompt


def test_pipeline_system_prompt_contains_archetype(agent):
    pipeline = PromptPipeline()
    prompt = pipeline.build_system_prompt(
        config=agent.config,
        state=agent.state,
        memory=agent.memory,
        topic="Test topic",
        turn_number=1,
    )
    assert "analytical" in prompt


def test_pipeline_system_prompt_contains_traits(agent):
    pipeline = PromptPipeline()
    prompt = pipeline.build_system_prompt(
        config=agent.config,
        state=agent.state,
        memory=agent.memory,
        topic="Test topic",
        turn_number=1,
    )
    assert "cautious" in prompt
    assert "detail-oriented" in prompt


def test_pipeline_conversation_messages_no_history(agent):
    pipeline = PromptPipeline()
    messages = pipeline.build_conversation_messages(
        agent_name=agent.name,
        history=[],
        topic="Should we launch?",
        context=None,
        expectations=None,
        system_tokens=500,
    )
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "Should we launch?" in messages[0]["content"]


def test_pipeline_conversation_messages_own_turn_is_assistant(agent):
    pipeline = PromptPipeline()
    history = [Message(agent_name="Tester", content="My previous message.", turn=1)]
    messages = pipeline.build_conversation_messages(
        agent_name=agent.name,
        history=history,
        topic="Topic",
        context=None,
        expectations=None,
        system_tokens=500,
    )
    assert messages[0]["role"] == "assistant"
    assert messages[0]["content"] == "My previous message."


def test_pipeline_conversation_messages_other_agent_is_user(agent):
    pipeline = PromptPipeline()
    history = [Message(agent_name="Other", content="Their message.", turn=1)]
    messages = pipeline.build_conversation_messages(
        agent_name=agent.name,
        history=history,
        topic="Topic",
        context=None,
        expectations=None,
        system_tokens=500,
    )
    assert messages[0]["role"] == "user"
    assert "Other:" in messages[0]["content"]


async def test_generate_calls_adapter_and_parses(agent, mock_adapter):
    mock_adapter.generate.return_value = (
        "<response>"
        "<thinking>Thinking.</thinking>"
        "<message>My response.</message>"
        "<targets></targets>"
        '<action type="none"></action>'
        "</response>"
    )
    result = await agent.generate([], "Test topic", turn_number=1)
    assert result.message == "My response."
    assert result.thinking == "Thinking."
    mock_adapter.generate.assert_called_once()


def test_apply_turn_updates_speaker_gains_momentum(agent):
    initial_momentum = agent.state.momentum
    agent.apply_turn_updates(spoke=True, participants=["Tester", "Other"])
    assert agent.state.momentum > initial_momentum


def test_apply_turn_updates_energy_decays(agent):
    initial_energy = agent.state.energy
    agent.apply_turn_updates(spoke=False, participants=["Tester", "Other"])
    assert agent.state.energy < initial_energy
