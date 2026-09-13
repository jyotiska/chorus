from __future__ import annotations

from chorus.core.memory import AgentMemory
from chorus.core.personality import build_behavior_rules
from chorus.core.state import AgentState
from chorus.core.types import AgentConfig, Message
from chorus.prompts.token_budget import TokenBudgetManager, count_tokens, trim_conversation


class IdentityStage:
    def build(self, config: AgentConfig) -> str:
        rules = build_behavior_rules(config.archetype, config.traits)
        return (
            f"You are {config.name}, a {config.archetype.value} personality.\n\n"
            f"About you: {config.description}\n\n"
            f"Core traits: {', '.join(config.traits)}\n\n"
            f"Behavioral guidelines:\n{rules}\n\n"
            "Stay in character at all times. Your personality shapes HOW you "
            "contribute, not WHETHER you contribute."
        )


class ContextStage:
    def build(
        self,
        topic: str,
        state: AgentState,
        turn_number: int,
        context: str | None = None,
        expectations: list[str] | None = None,
    ) -> str:
        parts = [
            f"Current situation:",
            f"- Topic: {topic}",
            f"- Turn: {turn_number}",
            f"- Your mood: {state.mood}",
            f"- Your energy: {state.energy:.2f}",
            f"- Your confidence: {state.confidence:.2f}",
            f"- Your frustration: {state.frustration:.2f}",
        ]

        if context:
            parts.append(f"\nBackground:\n{context}")

        if expectations:
            formatted = "\n".join(f"  - {e}" for e in expectations)
            parts.append(f"\nExpected outcomes:\n{formatted}")

        nudges = self._state_nudges(state)
        if nudges:
            parts.append(f"\n{nudges}")

        return "\n".join(parts)

    def _state_nudges(self, state: AgentState) -> str:
        nudges = []
        if state.frustration > 0.6:
            nudges.append("You are feeling frustrated. You may express this, but stay constructive.")
        if state.energy < 0.3:
            nudges.append("Your energy is low. Keep responses concise and focused.")
        if state.confidence > 0.85:
            nudges.append("You are feeling very confident. Be bold but watch for blind spots.")
        if state.receptiveness < 0.3:
            nudges.append("You are not very open to others' input right now. Acknowledge this tension.")
        if state.momentum > 0.5:
            nudges.append("You are on a roll. Build on your momentum.")
        return "\n".join(nudges)


class MemoryStage:
    def build(
        self,
        memory: AgentMemory,
        query: str,
        participants: list[str],
    ) -> str:
        episodic = memory.episodic.retrieve(query, limit=5)
        semantic = memory.semantic.retrieve(query, limit=3)
        working = memory.working.recent()

        parts = []

        if episodic:
            parts.append("Relevant memories from this conversation:")
            for ep in episodic:
                parts.append(f"  [Turn {ep.turn}] {ep.agent_name}: {ep.content[:120]}...")

        if semantic:
            parts.append("\nThings you have learned:")
            for fact in semantic:
                parts.append(f"  - {fact.content}")

        if working:
            parts.append("\nRecent exchanges you remember clearly:")
            for ep in working[-3:]:
                parts.append(f"  {ep.agent_name}: {ep.content[:100]}...")

        return "\n".join(parts) if parts else ""


class ActionStage:
    def build(self) -> str:
        return (
            "Respond to the conversation. Your response must use this exact format:\n\n"
            "<response>\n"
            "  <thinking>Your private internal reasoning (not shared)</thinking>\n"
            "  <message>Your actual contribution to the group discussion</message>\n"
            "  <targets>Comma-separated agent names you are addressing, or empty</targets>\n"
            "  <action type=\"propose|question|agree|disagree|vote|none\">"
            "Optional structured action</action>\n"
            "</response>"
        )


class PromptPipeline:
    def __init__(self, budget_manager: TokenBudgetManager | None = None) -> None:
        self._identity = IdentityStage()
        self._context = ContextStage()
        self._memory = MemoryStage()
        self._action = ActionStage()
        self._budget = budget_manager or TokenBudgetManager()

    def build_system_prompt(
        self,
        config: AgentConfig,
        state: AgentState,
        memory: AgentMemory,
        topic: str,
        turn_number: int,
        context: str | None = None,
        expectations: list[str] | None = None,
        participants: list[str] | None = None,
    ) -> str:
        identity = self._identity.build(config)
        ctx = self._context.build(topic, state, turn_number, context, expectations)
        mem = self._memory.build(memory, topic, participants or [])
        action = self._action.build()

        sections = [identity, ctx]
        if mem:
            sections.append(mem)
        sections.append(action)

        return "\n\n".join(sections)

    def build_conversation_messages(
        self,
        agent_name: str,
        history: list[Message],
        topic: str,
        context: str | None,
        expectations: list[str] | None,
        system_tokens: int,
    ) -> list[dict[str, str]]:
        if not history:
            return [{"role": "user", "content": self._opening(topic, context, expectations)}]

        conv_budget = self._budget.conversation_budget(system_tokens)
        trimmed = trim_conversation(history, conv_budget)

        messages: list[dict[str, str]] = []
        for msg in trimmed:
            role = "assistant" if msg.agent_name == agent_name else "user"
            content = (
                msg.content
                if msg.agent_name == agent_name
                else f"{msg.agent_name}: {msg.content}"
            )
            messages.append({"role": role, "content": content})

        messages.append({
            "role": "user",
            "content": "Please give your next contribution to the discussion.",
        })
        return messages

    def _opening(
        self,
        topic: str,
        context: str | None,
        expectations: list[str] | None,
    ) -> str:
        parts = [f"The discussion topic is: {topic}"]
        if context:
            parts.append(f"\nBackground context:\n{context}")
        if expectations:
            formatted = "\n".join(f"- {e}" for e in expectations)
            parts.append(f"\nWhat this discussion should produce:\n{formatted}")
        parts.append("\nPlease give your opening contribution.")
        return "\n".join(parts)
