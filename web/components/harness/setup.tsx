"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Pencil,
  SlidersHorizontal,
  Sparkles,
  Users,
  Search,
} from "lucide-react";
import {
  type ExperimentCatalog,
  type HarnessCatalog,
  type HarnessSnapshot,
  type Persona,
  type TeamGeneration,
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

import { DeepSWESetup } from "./deepswe-setup";

function ModelPicker({
  id,
  label,
  value,
  select,
  warning,
  note,
  sharedWarning,
  options,
}: {
  id: string;
  label: string;
  value: string;
  select: (value: string) => void;
  warning?: string;
  note?: string | null;
  sharedWarning?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="setting-field">
      <label htmlFor={id}>{label}</label>
      <Select value={value} items={options} onValueChange={(value) => value !== null && select(value)}>
        <SelectTrigger
          id={id}
          aria-invalid={Boolean(warning || sharedWarning) || undefined}
          aria-describedby={[
            warning ? `${id}-warning` : sharedWarning,
            note ? `${id}-note` : undefined,
          ].filter(Boolean).join(" ") || undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="model-options" align="end" alignItemWithTrigger={false}>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {warning && <p id={`${id}-warning`} role="status" className="notice">{warning}</p>}
      {note && <p id={`${id}-note`} role="status" className="notice">{note}</p>}
    </div>
  );
}

export function Launcher({
  catalog,
  experiment,
  start,
  previousRun,
}: {
  catalog: HarnessCatalog | ExperimentCatalog;
  experiment: boolean;
  previousRun: HarnessSnapshot | null;
  start: (run: HarnessSnapshot) => Promise<void>;
}) {
  const previous = previousRun?.config;
  const [problem, setProblem] = useState(
    catalog.problems.find((item) => item.id === previous?.problemId) ??
      catalog.problems[0],
  );
  const [visitedDeepSWE, setVisitedDeepSWE] = useState(false);
  const [source, setSource] = useState("app");
  const custom = experiment && problem.id === "other";
  const [customStatement, setCustomStatement] = useState(
    previous?.problemId === "other" ? previousRun?.problem.statement ?? "" : "",
  );
  const [generated, setGenerated] = useState<{
    team: TeamGeneration;
    problemId: string;
    statement: string;
  } | null>(() => {
    const agents = previousRun?.agents.filter((agent) => "generationId" in agent) ?? [];
    if (!previousRun || !experiment || !agents.length) return null;
    return { team: { id: agents[0].generationId, agents }, problemId: previousRun.problem.id, statement: previousRun.problem.statement };
  });
  const [roster, setRoster] = useState(
    experiment && !custom && !generated
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
  const [publicChecks, setPublicChecks] = useState(false);
  const checkProfile = "publicCheckProfile" in catalog ? catalog.publicCheckProfile : undefined;
  const [sheet, setSheet] = useState<"problem" | "team" | null>(null);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("");
  const [profile, setProfile] = useState<Persona | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const generationRequest = useRef<AbortController | null>(null);
  const teamDialog = useRef<HTMLDialogElement>(null);
  const statementField = useRef<HTMLTextAreaElement>(null);
  const focusStatement = useRef(false);
  useEffect(() => {
    if (!sheet && custom && focusStatement.current) {
      focusStatement.current = false;
      statementField.current?.focus();
    }
  }, [custom, sheet]);
  useEffect(() => () => {
    generationRequest.current?.abort();
    generationRequest.current = null;
  }, []);
  const judging = experiment || judge;
  const selectedModel = catalog.models.find((item) => item.id === model);
  const selectedJudgeModel = catalog.models.find(
    (item) => item.id === (judgeModel ?? model),
  );
  const modelOptions = catalog.models.map((item) => ({
    value: item.id,
    label: item.label + (item.available === false ? " · unavailable" : ""),
  }));
  const modelWarning = selectedModel?.available === false
    ? selectedModel.unavailableReason || "This model is unavailable."
    : undefined;
  const judgeUsesAgentModel = selectedJudgeModel?.id === selectedModel?.id;
  const judgeWarning = judging && !judgeUsesAgentModel && selectedJudgeModel?.available === false
    ? selectedJudgeModel.unavailableReason || "This model is unavailable."
    : undefined;
  const agents = [...(generated?.team.agents ?? []), ...catalog.agents];
  const selected = agents.filter((agent) => roster.includes(agent.id));
  const usingGenerated = selected.some((agent) => "generationId" in agent);
  const statement = custom ? customStatement : problem.statement;
  const staleTeam = usingGenerated && (generated?.problemId !== problem.id || generated.statement !== statement);
  const invalidCap =
    !experiment &&
    (!Number.isInteger(Number(cap)) || Number(cap) < 1 || Number(cap) > 100);
  const invalidRoster = experiment
    ? roster.length === 0
    : roster.length < 2 || roster.length > 50;
  const rosterRequirement = experiment
    ? "Choose at least one agent."
    : "Choose between 2 and 50 agents.";
  const statementLimit = "customStatementMaxBytes" in catalog ? catalog.customStatementMaxBytes : 0;
  const statementBytes = custom ? new TextEncoder().encode(customStatement).length : 0;
  const statementError = custom && statementBytes > statementLimit ? "Shorten the problem statement to fit the limit." : "";
  const briefError = custom && !customStatement.trim() ? "Enter a problem statement." : statementError;
  const reason = invalidRoster
    ? rosterRequirement
    : invalidCap
      ? "Choose 1–100 turns per agent."
      : briefError;
  const unavailable =
    selectedModel?.available === false ||
    (judging && selectedJudgeModel?.available === false);
  const launchLabel = experiment ? "Start experiment" : "Start session";
  const briefLabel = experiment ? "brief" : "problem";
  const agentCount = `${roster.length} ${roster.length === 1 ? "agent" : "agents"}`;
  const visible = agents
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
  function cancelGeneration() {
    generationRequest.current?.abort();
    generationRequest.current = null;
    setGenerating(false);
    setGenerationError("");
  }
  function toggle(id: string) {
    if (generating) cancelGeneration();
    if (roster.includes(id)) {
      setRoster(roster.filter((value) => value !== id));
      setAdversaries(adversaries.filter((value) => value !== id));
    } else setRoster([...roster, id]);
  }
  async function generate() {
    if (busy || generationRequest.current || briefError || !selectedModel || modelWarning) return;
    const controller = new AbortController();
    generationRequest.current = controller;
    setGenerating(true);
    setGenerationError("");
    setError("");
    try {
      const team = await harness.generateTeam({ problemId: problem.id, model, ...(custom ? { customStatement } : {}) }, controller.signal);
      if (generationRequest.current !== controller) return;
      setGenerated({ team, problemId: problem.id, statement });
      setRoster(team.agents.map((agent) => agent.id));
      setAdversaries([]);
    } catch (error) {
      if (generationRequest.current !== controller) return;
      setGenerationError(error instanceof DOMException && error.name === "TimeoutError"
        ? "Team generation took too long. Try Generate again."
        : message(error));
    } finally {
      if (generationRequest.current === controller) {
        generationRequest.current = null;
        setGenerating(false);
      }
    }
  }
  async function submit() {
    if (busy || reason || unavailable || staleTeam || generationRequest.current) return;
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
        ? await harness.createExperiment({ ...selection, ...(custom ? { customStatement } : {}),
            ...(usingGenerated && generated ? { teamGenerationId: generated.team.id } : {}),
            ...(publicChecks && checkProfile ? { publicChecks: checkProfile.digest } : {}) })
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
    <ModelPicker
      id="judge-model"
      label="Judge model"
      value={judgeModel ?? model}
      select={setJudgeModel}
      warning={judgeWarning}
      note={judgeUsesAgentModel ? undefined : selectedJudgeModel?.compatibilityNote}
      sharedWarning={judgeUsesAgentModel && modelWarning ? "run-model-warning" : undefined}
      options={modelOptions}
    />
  );
  return (
    <section className={experiment && source === "app" ? "launcher app-source" : "launcher"}>
      {experiment && (
        <section className="problem-field source-picker">
          <ModelPicker id="problem-source" label="Problem source" value={source} select={(value) => { setSource(value); if (value === "deepswe") setVisitedDeepSWE(true); }}
            options={[{ value: "app", label: "App or open-ended problem" }, { value: "deepswe", label: "DeepSWE" }]} />
        </section>
      )}
      {visitedDeepSWE && <div hidden={source !== "deepswe"}><DeepSWESetup /></div>}
      {source === "app" && <>
      {!experiment && (
        <div className="launcher-intro">
          <h2>Set up a session</h2>
          <p>Choose a problem and the agents who will work on it.</p>
        </div>
      )}
      <section className="problem-field" aria-labelledby="problem-heading">
        {experiment ? <h2 id="problem-heading">Brief</h2> : (
          <span id="problem-heading" className="field-label">Problem</span>
        )}
        <Button
          variant="outline"
          aria-haspopup="dialog"
          id="choose-problem"
          className="problem-trigger"
          aria-label={`Choose ${briefLabel}: ${problem.title}`}
          onClick={() => open("problem")}
        >
          <span>{problem.title}</span>
          <ChevronDown aria-hidden="true" />
        </Button>
        {custom ? (
          <div className="custom-statement">
            <label htmlFor="custom-statement">Problem statement</label>
            <textarea id="custom-statement" rows={5} ref={statementField} value={customStatement}
              placeholder="Describe what the team should deliver."
              aria-required="true" aria-invalid={Boolean(statementError)}
              aria-describedby={statementError ? "custom-statement-error" : undefined}
              onChange={(event) => { cancelGeneration(); setCustomStatement(event.target.value); setError(""); }} />
            {statementError && <p id="custom-statement-error" role="status">{statementError}</p>}
          </div>
        ) : <p>{problem.statement}</p>}
      </section>
      {experiment ? (
        <section className="experiment-team" aria-labelledby="experiment-team-title">
          <div className="experiment-team-header">
            <div className="experiment-team-title">
              <h2 id="experiment-team-title">Experiment team</h2>
              <span>{agentCount}</span>
            </div>
            <div className="experiment-team-actions">
              <button type="button" className="subtle-btn" aria-haspopup="dialog" onClick={() => open("team")}>
                <Pencil aria-hidden="true" />
                Edit team
              </button>
              <button type="button" className="subtle-btn" disabled={generating || busy || Boolean(briefError || modelWarning) || !selectedModel}
                onClick={() => void generate()}>
                <Sparkles aria-hidden="true" />
                {generating ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
          {selected.length > 0 && (
            <ul className="experiment-team-list" role="list" aria-label="Selected agents">
              {selected.map((agent) => (
                <li key={agent.id}>
                  <span aria-hidden="true"><Portrait agent={agent} /></span>
                  {"generationId" in agent ? (
                    <button type="button" className="generated-agent-preview" aria-label={`View ${agent.name} profile`} onClick={() => setProfile(agent)}>
                      {agent.name}
                      <small>{agent.role}</small>
                    </button>
                  ) : <span>{agent.name}</span>}
                </li>
              ))}
            </ul>
          )}
          {invalidRoster && <p role="status" className="notice">{rosterRequirement}</p>}
          {generating && <p role="status" className="notice">Generating agents with {selectedModel?.label}…</p>}
          {generationError && <p role="alert" className="notice">{generationError}</p>}
          {staleTeam && !generating && <p role="status" className="notice">Generate a team for this brief or remove the generated agents in Edit team.</p>}
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
      <section className="run-settings" aria-labelledby="model-heading">
        {experiment ? <h2 id="model-heading">Models</h2> : (
          <h3 id="model-heading"><SlidersHorizontal /> Run settings</h3>
        )}
        <div className={experiment ? "settings-fields experiment-settings-fields" : "settings-fields"}>
          <ModelPicker
            id="run-model"
            label={experiment ? "Agent model" : "Model"}
            value={model}
            select={(value) => { if (value !== model) cancelGeneration(); setModel(value); }}
            warning={modelWarning}
            note={selectedModel?.compatibilityNote}
            options={modelOptions}
          />
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
      </section>
      {experiment && checkProfile && <label className="judge">
        <input type="checkbox" checked={publicChecks} onChange={(event) => setPublicChecks(event.target.checked)} />
        Allow agents to run public checks · {checkProfile.profile.name}
      </label>}
      {!experiment && reason && (
        <p role="status" className="notice">
          {reason}
        </p>
      )}
      {!experiment && error && <p role="alert">{error}</p>}
      <div className="launch-foot">
        {experiment && error && <p role="alert">{error}</p>}
        {!experiment && <span>{invalidCap ? "Turn limit required" : `Up to ${roster.length * Number(cap)} contribution cycles`}</span>}
        <button
          type="button"
          className="primary-btn"
          disabled={busy || !!reason || unavailable || generating || staleTeam}
          onClick={() => void submit()}
        >
          {busy ? "Starting…" : launchLabel}
          <ArrowUpRight />
        </button>
      </div>
      {sheet && (
        <Sheet
          title={sheet === "team" ? "Edit team" : `Choose a ${briefLabel}`}
          dialogRef={teamDialog}
          close={() => setSheet(null)}
        >
          <label className="search">
            <Search />
            <input
              autoFocus
              aria-label={
                sheet === "team" ? "Search agents" : `Search ${briefLabel}s`
              }
              value={query}
              placeholder={
                sheet === "team" ? "Search agents…" : `Search ${briefLabel}s…`
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
                    focusStatement.current = item.id === "other";
                    setError("");
                    if (item.id !== problem.id) {
                      cancelGeneration();
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
              {!matches.length && <p>No matching {briefLabel}s.</p>}
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
      </>}
    </section>
  );
}
