import os
import anthropic
from chorus.llm.base import LLMAdapter

DEFAULT_MODEL = "claude-sonnet-4-6"


class AnthropicAdapter(LLMAdapter):
    def __init__(self, model: str = DEFAULT_MODEL) -> None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise EnvironmentError("ANTHROPIC_API_KEY environment variable is not set.")
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._model = model

    def model_name(self) -> str:
        return self._model

    async def generate(
        self, system_prompt: str, messages: list[dict[str, str]]
    ) -> str:
        response = await self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=system_prompt,
            messages=messages,
        )
        return response.content[0].text

    def count_tokens(self, text: str) -> int:
        return len(text) // 4
