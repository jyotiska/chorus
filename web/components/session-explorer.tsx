"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { sessionOptions, type SessionOption } from "@/lib/session-data";
import { ChorusClient, type Catalog } from "@/lib/api/chorus/client";
import { useChorusSession } from "@/lib/use-chorus-session";
import { AgentState, SessionWorkspace } from "@/components/session-workspace";
import styles from "@/components/session-workspace.module.css";

type AgentWithId = SessionOption["agents"][number];
const client = new ChorusClient();

export function SessionExplorer() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const discussion = useChorusSession();
  const { snapshot, commandPending: connecting } = discussion;
  const error = discussion.error || catalogError;
  const sessions = catalog ? sessionOptions(catalog) : [];
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState("20");
  const [model, setModel] = useState("");
  const [judgeEnabled, setJudgeEnabled] = useState(false);
  const [adversaryIds, setAdversaryIds] = useState<string[]>([]);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const isRunning = snapshot?.status === "running" || snapshot?.status === "reviewing";
  const selectedModel = catalog?.models.find((item) => item.id === model);

  useEffect(() => {
    let active = true;
    void client.catalog().then((value) => {
      if (active) { setCatalog(value); setModel(value.defaultModel); }
    }).catch((error: unknown) => { if (active) setCatalogError(error instanceof Error ? error.message : "Cannot reach Chorus."); });
    return () => { active = false; };
  }, []);

  function runSimulation() {
    if (!activeSession || !selectedModel || selectedModel.available === false) return;
    void discussion.start({ scenarioId: activeSession.id, participantIds: activeSession.agents.map((agent) => agent.id), adversaryIds, model, maxTurns: Number(turnCount), judgeEnabled });
  }
  function returnToSetup() {
    if (snapshot && catalog) {
      setActiveSessionId(snapshot.config.scenarioId);
      setTurnCount(String(snapshot.config.maxTurns));
      setJudgeEnabled(snapshot.config.judgeEnabled);
      setAdversaryIds(snapshot.config.adversaryIds);
      setModel(catalog.models.some((item) => item.id === snapshot.config.model) ? snapshot.config.model : catalog.defaultModel);
    }
    void discussion.back();
  }
  const appHeader = (
    <header className="shrink-0 border-b border-[#deddd6]">
      <div className="mx-auto flex h-16 items-center justify-between gap-2 px-4">
        <a href="#" className="text-lg font-semibold tracking-[-0.04em]" aria-label="The Chorus Project home">The Chorus Project</a>
        {snapshot && <Button type="button" onClick={returnToSetup} disabled={connecting} variant="outline" className="rounded-none border-[#c9c8c1]">New simulation</Button>}
      </div>
    </header>
  );

  if (!catalog) return <main className="p-8"><p role={catalogError ? "alert" : "status"}>{catalogError || "Connecting to Chorus…"}</p>{catalogError && <Button onClick={() => window.location.reload()}>Retry connection</Button>}</main>;
  if (snapshot) return <main className={styles.sessionPage}>
    {appHeader}
    <SessionWorkspace key={snapshot.id} snapshot={snapshot} catalog={catalog} busy={connecting} error={discussion.error} errorCode={discussion.errorCode} onControl={discussion.control} />
  </main>;

  return (
    <main className="min-h-screen bg-[#faf9f6] text-[#20201e]">
      {appHeader}

      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="max-w-xl">
          <label className="mb-2 block text-sm font-medium" id="scenario-label">
            Choose a scenario
          </label>
          <Select
            value={activeSessionId}
            onValueChange={(value) => {
              if (isRunning) return;
              setActiveSessionId(value);
              setAdversaryIds((ids) => ids.filter((id) => sessions.find((session) => session.id === value)?.agents.some((agent) => agent.id === id)));
            }}
          >
            <SelectTrigger
              disabled={connecting}
              aria-labelledby="scenario-label"
              className="h-11 w-full rounded-none border-[#c9c8c1] bg-white px-3 text-sm"
            >
              <SelectValue placeholder="Select a session">
                {activeSession?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-none">
              {sessions.map((session) => (
                <SelectItem key={session.id} value={session.id} className="rounded-none">
                  {session.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!activeSession && error && <p role="alert" className="mt-4 text-sm text-[#9a382d]">{error}</p>}
        {activeSession && (
          <div className="mt-12 max-w-3xl">
            <section aria-labelledby="scenario-heading">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-[#77766f]">
                Scenario
              </p>
              <h1
                id="scenario-heading"
                className="text-3xl leading-tight tracking-[-0.03em] sm:text-4xl"
              >
                {activeSession.topic}
              </h1>
              <p className="mt-5 whitespace-pre-line text-[15px] leading-7 text-[#55554f]">
                {activeSession.context}
              </p>
            </section>

            <section aria-labelledby="deliverable-heading" className="mt-8 border border-[#e1ded6] border-l-[3px] border-l-[#a8785b] bg-white px-5 py-5 sm:px-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-[#795d48]">
                Shared canvas deliverable
              </p>
              <h2 id="deliverable-heading" className="sr-only">Required deliverable</h2>
              <p className="text-sm leading-6 text-[#55554f]">{activeSession.deliverable}</p>
              <p className="mt-3 text-xs leading-5 text-[#8a8176]">
                Agents create this artifact on the canvas. Participants can revise a section or leave the canvas unchanged on a turn.
              </p>
            </section>

            <section aria-labelledby="agents-heading" className="mt-12">
              <h2 id="agents-heading" className="text-2xl tracking-[-0.03em]">
                Agents in this scenario
                <span className="ml-2 font-sans text-sm font-normal tracking-normal text-[#77766f]">
                  ({activeSession.agents.length})
                </span>
              </h2>
              <p className="mt-3 text-sm leading-6 text-[#77766f]" id="adversary-help">Optional: mark one or more agents as adversaries. They act against their usual personality and work to undermine the team. Assignments are hidden from participants and the judge; behavior may reveal them.</p>
              <div className="mt-4 grid gap-3">
                {activeSession.agents.map((agent) => (
                  <AgentDetails key={agent.id} agent={agent} adversarial={adversaryIds.includes(agent.id)} busy={connecting} onAdversaryChange={(checked) => setAdversaryIds((ids) => checked ? [...ids, agent.id] : ids.filter((id) => id !== agent.id))} />
                ))}
              </div>
            </section>

            <section aria-labelledby="simulation-settings-heading" className="mt-12 border-t border-[#deddd6] pt-8">
              <h2 id="simulation-settings-heading" className="text-2xl tracking-[-0.03em]">
                Simulation settings
              </h2>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label id="turn-count-label" className="mb-2 block text-sm font-medium">
                    Number of turns
                  </label>
                  <Select value={turnCount} onValueChange={(value) => value && setTurnCount(value)}>
                    <SelectTrigger
                      disabled={connecting}
                      aria-labelledby="turn-count-label"
                      className="h-11 w-full rounded-none border-[#c9c8c1] bg-white px-3 text-sm"
                    >
                      <SelectValue>{turnCount} turns</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-none">
                      {[5, 10, 15, 20, 30, 40, 50].map((turns) => (
                        <SelectItem key={turns} value={String(turns)} className="rounded-none">
                          {turns} turns
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label id="model-label" className="mb-2 block text-sm font-medium">
                    Model
                  </label>
                  <Select value={model} onValueChange={(value) => value && setModel(value)}>
                    <SelectTrigger
                      disabled={connecting}
                      aria-labelledby="model-label"
                      className="h-11 w-full rounded-none border-[#c9c8c1] bg-white px-3 text-sm"
                    >
                      <SelectValue>{selectedModel?.label ?? model}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-none">
                      {(["ollama", "openai", "openrouter"] as const).map((provider) => (
                        <SelectGroup key={provider}>
                          <SelectLabel>{provider === "openrouter" ? "OpenRouter" : provider === "openai" ? "OpenAI APIs" : "Local MLX"}</SelectLabel>
                          {catalog.models.filter((item) => item.provider === provider).map((item) => (
                            <SelectItem key={item.id} value={item.id} disabled={item.available === false} className="rounded-none">
                              {item.label}{item.available === false ? " — unavailable" : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {catalog.models.filter((item) => item.unavailableReason).map((item) => <p key={item.id} className="mt-2 text-xs text-[#77766f]">{item.label}: {item.unavailableReason}</p>)}
                </div>
                <div className="flex min-h-11 items-center justify-between border border-[#c9c8c1] bg-white px-3 py-2.5">
                  <label htmlFor="judge-enabled" className="cursor-pointer text-sm font-medium">
                    Enable Judge
                    <span className="mt-0.5 block text-xs font-normal text-[#77766f]">
                      Reviews discussion every 5 turns
                    </span>
                  </label>
                  <input
                    id="judge-enabled"
                    type="checkbox"
                    checked={judgeEnabled}
                    onChange={(event) => setJudgeEnabled(event.target.checked)}
                    disabled={connecting}
                    className="size-4 accent-[#8c5b40]"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button
                  type="button"
                  onClick={runSimulation}
                  disabled={connecting || !selectedModel || selectedModel.available === false}
                  className="h-11 w-full rounded-none bg-[#282825] px-5 text-sm text-white hover:bg-[#3b3b36] sm:w-auto"
                >
                  {connecting ? "Connecting…" : "Run Simulation"}
                </Button>
              </div>
              {error && (
                <p role="alert" className="mt-4 text-sm text-[#9a382d]">
                  {error}
                </p>
              )}
            </section>

          </div>
        )}
      </div>
    </main>
  );
}

function AgentDetails({ agent, adversarial, busy, onAdversaryChange }: { agent: AgentWithId; adversarial: boolean; busy: boolean; onAdversaryChange: (checked: boolean) => void }) {
  return (
    <article className="border border-[#e1ded6] border-l-[3px] border-l-[#a8785b] bg-white px-5 py-5 shadow-[0_1px_3px_rgba(32,32,30,0.05)] sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-xl tracking-[-0.02em]">
          {agent.name.replace(/([a-z])([A-Z])/g, "$1 $2")}
        </h3>
        <span className="bg-[#f3efe8] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[#795d48]">
          {agent.role}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#55554f]">
        {agent.description}
      </p>
      <ul aria-label={`${agent.name} traits`} className="mt-3 flex flex-wrap gap-2">
        {agent.traits.map((trait) => (
          <li
            key={trait}
            className="rounded-full border border-[#e3ddd2] bg-[#f7f4ee] px-2.5 py-1 text-xs text-[#4f4b44]"
          >
            {trait}
          </li>
        ))}
      </ul>
      <AgentState agent={agent} />
      <label className="mt-4 flex items-center gap-2 text-sm text-[#795d48]">
        <input type="checkbox" aria-label={`Adversary: ${agent.name}`} aria-describedby="adversary-help" checked={adversarial} disabled={busy} onChange={(event) => onAdversaryChange(event.target.checked)} className="size-4 accent-[#8c5b40]" />
        Adversary
      </label>
    </article>
  );
}
