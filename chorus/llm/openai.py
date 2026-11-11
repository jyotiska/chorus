"""OpenAI Responses adapter using Chorus's server-side credential."""
from __future__ import annotations

import asyncio
import json
import os
import time
from functools import lru_cache
from typing import Any

import httpx
import tiktoken

from chorus import PROMPT_VERSION
from chorus.llm.structured import strict_schema, unwrap_result
from chorus.llm.usage import details as usage_details
from chorus.llm.caching import openai_options
from chorus.llm.transport import CALL_TIMEOUT, assert_budget, input_estimate, logger
from chorus.services.errors import ChorusError

LUNA_INPUT_LIMIT = 250_000
LUNA_CONTEXT_WINDOW = 1_050_000
LUNA_VERIFY_THRESHOLD = 225_000


@lru_cache(maxsize=1)
def luna_encoding():
    return tiktoken.get_encoding("o200k_base")


def luna_input_estimate(messages, schema=None):
    """Estimate text and tool tokens locally, including framing headroom."""
    encode = luna_encoding().encode_ordinary

    def size(value):
        return len(encode(json.dumps(value, ensure_ascii=False, separators=(",", ":"))))

    return sum(size(message) + 16 for message in messages) + (size(schema) + 16 if schema else 0)


def luna_input_limit(output):
    return min(LUNA_INPUT_LIMIT, LUNA_CONTEXT_WINDOW - output)


def assert_luna_budget(input_tokens, output):
    if input_tokens > luna_input_limit(output):
        raise ChorusError("CONTEXT_LIMIT", "This request exceeds Chorus's input budget for GPT-6 Luna.")


def normalize_response(raw: Any, structured: bool, allow_tools: bool = False) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("status") not in {"completed", "incomplete"} or not isinstance(raw.get("output"), list):
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an invalid response.")
    incomplete = raw["status"] == "incomplete"
    details = raw.get("incomplete_details")
    if incomplete and (not isinstance(details, dict) or details.get("reason") != "max_output_tokens"):
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI could not complete this response.")
    parts, calls = [], []
    for item in raw["output"]:
        if not isinstance(item, dict):
            raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid output.")
        if item.get("type") == "function_call" and allow_tools:
            if not all(isinstance(item.get(k), str) and item[k] for k in ("call_id", "name", "arguments")):
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an invalid function call.")
            calls.append({"id": item["call_id"], "type": "function", "function": {"name": item["name"], "arguments": item["arguments"]}})
            continue
        if item.get("type") != "message":
            continue
        if item.get("role") != "assistant" or not isinstance(item.get("content"), list):
            raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an invalid message.")
        for part in item["content"]:
            if not isinstance(part, dict):
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid content.")
            if part.get("type") == "refusal":
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI declined this request. Saved work is preserved.")
            if part.get("type") != "output_text" or not isinstance(part.get("text"), str):
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid text.")
            parts.append(part["text"])
    text = "".join(parts)
    if not text.strip() and not incomplete and not calls:
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an empty response.")
    if structured and not incomplete:
        text = unwrap_result(text)
    result: dict[str, Any] = {"message": {"content": text}, "done_reason": "length" if incomplete else "stop"}
    if calls:
        result["message"]["tool_calls"] = calls
    usage = raw.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid usage metadata.")
        for source, target in (("input_tokens", "prompt_eval_count"), ("output_tokens", "eval_count")):
            value = usage.get(source)
            if type(value) is not int or value < 0:
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid usage metadata.")
            result[target] = value
    telemetry = usage_details(raw, "openai", result.get("prompt_eval_count"), result.get("eval_count"))
    if telemetry:
        result["usage_details"] = telemetry
    return result


class OpenAITransport:
    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None):
        self.http_transport = transport

    @property
    def api_key(self) -> str:
        return os.getenv("CHORUS_API_KEY", "").strip()

    def require_key(self) -> str:
        if not self.api_key:
            raise ChorusError("MODEL_UNAVAILABLE", "Set CHORUS_API_KEY in the Chorus backend environment and restart Chorus to use OpenAI.")
        return self.api_key

    async def __call__(self, model: str, messages: list[dict[str, str]], *, output: int = 300, format: dict[str, Any] | None = None, phase: str = "", attempt: int = 1, run_id: str = "", tools: list[dict] | None = None) -> dict[str, Any]:
        key = self.require_key()
        budget_schema = {"tools": tools, "format": format} if tools else strict_schema(format) if format is not None else None
        estimated = luna_input_estimate(messages, budget_schema) if model == "gpt-6-luna" else None
        if estimated is None:
            assert_budget(messages, output, format=budget_schema)
        started = time.monotonic()
        outcome = "success"
        result: dict[str, Any] = {}
        converted = []
        for message in messages:
            if message.get("role") == "tool":
                converted.append({"type": "function_call_output", "call_id": message["tool_call_id"], "output": message["content"]})
            elif message.get("tool_calls"):
                if message.get("content"):
                    converted.append({"role": "assistant", "content": message["content"]})
                for call in message["tool_calls"]:
                    converted.append({"type": "function_call", "call_id": call["id"], "name": call["function"]["name"], "arguments": call["function"]["arguments"]})
            else:
                converted.append(message)
        inputs, cache_options = openai_options(model, converted, phase)
        payload: dict[str, Any] = {"model": model, "input": inputs, "max_output_tokens": output, "reasoning": {"effort": "none"}, "store": False, "stream": False, **cache_options}
        if tools:
            payload["tools"] = [{"type": "function", "name": t["function"]["name"], "description": t["function"]["description"], "parameters": t["function"]["parameters"], "strict": True} for t in tools]
            payload["parallel_tool_calls"] = False
        if format is not None:
            payload["text"] = {"format": {"type": "json_schema", "name": "chorus_result", "strict": True, "schema": strict_schema(format)}}
        try:
            async with asyncio.timeout(CALL_TIMEOUT), httpx.AsyncClient(timeout=CALL_TIMEOUT, transport=self.http_transport) as client:
                headers = {"Authorization": f"Bearer {key}"}
                if estimated is not None and estimated >= min(LUNA_VERIFY_THRESHOLD, luna_input_limit(output)):
                    # Avoid a separate network call on ordinary turns. Use the
                    # provider's count for long requests close to the ceiling.
                    count_payload = {field: payload[field] for field in ("model", "input", "tools", "text", "reasoning") if field in payload}
                    counted = await client.post("https://api.openai.com/v1/responses/input_tokens", headers=headers, json=count_payload)
                    if not counted.is_success:
                        raise ChorusError("MODEL_REQUEST_FAILED", "OpenAI could not count the tokens for this long request.")
                    try:
                        input_tokens = counted.json()["input_tokens"]
                    except (ValueError, TypeError, KeyError) as error:
                        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an invalid input token count.") from error
                    if type(input_tokens) is not int or input_tokens < 0:
                        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an invalid input token count.")
                    assert_luna_budget(input_tokens, output)
                response = await client.post("https://api.openai.com/v1/responses", headers=headers, json=payload)
            if not response.is_success:
                code, message = {
                    401: ("MODEL_REQUEST_FAILED", "OpenAI rejected CHORUS_API_KEY. Check the backend credential."),
                    403: ("MODEL_REQUEST_FAILED", "This OpenAI account does not have access to the selected model."),
                    404: ("MODEL_NOT_FOUND", "The selected OpenAI model is unavailable to this account."),
                    429: ("MODEL_REQUEST_FAILED", "OpenAI rate limit or quota reached. Check account limits, then resume to retry."),
                }.get(response.status_code, ("MODEL_UNAVAILABLE" if response.status_code >= 500 else "MODEL_REQUEST_FAILED", "OpenAI could not complete the request. Saved work is preserved; resume to retry."))
                raise ChorusError(code, message)
            try:
                raw = response.json()
            except ValueError as error:
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned unreadable JSON.") from error
            result = normalize_response(raw, format is not None, bool(tools))
            return result
        except (TimeoutError, httpx.TimeoutException) as error:
            outcome = "TIMEOUT"
            raise ChorusError("TIMEOUT", "OpenAI took too long. Resume to retry.") from error
        except httpx.HTTPError as error:
            outcome = "MODEL_UNAVAILABLE"
            raise ChorusError("MODEL_UNAVAILABLE", "The OpenAI connection failed. Resume to retry.") from error
        except ChorusError as error:
            outcome = error.code
            raise
        except asyncio.CancelledError:
            outcome = "CANCELLED"
            raise
        finally:
            logger.info(json.dumps({"event": "model_call", "provider": "openai", "runId": run_id, "promptVersion": PROMPT_VERSION, "model": model, "phase": phase, "attempt": attempt, "durationMs": round((time.monotonic() - started) * 1000), "estimatedInput": estimated if estimated is not None else input_estimate(messages, budget_schema), "outputAllowance": output, "input": result.get("prompt_eval_count"), "output": result.get("eval_count"), "outcome": outcome}))
