import type { Catalog } from "@/lib/api/chorus/client";
export type AgentProfile = Catalog["agents"][number];
export type SessionOption = { id: string; label: string; topic: string; context: string; deliverable: string; agents: AgentProfile[] };
export function sessionOptions(catalog: Catalog): SessionOption[] {
  return catalog.scenarios.filter((s) => s.collection === "chorus-web").map((s) => ({ id: s.id, label: s.title, topic: s.summary, context: s.problem, deliverable: s.deliverable,
    agents: s.suggestedAgents.flatMap((id) => catalog.agents.find((agent) => agent.id === id) ?? []) }));
}
