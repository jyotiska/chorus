from chorus.core.memory import AgentMemory, Episode
from chorus.core.personality import STATE_BASELINES, WORKING_MEMORY_SLOTS
from chorus.core.state import AgentState, StateGuard, StateUpdate, UpdateSource, apply_updates
from chorus.core.types import AgentConfig, Message, ParsedResponse
from chorus.llm.base import LLMAdapter
from chorus.parsing.response_parser import parse_response
from chorus.prompts.pipeline import PromptPipeline
from chorus.prompts.token_budget import count_tokens


class PersonalityAgent:
    def __init__(self, config: AgentConfig, adapter: LLMAdapter) -> None:
        self.config = config
        self.adapter = adapter
        self.state = AgentState(**self._initial_state())
        self.memory = AgentMemory(
            working_capacity=WORKING_MEMORY_SLOTS[config.archetype]
        )
        self._pipeline = PromptPipeline()
        self._guard = StateGuard()
        self._turn_number = 0

    @property
    def name(self) -> str:
        return self.config.name

    @property
    def baselines(self) -> dict[str, float]:
        return STATE_BASELINES[self.config.archetype]

    def _initial_state(self) -> dict[str, float]:
        baselines = STATE_BASELINES[self.config.archetype]
        return {
            "confidence": baselines["confidence"],
            "cooperation": baselines["cooperation"],
            "assertiveness": baselines["assertiveness"],
            "openness": baselines["openness"],
            "energy": 0.9,
            "momentum": 0.0,
            "frustration": 0.0,
            "focus": 0.85,
        }

    def apply_turn_updates(self, spoke: bool, participants: list[str]) -> list:
        updates: list[StateUpdate] = [
            StateUpdate("energy", -0.03, UpdateSource.TIME_DECAY),
            StateUpdate("focus", -0.01, UpdateSource.TIME_DECAY),
        ]
        if spoke:
            updates.append(StateUpdate("momentum", 0.1, UpdateSource.INTERACTION_SUCCESS))
            updates.append(StateUpdate("energy", -0.02, UpdateSource.TIME_DECAY))
        else:
            updates.append(StateUpdate("momentum", -0.05, UpdateSource.TIME_DECAY))

        return apply_updates(self.state, updates, self.baselines, self.name, self._guard)

    def record_episode(
        self,
        turn: int,
        speaker: str,
        content: str,
        outcome: str = "neutral",
        valence: float = 0.0,
    ) -> None:
        episode = Episode(
            turn=turn,
            agent_name=speaker,
            content=content,
            emotional_valence=valence,
            outcome=outcome,
        )
        self.memory.record_turn(episode)

    async def generate(
        self,
        history: list[Message],
        topic: str,
        turn_number: int,
        context: str | None = None,
        expectations: list[str] | None = None,
        participants: list[str] | None = None,
    ) -> ParsedResponse:
        self._turn_number = turn_number

        system_prompt = self._pipeline.build_system_prompt(
            config=self.config,
            state=self.state,
            memory=self.memory,
            topic=topic,
            turn_number=turn_number,
            context=context,
            expectations=expectations,
            participants=participants,
        )

        system_tokens = count_tokens(system_prompt)
        messages = self._pipeline.build_conversation_messages(
            agent_name=self.name,
            history=history,
            topic=topic,
            context=context,
            expectations=expectations,
            system_tokens=system_tokens,
        )

        raw = await self.adapter.generate(system_prompt, messages)
        return parse_response(raw)
