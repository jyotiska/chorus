"""Normalize optional provider telemetry without inventing missing counts."""
from __future__ import annotations

import math
import re
from typing import Any


def count(value: Any, ceiling: int | None = None) -> int | None:
    return value if type(value) is int and value >= 0 and (ceiling is None or value <= ceiling) else None


def identifier(value: Any) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r"[\w./:@ -]{1,160}", value) else None


def details(raw: dict[str, Any], route: str, input_tokens: int | None, output_tokens: int | None) -> dict[str, Any]:
    usage = raw.get("usage")
    usage = usage if isinstance(usage, dict) else {}
    inputs = usage.get("input_tokens_details" if route == "openai" else "prompt_tokens_details")
    outputs = usage.get("output_tokens_details" if route == "openai" else "completion_tokens_details")
    inputs = inputs if isinstance(inputs, dict) else {}
    outputs = outputs if isinstance(outputs, dict) else {}
    cost = usage.get("cost")
    result = {
        "cachedInput": count(inputs.get("cached_tokens"), input_tokens),
        "cacheWriteInput": count(inputs.get("cache_write_tokens"), input_tokens),
        "reasoningOutput": count(outputs.get("reasoning_tokens"), output_tokens),
        "requestId": identifier(raw.get("id")),
        "provider": identifier(raw.get("provider")),
        "costUSD": float(cost) if type(cost) in (int, float) and math.isfinite(cost) and cost >= 0 else None,
    }
    if input_tokens is None:
        result["cachedInput"] = result["cacheWriteInput"] = None
    if output_tokens is None:
        result["reasoningOutput"] = None
    if result["cachedInput"] is not None and result["cacheWriteInput"] is not None and result["cachedInput"] + result["cacheWriteInput"] > input_tokens:
        result["cachedInput"] = result["cacheWriteInput"] = None
    # Preserve valid partial information, including an explicit zero.
    return {key: value for key, value in result.items() if value is not None}
