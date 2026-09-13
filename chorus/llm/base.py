from abc import ABC, abstractmethod


class LLMAdapter(ABC):
    @abstractmethod
    async def generate(
        self, system_prompt: str, messages: list[dict[str, str]]
    ) -> str:
        pass

    @abstractmethod
    def count_tokens(self, text: str) -> int:
        pass

    @abstractmethod
    def model_name(self) -> str:
        pass
