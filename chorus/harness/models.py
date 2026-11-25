"""Authoritative contracts for the independent-agent engine."""
from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from chorus.harness import ENGINE_VERSION, PROMPT_VERSION
from chorus.harness.experiment_paths import BINARY_OUTPUT_SUFFIXES, experiment_output_path


CUSTOM_PROBLEM_ID = "other"
CUSTOM_STATEMENT_MAX_BYTES = 12_000


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


class GeneratedPersona(Persona):
    generationId: str
    avatarId: str
    systemPrompt: str


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


CheckId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,39}$")]
CheckDigest = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
CheckStatus = Literal["running", "passed", "failed", "timed_out", "unavailable", "cancelled"]


class PublicCheckCommand(Model):
    id: CheckId
    argv: list[Annotated[str, StringConstraints(min_length=1, max_length=500)]] = Field(min_length=1, max_length=24)


class PublicCheckProfile(Model):
    name: str = Field(min_length=1, max_length=80)
    image: str = Field(pattern=r"^[A-Za-z0-9._/:\-]+@sha256:[0-9a-f]{64}$")
    platform: Literal["linux/amd64", "linux/arm64"]
    commands: list[PublicCheckCommand] = Field(min_length=1, max_length=8)
    timeoutSeconds: int = Field(default=45, ge=1, le=120)
    maxRuns: int = Field(default=12, ge=1, le=50)

    @model_validator(mode="after")
    def valid_commands(self):
        if len({command.id for command in self.commands}) != len(self.commands):
            raise ValueError("Give each public check a distinct ID.")
        if any("\0" in part for command in self.commands for part in command.argv):
            raise ValueError("Check arguments cannot contain NUL.")
        return self


class PublicCheckPin(Model):
    digest: CheckDigest
    profile: PublicCheckProfile
    policy: Literal["agent-requested-v1"] = "agent-requested-v1"


class PublicCheckSummary(Model):
    checkId: CheckId
    status: Literal["unchecked", "passed", "failed", "timed_out", "unavailable", "cancelled"]
    recordId: str | None = None


class ExperimentCatalog(HarnessCatalog):
    customStatementMaxBytes: int = CUSTOM_STATEMENT_MAX_BYTES
    publicCheckProfile: PublicCheckPin | None = Field(default=None, exclude_if=lambda value: value is None)


class HarnessConfig(Model):
    problemId: str
    participantIds: list[str] = Field(min_length=1, max_length=50)
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


class TaskGap(Model):
    task: str
    reason: str


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
    failureCode: Literal["CONTEXT_LIMIT"] | None = None
    currentTask: str | None = None
    reportedStatus: Literal["working", "waiting", "blocked"] | None = None
    turnStartedAt: str | None = None
    remainingTasks: list[TaskGap] = Field(default_factory=list)


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


class ExperimentBrief(Model):
    problemId: str
    customStatement: str | None = None


class TeamGenerationRequest(ExperimentBrief):
    model: str


class TeamGeneration(Model):
    id: str
    agents: list[GeneratedPersona] = Field(min_length=3, max_length=5)


class ExperimentConfig(ExperimentBrief):
    participantIds: list[str] = Field(min_length=1, max_length=15)
    model: str = "gpt-6-luna"
    judgeModel: str | None = None
    teamGenerationId: str | None = Field(default=None, max_length=36)
    publicChecks: CheckDigest | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def distinct_participants(self):
        if len(set(self.participantIds)) != len(self.participantIds):
            raise ValueError("Participants must be distinct.")
        return self


class ExperimentWorktree(Model):
    agentId: str
    branch: str
    path: str


class ExperimentRepository(Model):
    path: str
    metadataPath: str
    baselineCommit: str
    mainCommit: str
    worktrees: list[ExperimentWorktree]


class RepositoryEntry(Model):
    path: str
    kind: Literal["directory", "file", "link", "submodule"]


class RepositoryTree(Model):
    revision: str
    entries: list[RepositoryEntry]
    truncated: bool


class RepositoryFile(Model):
    status: Literal["text", "binary", "too_large"]
    size: int
    content: str | None


class RepositoryCommitDiff(Model):
    patch: str
    truncated: bool


class ExperimentTasks(Model):
    revision: int
    markdown: str
    completed: int
    total: int


class PlanningCompletion(Model):
    agentId: str
    specRevision: int
    createdAt: str


OutputDescription = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]


class Deliverable(Model):
    kind: Literal["file", "repository", "unavailable"]
    path: str
    format: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=48)]
    formatSource: Literal["explicit", "inferred"]
    description: OutputDescription
    primary: bool
    required: bool

    @model_validator(mode="after")
    def output_path(self):
        if self.kind == "file":
            path = experiment_output_path(self.path)
            if path.suffix.casefold() in BINARY_OUTPUT_SUFFIXES:
                raise ValueError("Binary files are unsupported. Record this requirement as unavailable.")
        elif self.path:
            raise ValueError("Only a file deliverable has a path. Use an empty path for repository or unavailable outputs.")
        if self.primary and not self.required:
            raise ValueError("The primary output must be required.")
        return self


class DeliverablePlan(Model):
    outputs: list[Deliverable] = Field(min_length=1, max_length=8)
    acceptanceCriteria: list[OutputDescription] = Field(min_length=1, max_length=8)
    assumptions: list[OutputDescription] = Field(max_length=6)

    @model_validator(mode="after")
    def distinct_outputs(self):
        if sum(output.primary for output in self.outputs) != 1:
            raise ValueError("Choose exactly one primary output.")
        paths = [output.path.casefold() for output in self.outputs if output.kind == "file"]
        if len(set(paths)) != len(paths) or any(
            left.startswith(right + "/") for left in paths for right in paths if left != right
        ):
            raise ValueError("Use distinct file paths. A planned file cannot contain another file.")
        if sum(output.kind == "repository" for output in self.outputs) > 1:
            raise ValueError("Use one repository output for software changes.")
        if len(self.model_dump_json().encode()) > 4_500:
            raise ValueError("Use a concise deliverable plan of at most 4,500 bytes.")
        return self


class ArtifactCheck(Model):
    status: Literal["ready", "missing", "invalid", "unavailable"]
    detail: str
    size: int | None = None


class FrozenExperiment(Model):
    mainCommit: str
    specRevision: int
    evidenceThrough: int
    artifactChecks: list[ArtifactCheck] = Field(default_factory=list)
    publicChecks: list[PublicCheckSummary] = Field(default_factory=list, exclude_if=lambda value: not value)


class CriterionScore(Model):
    score: int | Literal["not_assessable", "not_applicable"] = Field()
    explanation: str = Field(min_length=1, max_length=1600)
    evidenceIds: list[str] = Field(max_length=30)

    @model_validator(mode="after")
    def valid_score(self):
        if isinstance(self.score, int) and not 0 <= self.score <= 4:
            raise ValueError("Scores must be between zero and four.")
        return self


class AgentScorecard(Model):
    agentId: str
    criteria: list[CriterionScore] = Field(min_length=5, max_length=5)


class ExperimentReport(Model):
    summary: str = Field(min_length=1, max_length=3500)
    application: list[CriterionScore] = Field(min_length=5, max_length=5)
    agents: list[AgentScorecard]
    collaboration: list[CriterionScore] = Field(min_length=5, max_length=5)
    missingWork: list[str]


class DeepSWETask(Model):
    id: str
    datasetCommit: str
    baseCommit: str
    baseTree: str
    image: str
    verifierImage: str
    platform: str
    pierVersion: str


class DeepSWESlot(Model):
    guidance: Literal["neutral", "role", "full"]
    profileId: str | None = None
    model: str | None = None

    @model_validator(mode="after")
    def validate_profile(self):
        if (self.guidance == "neutral") != (self.profileId is None):
            raise ValueError("Choose a profile for role or full guidance only.")
        return self


class DeepSWECondition(Model):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    model: str = Field(min_length=1, max_length=160)
    slots: list[DeepSWESlot] = Field(min_length=1, max_length=15)
    callLimit: int = Field(ge=1, le=10000)
    solvingSeconds: int = Field(ge=1, le=86400)
    publicChecks: CheckDigest | None = Field(default=None, exclude_if=lambda value: value is None)


class DeepSWERequest(Model):
    task: DeepSWETask
    condition: DeepSWECondition


class DeepSWECampaignRequest(Model):
    requestId: str = Field(pattern=r"^[a-zA-Z0-9-]{1,64}$")
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    task: DeepSWETask
    conditions: list[DeepSWECondition] = Field(min_length=1, max_length=8)
    repeats: int = Field(ge=1, le=30)
    seed: int = Field(default=0, ge=0, le=2147483647)

    @model_validator(mode="after")
    def distinct_conditions(self):
        if len({item.name.casefold() for item in self.conditions}) != len(self.conditions):
            raise ValueError("Give each condition a distinct name.")
        return self


class DeepSWECatalogEntry(Model):
    task: DeepSWETask
    problem: Problem
    publicCheckProfile: PublicCheckPin | None = Field(default=None, exclude_if=lambda value: value is None)


class DeepSWECatalog(Model):
    task: DeepSWETask | None = None
    tasks: list[DeepSWECatalogEntry] = Field(default_factory=list)
    models: list[ModelInfo] = Field(default_factory=list)
    problem: Problem
    agents: list[Persona]
    model: ModelInfo
    callLimit: int
    solvingSeconds: int
    unavailableReason: str | None = None
    publicCheckProfile: PublicCheckPin | None = Field(default=None, exclude_if=lambda value: value is None)


class DeepSWEResult(Model):
    reward: Literal[0, 1]
    tests: int | None = None
    passed: int | None = None
    failed: int | None = None
    compilationFailure: str | None = None


class DeepSWERun(Model):
    condition: DeepSWECondition | None = None
    task: DeepSWETask
    callLimit: int
    solvingSeconds: int
    callsReserved: int = 0
    deadlineAt: str | None = None
    stopReason: Literal["call_limit", "deadline"] | None = None
    patchDigest: str | None = None
    submittedTree: str | None = None
    verificationAttempts: int = 0
    result: DeepSWEResult | None = None


class ExperimentState(Model):
    phase: Literal["plan", "build", "judge", "verify"] = "plan"
    planningCompletions: list[PlanningCompletion] | None = None
    # Preserve the original decision and threshold for archived majority runs.
    majority: int | None = None
    votes: list[PlanningCompletion] = Field(default_factory=list)
    repository: ExperimentRepository
    frozen: FrozenExperiment | None = None
    judgeAttempts: int = 0
    report: ExperimentReport | None = None
    rubric: Literal["application-v1", "deliverable-v1", "deepswe-v1"] = "application-v1"
    deliverablePlan: DeliverablePlan | None = None
    deepswe: DeepSWERun | None = None
    publicCheckProfile: PublicCheckPin | None = Field(default=None, exclude_if=lambda value: value is None)


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
    agents: list[GeneratedPersona | Persona]
    workers: list[Worker]
    status: Literal["ready", "running", "reviewing", "paused", "completed", "stopped", "stopping", "killed", "judge_failed", "verify_failed"] = "ready"
    canvas: str = ""
    canvasVersion: int = 0
    boardCount: int = 0
    changeCount: int = 0
    lease: LeaseView | None = None
    endedEarly: bool = False
    frozenSequence: int | None = None
    verification: Verification | None = None
    report: JudgeReport | None = None
    # Existing persisted sessions have no experiment state.
    experiment: ExperimentState | None = None
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
    action: Literal["start", "pause", "resume", "stop", "kill", "retry_judge", "retry_verification"]
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


class ExperimentUsageReport(UsageReport):
    teamGeneration: Usage


class CampaignTrial(Model):
    condition: str
    repeat: int
    sessionId: str | None
    status: str
    reward: Literal[0, 1] | None
    calls: int
    usage: Usage | None
    wallTimeMs: int | None


class CampaignSummary(Model):
    id: str
    name: str
    status: str
    createdAt: str


class CampaignScore(Model):
    condition: str
    passed: int
    graded: int
    planned: int
    ratePercent: float | None
    pairedCount: int
    deltaPoints: float | None


class DeepSWEComparison(Model):
    baseline: str
    candidate: str
    paired: int
    wins: int
    losses: int
    ties: int
    baselinePlanned: int
    candidatePlanned: int
    baselinePercent: float | None
    candidatePercent: float | None
    deltaPoints: float | None
    changedSettings: list[str]


class DeepSWECampaign(Model):
    id: str
    status: Literal["running", "paused", "finished", "cancelled"]
    error: str
    manifest: DeepSWECampaignRequest
    trials: list[CampaignTrial]
    scores: list[CampaignScore]
    callCeiling: int
    engineVersion: str
    promptVersion: str
    publicCheckProfile: PublicCheckPin | None = Field(default=None, exclude_if=lambda value: value is None)


class WorkspacePort(Model):
    port: int
    url: str


class WorkspaceRuntime(Model):
    enabled: bool
    availableRevision: str
    revision: str | None = None
    state: Literal["stopped", "starting", "running", "failed"] = "stopped"
    error: str | None = None
    logs: dict[str, str] = Field(default_factory=dict)
    forwards: list[WorkspacePort] = Field(default_factory=list)


class WorkspaceAction(Model):
    action: Literal["run", "stop", "reset", "forward"]
    port: int | None = Field(default=None, ge=1024, le=65535)


class TerminalTicket(Model):
    url: str


class HarnessContracts(Model):
    catalog: HarnessCatalog
    config: HarnessConfig
    snapshot: HarnessSnapshot
    page: RecordPage
    command: HarnessCommand
    usage: ExperimentUsageReport | UsageReport
    experimentCatalog: ExperimentCatalog
    experimentConfig: ExperimentConfig
    campaignSummary: CampaignSummary
    deepsweComparison: DeepSWEComparison
    deepsweRequest: DeepSWERequest
    deepsweCampaign: DeepSWECampaign
    deepsweCatalog: DeepSWECatalog
    teamGeneration: TeamGeneration
    teamGenerationRequest: TeamGenerationRequest
    repositoryTree: RepositoryTree
    repositoryFile: RepositoryFile
    repositoryCommitDiff: RepositoryCommitDiff
    experimentTasks: ExperimentTasks
    workspaceRuntime: WorkspaceRuntime
    workspaceAction: WorkspaceAction
    terminalTicket: TerminalTicket
