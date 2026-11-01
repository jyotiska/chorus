"""Metadata-only call accounting, independent of model text and publication."""
from __future__ import annotations

import asyncio
import logging
import time
from contextvars import ContextVar
from typing import Callable
from uuid import uuid4

from chorus.contracts import CallMetrics, ResponseContext, Snapshot, TurnTelemetry
from chorus.llm.caching import CACHE_SCOPE
from chorus.llm.transport import CONTEXT_TOKENS, input_estimate
from chorus.llm.usage import count

CALL_RECORDER: ContextVar[Callable | None] = ContextVar("chorus_call_recorder", default=None)
CALL_OPERATION: ContextVar[str] = ContextVar("chorus_call_operation", default="")
CAPABILITY_VERSION = "2026-11-01"
logger = logging.getLogger("chorus.usage")
# Documented model maxima; the existing, smaller Chorus cap remains enforced.
# Sources: OpenAI model page and OpenRouter /api/v1/models, 1 November 2026.
MODEL_WINDOWS = {"gpt-6-luna": 1_050_000, "deepseek/deepseek-v4.1-flash-1017": 1_048_576,
                 "minimax/minimax-m3.1-flash": 1_048_576, "z-ai/glm-5.3-flash": 1_048_576}


class TrackedCall:
    def __init__(self, call, session: Snapshot, agent_id: str):
        self.call, self.session, self.agent_id = call, session, agent_id
        self.calls: list[CallMetrics] = []
        self.response: CallMetrics | None = None

    def __getattr__(self, name):
        return getattr(self.call, name)

    async def structured_output_support(self, model, run_id):
        from chorus.llm.providers import ProviderRouter
        from chorus.llm.transport import OllamaTransport
        capability = getattr(self.call, "structured_output_support", None)
        if capability is None:
            return True, None
        if isinstance(self.call, (ProviderRouter, OllamaTransport)):
            return await capability(model, run_id, probe_call=self)
        return await capability(model, run_id)

    def accept(self, *, primary=False):
        if self.calls:
            self.validate(True)
            self.calls[-1].accepted = True
            if primary:
                self.response = self.calls[-1]

    def reject(self, reason: str):
        self.validate(False, reason)

    def validate(self, passed: bool, reason: str | None = None):
        if not self.calls:
            return
        record = self.calls[-1]
        record.validationPassed, record.rejectionReason = passed, reason
        logger.info("Model validation: %s", {"id": record.id, "phase": record.phase,
                    "attempt": record.attempt, "passed": passed, "reason": reason})
        recorder = CALL_RECORDER.get()
        if recorder:
            # Publication still belongs to the atomic session commit, even if
            # validation completes before a later cancellation or skipped slot.
            recorder(self.session.id, CALL_OPERATION.get(), record.model_copy(update={"accepted": False}))

    def details(self, *, skipped=False) -> TurnTelemetry:
        if skipped:
            for item in self.calls:
                item.accepted = False
        return TurnTelemetry(response=None if skipped else self.response, calls=self.calls)

    async def __call__(self, model, messages, **options):
        from chorus.llm.openai import OpenAITransport
        from chorus.llm.openrouter import OpenRouterTransport, REASONING_MODELS, REASONING_ALLOWANCE
        from chorus.llm.transport import OllamaTransport
        transport = self.call.transport(model) if hasattr(self.call, "transport") else self.call
        route = "openai" if isinstance(transport, OpenAITransport) else "openrouter" if isinstance(transport, OpenRouterTransport) else "ollama" if isinstance(transport, OllamaTransport) else "unknown"
        reserve = options.get("output", 300) + (REASONING_ALLOWANCE if route == "openrouter" and model in REASONING_MODELS else 0)
        from chorus.llm.structured import strict_schema
        schema = options.get("format")
        if schema is not None and route in {"openai", "openrouter"}:
            schema = strict_schema(schema)
        estimate = input_estimate(messages, schema)
        model_window = MODEL_WINDOWS.get(model) if route in {"openai", "openrouter"} else CONTEXT_TOKENS if route == "ollama" else None
        cap = min(CONTEXT_TOKENS, model_window or CONTEXT_TOKENS)
        context = ResponseContext(modelWindowTokens=model_window, configuredWindowTokens=CONTEXT_TOKENS,
                                  effectiveWindowTokens=cap, inputTokens=estimate, inputSource="estimated",
                                  completionReserveTokens=reserve, usableInputTokens=max(0, cap - reserve), capabilityVersion=CAPABILITY_VERSION)
        record = CallMetrics(id=str(uuid4()), agentId=self.agent_id, phase=options.get("phase", ""), attempt=options.get("attempt", 1),
                             model=model, route=route, context=context)
        started = time.monotonic()
        token = CACHE_SCOPE.set(f"{self.session.id}:{self.agent_id}:epoch-0")
        try:
            result = await self.call(model, messages, **options)
            record.input = count(result.get("prompt_eval_count"))
            record.output = count(result.get("eval_count"))
            info = result.get("usage_details", {})
            for key in ("cachedInput", "cacheWriteInput", "reasoningOutput", "requestId", "provider", "costUSD"):
                if key in info:
                    setattr(record, key, info[key])
            record.cacheStatus = "unknown" if record.cachedInput is None else "hit" if record.cachedInput else "no_read"
            if record.input is not None:
                context.inputTokens, context.inputSource = record.input, "provider"
            return result
        except asyncio.CancelledError:
            record.outcome = "CANCELLED"
            raise
        except Exception as error:
            record.outcome = getattr(error, "code", "FAILED")
            raise
        finally:
            CACHE_SCOPE.reset(token)
            record.durationMs = round((time.monotonic() - started) * 1000)
            self.calls.append(record)
            logger.info("Model usage: %s", record.model_dump_json())
            recorder = CALL_RECORDER.get()
            if recorder:
                recorder(self.session.id, CALL_OPERATION.get(), record)
