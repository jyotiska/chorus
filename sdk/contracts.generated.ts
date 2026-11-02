/** Generated from Chorus Pydantic contracts. Do not edit by hand. */

export type Id = string;
export type Revision = number;
export type Engineversion = string;
export type Scenarioid = string;
/**
 * @minItems 2
 * @maxItems 10
 */
export type Participantids = string[];
/**
 * @maxItems 10
 */
export type Adversaryids = string[];
export type Model = string;
export type Maxturns = number;
export type Judgeenabled = boolean;
export type Id1 = string;
export type Title = string;
export type Summary = string;
export type Problem = string;
export type Guidelines = string[];
export type Deliverable = string;
export type Suggestedagents = string[];
export type Collection = string;
export type Id2 = string;
export type Name = string;
export type Role = string;
export type Description = string;
export type Traits = string[];
export type Mood = string;
export type Energy = number;
export type Confidence = number;
export type Socialstyle = "introverted" | "ambiverted" | "extroverted";
export type Challengeresponse = "sensitive" | "balanced" | "resilient";
export type Collection1 = string;
export type Agents = Agent[];
export type Status = "ready" | "running" | "reviewing" | "paused" | "stopped" | "completed";
export type Kind = "agent" | "judge" | "skipped";
export type Turnnumber = number;
export type Speakerid = string;
export type Speakername = string;
export type Text = string;
export type Actions = string[];
export type Input = number | null;
export type Output = number | null;
export type Latencyseconds = number;
export type Agentid = string;
export type Energy1 = number;
export type Confidence1 = number;
/**
 * @minItems 1
 */
export type Reasons = string[];
export type Statchanges = StatChange[];
export type Id3 = string;
export type Agentid1 = string;
export type Promptversion = string;
export type Phase = string;
export type Attempt = number;
export type Model1 = string;
export type Route = "openai" | "openrouter" | "ollama" | "unknown";
export type Provider = string | null;
export type Requestid = string | null;
export type Input1 = number | null;
export type Output1 = number | null;
export type Cachedinput = number | null;
export type Cachewriteinput = number | null;
export type Reasoningoutput = number | null;
export type Costusd = number | null;
export type Cachestatus = "hit" | "no_read" | "unknown";
export type Outcome = string;
export type Accepted = boolean;
export type Validationpassed = boolean | null;
export type Rejectionreason = string | null;
export type Durationms = number;
export type Modelwindowtokens = number | null;
export type Configuredwindowtokens = number;
export type Effectivewindowtokens = number;
export type Inputtokens = number;
export type Inputsource = "provider" | "estimated";
export type Completionreservetokens = number;
export type Usableinputtokens = number;
export type Capabilityversion = string;
export type Calls = CallMetrics[];
export type Turns = Turn[];
export type Canvas = string;
export type Endedearly = boolean;
export type Summary1 = string;
/**
 * @minItems 1
 * @maxItems 5
 */
export type Strengths = string[];
/**
 * @minItems 1
 * @maxItems 5
 */
export type Improvements = string[];
/**
 * @minItems 1
 * @maxItems 5
 */
export type Nextpriorities = string[];
export type Verdict = "Meets requirements" | "Partially meets requirements" | "Needs more work";
export type Feedbackresponse = string;
export type Criterion = string;
export type Status1 = "Met" | "Partially met" | "Missing";
export type Evidence = string;
/**
 * @minItems 1
 */
export type Requirements = Requirement[];
export type Kind1 = "turn" | "checkpoint" | "final";
export type Speakerid1 = string | null;
export type Error = string;
export type Errorcode =
  | (
      | "INVALID_REQUEST"
      | "INVALID_MODEL_RESPONSE"
      | "GENERATION_FAILED"
      | "MODEL_UNAVAILABLE"
      | "MODEL_NOT_FOUND"
      | "MODEL_REQUEST_FAILED"
      | "TIMEOUT"
      | "CANCELLED"
      | "CONTEXT_LIMIT"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INVALID_STATE"
      | "CAPACITY"
      | "RECOVERED"
      | "VERSION_MISMATCH"
      | "FORBIDDEN"
      | "BACKEND_UNAVAILABLE"
    )
  | null;
export type Createdat = string;
export type Updatedat = string;
export type Commandid = string;
export type Expectedrevision = number;
export type Action = "start" | "pause" | "resume" | "stop";
export type Agents1 = Agent[];
export type Scenarios = Scenario[];
export type Id4 = string;
export type Label = string;
export type Provider1 = "ollama" | "openai" | "openrouter";
export type Installed = boolean | null;
export type Available = boolean | null;
export type Unavailablereason = string | null;
export type Models = ModelInfo[];
export type Defaultmodel = string;
export type Agentid2 = string;
export type Turnnumber1 = number;
export type Createdat1 = string;
export type Text1 = string | null;
export type Journals = Journal[];
export type Version = string;
export type Id5 = string;
export type Name1 = string;
export type Role1 = string;
export type Domain = string;
export type Introduction = string;
export type Personality1 = string;
export type Traits1 = string[];
export type Strengths1 = string;
export type Weaknesses = string;
export type Avatarbrief = string;
export type Avatarversion = string;
export type Agents2 = Persona[];
export type Id6 = string;
export type Title1 = string;
export type Domain1 = string;
export type Statement = string;
export type Participantids1 = string[];
export type Version1 = string;
export type Problems = Problem1[];
export type Id7 = string;
export type Label1 = string;
export type Provider2 = "ollama" | "openai" | "openrouter";
export type Available1 = boolean | null;
export type Unavailablereason1 = string | null;
export type Compatibilitynote = string | null;
export type Models1 = ModelInfo1[];
export type Defaultmodel1 = string;
export type Problemid = string;
/**
 * @minItems 2
 * @maxItems 50
 */
export type Participantids2 = string[];
/**
 * @maxItems 50
 */
export type Adversaryids1 = string[];
export type Model2 = string;
export type Maxturnsperagent = number;
export type Judgeenabled1 = boolean;
export type Maxcallsperturn = number;
export type Maxtoolsperturn = number;
export type Maxpostsperturn = number;
export type Leaseseconds = number;
export type Maxleaseholdseconds = number;
export type Id8 = string;
export type Revision1 = number;
export type Sequence = number;
export type Engineversion1 = string;
export type Promptversion1 = string;
export type Catalogversion = string;
export type Generation = number;
export type Agents3 = Persona[];
export type Agentid3 = string;
export type Turnsstarted = number;
export type Turnscompleted = number;
export type Currentturnindex = number;
export type State =
  "queued" | "running" | "waiting_model" | "waiting_lock" | "paused" | "finished" | "capped" | "failed";
export type Operationid = string;
export type Callsused = number;
export type Toolsused = number;
export type Postsused = number;
export type Editsused = number;
export type Repairsused = number;
export type Boardcursor = number;
export type Reason = string;
export type Turnstartedat = string | null;
export type Workers = Worker[];
export type Status2 = "ready" | "running" | "reviewing" | "paused" | "completed" | "stopped";
export type Canvas1 = string;
export type Canvasversion = number;
export type Boardcount = number;
export type Changecount = number;
export type Agentid4 = string;
export type Expiresat = string;
export type Fencing = number;
export type Endedearly1 = boolean;
export type Frozensequence = number | null;
export type Status3 = "correct" | "incorrect" | "unavailable";
export type Checks = string[];
export type Version2 = string;
export type Canvasversion1 = number;
export type Rubricversion = string;
export type Summary2 = string;
/**
 * @minItems 5
 * @maxItems 5
 */
export type Conversationscores = number[];
export type Conversationexplanation = string;
export type Conversationevidenceids = string[];
export type Agentid5 = string;
/**
 * @minItems 5
 * @maxItems 5
 */
export type Scores = number[];
export type Explanation = string;
export type Evidenceids = string[];
export type Insufficientevidence = boolean;
export type Agents4 = Grade[];
export type Coveredrecordids = string[];
export type Completedat = string;
export type Error1 = string;
export type Createdat2 = string;
export type Updatedat1 = string;
export type Id9 = string;
export type Sequence1 = number;
export type Kind2 = string;
export type Agentid6 = string;
export type Turn1 = number;
export type Createdat3 = string;
export type Records = Record[];
export type Cursor = number;
export type Highwater = number;
export type Hasmore = boolean;
export type Commandid1 = string;
export type Action1 = "start" | "pause" | "resume" | "stop";
export type Expectedrevision1 = number;
export type Callcount = number;
export type Inputtokens1 = number;
export type Outputtokens = number;
export type Cachedtokens = number;
export type Unknowninputcalls = number;
export type Unknownoutputcalls = number;
export type Unknowncachecalls = number;
export type Cachecoveredcalls = number;
export type Cacheutilizationpercent = number | null;
export type Cacheused = boolean | null;
export type Totallatencyms = number;
export type Meanlatencyms = number;
export type P95Latencyms = number;
export type Reportedcostusd = number;
export type Estimatedcostusd = number;
export type Unknowncostcalls = number;
export type Walltimems = number;
export type Error2 = string;
export type Code =
  | "INVALID_REQUEST"
  | "INVALID_MODEL_RESPONSE"
  | "GENERATION_FAILED"
  | "MODEL_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "MODEL_REQUEST_FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "CONTEXT_LIMIT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "CAPACITY"
  | "RECOVERED"
  | "VERSION_MISMATCH"
  | "FORBIDDEN"
  | "BACKEND_UNAVAILABLE";
export type Requestid1 = string;

/**
 * Root for generating TypeScript declarations and runtime validators.
 */
export interface Contracts {
  snapshot: Snapshot;
  config: SessionConfig;
  command: Command;
  catalog: Catalog;
  journals: Journals;
  harness: HarnessContracts;
  error: APIError;
}
export interface Snapshot {
  id: Id;
  revision: Revision;
  engineVersion: Engineversion;
  config: SessionConfig;
  scenario: Scenario;
  agents: Agents;
  status: Status;
  turns: Turns;
  canvas: Canvas;
  endedEarly: Endedearly;
  finalJudgement: FinalJudgement | null;
  finalUsageDetails?: TurnTelemetry | null;
  pending: Work | null;
  error: Error;
  errorCode: Errorcode;
  createdAt: Createdat;
  updatedAt: Updatedat;
}
export interface SessionConfig {
  scenarioId: Scenarioid;
  participantIds: Participantids;
  adversaryIds: Adversaryids;
  model: Model;
  maxTurns: Maxturns;
  judgeEnabled: Judgeenabled;
}
export interface Scenario {
  id: Id1;
  title: Title;
  summary: Summary;
  problem: Problem;
  guidelines: Guidelines;
  deliverable: Deliverable;
  suggestedAgents: Suggestedagents;
  collection: Collection;
}
export interface Agent {
  id: Id2;
  name: Name;
  role: Role;
  description: Description;
  traits: Traits;
  mood: Mood;
  energy: Energy;
  confidence: Confidence;
  personality: Personality;
  collection: Collection1;
}
export interface Personality {
  socialStyle: Socialstyle;
  challengeResponse: Challengeresponse;
}
export interface Turn {
  kind: Kind;
  turnNumber: Turnnumber;
  speakerId: Speakerid;
  speakerName: Speakername;
  text: Text;
  actions: Actions;
  tokenUsage: TokenUsage;
  latencySeconds: Latencyseconds;
  statChanges: Statchanges;
  usageDetails?: TurnTelemetry | null;
}
export interface TokenUsage {
  input: Input;
  output: Output;
}
export interface StatChange {
  agentId: Agentid;
  energy: Energy1;
  confidence: Confidence1;
  reasons: Reasons;
}
export interface TurnTelemetry {
  response: CallMetrics | null;
  calls: Calls;
}
export interface CallMetrics {
  id: Id3;
  agentId: Agentid1;
  promptVersion: Promptversion;
  phase: Phase;
  attempt: Attempt;
  model: Model1;
  route: Route;
  provider: Provider;
  requestId: Requestid;
  input: Input1;
  output: Output1;
  cachedInput: Cachedinput;
  cacheWriteInput: Cachewriteinput;
  reasoningOutput: Reasoningoutput;
  costUSD: Costusd;
  cacheStatus: Cachestatus;
  outcome: Outcome;
  accepted: Accepted;
  validationPassed?: Validationpassed;
  rejectionReason?: Rejectionreason;
  durationMs: Durationms;
  context: ResponseContext;
}
export interface ResponseContext {
  modelWindowTokens: Modelwindowtokens;
  configuredWindowTokens: Configuredwindowtokens;
  effectiveWindowTokens: Effectivewindowtokens;
  inputTokens: Inputtokens;
  inputSource: Inputsource;
  completionReserveTokens: Completionreservetokens;
  usableInputTokens: Usableinputtokens;
  capabilityVersion: Capabilityversion;
}
export interface FinalJudgement {
  summary: Summary1;
  strengths: Strengths;
  improvements: Improvements;
  nextPriorities: Nextpriorities;
  verdict: Verdict;
  feedbackResponse: Feedbackresponse;
  requirements: Requirements;
}
export interface Requirement {
  criterion: Criterion;
  status: Status1;
  evidence: Evidence;
}
export interface Work {
  kind: Kind1;
  speakerId: Speakerid1;
}
export interface Command {
  commandId: Commandid;
  expectedRevision: Expectedrevision;
  action: Action;
}
export interface Catalog {
  agents: Agents1;
  scenarios: Scenarios;
  models: Models;
  defaultModel: Defaultmodel;
}
export interface ModelInfo {
  id: Id4;
  label: Label;
  provider: Provider1;
  installed: Installed;
  available: Available;
  unavailableReason: Unavailablereason;
}
export interface Journal {
  agentId: Agentid2;
  turnNumber: Turnnumber1;
  createdAt: Createdat1;
  text: Text1;
}
export interface HarnessContracts {
  catalog: HarnessCatalog;
  config: HarnessConfig;
  snapshot: HarnessSnapshot;
  page: RecordPage;
  command: HarnessCommand;
  usage: UsageReport;
}
export interface HarnessCatalog {
  version: Version;
  agents: Agents2;
  problems: Problems;
  models: Models1;
  defaultModel: Defaultmodel1;
}
export interface Persona {
  id: Id5;
  name: Name1;
  role: Role1;
  domain: Domain;
  introduction: Introduction;
  personality: Personality1;
  traits: Traits1;
  strengths: Strengths1;
  weaknesses: Weaknesses;
  avatarBrief: Avatarbrief;
  avatarVersion: Avatarversion;
}
export interface Problem1 {
  id: Id6;
  title: Title1;
  domain: Domain1;
  statement: Statement;
  answerSchema: Answerschema;
  participantIds: Participantids1;
  version: Version1;
}
export interface Answerschema {
  [k: string]: unknown;
}
export interface ModelInfo1 {
  id: Id7;
  label: Label1;
  provider: Provider2;
  available: Available1;
  unavailableReason: Unavailablereason1;
  compatibilityNote: Compatibilitynote;
}
export interface HarnessConfig {
  problemId: Problemid;
  participantIds: Participantids2;
  adversaryIds: Adversaryids1;
  model: Model2;
  maxTurnsPerAgent: Maxturnsperagent;
  judgeEnabled: Judgeenabled1;
  maxCallsPerTurn: Maxcallsperturn;
  maxToolsPerTurn: Maxtoolsperturn;
  maxPostsPerTurn: Maxpostsperturn;
  leaseSeconds: Leaseseconds;
  maxLeaseHoldSeconds: Maxleaseholdseconds;
}
export interface HarnessSnapshot {
  id: Id8;
  revision: Revision1;
  sequence: Sequence;
  engineVersion: Engineversion1;
  promptVersion: Promptversion1;
  catalogVersion: Catalogversion;
  generation: Generation;
  config: HarnessConfig;
  problem: Problem1;
  agents: Agents3;
  workers: Workers;
  status: Status2;
  canvas: Canvas1;
  canvasVersion: Canvasversion;
  boardCount: Boardcount;
  changeCount: Changecount;
  lease: LeaseView | null;
  endedEarly: Endedearly1;
  frozenSequence: Frozensequence;
  verification: Verification | null;
  report: JudgeReport | null;
  error: Error1;
  createdAt: Createdat2;
  updatedAt: Updatedat1;
}
export interface Worker {
  agentId: Agentid3;
  turnsStarted: Turnsstarted;
  turnsCompleted: Turnscompleted;
  currentTurnIndex: Currentturnindex;
  state: State;
  operationId: Operationid;
  callsUsed: Callsused;
  toolsUsed: Toolsused;
  postsUsed: Postsused;
  editsUsed: Editsused;
  repairsUsed: Repairsused;
  boardCursor: Boardcursor;
  reason: Reason;
  turnStartedAt: Turnstartedat;
}
export interface LeaseView {
  agentId: Agentid4;
  expiresAt: Expiresat;
  fencing: Fencing;
}
export interface Verification {
  status: Status3;
  checks: Checks;
  version: Version2;
  canvasVersion: Canvasversion1;
}
export interface JudgeReport {
  rubricVersion: Rubricversion;
  summary: Summary2;
  conversationScores: Conversationscores;
  conversationExplanation: Conversationexplanation;
  conversationEvidenceIds: Conversationevidenceids;
  agents: Agents4;
  coveredRecordIds: Coveredrecordids;
  completedAt: Completedat;
}
export interface Grade {
  agentId: Agentid5;
  scores: Scores;
  explanation: Explanation;
  evidenceIds: Evidenceids;
  insufficientEvidence: Insufficientevidence;
}
export interface RecordPage {
  records: Records;
  cursor: Cursor;
  highWater: Highwater;
  hasMore: Hasmore;
}
export interface Record {
  id: Id9;
  sequence: Sequence1;
  kind: Kind2;
  agentId: Agentid6;
  turn: Turn1;
  createdAt: Createdat3;
  data: Data;
}
export interface Data {
  [k: string]: unknown;
}
export interface HarnessCommand {
  commandId: Commandid1;
  action: Action1;
  expectedRevision: Expectedrevision1;
}
export interface UsageReport {
  agents: Agents5;
  participants: Usage;
  judge: Usage;
  total: Usage;
  wallTimeMs: Walltimems;
}
export interface Agents5 {
  [k: string]: Usage;
}
export interface Usage {
  callCount: Callcount;
  inputTokens: Inputtokens1;
  outputTokens: Outputtokens;
  cachedTokens: Cachedtokens;
  unknownInputCalls: Unknowninputcalls;
  unknownOutputCalls: Unknownoutputcalls;
  unknownCacheCalls: Unknowncachecalls;
  cacheCoveredCalls: Cachecoveredcalls;
  cacheUtilizationPercent: Cacheutilizationpercent;
  cacheUsed: Cacheused;
  totalLatencyMs: Totallatencyms;
  meanLatencyMs: Meanlatencyms;
  p95LatencyMs: P95Latencyms;
  reportedCostUSD: Reportedcostusd;
  estimatedCostUSD: Estimatedcostusd;
  unknownCostCalls: Unknowncostcalls;
}
export interface APIError {
  error: Error2;
  code: Code;
  requestId: Requestid1;
}
