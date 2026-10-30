"""OpenRouter Chat Completions adapter with no cross-model fallback."""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import httpx

from chorus import ENGINE_VERSION
from chorus.llm.structured import strict_schema, unwrap_result
from chorus.llm.transport import CALL_TIMEOUT, assert_budget, input_estimate, logger
from chorus.services.errors import ChorusError

REASONING_MODELS = {"minimax/minimax-m3.1-flash", "z-ai/glm-5.3-flash"}
REASONING_ALLOWANCE = 2048


def request_error(status: int) -> ChorusError:
    code, message = {
        401: ("MODEL_REQUEST_FAILED", "OpenRouter rejected OPENROUTER_API_KEY. Check the backend credential."),
        402: ("MODEL_REQUEST_FAILED", "OpenRouter credits are exhausted. Add credits, then resume to retry."),
        403: ("MODEL_REQUEST_FAILED", "OpenRouter denied this request. Check account access and provider restrictions."),
        404: ("MODEL_NOT_FOUND", "The selected OpenRouter model or route is unavailable."),
        408: ("TIMEOUT", "OpenRouter took too long. Resume to retry."),
        429: ("MODEL_REQUEST_FAILED", "OpenRouter rate limit reached. Wait, then resume to retry."),
    }.get(status, ("MODEL_UNAVAILABLE" if status >= 500 else "MODEL_REQUEST_FAILED", "OpenRouter could not complete the request. Saved work is preserved; resume to retry."))
    return ChorusError(code, message)


def embedded_error(value: Any) -> ChorusError:
    status = value.get("code") if isinstance(value, dict) else None
    if isinstance(status, str) and status.isdigit():
        status = int(status)
    return request_error(status if type(status) is int and 400 <= status <= 599 else 502)


def normalize_response(raw: Any, structured: bool) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter returned an invalid response.")
    if raw.get("error") is not None:
        raise embedded_error(raw["error"])
    choices = raw.get("choices")
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter returned invalid choices.")
    choice = choices[0]
    if choice.get("error") is not None:
        raise embedded_error(choice["error"])
    reason, message = choice.get("finish_reason"), choice.get("message")
    if not isinstance(reason, str) or reason not in {"stop", "length"} or not isinstance(message, dict) or message.get("role") != "assistant":
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter could not complete a valid text response.")
    if message.get("refusal") or message.get("tool_calls"):
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter returned a refusal or unexpected tool call. Saved work is preserved.")
    content = message.get("content")
    if content is None and reason == "length":
        content = ""
    if not isinstance(content, str) or not content.strip() and reason != "length":
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter returned invalid or empty text.")
    result: dict[str, Any] = {"message": {"content": unwrap_result(content) if structured and reason != "length" else content}, "done_reason": reason}
    usage = raw.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter returned invalid usage metadata.")
        for source, target in (("prompt_tokens", "prompt_eval_count"), ("completion_tokens", "eval_count")):
            count = usage.get(source)
            if type(count) is not int or count < 0:
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter returned invalid usage metadata.")
            result[target] = count
    return result


class OpenRouterTransport:
    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None):
        self.http_transport = transport

    @property
    def api_key(self) -> str:
        return os.getenv("OPENROUTER_API_KEY", "").strip()

    def require_key(self) -> str:
        key = self.api_key
        if not key:
            raise ChorusError("MODEL_UNAVAILABLE", "Set OPENROUTER_API_KEY in the Chorus backend environment and restart Chorus to use OpenRouter.")
        return key

    async def __call__(self, model: str, messages: list[dict[str, str]], *, output: int = 300, format: dict[str, Any] | None = None, phase: str = "", attempt: int = 1, run_id: str = "") -> dict[str, Any]:
        key = self.require_key()
        reasoning_allowance = REASONING_ALLOWANCE if model in REASONING_MODELS else 0
        completion_allowance = output + reasoning_allowance
        assert_budget(messages, completion_allowance)
        started, outcome = time.monotonic(), "success"
        result: dict[str, Any] = {}
        reasoning = {"effort": "low", "exclude": True} if reasoning_allowance else {"enabled": False, "exclude": True}
        payload: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": completion_allowance, "stream": False, "reasoning": reasoning}
        if format is not None:
            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "chorus_result", "strict": True, "schema": strict_schema(format)}}
            payload["provider"] = {"require_parameters": True}
        try:
            async with asyncio.timeout(CALL_TIMEOUT), httpx.AsyncClient(timeout=CALL_TIMEOUT, transport=self.http_transport) as client:
                response = await client.post("https://openrouter.ai/api/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "X-OpenRouter-Title": "Chorus"}, json=payload)
            if not response.is_success:
                raise request_error(response.status_code)
            try:
                raw = response.json()
            except ValueError as error:
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenRouter returned unreadable JSON.") from error
            result = normalize_response(raw, format is not None)
            return result
        except (TimeoutError, httpx.TimeoutException) as error:
            outcome = "TIMEOUT"
            raise ChorusError("TIMEOUT", "OpenRouter took too long. Resume to retry.") from error
        except httpx.HTTPError as error:
            outcome = "MODEL_UNAVAILABLE"
            raise ChorusError("MODEL_UNAVAILABLE", "The OpenRouter connection failed. Resume to retry.") from error
        except ChorusError as error:
            outcome = error.code
            raise
        except asyncio.CancelledError:
            outcome = "CANCELLED"
            raise
        finally:
            logger.info(json.dumps({"event": "model_call", "provider": "openrouter", "runId": run_id, "promptVersion": ENGINE_VERSION, "model": model, "phase": phase, "attempt": attempt, "durationMs": round((time.monotonic() - started) * 1000), "estimatedInput": input_estimate(messages), "outputAllowance": output, "completionAllowance": completion_allowance, "reasoningAllowance": reasoning_allowance, "input": result.get("prompt_eval_count"), "output": result.get("eval_count"), "outcome": outcome}))
