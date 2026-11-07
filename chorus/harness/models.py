"""Authoritative contracts for the independent-agent engine."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from chorus.harness import ENGINE_VERSION, PROMPT_VERSION


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, json_schema_serialization_defaults_required=True)


class Persona(Model):
    id: str
    name: str
    role: str
    domain: str
    introduction: str
    personality: str
    traits: list[str]
    strengths: str
    weaknesses: str
    avatarBrief: str
    avatarVersion: str = "1"


class Problem(Model):
    id: str
    title: str
    domain: str
    statement: str
    answerSchema: dict[str, Any]
    participantIds: list[str]
    version: str = "1"


class ModelInfo(Model):
    id: str
    label: str
    provider: Literal["ollama", "openai", "openrouter"]
    available: bool | None = None
    unavailableReason: str | None = None
    compatibilityNote: str | None = None


class HarnessCatalog(Model):
    version: str = "1"
    agents: list[Persona]
    problems: list[Problem]
    models: list[ModelInfo]
    defaultModel: str = "gpt-6-luna"


class HarnessConfig(Model):
    problemId: str
    participantIds: list[str] = Field(min_length=2, max_length=50)
    adversaryIds: list[str] = Field(default_factory=list, max_length=50)
    model: str = "gpt-6-luna"
    judgeModel: str | None = None
    maxTurnsPerAgent: int = Field(default=10, ge=1, le=100)
    judgeEnabled: bool = False
    maxCallsPerTurn: int = Field(default=8, ge=2, le=16)
    maxToolsPerTurn: int = Field(default=16, ge=1, le=32)
    maxPostsPerTurn: int = Field(default=3, ge=1, le=3)
    leaseSeconds: int = Field(default=30, ge=5, le=60)
    maxLeaseHoldSeconds: int = Field(default=120, ge=30, le=180)

    @model_validator(mode="after")
    def participants_valid(self):
        if len(set(self.participantIds)) != len(self.participantIds):
            raise ValueError("Participants must be distinct.")
        if len(set(self.adversaryIds)) != len(self.adversaryIds) or not set(self.adversaryIds) <= set(self.participantIds):
            raise ValueError("Adversaries must be distinct selected participants.")
        return self


class Worker(Model):
    agentId: str
    turnsStarted: int = 0
    turnsCompleted: int = 0
    currentTurnIndex: int = 0
    state: Literal["queued", "running", "waiting_model", "waiting_lock", "paused", "finished", "capped", "failed"] = "queued"
    operationId: str = ""
    callsUsed: int = 0
    toolsUsed: int = 0
    postsUsed: int = 0
    editsUsed: int = 0
    repairsUsed: int = 0
    boardCursor: int = 0
    reason: str = ""
    turnStartedAt: str | None = None


class LeaseView(Model):
    agentId: str
    expiresAt: str
    fencing: int


class Verification(Model):
    status: Literal["correct", "incorrect", "unavailable"]
    checks: list[str]
    version: str = "1"
    canvasVersion: int


class Grade(Model):
    agentId: str
    scores: list[int] = Field(min_length=5, max_length=5)
    explanation: str = Field(min_length=8, max_length=1800)
    evidenceIds: list[str]
    insufficientEvidence: bool = False

    @model_validator(mode="after")
    def scores_valid(self):
        if any(not 0 <= score <= 4 for score in self.scores):
            raise ValueError("Scores must be between zero and four.")
        return self


class JudgeReport(Model):
    rubricVersion: str = "1"
    summary: str
    conversationScores: list[int] = Field(min_length=5, max_length=5)
    conversationExplanation: str
    conversationEvidenceIds: list[str]
    agents: list[Grade]
    coveredRecordIds: list[str]
    completedAt: str

    @model_validator(mode="after")
    def scores_valid(self):
        if any(not 0 <= score <= 4 for score in self.conversationScores):
            raise ValueError("Scores must be between zero and four.")
        return self


class HarnessSnapshot(Model):
    id: str
    revision: int = 0
    sequence: int = 0
    engineVersion: str = ENGINE_VERSION
    promptVersion: str = PROMPT_VERSION
    catalogVersion: str = "1"
    generation: int = 0
    config: HarnessConfig
    problem: Problem
    agents: list[Persona]
    workers: list[Worker]
    status: Literal["ready", "running", "reviewing", "paused", "completed", "stopped"] = "ready"
    canvas: str = ""
    canvasVersion: int = 0
    boardCount: int = 0
    changeCount: int = 0
    lease: LeaseView | None = None
    endedEarly: bool = False
    frozenSequence: int | None = None
    verification: Verification | None = None
    report: JudgeReport | None = None
    error: str = ""
    createdAt: str
    updatedAt: str


class Record(Model):
    id: str
    sequence: int
    kind: str
    agentId: str
    turn: int
    createdAt: str
    data: dict[str, Any]


class RecordPage(Model):
    records: list[Record]
    cursor: int
    highWater: int
    hasMore: bool


class HarnessCommand(Model):
    commandId: str = Field(min_length=1, max_length=100)
    action: Literal["start", "pause", "resume", "stop"]
    expectedRevision: int = Field(ge=0)


class Usage(Model):
    callCount: int = 0
    inputTokens: int = 0
    outputTokens: int = 0
    cachedTokens: int = 0
    unknownInputCalls: int = 0
    unknownOutputCalls: int = 0
    unknownCacheCalls: int = 0
    cacheCoveredCalls: int = 0
    cacheUtilizationPercent: float | None = None
    cacheUsed: bool | None = None
    totalLatencyMs: int = 0
    meanLatencyMs: float = 0
    p95LatencyMs: int = 0
    reportedCostUSD: float = 0
    estimatedCostUSD: float = 0
    unknownCostCalls: int = 0


class UsageReport(Model):
    agents: dict[str, Usage]
    participants: Usage
    judge: Usage
    total: Usage
    wallTimeMs: int


class HarnessContracts(Model):
    catalog: HarnessCatalog
    config: HarnessConfig
    snapshot: HarnessSnapshot
    page: RecordPage
    command: HarnessCommand
    usage: UsageReport
