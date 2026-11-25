// Source: chorus/sdk/harness-client.ts. Regenerated into both applications.
import Ajv from "ajv/dist/2020";
import schema from "./contracts.schema.json";
import type { Contracts } from "./contracts.generated";
type H = Contracts["harness"];
export type HarnessSnapshot = H["snapshot"];
export type HarnessCatalog = H["catalog"];
export type ExperimentCatalog = H["experimentCatalog"];
export type DeepSWERequest = H["deepsweRequest"];
export type DeepSWECondition = DeepSWERequest["condition"];
export type DeepSWEComparison = H["deepsweComparison"];
export type DeepSWECampaign = H["deepsweCampaign"];
export type CampaignManifest = DeepSWECampaign["manifest"];
export type DeepSWECatalog = H["deepsweCatalog"];
export type HarnessConfig = H["config"];
export type ExperimentConfig = H["experimentConfig"];
export type TeamGeneration = H["teamGeneration"];
export type HarnessAction = H["command"]["action"];
export type HarnessUsage = H["usage"];
export type HarnessRecord = H["page"]["records"][number];
export type RepositoryTree = H["repositoryTree"];
export type RepositoryFile = H["repositoryFile"];
export type RepositoryCommitDiff = H["repositoryCommitDiff"];
export type ExperimentTasks = H["experimentTasks"];
export type WorkspaceRuntime = H["workspaceRuntime"];
export type WorkspaceAction = H["workspaceAction"];
export type Persona = HarnessSnapshot["agents"][number];
export type Usage = HarnessUsage["total"];
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema, "harness");
function parse<T>(value: unknown, name: string): T {
  const validate = ajv.getSchema(`harness#/$defs/${name}`);
  if (!validate || !validate(value)) throw new Error(`Chorus returned an invalid ${name} response.`);
  return value as T;
}
export class HarnessError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export class HarnessClient {
  constructor(public readonly base = "/api/chorus/v2") {}
  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(this.base + path, { cache: "no-store", signal: AbortSignal.timeout(15000), ...init });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = parse<Contracts["error"]>(value, "APIError");
      throw new HarnessError(error.code, error.error);
    }
    return value;
  }
  async catalog(): Promise<HarnessCatalog> { return parse(await this.request("/catalog"), "HarnessCatalog"); }
  async experimentCatalog(): Promise<ExperimentCatalog> { return parse(await this.request("/experiments/catalog"), "ExperimentCatalog"); }
  async deepsweCatalog(signal: AbortSignal): Promise<DeepSWECatalog> {
    return parse(await this.request("/deepswe/catalog", { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) }), "DeepSWECatalog");
  }
  async createDeepSWE(settings?: DeepSWERequest): Promise<HarnessSnapshot> {
    return parse(await this.request("/deepswe/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings), signal: AbortSignal.timeout(60000) }), "HarnessSnapshot");
  }
  async launchCampaign(manifest: CampaignManifest): Promise<DeepSWECampaign> {
    return parse(await this.request("/deepswe/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(manifest), signal: AbortSignal.timeout(60000) }), "DeepSWECampaign");
  }
  async campaign(id: string, signal?: AbortSignal): Promise<DeepSWECampaign> {
    return parse(await this.request(`/deepswe/campaigns/${encodeURIComponent(id)}`, signal ? { signal } : {}), "DeepSWECampaign");
  }
  async campaigns(): Promise<H["campaignSummary"][]> {
    const rows = await this.request("/deepswe/campaigns");
    if (!Array.isArray(rows)) throw new Error("Invalid DeepSWE campaign list.");
    return rows.map(row => parse<H["campaignSummary"]>(row, "CampaignSummary"));
  }
  async compareCampaigns(id: string, other: string, candidate: string, baseline: string): Promise<DeepSWEComparison> {
    const params = new URLSearchParams({ other, candidate, baseline });
    return parse(await this.request(`/deepswe/campaigns/${encodeURIComponent(id)}/comparison?${params}`), "DeepSWEComparison");
  }
  async campaignControl(id: string, action: "resume" | "cancel"): Promise<DeepSWECampaign> {
    return parse(await this.request(`/deepswe/campaigns/${encodeURIComponent(id)}/${action}`, { method: "POST" }), "DeepSWECampaign");
  }
  deepswePatch(id: string): string { return `${this.base}/sessions/${encodeURIComponent(id)}/deepswe/patch`; }
  async list(): Promise<HarnessSnapshot[]> {
    const value = await this.request("/sessions");
    if (!Array.isArray(value)) throw new Error("Invalid Chorus session list.");
    return value.map((entry) => parse<HarnessSnapshot>(entry, "HarnessSnapshot"));
  }
  async get(id: string): Promise<HarnessSnapshot> { return parse(await this.request(`/sessions/${encodeURIComponent(id)}`), "HarnessSnapshot"); }
  async createRun(settings: Pick<HarnessConfig, "problemId" | "participantIds" | "adversaryIds" | "model" | "judgeModel" | "maxTurnsPerAgent" | "judgeEnabled">) {
    return this.create({ ...settings, maxCallsPerTurn: 8, maxToolsPerTurn: 16, maxPostsPerTurn: 3, leaseSeconds: 30, maxLeaseHoldSeconds: 120 });
  }
  async create(config: HarnessConfig): Promise<HarnessSnapshot> {
    return parse(await this.request("/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) }), "HarnessSnapshot");
  }
  async createExperiment(config: Pick<ExperimentConfig, "problemId" | "participantIds" | "model" | "judgeModel"> & { customStatement?: string; teamGenerationId?: string; publicChecks?: string }): Promise<HarnessSnapshot> {
    return parse(await this.request("/experiments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) }), "HarnessSnapshot");
  }
  async generateTeam(config: Omit<H["teamGenerationRequest"], "customStatement"> & { customStatement?: string }, signal: AbortSignal): Promise<TeamGeneration> {
    return parse(await this.request("/experiments/teams", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
      signal: AbortSignal.any([signal, AbortSignal.timeout(200_000)]),
    }), "TeamGeneration");
  }
  async command(id: string, action: HarnessAction): Promise<HarnessSnapshot> {
    const commandId = crypto.randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.get(id);
      try {
        return parse(await this.request(`/sessions/${encodeURIComponent(id)}/commands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId, action, expectedRevision: current.revision }) }), "HarnessSnapshot");
      } catch (error) {
        if (!(error instanceof HarnessError) || error.code !== "CONFLICT" || attempt === 2) throw error;
      }
    }
    throw new Error("Session is changing; retry the command.");
  }
  async records(id: string, kind: string, after = 0, agent?: string): Promise<H["page"]> {
    const params = new URLSearchParams({ kind, after: String(after), limit: "100" });
    if (agent) params.set("agent", agent);
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/records?${params}`), "RecordPage");
  }
  async usage(id: string): Promise<HarnessUsage> {
    const value = await this.request(`/sessions/${encodeURIComponent(id)}/usage`);
    return parse(value, value && typeof value === "object" && "teamGeneration" in value ? "ExperimentUsageReport" : "UsageReport");
  }
  async record(id: string, recordId: string): Promise<HarnessRecord> { return parse(await this.request(`/sessions/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}`), "Record"); }
  async repositoryTree(id: string, branch: string, revision?: string): Promise<RepositoryTree> {
    const params = new URLSearchParams({ branch });
    if (revision) params.set("revision", revision);
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/repository/tree?${params}`), "RepositoryTree");
  }
  async repositoryFile(id: string, branch: string, revision: string, path: string): Promise<RepositoryFile> {
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/repository/file?${new URLSearchParams({ branch, revision, path })}`), "RepositoryFile");
  }
  repositoryImage(id: string, branch: string, revision: string, path: string): string {
    return `${this.base}/sessions/${encodeURIComponent(id)}/repository/image?${new URLSearchParams({ branch, revision, path })}`;
  }
  async runtime(id: string): Promise<WorkspaceRuntime> {
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/runtime`), "WorkspaceRuntime");
  }
  async runtimeAction(id: string, action: WorkspaceAction): Promise<WorkspaceRuntime> {
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/runtime`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
      signal: AbortSignal.timeout(75000),
    }), "WorkspaceRuntime");
  }
  async terminal(id: string): Promise<H["terminalTicket"]> {
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/runtime/terminal`, {
      method: "POST", signal: AbortSignal.timeout(75000),
    }), "TerminalTicket");
  }
  artifactDownload(id: string, path: string): string {
    return `${this.base}/sessions/${encodeURIComponent(id)}/artifacts/download?${new URLSearchParams({ path })}`;
  }
  async repositoryCommitDiff(id: string, branch: string, revision: string): Promise<RepositoryCommitDiff> {
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/repository/commit-diff?${new URLSearchParams({ branch, revision })}`), "RepositoryCommitDiff");
  }
  async agentTasks(id: string, agent: string): Promise<ExperimentTasks> {
    return parse(await this.request(`/sessions/${encodeURIComponent(id)}/agents/${encodeURIComponent(agent)}/tasks`), "ExperimentTasks");
  }
  subscribe(id: string, revision: number, receive: (state: HarnessSnapshot) => void, fail: (message: string) => void): () => void {
    let closed = false;
    const stream = new EventSource(`${this.base}/sessions/${encodeURIComponent(id)}/events?after=${revision}`);
    stream.addEventListener("snapshot", (event) => {
      if (closed) return;
      try { receive(parse(JSON.parse(event.data), "HarnessSnapshot")); }
      catch (error) { fail(error instanceof Error ? error.message : "Invalid session event."); }
    });
    stream.onopen = () => { void this.get(id).then((state) => { if (!closed) receive(state); }).catch((error: unknown) => { if (!closed) fail(String(error)); }); };
    stream.onerror = () => fail("Connection interrupted. Reconnecting to Chorus…");
    return () => { closed = true; stream.close(); };
  }
}
