"""
LLM adapter interfaces and implementations.
"""

from .adapter import LLMAdapter, LLMResponse
from .openai_adapter import (
    OpenAIAdapter,
    LLMAdapterError,
    LLMRateLimitError,
    LLMConnectionError,
    LLMAPIError,
)

__all__ = [
    # Base classes
    "LLMAdapter",
    "LLMResponse",
    # OpenAI implementation
    "OpenAIAdapter",
    # Exceptions
    "LLMAdapterError",
    "LLMRateLimitError",
    "LLMConnectionError",
    "LLMAPIError",
]

