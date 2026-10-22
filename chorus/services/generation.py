from __future__ import annotations
import asyncio
import copy
from dataclasses import dataclass
import json
import logging
import time
from typing import Any, TypeVar, Awaitable
from uuid import uuid4
import regex as re
from pydantic import ValidationError
from chorus.contracts import Agent, Snapshot, Review, FinalJudgement, TokenUsage
from chorus.llm.transport import ModelCall, assert_budget, JOURNAL_TIMEOUT
from chorus.services.canvas import apply_edit, edit_adapter, evidence_block
from chorus.services.errors import ChorusError
from chorus.services.policies import compact, speech_error, canvas_body, canvas_error, grounding_error
from chorus.services.prompts import canvas_messages, spoken_messages, journal_messages, judge_messages

logger = logging.getLogger("chorus.generation")
T = TypeVar("T")


async def bounded(awaitable: Awaitable[T], seconds: float) -> T:
    """Bound even an adapter which does not acknowledge cancellation promptly."""
    task = asyncio.ensure_future(awaitable)
    def consume(done: asyncio.Future[T]) -> None:
        if not done.cancelled():
            done.exception()
    try:
        done, _ = await asyncio.wait({task}, timeout=seconds)
        if not done:
            task.cancel()
            task.add_done_callback(consume)
            raise ChorusError("TIMEOUT", "The request took too long. Resume to retry.")
        return task.result()
    except asyncio.CancelledError:
        task.cancel()
        task.add_done_callback(consume)
        raise


def decoding_schema(schema: dict[str, Any]) -> dict[str, Any]:
    defs = schema.get("$defs", {})
    def resolve(node: Any) -> Any:
        if isinstance(node, list):
            return [resolve(x) for x in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return resolve(copy.deepcopy(defs[node["$ref"].split("/")[-1]]))
        result = {k: resolve(v) for k, v in node.items() if k not in {"$defs", "discriminator", "maxLength"}}
        if result.get("minLength", 0) >= 8:
            result["pattern"] = r"[^\n]*[.!?]"
        return result
    return resolve(schema)


class Usage:
    def __init__(self) -> None:
        self.input = self.output = self.calls = 0
        self.complete = True

    def add(self, result: dict[str, Any]) -> None:
        self.calls += 1
        if result.get("prompt_eval_count") is None or result.get("eval_count") is None:
            self.complete = False
        else:
            self.input += result["prompt_eval_count"]
            self.output += result["eval_count"]

    def total(self) -> TokenUsage:
        return TokenUsage(input=self.input, output=self.output) if self.complete and self.calls else TokenUsage()


@dataclass
class TurnResult:
    skipped: bool
    text: str = ""
    canvas: str = ""
    journal: str | None = None
    updated: bool = False
    usage: TokenUsage | None = None
    latency: float = 0
    operation: str = "UNCHANGED"
    preserved_reason: str | None = None
    run_id: str = ""


def check_cancelled() -> None:
    task = asyncio.current_task()
    if task and task.cancelling():
        raise asyncio.CancelledError


def content(result: dict[str, Any]) -> str:
    return result.get("message", {}).get("content", "")


def has_tools(result: dict[str, Any]) -> bool:
    return bool(result.get("message", {}).get("tool_calls"))


async def run_turn(session: Snapshot, speaker: Agent, call: ModelCall) -> TurnResult:
    started = time.monotonic()
    run_id = str(uuid4())
    usage = Usage()
    current = session.canvas
    description = "The document is unchanged."
    updated = False
    operation = "UNCHANGED"
    preserved_reason = "retry_exhausted"
    messages = canvas_messages(session, speaker)
    assert_budget(messages, 2400)
    assert_budget(spoken_messages(session, speaker, current, False))
    for attempt in range(3):
        result = await call(session.config.model, messages, output=2400, format=decoding_schema(edit_adapter.json_schema()), phase="canvas", attempt=attempt + 1, run_id=run_id)
        check_cancelled()
        usage.add(result)
        error = "The edit was cut off. Return a shorter complete JSON operation." if result.get("done_reason") == "length" else "Return one JSON edit without tool calls." if has_tools(result) else None
        candidate = session.canvas
        change = description
        if not error:
            try:
                raw = json.loads(content(result))
                candidate, change = apply_edit(session.canvas, session.scenario.problem, raw)
                logger.info(json.dumps({"event": "canvas_operation", "runId": run_id, "attempt": attempt + 1, "operation": raw["op"]}))
                if raw["op"] != "UNCHANGED":
                    error = canvas_error(candidate[len(evidence_block(session.scenario.problem)):].strip()) or canvas_error(candidate)
            except (ValueError, ValidationError, KeyError, TypeError):
                error = "Return one valid JSON edit against an exact canonical path, preserving evidence and surrounding headings."
        if not error and canvas_body(candidate) != canvas_body(session.canvas):
            error = "The complete result exceeds 6000 characters or 800 words. Shorten one section or return UNCHANGED." if len(candidate) > 6000 or len(candidate.split()) > 800 else grounding_error(candidate, session.scenario.problem)
            if not error:
                try:
                    assert_budget(spoken_messages(session, speaker, candidate, True, change))
                except ChorusError:
                    error = "The revised canvas leaves too little context space. Shorten a section or return UNCHANGED."
        if not error:
            updated = canvas_body(candidate) != canvas_body(session.canvas)
            if updated:
                current, description = candidate, change
            operation = raw["op"]
            preserved_reason = "requested_unchanged" if operation == "UNCHANGED" else "no_substantive_change"
            break
        logger.info(json.dumps({"event": "generation_rejected", "runId": run_id, "phase": "canvas", "attempt": attempt + 1, "reason": "invalid_canvas"}))
        messages = canvas_messages(session, speaker, error)
    if not updated:
        logger.info(json.dumps({"event": "canvas_preserved", "runId": run_id, "reason": preserved_reason}))
    messages = spoken_messages(session, speaker, current, updated, description)
    text = ""
    for attempt in range(3):
        result = await call(session.config.model, messages, phase="spoken", attempt=attempt + 1, run_id=run_id)
        check_cancelled()
        usage.add(result)
        candidate_text = compact(content(result))
        error = "Return a shorter complete contribution." if result.get("done_reason") == "length" else "Give speech without tool calls." if has_tools(result) else "No canvas edit was saved. Do not claim an edit." if not updated and re.search(r"\bI\s+(?:added|edited|updated|inserted|removed|saved|rewrote|replaced|finalized)\b", candidate_text, re.I) else speech_error(candidate_text, session.turns) or grounding_error(candidate_text, session.scenario.problem)
        if not error:
            text = candidate_text
            break
        logger.info(json.dumps({"event": "generation_rejected", "runId": run_id, "phase": "spoken", "attempt": attempt + 1, "reason": "invalid_contribution"}))
        messages = messages[:2] + [{"role": "user", "content": f"Your unpublished contribution was rejected: {error} Return a fresh, complete contribution grounded in the original context above."}]
    if not text:
        check_cancelled()
        logger.info(json.dumps({"event": "slot_prepared_as_skipped", "runId": run_id, "reason": "invalid_contribution"}))
        return TurnResult(skipped=True, usage=usage.total(), latency=time.monotonic() - started, run_id=run_id)
    journal = None
    messages = journal_messages(session, speaker, current, text)
    try:
        for attempt in range(2):
            result = await bounded(call(session.config.model, messages, output=256, phase="journal", attempt=attempt + 1, run_id=run_id), JOURNAL_TIMEOUT)
            check_cancelled()
            usage.add(result)
            if result.get("done_reason") == "length":
                logger.info(json.dumps({"event": "generation_rejected", "runId": run_id, "phase": "journal", "attempt": attempt + 1, "reason": "truncated"}))
                messages.append({"role": "user", "content": "Your journal ran out of generation space. Write one short, complete sentence expressing your main feeling. Finish the thought naturally."})
                continue
            journal = " ".join(content(result).split()) or None
            break
    except ChorusError as error:
        usage.complete = False
        logger.info(json.dumps({"event": "journal_unavailable", "runId": run_id, "code": error.code}))
    check_cancelled()
    logger.info(json.dumps({"event": "turn_prepared", "runId": run_id, "canvasOperation": operation if updated else "UNCHANGED", **({"preservedReason": preserved_reason} if not updated else {})}))
    return TurnResult(skipped=False, text=text, canvas=current, journal=journal, updated=updated, usage=usage.total(), latency=time.monotonic() - started, operation=operation if updated else "UNCHANGED", preserved_reason=preserved_reason if not updated else None, run_id=run_id)


def proposed_canvas(canvas: str, evidence: str) -> str:
    prefix = evidence_block(evidence)
    return (canvas[len(prefix):] if canvas.startswith(prefix) else canvas).strip()


def review_evidence_error(review: Review, canvas: str, evidence: str) -> str | None:
    def norm(text: str) -> str:
        return " ".join(re.sub(r"\*\*|__", "", text.lower()).split())
    source = norm(proposed_canvas(canvas, evidence))
    def quotes(text: str) -> list[str]:
        return [norm(q) for q in re.findall(r"\[([^\]]+)\]", text)]
    def supported(text: str) -> bool:
        return any(len(q) >= 4 and q in source for q in quotes(text))
    if any(not supported(s) for s in review.strengths):
        return "Each strength must quote an exact excerpt of the CURRENT canvas in square brackets."
    narratives = [review.summary, *review.strengths, *review.improvements, *review.nextPriorities]
    if isinstance(review, FinalJudgement):
        if any(r.status != "Missing" and not supported(r.evidence) for r in review.requirements):
            return "Every Met or Partially met requirement needs an exact CURRENT canvas quote."
        narratives += [r.evidence for r in review.requirements] + [review.feedbackResponse]
    if any(q not in source for n in narratives for q in quotes(n)):
        return "A quoted excerpt is absent from the CURRENT canvas."
    if any(re.search(r"\b(?:lacks?|missing|without|no)\s+\[[^\]]+\]|\[[^\]]+\]\s+(?:is|was|remains)\s+(?:missing|absent)", n, re.I) for n in narratives):
        return "A finding claims its own present citation is missing. State which additional detail is absent."
    return None


def review_message(review: Review) -> str:
    return f"Progress: {review.summary}\n\nWhat went well:\n" + "\n".join("- " + s for s in review.strengths) + "\n\nWhat to improve:\n" + "\n".join("- " + s for s in review.improvements) + "\n\nNext priorities:\n" + "\n".join("- " + s for s in review.nextPriorities)


async def run_review(session: Snapshot, final: bool, call: ModelCall) -> tuple[Review, TokenUsage, float]:
    started = time.monotonic()
    criteria, messages = judge_messages(session, final)
    schema = decoding_schema((FinalJudgement if final else Review).model_json_schema())
    props = schema["properties"]
    if not final:
        props["summary"]["minLength"] = 8
        for key in ("strengths", "improvements", "nextPriorities"):
            props[key]["maxItems"] = 3
    if final:
        requirement = props["requirements"]["items"]
        assessment = {"type": "object", "properties": {k: requirement["properties"][k] for k in ("status", "evidence")}, "required": ["status", "evidence"], "additionalProperties": False}
        props["requirements"] = {"type": "object", "properties": {c: copy.deepcopy(assessment) for c in criteria}, "required": criteria, "additionalProperties": False}
        messages[0]["content"] += "\nReturn requirements as an object with exactly these keys: " + ", ".join(criteria) + ". Each value has status and evidence. Do not use an array or repeat a criterion."
    has_plan = bool(proposed_canvas(session.canvas, session.scenario.problem))
    if not has_plan:
        props["strengths"]["items"]["pattern"] = r"No written deliverable exists yet\."
        messages[0]["content"] += "\nThere is no written plan. For strengths, return only: No written deliverable exists yet. Assess spoken progress in the summary; do not invent canvas citations."
    else:
        excerpts = list(dict.fromkeys(" ".join(re.sub(r"^\s*[-#*>]+\s*", "", re.sub(r"\*\*|__", "", line)).strip().split()[:5]) for line in proposed_canvas(session.canvas, session.scenario.problem).split("\n") if not re.search(r"^\s*#", line) and len(line.strip()) >= 4 and not line.strip().startswith("|")))
        excerpts = [x for x in excerpts if len(x) >= 4 and not re.search(r'[\[\]"“”]', x)][:12]
        if excerpts:
            citations = "|".join(re.escape(x) for x in excerpts)
            props["strengths"]["items"]["pattern"] = rf"The canvas records \[(?:{citations})\] as a proposal\."
            if final:
                for item in props["requirements"]["properties"].values():
                    item["properties"]["evidence"]["pattern"] = rf'[^"\n]*\[(?:{citations})\][^"\n]*[.!?]'
            messages[0]["content"] += "\nWrite each strength as: The canvas records [exact excerpt] as a proposal. Use one of these exact current-canvas excerpts in each strength" + (" and requirement evidence" if final else "") + ", enclosed in square brackets: " + ", ".join(f"[{x}]" for x in excerpts[:8]) + ". A missing requirement can cite an existing section and explain what it lacks."
    # Some local runners do not expose decoding schemas to the model. State
    # the whole response contract in the prompt as well, without repeating the
    # large citation regexes. Runtime validation remains the publication gate.
    def prompt_shape(node: Any) -> Any:
        if isinstance(node, list):
            return [prompt_shape(item) for item in node]
        if isinstance(node, dict):
            return {key: prompt_shape(value) for key, value in node.items() if key not in {"title", "pattern", "description"}}
        return node
    messages[0]["content"] += "\n\nReturn exactly one complete JSON response object with every required top-level field below. The requirements ratings are nested inside the complete response, never the entire response. Do not add prose before or after the JSON object. The sentence and exact-citation rules above still apply. Complete response JSON Schema:\n" + json.dumps(prompt_shape(schema), ensure_ascii=False, separators=(",", ":"))
    usage = Usage()
    run_id = str(uuid4())
    error = "Return complete sentences and all required fields matching the schema."
    for attempt in range(2):
        result = await call(session.config.model, messages, output=3000 if final else 1200, format=schema, phase="final" if final else "checkpoint", attempt=attempt + 1, run_id=run_id)
        check_cancelled()
        usage.add(result)
        try:
            if result.get("done_reason") == "length":
                raise ValueError("The review was cut off. Return a shorter complete review.")
            raw = json.loads(content(result))
            if not isinstance(raw, dict):
                raise ValueError("Return one structured JSON review object.")
            if final and isinstance(raw.get("requirements"), dict):
                raw["requirements"] = [{**value, "criterion": criterion} for criterion, value in raw["requirements"].items()]
            review = (FinalJudgement if final else Review).model_validate(raw)
            if not final and (len(review.summary) > 300 or any(len(items) > 3 or any(len(v) > 140 for v in items) for items in (review.strengths, review.improvements, review.nextPriorities))):
                raise ValueError("Checkpoint summary and bullets exceed limits.")
            if isinstance(review, FinalJudgement):
                if len(review.requirements) != len(criteria) or {r.criterion for r in review.requirements} != set(criteria):
                    raise ValueError("Assess every supplied criterion exactly once.")
                if review.verdict == "Meets requirements" and any(r.status != "Met" for r in review.requirements):
                    raise ValueError("A Meets requirements verdict requires every criterion to be Met.")
                if not has_plan and (review.verdict == "Meets requirements" or next(r for r in review.requirements if r.criterion == "Expected deliverable").status != "Missing"):
                    raise ValueError("No written deliverable exists. Mark Expected deliverable Missing.")
            validation = review_evidence_error(review, session.canvas, session.scenario.problem) if has_plan else None
            if validation:
                raise ValueError(validation)
            return review, usage.total(), time.monotonic() - started
        except (ValueError, TypeError, KeyError, StopIteration) as failure:
            logger.info(json.dumps({"event": "generation_rejected", "runId": run_id, "phase": "final" if final else "checkpoint", "attempt": attempt + 1, "reason": "invalid_review"}))
            error = str(failure) if not isinstance(failure, ValidationError) else "Return all fields and complete short sentences within the schema limits."
            messages = messages[:2] + [{"role": "user", "content": f"Correct your previous review: {error} Your previous response was an unpublished draft, not feedback given to the agents. Do not mention drafts, validation, or corrections in the final review. The supplied conversation is the only record of published judge feedback. Return corrected JSON based on the actual conversation and canvas."}]
    raise ChorusError("GENERATION_FAILED", "The judge could not produce a complete, evidence-based review. Resume to retry.")
