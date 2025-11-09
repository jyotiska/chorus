from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Iterator, Any
from dataclasses import dataclass


@dataclass
class LLMResponse:
    """
    Standardized response from an LLM provider.
    
    Attributes:
        content: The generated text content
        model: Model identifier used for generation
        tokens_used: Total tokens consumed (prompt + completion)
        prompt_tokens: Tokens in the prompt
        completion_tokens: Tokens in the completion
        metadata: Additional provider-specific metadata
    """
    content: str
    model: str
    tokens_used: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = None


class LLMAdapter(ABC):
    """
    Abstract interface for LLM providers.
    
    All LLM adapters must implement this interface to ensure provider-agnostic
    integration with the framework.
    """
    
    def __init__(self, model: str, **kwargs):
        """
        Initialize the LLM adapter.
        
        Args:
            model: Model identifier (e.g., "gpt-4", "claude-3-opus")
            **kwargs: Provider-specific configuration
        """
        self.model = model
        self.config = kwargs
    
    @abstractmethod
    def generate(
        self,
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        top_p: float = 1.0,
        stop_sequences: Optional[List[str]] = None,
        **kwargs
    ) -> LLMResponse:
        """
        Generate a response from the LLM.
        
        Args:
            messages: List of message dicts in OpenAI format
                     [{"role": "system/user/assistant", "content": "..."}]
            max_tokens: Maximum tokens to generate (None = provider default)
            top_p: Nucleus sampling parameter (0.0 to 1.0, default: 1.0)
            stop_sequences: List of sequences that stop generation
            **kwargs: Additional provider-specific parameters (e.g., temperature if supported)
            
        Returns:
            LLMResponse object with generated content and metadata
            
        Raises:
            Exception: Provider-specific errors (should be handled by implementation)
        """
        pass
    
    @abstractmethod
    def generate_stream(
        self,
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        top_p: float = 1.0,
        stop_sequences: Optional[List[str]] = None,
        **kwargs
    ) -> Iterator[str]:
        """
        Generate a streaming response from the LLM.
        
        Args:
            messages: List of message dicts in OpenAI format
            max_tokens: Maximum tokens to generate (None = provider default)
            top_p: Nucleus sampling parameter (0.0 to 1.0, default: 1.0)
            stop_sequences: List of sequences that stop generation
            **kwargs: Additional provider-specific parameters (e.g., temperature if supported)
            
        Yields:
            Content chunks as they are generated
            
        Raises:
            Exception: Provider-specific errors (should be handled by implementation)
        """
        pass
    
    @abstractmethod
    def count_tokens(self, messages: List[Dict[str, str]]) -> int:
        """
        Count the number of tokens in a list of messages.
        
        Args:
            messages: List of message dicts in OpenAI format
            
        Returns:
            Estimated token count for the messages
            
        Note:
            Token counting may be approximate depending on provider capabilities.
        """
        pass
    
    def get_model_name(self) -> str:
        """
        Get the model identifier.
        
        Returns:
            Model name/identifier
        """
        return self.model
    
    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(model='{self.model}')"

