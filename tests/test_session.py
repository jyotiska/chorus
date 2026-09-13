import pytest
from unittest.mock import AsyncMock, MagicMock
from chorus.core.agent import PersonalityAgent
from chorus.core.types import AgentConfig, Archetype
from chorus.orchestration.session import Session


MOCK_XML_RESPONSE = (
    "<response>"
    "<thinking>Thinking.</thinking>"
    "<message>Hello from agent.</message>"
    "<targets></targets>"
    '<action type="none"></action>'
    "</response>"
)


def _make_agent(name: str) -> PersonalityAgent:
    config = AgentConfig(
        name=name,
        archetype=Archetype.LEADER,
        traits=["bold"],
        description="A mock agent.",
    )
    adapter = AsyncMock()
    adapter.generate.return_value = MOCK_XML_RESPONSE
    adapter.model_name.return_value = "test-model"
    agent = PersonalityAgent(config=config, adapter=adapter)
    return agent


@pytest.fixture
def two_agent_session() -> Session:
    return Session(
        topic="Test topic",
        agents=[_make_agent("Alice"), _make_agent("Bob")],
        max_turns=4,
    )


async def test_session_runs_correct_number_of_turns(two_agent_session):
    results = await two_agent_session.run()
    assert len(results) == 4


async def test_session_alternates_agents(two_agent_session):
    results = await two_agent_session.run()
    names = [r.agent_name for r in results]
    assert names == ["Alice", "Bob", "Alice", "Bob"]


async def test_session_history_grows(two_agent_session):
    await two_agent_session.run()
    assert len(two_agent_session.history) == 4


async def test_session_is_finished_after_max_turns(two_agent_session):
    await two_agent_session.run()
    assert two_agent_session.is_finished()


async def test_inject_message_adds_to_history(two_agent_session):
    two_agent_session.inject_message("User", "What do you think?")
    assert two_agent_session.history[-1].agent_name == "User"
    assert two_agent_session.history[-1].content == "What do you think?"


async def test_run_turn_increments_turn_number(two_agent_session):
    assert two_agent_session.turn_number == 0
    await two_agent_session.run_turn()
    assert two_agent_session.turn_number == 1
