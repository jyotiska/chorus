from typing import List, Dict, Optional, Iterator
import os
from openai import OpenAI, OpenAIError, APIError, RateLimitError, APIConnectionError
from .adapter import LLMAdapter, LLMResponse


class LLMAdapterError(Exception):
    """Base exception for LLM adapter errors."""


class LLMRateLimitError(LLMAdapterError):
    """Raised when rate limit is exceeded."""


class LLMConnectionError(LLMAdapterError):
    """Raised when connection to LLM provider fails."""


class LLMAPIError(LLMAdapterError):
    """Raised when LLM provider API returns an error."""


class OpenAIAdapter(LLMAdapter):
    """
    Concrete implementation of LLMAdapter for OpenAI's API.
    
    Supports GPT-4, GPT-3.5-turbo, and other OpenAI chat models.
    """
    
    def __init__(
        self,
        model: str = "gpt-5-nano",
        api_key: Optional[str] = None,
        organization: Optional[str] = None,
        base_url: Optional[str] = None,
        **kwargs
    ):
        """
        Initialize the OpenAI adapter.
        
        Args:
            model: OpenAI model identifier (default: "gpt-5-nano")
            api_key: OpenAI API key (if None, reads from OPENAI_API_KEY env var)
            organization: OpenAI organization ID (optional)
            base_url: Custom base URL for API (optional, for Azure or proxies)
            **kwargs: Additional configuration options
        """
        super().__init__(model, **kwargs)
        
        # Get API key from parameter or environment
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError(
                "OpenAI API key not provided. Set OPENAI_API_KEY environment variable "
                "or pass api_key parameter."
            )
        
        # Initialize OpenAI client
        client_kwargs = {"api_key": self.api_key}
        if organization:
            client_kwargs["organization"] = organization
        if base_url:
            client_kwargs["base_url"] = base_url
        
        self.client = OpenAI(**client_kwargs)
    
    def generate(
        self,
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        top_p: float = 1.0,
        stop_sequences: Optional[List[str]] = None,
        **kwargs
    ) -> LLMResponse:
        """
        Generate a response using OpenAI's API.
        
        Args:
            messages: List of message dicts [{"role": "...", "content": "..."}]
            max_tokens: Maximum tokens to generate
            top_p: Nucleus sampling parameter
            stop_sequences: Stop sequences
            **kwargs: Additional OpenAI-specific parameters (e.g., temperature if model supports it)
            
        Returns:
            LLMResponse with generated content and metadata
            
        Raises:
            OpenAIError: For API errors
        """
        try:
            # Prepare API call parameters
            api_params = {
                "model": self.model,
                "messages": self._format_messages(messages),
                "top_p": top_p,
            }
            
            # Add optional parameters
            if max_tokens is not None:
                api_params["max_tokens"] = max_tokens
            if stop_sequences:
                api_params["stop"] = stop_sequences
            
            # Merge any additional kwargs
            api_params.update(kwargs)
            
            # Make API call
            response = self.client.chat.completions.create(**api_params)
            
            # Extract response data
            content = response.choices[0].message.content
            
            # Build metadata
            metadata = {
                "finish_reason": response.choices[0].finish_reason,
                "model": response.model,
                "created": response.created,
            }
            
            # Add system fingerprint if available
            if hasattr(response, "system_fingerprint") and response.system_fingerprint:
                metadata["system_fingerprint"] = response.system_fingerprint
            
            return LLMResponse(
                content=content,
                model=response.model,
                tokens_used=response.usage.total_tokens,
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                metadata=metadata
            )
            
        except RateLimitError as e:
            raise LLMRateLimitError(f"OpenAI rate limit exceeded: {e}") from e
        except APIConnectionError as e:
            raise LLMConnectionError(f"OpenAI API connection error: {e}") from e
        except APIError as e:
            raise LLMAPIError(f"OpenAI API error: {e}") from e
        except OpenAIError as e:
            raise LLMAPIError(f"OpenAI error: {e}") from e
        except Exception as e:
            raise LLMAdapterError(f"Unexpected error calling OpenAI: {e}") from e
    
    def generate_stream(
        self,
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        top_p: float = 1.0,
        stop_sequences: Optional[List[str]] = None,
        **kwargs
    ) -> Iterator[str]:
        """
        Generate a streaming response using OpenAI's API.
        
        Args:
            messages: List of message dicts
            max_tokens: Maximum tokens to generate
            top_p: Nucleus sampling parameter
            stop_sequences: Stop sequences
            **kwargs: Additional OpenAI-specific parameters (e.g., temperature if model supports it)
            
        Yields:
            Content chunks as they are generated
            
        Raises:
            OpenAIError: For API errors
        """
        try:
            # Prepare API call parameters
            api_params = {
                "model": self.model,
                "messages": self._format_messages(messages),
                "top_p": top_p,
                "stream": True,
            }
            
            # Add optional parameters
            if max_tokens is not None:
                api_params["max_tokens"] = max_tokens
            if stop_sequences:
                api_params["stop"] = stop_sequences
            
            # Merge any additional kwargs
            api_params.update(kwargs)
            
            # Make streaming API call
            stream = self.client.chat.completions.create(**api_params)
            
            # Yield chunks as they arrive
            for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    yield chunk.choices[0].delta.content
                    
        except RateLimitError as e:
            raise LLMRateLimitError(f"OpenAI rate limit exceeded: {e}") from e
        except APIConnectionError as e:
            raise LLMConnectionError(f"OpenAI API connection error: {e}") from e
        except APIError as e:
            raise LLMAPIError(f"OpenAI API error: {e}") from e
        except OpenAIError as e:
            raise LLMAPIError(f"OpenAI error: {e}") from e
        except Exception as e:
            raise LLMAdapterError(f"Unexpected error calling OpenAI: {e}") from e
    
    def count_tokens(self, messages: List[Dict[str, str]]) -> int:
        """
        Estimate token count for messages.
        
        Note: This is a rough estimation. For exact counts, consider using tiktoken.
        
        Args:
            messages: List of message dicts
            
        Returns:
            Estimated token count
        """
        # Rough estimation: ~4 characters per token (English text average)
        # This is approximate - for production, use tiktoken library
        total_chars = sum(len(msg.get("content", "")) for msg in messages)
        estimated_tokens = total_chars // 4
        
        # Add overhead for message formatting (role, etc.)
        overhead_per_message = 4  # Approximate
        total_overhead = len(messages) * overhead_per_message
        
        return estimated_tokens + total_overhead
    
    def _format_messages(self, messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
        """
        Format messages for OpenAI API.
        
        Validates and ensures messages conform to OpenAI's expected format.
        
        Args:
            messages: List of message dicts
            
        Returns:
            Formatted messages list
            
        Raises:
            ValueError: If messages are invalid
        """
        if not messages:
            raise ValueError("Messages list cannot be empty")
        
        formatted_messages = []
        for msg in messages:
            if "role" not in msg or "content" not in msg:
                raise ValueError(
                    f"Message missing required fields. Expected 'role' and 'content', "
                    f"got: {msg.keys()}"
                )
            
            # Validate role
            valid_roles = ["system", "user", "assistant", "function", "tool"]
            if msg["role"] not in valid_roles:
                raise ValueError(
                    f"Invalid message role: '{msg['role']}'. "
                    f"Valid roles: {', '.join(valid_roles)}"
                )
            
            formatted_messages.append({
                "role": msg["role"],
                "content": msg["content"]
            })
        
        return formatted_messages
    
    def __repr__(self) -> str:
        return f"OpenAIAdapter(model='{self.model}')"

