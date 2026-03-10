import ollama
from chorus.llm.base import LLMAdapter

DEFAULT_BASE_URL = "http://localhost:11434"
DEFAULT_TIMEOUT = 300


class OllamaAdapter(LLMAdapter):
    def __init__(self, model: str, base_url: str = DEFAULT_BASE_URL) -> None:
        self._model = model
        self._client = ollama.AsyncClient(host=base_url, timeout=DEFAULT_TIMEOUT)

    def model_name(self) -> str:
        return self._model

    async def generate(
        self, system_prompt: str, messages: list[dict[str, str]]
    ) -> str:
        ollama_messages = self._build_messages(system_prompt, messages)
        response = await self._client.chat(
            model=self._model,
            messages=ollama_messages,
        )
        return response.message.content or ""

    def count_tokens(self, text: str) -> int:
        return len(text) // 4

    def _build_messages(
        self, system_prompt: str, messages: list[dict[str, str]]
    ) -> list[dict[str, str]]:
        return [{"role": "system", "content": system_prompt}] + messages


async def list_available_models(base_url: str = DEFAULT_BASE_URL) -> list[str]:
    client = ollama.AsyncClient(host=base_url)
    response = await client.list()
    return [model.model for model in response.models]
