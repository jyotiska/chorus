"""OpenAI Responses adapter using Chorus's server-side credential."""
from __future__ import annotations

import asyncio
import copy
import json
import os
import time
from typing import Any

import httpx

from chorus import ENGINE_VERSION
from chorus.llm.transport import CALL_TIMEOUT, assert_budget, input_estimate, logger
from chorus.services.errors import ChorusError


def strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Wrap canvas unions in an object and adapt the decoding schema to OpenAI."""
    def adapt(node: Any) -> Any:
        if isinstance(node, list):
            return [adapt(item) for item in node]
        if not isinstance(node, dict):
            return node
        result = {key: copy.deepcopy(value) for key, value in node.items() if key not in {"title", "default", "discriminator"}}
        for key in ("properties", "$defs"):
            if key in result:
                result[key] = {name: adapt(child) for name, child in result[key].items()}
        for key in ("items", "anyOf", "oneOf"):
            if key in result:
                result[key] = adapt(result[key])
        if "oneOf" in result:
            result["anyOf"] = result.pop("oneOf")
        if "const" in result:
            result["enum"] = [result.pop("const")]
        if result.get("type") == "object" or "properties" in result:
            result["additionalProperties"] = False
            result["required"] = list(result.get("properties", {}))
        return result
    return {"type": "object", "properties": {"result": adapt(schema)}, "required": ["result"], "additionalProperties": False}


def normalize_response(raw: Any, structured: bool) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("status") not in {"completed", "incomplete"} or not isinstance(raw.get("output"), list):
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an invalid response.")
    incomplete = raw["status"] == "incomplete"
    details = raw.get("incomplete_details")
    if incomplete and (not isinstance(details, dict) or details.get("reason") != "max_output_tokens"):
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI could not complete this response.")
    parts = []
    for item in raw["output"]:
        if not isinstance(item, dict):
            raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid output.")
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
    if not text.strip() and not incomplete:
        raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned an empty response.")
    if structured and not incomplete:
        try:
            value = json.loads(text)
        except ValueError:
            # Model-authored JSON is validated by the generation layer, which
            # owns bounded retries and preserving the previously saved canvas.
            pass
        else:
            if isinstance(value, dict) and set(value) == {"result"}:
                text = json.dumps(value["result"], ensure_ascii=False)
    result: dict[str, Any] = {"message": {"content": text}, "done_reason": "length" if incomplete else "stop"}
    usage = raw.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid usage metadata.")
        for source, target in (("input_tokens", "prompt_eval_count"), ("output_tokens", "eval_count")):
            value = usage.get(source)
            if type(value) is not int or value < 0:
                raise ChorusError("INVALID_MODEL_RESPONSE", "OpenAI returned invalid usage metadata.")
            result[target] = value
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

    async def __call__(self, model: str, messages: list[dict[str, str]], *, output: int = 300, format: dict[str, Any] | None = None, phase: str = "", attempt: int = 1, run_id: str = "") -> dict[str, Any]:
        key = self.require_key()
        assert_budget(messages, output)
        started = time.monotonic()
        outcome = "success"
        result: dict[str, Any] = {}
        payload: dict[str, Any] = {"model": model, "input": messages, "max_output_tokens": output, "reasoning": {"effort": "none"}, "store": False, "stream": False}
        if format is not None:
            payload["text"] = {"format": {"type": "json_schema", "name": "chorus_result", "strict": True, "schema": strict_schema(format)}}
        try:
            async with asyncio.timeout(CALL_TIMEOUT), httpx.AsyncClient(timeout=CALL_TIMEOUT, transport=self.http_transport) as client:
                response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {key}"}, json=payload)
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
            result = normalize_response(raw, format is not None)
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
            logger.info(json.dumps({"event": "model_call", "provider": "openai", "runId": run_id, "promptVersion": ENGINE_VERSION, "model": model, "phase": phase, "attempt": attempt, "durationMs": round((time.monotonic() - started) * 1000), "estimatedInput": input_estimate(messages), "outputAllowance": output, "input": result.get("prompt_eval_count"), "output": result.get("eval_count"), "outcome": outcome}))
