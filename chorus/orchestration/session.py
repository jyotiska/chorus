from __future__ import annotations

from dataclasses import dataclass, field
from chorus.core.agent import PersonalityAgent
from chorus.core.state import AgentState, StateEvent
from chorus.core.types import Message, ParsedResponse


@dataclass
class TurnResult:
    turn: int
    agent_name: str
    response: ParsedResponse
    state_snapshot: dict[str, float] = field(default_factory=dict)
    state_events: list[StateEvent] = field(default_factory=list)


@dataclass
class Session:
    topic: str
    agents: list[PersonalityAgent]
    max_turns: int
    context: str | None = None
    expectations: list[str] | None = None
    history: list[Message] = field(default_factory=list)
    turn_number: int = 0
    events: list[StateEvent] = field(default_factory=list)

    def _next_agent(self) -> PersonalityAgent:
        return self.agents[self.turn_number % len(self.agents)]

    def _record_message(self, agent_name: str, content: str) -> None:
        self.history.append(
            Message(agent_name=agent_name, content=content, turn=self.turn_number)
        )

    def _participant_names(self) -> list[str]:
        return [a.name for a in self.agents]

    async def run_turn(self) -> TurnResult:
        speaker = self._next_agent()

        response = await speaker.generate(
            history=self.history,
            topic=self.topic,
            turn_number=self.turn_number,
            context=self.context,
            expectations=self.expectations,
            participants=self._participant_names(),
        )

        self._record_message(speaker.name, response.message)

        # Let all agents observe this turn
        all_events: list[StateEvent] = []
        for agent in self.agents:
            spoke = agent.name == speaker.name
            events = agent.apply_turn_updates(spoke=spoke, participants=self._participant_names())
            all_events.extend(events)

            # Record the episode in each agent's memory
            agent.record_episode(
                turn=self.turn_number,
                speaker=speaker.name,
                content=response.message,
            )

        self.events.extend(all_events)
        self.turn_number += 1

        return TurnResult(
            turn=self.turn_number,
            agent_name=speaker.name,
            response=response,
            state_snapshot=speaker.state.snapshot(),
            state_events=[e for e in all_events if e.agent_name == speaker.name],
        )

    def is_finished(self) -> bool:
        return self.turn_number >= self.max_turns

    def inject_message(self, sender: str, content: str) -> None:
        self._record_message(sender, content)

    def agent_state(self, name: str) -> AgentState | None:
        for agent in self.agents:
            if agent.name == name:
                return agent.state
        return None

    async def run(self) -> list[TurnResult]:
        results = []
        while not self.is_finished():
            result = await self.run_turn()
            results.append(result)
        return results
