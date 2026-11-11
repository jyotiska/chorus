"use client";

import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Pencil,
  SlidersHorizontal,
  Users,
  Search,
} from "lucide-react";
import {
  type HarnessCatalog,
  type HarnessSnapshot,
  type Persona,
} from "@/lib/api/chorus/harness-client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Portrait, ProfileDialog } from "@/lib/api/chorus/harness-workspace";
import { harness, message, Sheet } from "./shell";

export function Launcher({
  catalog,
  start,
  previous,
}: {
  catalog: HarnessCatalog;
  previous: HarnessSnapshot["config"] | null;
  start: (run: HarnessSnapshot) => Promise<void>;
}) {
  const experiment = catalog.version === "experiments-1";
  const [problem, setProblem] = useState(
    catalog.problems.find((item) => item.id === previous?.problemId) ??
      catalog.problems[0],
  );
  const [roster, setRoster] = useState(
    experiment
      ? problem.participantIds
      : (previous?.participantIds ?? problem.participantIds),
  );
  const [adversaries, setAdversaries] = useState<string[]>(
    previous?.adversaryIds ?? [],
  );
  const [model, setModel] = useState(previous?.model ?? catalog.defaultModel);
  const [cap, setCap] = useState(String(previous?.maxTurnsPerAgent ?? 10));
  const [judgeModel, setJudgeModel] = useState<string | null>(
    previous?.judgeModel ?? null,
  );
  const [judge, setJudge] = useState(previous?.judgeEnabled ?? false);
  const [sheet, setSheet] = useState<"problem" | "team" | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [profile, setProfile] = useState<Persona | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const teamDialog = useRef<HTMLDialogElement>(null);
  const judging = experiment || judge;
  const selectedModel = catalog.models.find((item) => item.id === model);
  const selectedJudgeModel = catalog.models.find(
    (item) => item.id === (judgeModel ?? model),
  );
  const modelOptions = catalog.models.map((item) => ({
    value: item.id,
    label: item.label + (item.available === false ? " · unavailable" : ""),
  }));
  const selected = catalog.agents.filter((agent) => roster.includes(agent.id));
  const invalidCap =
    !experiment &&
    (!Number.isInteger(Number(cap)) || Number(cap) < 1 || Number(cap) > 100);
  const invalidRoster = experiment
    ? roster.length === 0
    : roster.length < 2 || roster.length > 50;
  const rosterRequirement = experiment
    ? "Choose at least one agent."
    : "Choose between 2 and 50 agents.";
  const reason = invalidRoster
    ? rosterRequirement
    : invalidCap
      ? "Choose 1–100 turns per agent."
      : "";
  const unavailable =
    selectedModel?.available === false ||
    (judging && selectedJudgeModel?.available === false);
  const launchLabel = experiment ? "Start experiment" : "Start session";
  const agentCount = `${roster.length} ${roster.length === 1 ? "agent" : "agents"}`;
  const visible = catalog.agents
    .filter(
      (agent) =>
        (!domain || agent.domain === domain) &&
        (agent.name + " " + agent.role)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .toSorted(
      (a, b) => Number(roster.includes(b.id)) - Number(roster.includes(a.id)),
    );
  const matches = catalog.problems.filter((item) =>
    (item.title + " " + item.domain)
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  function open(next: "problem" | "team") {
    setQuery("");
    setDomain("");
    setSheet(next);
  }
  function toggle(id: string) {
    if (roster.includes(id)) {
      setRoster(roster.filter((value) => value !== id));
      setAdversaries(adversaries.filter((value) => value !== id));
    } else setRoster([...roster, id]);
  }
  async function submit() {
    if (busy || reason || unavailable) return;
    setBusy(true);
    setError("");
    try {
      const selection = {
        problemId: problem.id,
        participantIds: roster,
        model,
        judgeModel,
      };
      const run = experiment
        ? await harness.createExperiment(selection)
        : await harness.createRun({
            ...selection,
            adversaryIds: adversaries,
            maxTurnsPerAgent: Number(cap),
            judgeEnabled: judge,
          });
      await start(run);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const judgePicker = (
    <div className="setting-field">
      <label htmlFor="judge-model">Judge model</label>
      <Select
        value={judgeModel ?? model}
        items={modelOptions}
        onValueChange={(value) => value !== null && setJudgeModel(value)}
      >
        <SelectTrigger id="judge-model">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false} className="min-w-[min(18rem,var(--available-width))]">
          {modelOptions.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <section className="launcher">
      <div className="launcher-intro">
        <h2>{experiment ? "Set up an experiment" : "Set up a session"}</h2>
        <p>Choose a problem and the agents who will work on it.</p>
      </div>
      <div className="problem-field">
        <span className="field-label">Problem</span>
        <Button
          variant="outline"
          aria-haspopup="dialog"
          id="choose-problem"
          className="problem-trigger"
          aria-label={`Choose problem: ${problem.title}`}
          onClick={() => open("problem")}
        >
          <span>{problem.title}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
        <p>{problem.statement}</p>
      </div>
      {experiment ? (
        <section className="experiment-team" aria-labelledby="experiment-team-title">
          <div className="experiment-team-header">
            <div>
              <h3 id="experiment-team-title">Experiment team</h3>
              <p><strong>{agentCount}</strong> selected</p>
            </div>
            <button className="subtle-btn" aria-haspopup="dialog" onClick={() => open("team")}>
              <Pencil aria-hidden="true" />
              Edit team
            </button>
          </div>
          {selected.length > 0 && (
            <ul className="experiment-team-list" role="list" aria-label="Selected agents">
              {selected.map((agent) => (
                <li key={agent.id}>
                  <span aria-hidden="true"><Portrait agent={agent} /></span>
                  <span>{agent.name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : <div className="team-line">
        <span className="field-label">
          <Users />
          Team
        </span>
        <div className="team-preview" aria-hidden="true">
          {selected.slice(0, 4).map((agent) => (
            <Portrait key={agent.id} agent={agent} />
          ))}
        </div>
        <span>{agentCount}</span>
        <button className="subtle-btn" onClick={() => open("team")}>
          Edit team
        </button>
      </div>}
      <section className="run-settings">
        <h3>
          <SlidersHorizontal /> Run settings
        </h3>
        <div className={experiment ? "settings-fields experiment-settings-fields" : "settings-fields"}>
          <div className="setting-field">
            <label htmlFor="run-model">Model</label>
            <Select
              value={model}
              items={modelOptions}
              onValueChange={(value) => value !== null && setModel(value)}
            >
              <SelectTrigger id="run-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {modelOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {experiment ? judgePicker : (
            <label>
              Turns per agent
              <input
                type="number"
                aria-label="Turns per agent"
                min="1"
                max="100"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </label>
          )}
        </div>
        {selectedModel?.available === false && (
          <p role="status" className="notice">
            {selectedModel.unavailableReason}
          </p>
        )}
        {selectedModel?.compatibilityNote && (
          <p role="status" className="notice">
            {selectedModel.compatibilityNote}
          </p>
        )}
        {!experiment && (
          <label className="judge">
            <input
              type="checkbox"
              checked={judge}
              onChange={(e) => setJudge(e.target.checked)}
            />{" "}
            Final judge
          </label>
        )}
        {!experiment && judge && judgePicker}
        {judging &&
          selectedJudgeModel?.id !== selectedModel?.id &&
          selectedJudgeModel?.available === false && (
            <p role="status" className="notice">{selectedJudgeModel.unavailableReason}</p>
          )}
      </section>
      {reason && (
        <p role="status" className="notice">
          {reason}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="launch-foot">
        {!experiment && <span>{invalidCap ? "Turn limit required" : `Up to ${roster.length * Number(cap)} contribution cycles`}</span>}
        <button
          type="button"
          className="primary-btn"
          disabled={busy || !!reason || unavailable}
          onClick={() => void submit()}
        >
          {busy ? "Starting…" : launchLabel}
          <ArrowUpRight />
        </button>
      </div>
      {sheet && (
        <Sheet
          title={sheet === "team" ? "Edit team" : "Choose a problem"}
          dialogRef={teamDialog}
          close={() => setSheet(null)}
        >
          <label className="search">
            <Search />
            <input
              autoFocus
              aria-label={
                sheet === "team" ? "Search agents" : "Search problems"
              }
              value={query}
              placeholder={
                sheet === "team" ? "Search agents…" : "Search problems…"
              }
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {sheet === "problem" ? (
            <div className="problem-list">
              {matches.map((item) => (
                <button
                  key={item.id}
                  onClick={(event) => {
                    if (item.id !== problem.id) {
                      setProblem(item);
                      if (!experiment) {
                        setRoster(item.participantIds);
                        setAdversaries([]);
                      }
                    }
                    event.currentTarget.closest("dialog")?.close();
                  }}
                >
                  <span>
                    <b>{item.title}</b>
                    <small>{item.domain}</small>
                  </span>
                  {item.id === problem.id && <Check />}
                </button>
              ))}
              {!matches.length && <p>No matching problems.</p>}
            </div>
          ) : (
            <>
              <div className="filter-row">
                {!experiment && (
                  <div className="domain-field">
                    <label htmlFor="team-domain">Domain</label>
                    <Select
                      value={domain}
                      onValueChange={(value) => setDomain(value ?? "")}
                    >
                      <SelectTrigger id="team-domain">
                        <SelectValue>{domain || "All domains"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent container={teamDialog} alignItemWithTrigger={false}>
                        <SelectItem value="">All domains</SelectItem>
                        {[...new Set(catalog.agents.map((agent) => agent.domain))]
                          .filter(Boolean)
                          .sort()
                          .map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <span>{roster.length} selected</span>
              </div>
              <div className={experiment ? "roster-list experiment-roster" : "roster-list"}>
                {visible.map((agent) => (
                  <div key={agent.id} className="persona">
                    <input
                      type="checkbox"
                      aria-label={`Select ${agent.name}`}
                      checked={roster.includes(agent.id)}
                      onChange={() => toggle(agent.id)}
                    />
                    <button
                      className="persona-info"
                      aria-label={`View ${agent.name} profile`}
                      onClick={() => setProfile(agent)}
                    >
                      <Portrait agent={agent} />
                      <span>
                        <b>{agent.name}</b>
                        {agent.role && agent.role !== agent.name && <small>{agent.role}</small>}
                      </span>
                    </button>
                    {!experiment && roster.includes(agent.id) && (
                      <label className="adversary">
                        <input
                          type="checkbox"
                          aria-label={`${agent.name} private adversary`}
                          checked={adversaries.includes(agent.id)}
                          onChange={(e) =>
                            setAdversaries(
                              e.target.checked
                                ? [...adversaries, agent.id]
                                : adversaries.filter((id) => id !== agent.id),
                            )
                          }
                        />
                        Private adversary
                      </label>
                    )}
                  </div>
                ))}
                {!visible.length && <p>No matching agents.</p>}
              </div>
            </>
          )}
        </Sheet>
      )}
      {profile && (
        <ProfileDialog agent={profile} close={() => setProfile(null)} />
      )}
    </section>
  );
}
