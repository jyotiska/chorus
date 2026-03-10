from dataclasses import dataclass, field
from chorus.core.agent import PersonalityAgent
from chorus.core.types import Message, ParsedResponse


@dataclass
class TurnResult:
    turn: int
    agent_name: str
    response: ParsedResponse


@dataclass
class Session:
    topic: str
    agents: list[PersonalityAgent]
    max_turns: int
    context: str | None = None
    expectations: list[str] | None = None
    history: list[Message] = field(default_factory=list)
    turn_number: int = 0

    def _next_agent(self) -> PersonalityAgent:
        return self.agents[self.turn_number % len(self.agents)]

    def _record_message(self, agent_name: str, content: str) -> None:
        self.history.append(
            Message(agent_name=agent_name, content=content, turn=self.turn_number)
        )

    async def run_turn(self) -> TurnResult:
        agent = self._next_agent()
        response = await agent.generate(self.history, self.topic, self.context, self.expectations)
        self._record_message(agent.name, response.message)
        self.turn_number += 1
        return TurnResult(
            turn=self.turn_number,
            agent_name=agent.name,
            response=response,
        )

    def is_finished(self) -> bool:
        return self.turn_number >= self.max_turns

    def inject_message(self, sender: str, content: str) -> None:
        self._record_message(sender, content)

    async def run(self) -> list[TurnResult]:
        results = []
        while not self.is_finished():
            result = await self.run_turn()
            results.append(result)
        return results
