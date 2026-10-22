// Shared Chorus client. Source: chorus/sdk/client.ts; regenerate with export_contracts.py.
import Ajv from "ajv/dist/2020";
import schema from "./contracts.schema.json";
import type { Contracts } from "./contracts.generated";
export type Snapshot = Contracts["snapshot"];
export type SessionConfig = Contracts["config"];
export type Command = Contracts["command"];
export type Catalog = Contracts["catalog"];
export type Journal = Contracts["journals"][number];
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema, "chorus");
function parse<T>(value: unknown, name: string): T {
  const validate = ajv.getSchema(`chorus#/$defs/${name}`);
  if (!validate || !validate(value)) throw new Error(`Chorus returned an invalid ${name} response.`);
  return value as T;
}
export class ChorusError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
export class ChorusClient {
  constructor(private readonly base = "/api/chorus") {}
  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.base}${path}`, { signal: AbortSignal.timeout(15000), ...init, cache: "no-store" });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = parse<Contracts["error"]>(value, "APIError");
      throw new ChorusError(error.code, error.error);
    }
    return value;
  }
  async catalog(): Promise<Catalog> { return parse(await this.request("/catalog"), "Catalog"); }
  async models(): Promise<Catalog["models"]> {
    const value = await this.request("/models");
    if (!Array.isArray(value)) throw new Error("Chorus returned invalid models.");
    return value.map((entry) => parse<Catalog["models"][number]>(entry, "ModelInfo"));
  }
  async create(config: SessionConfig): Promise<Snapshot> {
    return parse(await this.request("/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) }), "Snapshot");
  }
  async get(id: string): Promise<Snapshot> { return parse(await this.request(`/sessions/${encodeURIComponent(id)}`), "Snapshot"); }
  async journals(id: string): Promise<Journal[]> {
    const value = await this.request(`/sessions/${encodeURIComponent(id)}/journals`);
    if (!Array.isArray(value)) throw new Error("Chorus returned invalid journals.");
    return value.map((entry) => parse<Journal>(entry, "Journal"));
  }
  async command(id: string, action: Command["action"]): Promise<Snapshot> {
    const commandId = crypto.randomUUID();
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.get(id);
      try {
        return parse(await this.request(`/sessions/${encodeURIComponent(id)}/commands`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commandId, action, expectedRevision: current.revision }) }), "Snapshot");
      } catch (error) {
        if (!(error instanceof ChorusError) || error.code !== "CONFLICT" || attempt === 2) throw error;
      }
    }
    throw new Error("Session changed; retry the command.");
  }
  subscribe(id: string, revision: number, receive: (snapshot: Snapshot) => void, fail: (message: string) => void): () => void {
    let closed = false;
    const stream = new EventSource(`${this.base}/sessions/${encodeURIComponent(id)}/events?after=${revision}`);
    stream.addEventListener("snapshot", (event) => {
      try { receive(parse(JSON.parse(event.data), "Snapshot")); }
      catch (error) { fail(error instanceof Error ? error.message : "Invalid session event."); }
    });
    stream.onopen = () => {
      void this.get(id).then((snapshot) => { if (!closed) receive(snapshot); }).catch((error: unknown) => { if (!closed) fail(error instanceof Error ? error.message : "Cannot restore the session."); });
    };
    stream.onerror = () => fail("Connection interrupted. Reconnecting to Chorus…");
    return () => { closed = true; stream.close(); };
  }
}
