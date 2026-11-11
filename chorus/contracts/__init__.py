"""Versioned platform contracts; the source of generated frontend schemas."""
from __future__ import annotations

from typing import Annotated, Literal
from hashlib import sha256
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
import regex
from chorus import ENGINE_VERSION, PROMPT_VERSION


from chorus.error_codes import ErrorCode


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, json_schema_serialization_defaults_required=True)


class Personality(Contract):
    socialStyle: Literal["introverted", "ambiverted", "extroverted"] = "ambiverted"
    challengeResponse: Literal["sensitive", "balanced", "resilient"] = "balanced"


class Agent(Contract):
    id: str
    name: str
    role: str
    description: str
    traits: list[str]
    mood: str = "focused"
    energy: int = Field(default=80, ge=0, le=100)
    confidence: int = Field(default=80, ge=0, le=100)
    personality: Personality = Field(default_factory=Personality)
    collection: str = "nanoville"


class Scenario(Contract):
    id: str
    title: str
    summary: str
    problem: str
    guidelines: list[str]
    deliverable: str
    suggestedAgents: list[str]
    collection: str = "nanoville"


class ModelInfo(Contract):
    id: str
    label: str
    provider: Literal["ollama", "openai", "openrouter"] = "ollama"
    installed: bool | None = None
    available: bool | None = None
    unavailableReason: str | None = None


class Catalog(Contract):
    agents: list[Agent]
    scenarios: list[Scenario]
    models: list[ModelInfo]
    defaultModel: str


class SessionConfig(Contract):
    scenarioId: str
    participantIds: list[str] = Field(min_length=2, max_length=10)
    adversaryIds: list[str] = Field(default_factory=list, max_length=10)
    model: str = "qwen3.5:4b-mlx"
    maxTurns: int = Field(default=20, ge=1, le=100, strict=True)
    judgeEnabled: bool = False

    @field_validator("participantIds")
    @classmethod
    def distinct(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("Participants must be distinct.")
        return value

    @model_validator(mode="after")
    def adversaries_are_participants(self) -> SessionConfig:
        if len(set(self.adversaryIds)) != len(self.adversaryIds):
            raise ValueError("Adversaries must be distinct.")
        if not set(self.adversaryIds).issubset(self.participantIds):
            raise ValueError("Adversaries must be selected participants.")
        return self


class TokenUsage(Contract):
    input: int | None = Field(default=None, ge=0)
    output: int | None = Field(default=None, ge=0)


class ResponseContext(Contract):
    modelWindowTokens: int | None = Field(default=None, gt=0)
    configuredWindowTokens: int = Field(gt=0)
    effectiveWindowTokens: int = Field(gt=0)
    inputTokens: int = Field(ge=0)
    inputSource: Literal["provider", "estimated"]
    completionReserveTokens: int = Field(ge=0)
    usableInputTokens: int = Field(ge=0)
    capabilityVersion: str


def optional_validation(schema: dict) -> None:
    schema["required"] = [name for name in schema.get("required", []) if name not in {"validationPassed", "rejectionReason"}]


class CallMetrics(Contract):
    model_config = ConfigDict(json_schema_extra=optional_validation)
    id: str
    agentId: str
    promptVersion: str = "prompt-" + sha256(PROMPT_VERSION.encode()).hexdigest()[:16]
    phase: str
    attempt: int = Field(ge=1)
    model: str
    route: Literal["openai", "openrouter", "ollama", "unknown"]
    provider: str | None = None
    requestId: str | None = None
    input: int | None = Field(default=None, ge=0)
    output: int | None = Field(default=None, ge=0)
    cachedInput: int | None = Field(default=None, ge=0)
    cacheWriteInput: int | None = Field(default=None, ge=0)
    reasoningOutput: int | None = Field(default=None, ge=0)
    costUSD: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    cacheStatus: Literal["hit", "no_read", "unknown"] = "unknown"
    outcome: str = "success"
    accepted: bool = False
    validationPassed: bool | None = None
    rejectionReason: str | None = None
    durationMs: int = Field(default=0, ge=0)
    context: ResponseContext


class TurnTelemetry(Contract):
    response: CallMetrics | None = None
    calls: list[CallMetrics] = Field(default_factory=list)


def optional_telemetry(schema: dict) -> None:
    # New metadata is optional on the wire so pre-telemetry saved events and
    # client fixtures remain valid. Backend serialization still supplies it.
    schema["required"] = [name for name in schema.get("required", []) if name not in {"usageDetails", "finalUsageDetails"}]


class StatChange(Contract):
    agentId: str
    energy: int = Field(ge=-100, le=100)
    confidence: int = Field(ge=-100, le=100)
    reasons: list[str] = Field(min_length=1)


class Turn(Contract):
    model_config = ConfigDict(json_schema_extra=optional_telemetry)
    kind: Literal["agent", "judge", "skipped"]
    turnNumber: int
    speakerId: str
    speakerName: str
    text: str = Field(max_length=1800)
    actions: list[str] = Field(default_factory=list)
    tokenUsage: TokenUsage = Field(default_factory=TokenUsage)
    latencySeconds: float = Field(default=0, ge=0)
    statChanges: list[StatChange] = Field(default_factory=list)
    usageDetails: TurnTelemetry | None = None


def complete_sentence(value: str) -> str:
    if sum(bool(regex.search(r"\p{L}{2}", word)) for word in value.strip().split()) < 2 or not regex.search(r"[.!?][\"”']?$", value.strip()):
        raise ValueError("Use a complete sentence containing at least two words.")
    if regex.search(r"\b(?:a|an|the|to|with|before|after|and|or|of|for|by|in|that|which)[.!?]$", value.strip(), regex.I):
        raise ValueError("Sentence ends with a fragment.")
    return value


class Requirement(Contract):
    criterion: str = Field(min_length=1, max_length=200)
    status: Literal["Met", "Partially met", "Missing"]
    evidence: str = Field(min_length=8, max_length=600)
    _sentence = field_validator("evidence")(complete_sentence)


ReviewItem = Annotated[str, Field(min_length=8, max_length=300)]


class Review(Contract):
    summary: str = Field(min_length=8, max_length=600)
    strengths: list[ReviewItem] = Field(min_length=1, max_length=5)
    improvements: list[ReviewItem] = Field(min_length=1, max_length=5)
    nextPriorities: list[ReviewItem] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def sentences(self) -> Review:
        complete_sentence(self.summary)
        for value in self.strengths + self.improvements + self.nextPriorities:
            if len(value) > 300:
                raise ValueError("Review finding too long.")
            complete_sentence(value)
        return self


class FinalJudgement(Review):
    verdict: Literal["Meets requirements", "Partially meets requirements", "Needs more work"]
    feedbackResponse: str = Field(min_length=8, max_length=600)
    requirements: list[Requirement] = Field(min_length=1)
    _sentence = field_validator("feedbackResponse")(complete_sentence)


class Journal(Contract):
    agentId: str
    turnNumber: int
    createdAt: str
    text: str | None


class Work(Contract):
    kind: Literal["turn", "checkpoint", "final"]
    speakerId: str | None = None


class Snapshot(Contract):
    model_config = ConfigDict(json_schema_extra=optional_telemetry)
    id: str
    revision: int = 0
    engineVersion: str = ENGINE_VERSION
    config: SessionConfig
    scenario: Scenario
    agents: list[Agent]
    status: Literal["ready", "running", "reviewing", "paused", "stopped", "completed"] = "ready"
    turns: list[Turn] = Field(default_factory=list)
    canvas: str = Field(default="", max_length=20000)
    endedEarly: bool = False
    finalJudgement: FinalJudgement | None = None
    finalUsageDetails: TurnTelemetry | None = None
    pending: Work | None = None
    error: str = ""
    errorCode: ErrorCode | None = None
    createdAt: str
    updatedAt: str


class Command(Contract):
    commandId: str = Field(min_length=1, max_length=100)
    expectedRevision: int = Field(ge=0)
    action: Literal["start", "pause", "resume", "stop"]


class APIError(Contract):
    error: str
    code: ErrorCode
    requestId: str


class Unchanged(Contract):
    op: Literal["UNCHANGED"]


class CreateDocument(Contract):
    op: Literal["CREATE_DOCUMENT"]
    document: str = Field(min_length=1, max_length=20000)


Heading = Annotated[str, Field(min_length=1, max_length=200)]


class ReplaceSection(Contract):
    op: Literal["REPLACE_SECTION"]
    path: list[Heading] = Field(min_length=1, max_length=6)
    body: str = Field(min_length=1, max_length=20000)


class AppendSection(Contract):
    op: Literal["APPEND_SECTION"]
    parentPath: list[Heading] = Field(max_length=6)
    heading: Heading
    body: str = Field(min_length=1, max_length=20000)


CanvasEdit = Annotated[Unchanged | CreateDocument | ReplaceSection | AppendSection, Field(discriminator="op")]


from chorus.harness.models import HarnessContracts


class Contracts(Contract):
    """Root for generating TypeScript declarations and runtime validators."""
    snapshot: Snapshot
    config: SessionConfig
    command: Command
    catalog: Catalog
    journals: list[Journal]
    harness: HarnessContracts
    error: APIError
