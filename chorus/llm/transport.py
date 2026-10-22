from __future__ import annotations
import asyncio
import json
import logging
import os
import time
from typing import Any, Protocol
import httpx
from chorus.services.errors import ChorusError
from chorus import ENGINE_VERSION

logger = logging.getLogger("chorus.model")
CONTEXT_TOKENS = 32768
CALL_TIMEOUT = 180
OPERATION_TIMEOUT = 600
JOURNAL_TIMEOUT = 30


def input_estimate(messages: list[dict[str, str]]) -> int:
    return len(("".join(m.get("content", "") for m in messages) + "{}").encode("utf-8")) + len(messages) * 128


def assert_budget(messages: list[dict[str, str]], output: int = 300) -> None:
    if input_estimate(messages) + output > CONTEXT_TOKENS:
        raise ChorusError("CONTEXT_LIMIT", "The full discussion exceeds this model's input budget. Completed work is preserved; start a shorter discussion.")


class ModelCall(Protocol):
    async def __call__(self, model: str, messages: list[dict[str, str]], *, output: int = 300, format: dict[str, Any] | None = None, phase: str = "", attempt: int = 1, run_id: str = "") -> dict[str, Any]: ...


class OllamaTransport:
    def __init__(self, host: str | None = None) -> None:
        self.host = (host or os.getenv("OLLAMA_HOST", "http://localhost:11434")).rstrip("/")

    async def models(self) -> set[str]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(self.host + "/api/tags")
                response.raise_for_status()
                return {m["name"] for m in response.json()["models"]}
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
            raise ChorusError("MODEL_UNAVAILABLE", "Cannot reach the configured Ollama model catalog.") from error

    async def __call__(self, model: str, messages: list[dict[str, str]], *, output: int = 300, format: dict[str, Any] | None = None, phase: str = "", attempt: int = 1, run_id: str = "") -> dict[str, Any]:
        assert_budget(messages, output)
        started = time.monotonic()
        outcome = "success"
        result: dict[str, Any] = {}
        try:
            async with asyncio.timeout(CALL_TIMEOUT), httpx.AsyncClient(timeout=CALL_TIMEOUT) as client:
                response = await client.post(self.host + "/api/chat", json={"model": model, "messages": messages, "think": False, "stream": False, "options": {"num_ctx": CONTEXT_TOKENS, "num_predict": output, "temperature": 0.3}, **({"format": format} if format else {})})
            try:
                result = response.json()
            except ValueError as error:
                raise ChorusError("INVALID_MODEL_RESPONSE", "Ollama returned unreadable JSON.") from error
            if not isinstance(result, dict):
                raise ChorusError("INVALID_MODEL_RESPONSE", "Ollama returned an invalid response object.")
            if not response.is_success:
                message = result.get("error", "The model request failed.")
                code = "MODEL_NOT_FOUND" if "model" in message.lower() and "not found" in message.lower() else "MODEL_REQUEST_FAILED"
                raise ChorusError(code, message)
            if not isinstance(result, dict) or not isinstance(result.get("message"), dict) or not isinstance(result["message"].get("content", ""), str):
                raise ChorusError("INVALID_MODEL_RESPONSE", "Ollama returned an invalid response.")
            for key in ("prompt_eval_count", "eval_count"):
                if key in result and (type(result[key]) is not int or result[key] < 0):
                    raise ChorusError("INVALID_MODEL_RESPONSE", "Ollama returned invalid usage metadata.")
            return result
        except (TimeoutError, httpx.TimeoutException) as error:
            outcome = "TIMEOUT"
            raise ChorusError("TIMEOUT", "The model took too long. Resume to retry.") from error
        except httpx.HTTPError as error:
            outcome = "MODEL_UNAVAILABLE"
            raise ChorusError("MODEL_UNAVAILABLE", "The local model connection failed.") from error
        except ChorusError as error:
            outcome = error.code
            raise
        except asyncio.CancelledError:
            outcome = "CANCELLED"
            raise
        finally:
            logger.info(json.dumps({"event": "model_call", "runId": run_id, "promptVersion": ENGINE_VERSION, "model": model, "phase": phase, "attempt": attempt, "durationMs": round((time.monotonic() - started) * 1000), "estimatedInput": input_estimate(messages), "outputAllowance": output, "input": result.get("prompt_eval_count"), "output": result.get("eval_count"), "loadDuration": result.get("load_duration"), "promptEvalDuration": result.get("prompt_eval_duration"), "evalDuration": result.get("eval_duration"), "outcome": outcome}))
