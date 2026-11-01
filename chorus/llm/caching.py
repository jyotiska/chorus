"""Stable cache identities and capability-checked OpenAI cache settings."""
from __future__ import annotations

import copy
import hashlib
import os
import re
from contextvars import ContextVar
from typing import Any

from chorus import PROMPT_VERSION

CACHE_SCOPE: ContextVar[str] = ContextVar("chorus_cache_scope", default="")


def cache_identity(model: str, phase: str) -> str | None:
    scope = CACHE_SCOPE.get()
    if not scope:
        return None
    value = f"{scope}:{model}:{phase}:{PROMPT_VERSION}"
    # OpenAI's key limit is 64 characters (OpenRouter permits 256).
    return "chorus-" + hashlib.sha256(value.encode()).hexdigest()[:56]


def openai_options(model: str, messages: list[dict[str, str]], phase: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    identity = cache_identity(model, phase)
    options: dict[str, Any] = {"prompt_cache_key": identity} if identity else {}
    # Only the configured GPT-6 family and GPT-5.6+ accept these controls.
    match = re.match(r"^gpt-(\d+)(?:\.(\d+))?(?:-|$)", model)
    supported = bool(match and (int(match[1]) >= 6 or int(match[1]) == 5 and int(match[2] or 0) >= 6))
    if not supported:
        return messages, options
    mode = os.getenv("CHORUS_OPENAI_CACHE_MODE", "implicit")
    if mode not in {"implicit", "explicit", "disabled"}:
        raise ValueError("CHORUS_OPENAI_CACHE_MODE must be implicit, explicit or disabled")
    options["prompt_cache_options"] = {"mode": "explicit" if mode == "disabled" else mode, "ttl": "30m"}
    if mode != "explicit" or not messages:
        return messages, options
    result = copy.deepcopy(messages)
    # Cache only the reusable instructions. Changing work stays after this
    # breakpoint, avoiding paid writes of one-off input in explicit mode.
    if result[0]["role"] in {"system", "developer"}:
        result[0]["content"] = [{"type": "input_text", "text": result[0]["content"], "prompt_cache_breakpoint": {"mode": "explicit"}}]
    return result, options
