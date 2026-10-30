"""Route configured models without falling back between providers."""
from __future__ import annotations

from chorus.contracts import Catalog, ModelInfo
from chorus.llm.openai import OpenAITransport
from chorus.llm.openrouter import OpenRouterTransport
from chorus.llm.transport import OllamaTransport
from chorus.services.errors import ChorusError


class ProviderRouter:
    def __init__(self, catalog: Catalog, *, ollama: OllamaTransport | None = None, openai: OpenAITransport | None = None, openrouter: OpenRouterTransport | None = None):
        self.catalog = catalog
        self.ollama = ollama or OllamaTransport()
        self.openai = openai or OpenAITransport()
        self.openrouter = openrouter or OpenRouterTransport()

    def transport(self, model: str):
        info = next((item for item in self.catalog.models if item.id == model), None)
        if info is None:
            raise ChorusError("MODEL_NOT_FOUND", "This model is no longer configured. Start a new session with a current model.")
        return {"ollama": self.ollama, "openai": self.openai, "openrouter": self.openrouter}[info.provider]

    def validate_model(self, model: str) -> None:
        transport = self.transport(model)
        if transport is not self.ollama:
            transport.require_key()

    async def __call__(self, model, messages, **options):
        return await self.transport(model)(model, messages, **options)

    async def structured_output_support(self, model: str, run_id: str):
        transport = self.transport(model)
        if transport is not self.ollama:
            return True, None
        return await self.ollama.structured_output_support(model, run_id)

    async def model_infos(self) -> list[ModelInfo]:
        installed: set[str] = set()
        local_error = None
        if any(item.provider == "ollama" for item in self.catalog.models):
            try:
                installed = await self.ollama.models()
            except ChorusError:
                local_error = "Cannot reach Ollama. Start the local model service and refresh."
        result = []
        for item in self.catalog.models:
            if item.provider != "ollama":
                available = bool(self.transport(item.id).api_key)
                variable = "OPENROUTER_API_KEY" if item.provider == "openrouter" else "CHORUS_API_KEY"
                result.append(item.model_copy(update={"installed": None, "available": available, "unavailableReason": None if available else f"Set {variable} in the Chorus backend environment and restart Chorus."}))
            else:
                available = item.id in installed
                result.append(item.model_copy(update={"installed": available, "available": available, "unavailableReason": None if available else local_error or "This model is not installed in Ollama."}))
        return result
