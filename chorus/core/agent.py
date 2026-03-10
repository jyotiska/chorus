from chorus.core.personality import build_behavior_rules
from chorus.core.types import AgentConfig, Message, ParsedResponse
from chorus.llm.base import LLMAdapter
from chorus.parsing.response_parser import parse_response


class PersonalityAgent:
    def __init__(self, config: AgentConfig, adapter: LLMAdapter) -> None:
        self.config = config
        self.adapter = adapter

    @property
    def name(self) -> str:
        return self.config.name

    def build_system_prompt(self) -> str:
        behavior_rules = build_behavior_rules(self.config.archetype, self.config.traits)
        return (
            f"You are {self.config.name}, a {self.config.archetype.value} personality.\n\n"
            f"About you: {self.config.description}\n\n"
            f"Core traits: {', '.join(self.config.traits)}\n\n"
            f"Behavioral guidelines:\n{behavior_rules}\n\n"
            "Stay in character at all times. Your personality shapes HOW you contribute, "
            "not WHETHER you contribute.\n\n"
            "Format your response exactly like this:\n"
            "<response>\n"
            "  <thinking>Your private internal reasoning (not shared with others)</thinking>\n"
            "  <message>Your actual contribution to the group discussion</message>\n"
            "  <targets>Comma-separated agent names you're addressing, or empty</targets>\n"
            "  <action type=\"propose|question|agree|disagree|vote|none\">Optional structured action content</action>\n"
            "</response>"
        )

    def build_conversation_messages(
        self, history: list[Message], topic: str
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = []

        if not history:
            messages.append({
                "role": "user",
                "content": f"The discussion topic is: {topic}\n\nPlease give your opening contribution.",
            })
            return messages

        for msg in history:
            role = "assistant" if msg.agent_name == self.name else "user"
            content = (
                msg.content
                if msg.agent_name == self.name
                else f"{msg.agent_name}: {msg.content}"
            )
            messages.append({"role": role, "content": content})

        messages.append({
            "role": "user",
            "content": "Please give your next contribution to the discussion.",
        })

        return messages

    async def generate(self, history: list[Message], topic: str) -> ParsedResponse:
        system_prompt = self.build_system_prompt()
        messages = self.build_conversation_messages(history, topic)
        raw = await self.adapter.generate(system_prompt, messages)
        return parse_response(raw)
