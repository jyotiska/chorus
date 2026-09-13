import os
from openai import AsyncOpenAI
from chorus.llm.base import LLMAdapter

DEFAULT_MODEL = "gpt-4o"


class OpenAIAdapter(LLMAdapter):
    def __init__(self, model: str = DEFAULT_MODEL) -> None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise EnvironmentError("OPENAI_API_KEY environment variable is not set.")
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model

    def model_name(self) -> str:
        return self._model

    async def generate(
        self, system_prompt: str, messages: list[dict[str, str]]
    ) -> str:
        all_messages = [{"role": "system", "content": system_prompt}] + messages
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=all_messages,
            max_tokens=1024,
        )
        return response.choices[0].message.content or ""

    def count_tokens(self, text: str) -> int:
        return len(text) // 4
