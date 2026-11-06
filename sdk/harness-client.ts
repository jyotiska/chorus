// Source: chorus/sdk/harness-client.ts. Regenerated into both applications.
import Ajv from "ajv/dist/2020";
import schema from "./contracts.schema.json";
import type { Contracts } from "./contracts.generated";
type H = Contracts["harness"];
export type HarnessSnapshot = H["snapshot"];
export type HarnessCatalog = H["catalog"];
export type HarnessConfig = H["config"];
export type HarnessUsage = H["usage"];
export type HarnessRecord = H["page"]["records"][number];
export type Persona = HarnessCatalog["agents"][number];
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
  async list(): Promise<HarnessSnapshot[]> {
    const value = await this.request("/sessions");
    if (!Array.isArray(value)) throw new Error("Invalid Chorus session list.");
    return value.map((entry) => parse<HarnessSnapshot>(entry, "HarnessSnapshot"));
  }
  async get(id: string): Promise<HarnessSnapshot> { return parse(await this.request(`/sessions/${encodeURIComponent(id)}`), "HarnessSnapshot"); }
  async createRun(settings: Pick<HarnessConfig, "problemId" | "participantIds" | "adversaryIds" | "model" | "maxTurnsPerAgent" | "judgeEnabled">) {
    return this.create({ ...settings, maxCallsPerTurn: 8, maxToolsPerTurn: 16, maxPostsPerTurn: 3, leaseSeconds: 30, maxLeaseHoldSeconds: 120 });
  }
  async create(config: HarnessConfig): Promise<HarnessSnapshot> {
    return parse(await this.request("/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) }), "HarnessSnapshot");
  }
  async command(id: string, action: H["command"]["action"]): Promise<HarnessSnapshot> {
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
  async usage(id: string): Promise<HarnessUsage> { return parse(await this.request(`/sessions/${encodeURIComponent(id)}/usage`), "UsageReport"); }
  async record(id: string, recordId: string): Promise<HarnessRecord> { return parse(await this.request(`/sessions/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}`), "Record"); }
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
