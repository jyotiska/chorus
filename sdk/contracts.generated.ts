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
export type Id3 = string;
export type Label = string;
export type Installed = boolean | null;
export type Models = ModelInfo[];
export type Defaultmodel = string;
export type Agentid = string;
export type Turnnumber1 = number;
export type Createdat1 = string;
export type Text1 = string | null;
export type Journals = Journal[];
export type Error1 = string;
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
export type Requestid = string;

/**
 * Root for generating TypeScript declarations and runtime validators.
 */
export interface Contracts {
  snapshot: Snapshot;
  config: SessionConfig;
  command: Command;
  catalog: Catalog;
  journals: Journals;
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
  pending: Work | null;
  error: Error;
  errorCode: Errorcode;
  createdAt: Createdat;
  updatedAt: Updatedat;
}
export interface SessionConfig {
  scenarioId: Scenarioid;
  participantIds: Participantids;
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
  collection: Collection1;
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
}
export interface TokenUsage {
  input: Input;
  output: Output;
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
  id: Id3;
  label: Label;
  installed: Installed;
}
export interface Journal {
  agentId: Agentid;
  turnNumber: Turnnumber1;
  createdAt: Createdat1;
  text: Text1;
}
export interface APIError {
  error: Error1;
  code: Code;
  requestId: Requestid;
}
