"""
Chorus Framework - Multi-Agent Personality-Driven Conversation System

A framework for orchestrating conversations between AI agents with distinct
personalities, states, and communication styles.
"""

# Core components
from .core import (
    Personality,
    Archetype,
    AgentState,
    PersonalityAgent,
)

# LLM adapters
from .llm import (
    LLMAdapter,
    LLMResponse,
    OpenAIAdapter,
    LLMAdapterError,
    LLMRateLimitError,
    LLMConnectionError,
    LLMAPIError,
)

# Orchestration
from .orchestration import (
    ChorusFramework,
    ConversationTurn,
)

__version__ = "0.1.0"

__all__ = [
    # Core
    "Personality",
    "Archetype",
    "AgentState",
    "PersonalityAgent",
    # LLM
    "LLMAdapter",
    "LLMResponse",
    "OpenAIAdapter",
    "LLMAdapterError",
    "LLMRateLimitError",
    "LLMConnectionError",
    "LLMAPIError",
    # Orchestration
    "ChorusFramework",
    "ConversationTurn",
    # Version
    "__version__",
]

