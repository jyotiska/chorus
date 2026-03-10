import pytest
from unittest.mock import AsyncMock
from chorus.core.agent import PersonalityAgent
from chorus.core.types import AgentConfig, Archetype, Message


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


def test_system_prompt_contains_name(agent):
    prompt = agent.build_system_prompt()
    assert "Tester" in prompt


def test_system_prompt_contains_archetype(agent):
    prompt = agent.build_system_prompt()
    assert "analytical" in prompt


def test_system_prompt_contains_traits(agent):
    prompt = agent.build_system_prompt()
    assert "cautious" in prompt
    assert "detail-oriented" in prompt


def test_conversation_messages_no_history(agent):
    messages = agent.build_conversation_messages([], "Should we launch?")
    assert len(messages) == 1
    assert messages[0]["role"] == "user"
    assert "Should we launch?" in messages[0]["content"]


def test_conversation_messages_own_turn_is_assistant(agent):
    history = [Message(agent_name="Tester", content="My previous message.", turn=1)]
    messages = agent.build_conversation_messages(history, "Topic")
    assert messages[0]["role"] == "assistant"
    assert messages[0]["content"] == "My previous message."


def test_conversation_messages_other_agent_is_user(agent):
    history = [Message(agent_name="Other", content="Their message.", turn=1)]
    messages = agent.build_conversation_messages(history, "Topic")
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
    result = await agent.generate([], "Test topic")
    assert result.message == "My response."
    assert result.thinking == "Thinking."
    mock_adapter.generate.assert_called_once()
