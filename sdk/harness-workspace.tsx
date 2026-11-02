"use client";

// Shared product UI. Source: chorus/sdk; generated into both applications.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HarnessClient, HarnessError } from "./harness-client";
import type { HarnessCatalog, HarnessSnapshot, HarnessRecord, HarnessUsage, Persona, Usage } from "./harness-client";
import { ChorusClient } from "./client";
import type { Snapshot as LegacySnapshot } from "./client";
import styles from "./harness-workspace.module.css";

const client = new HarnessClient();
const legacyClient = new ChorusClient();
const storageKey = "chorus.harness.session";
const labels: Record<string, string> = { queued: "Ready", running: "Working", waiting_model: "Waiting for model", waiting_lock: "Waiting for canvas", paused: "Paused", finished: "Finished", capped: "Turn cap reached", failed: "Failed" };
const money = (value: number) => `$${value.toFixed(6)}`;
const number = (value: number) => value.toLocaleString();
const time = (value: string) => new Date(value).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "numeric", month: "short" });
const text = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);
const readableEvaluationText = (value: string) => value.replace(/\b(?:board|change|summary|call):[a-f0-9]{16,}\b/gi, "").replace(/\(\s*(?:[,;]\s*)*\)/g, "").replace(/\[\s*\]/g, "").replace(/\b(?:evidence|sources?)\s*:\s*(?=$|[).,;])/gi, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/\s+([)\]])/g, "$1").trim();
const asset = (agent: Persona, kind = "portrait") => `${client.base}/assets/${encodeURIComponent(agent.id)}/${kind}.svg${kind === "portrait" ? "?v=mono-transparent-1" : ""}`;

function Markdown({ children }: { children: string }) {
  return <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt || "Image omitted"}</span> }}>{children}</ReactMarkdown></div>;
}

function Portrait({ agent }: { agent: Persona }) {
  // Artwork is local, same-origin, packaged with Chorus, and already optimized SVG.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.portrait} src={asset(agent)} alt={`${agent.name} portrait`} width={48} height={60} />;
}

function Profile({ agent }: { agent: Persona }) {
  return <div className={styles.profile}><Portrait agent={agent} /><h2>{agent.name}</h2><p className={styles.eyebrow}>{agent.role}</p><p>{agent.introduction}</p><dl><dt>Personality</dt><dd>{agent.personality}</dd><dt>Traits</dt><dd>{agent.traits.join(" · ")}</dd><dt>Strengths</dt><dd>{agent.strengths}</dd><dt>Weaknesses</dt><dd>{agent.weaknesses}</dd></dl></div>;
}

function ProfileDialog({ agent, close }: { agent: Persona; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} onClose={close} aria-label={`${agent.name} profile`}><button className={styles.close} onClick={() => dialog.current?.close()}>Close profile</button><Profile agent={agent} /></dialog>;
}

function Metrics({ usage, compact = false }: { usage: Usage; compact?: boolean }) {
  const partial = (count: number) => count ? " (partial)" : "";
  return <dl className={compact ? styles.compactMetrics : styles.metrics}>
    <div><dt>Input tokens{partial(usage.unknownInputCalls)}</dt><dd>{number(usage.inputTokens)}</dd></div>
    <div><dt>Output tokens{partial(usage.unknownOutputCalls)}</dt><dd>{number(usage.outputTokens)}</dd></div>
    <div><dt>Cached tokens{partial(usage.unknownCacheCalls)}</dt><dd>{number(usage.cachedTokens)}</dd></div>
    <div><dt>Cache utilization</dt><dd>{usage.cacheUtilizationPercent === null ? "Unavailable" : `${usage.cacheUtilizationPercent.toFixed(1)}%`}</dd></div>
    <div><dt>Cache used</dt><dd>{usage.cacheUsed === null ? "Unknown" : usage.cacheUsed ? "Yes" : "No"}</dd></div>
    <div><dt>Calls</dt><dd>{usage.callCount}</dd></div>
    <div><dt>Total call time</dt><dd>{(usage.totalLatencyMs / 1000).toFixed(1)} s</dd></div>
    <div><dt>Mean / p95 latency</dt><dd>{(usage.meanLatencyMs / 1000).toFixed(2)} / {(usage.p95LatencyMs / 1000).toFixed(2)} s</dd></div>
    <div><dt>Estimated cost</dt><dd>{money(usage.estimatedCostUSD)}</dd></div>
    <div><dt>Cache coverage</dt><dd>{usage.cacheCoveredCalls}/{usage.callCount} calls</dd></div>
  </dl>;
}

function useRecords(snapshot: HarnessSnapshot, kind: string, agent?: string) {
  const [records, setRecords] = useState<HarnessRecord[]>([]);
  const [error, setError] = useState("");
  const saved = useRef<{ key: string; cursor: number; records: HarnessRecord[] }>({ key: "", cursor: 0, records: [] });
  useEffect(() => {
    let active = true;
    const key = `${snapshot.id}:${kind}:${agent || ""}`;
    const previous = saved.current.key === key && kind !== "call" ? saved.current : { key, cursor: 0, records: [] };
    async function read() {
      let cursor = previous.cursor;
      const additions: HarnessRecord[] = [];
      for (;;) {
        const page = await client.records(snapshot.id, kind, cursor, agent);
        additions.push(...page.records);
        cursor = page.cursor;
        if (!active) return;
        if (!page.hasMore) break;
      }
      if (active) {
        const merged = [...new Map([...previous.records, ...additions].map((r) => [r.id, r])).values()];
        saved.current = { key, cursor, records: merged };
        setRecords(merged);
        setError("");
      }
    }
    void read().catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Could not load records."); });
    return () => { active = false; };
  }, [snapshot.id, snapshot.revision, kind, agent]);
  return { records, error };
}

function RecordError({ message }: { message: string }) { return message ? <p role="alert">{message}</p> : null; }

function EvidenceDialog({ record, close }: { record: HarnessRecord; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} onClose={close} aria-label="Source evidence"><button className={styles.close} onClick={() => dialog.current?.close()}>Close evidence</button><h2>{record.kind === "board" ? "Message board post" : record.kind === "change" ? "Canvas change" : record.kind === "summary" ? "Reasoning summary" : "Supporting record"}</h2><p className={styles.muted}>Turn {record.turn} · {time(record.createdAt)}</p>{record.kind === "board" ? <p>{text(record.data.text)}</p> : record.kind === "change" ? <><p>{text(record.data.reason)}</p><pre className={styles.evidenceText}>{text(record.data.diff)}</pre></> : <pre className={styles.evidenceText}>{JSON.stringify(record.data, null, 2)}</pre>}</dialog>;
}

function EvidenceLinks({ snapshot, ids }: { snapshot: HarnessSnapshot; ids: string[] }) {
  const [record, setRecord] = useState<HarnessRecord | null>(null);
  const [error, setError] = useState("");
  async function open(id: string) { try { setRecord(await client.record(snapshot.id, id)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load source evidence."); } }
  return <div className={styles.evidenceLinks}>{ids.length > 0 && <span className={styles.evidenceLabel}>Supporting records:</span>}{ids.map((id, index) => <button key={id} onClick={() => void open(id)} aria-label={`Open supporting record ${index + 1}`}>Source {index + 1}</button>)}<RecordError message={error} />{record && <EvidenceDialog key={record.id} record={record} close={() => setRecord(null)} />}</div>;
}

function Board({ snapshot, select }: { snapshot: HarnessSnapshot; select: (id: string) => void }) {
  const { records, error } = useRecords(snapshot, "board");
  function mentions(content: string): ReactNode[] {
    return content.split(/(@[A-Za-z]+)/g).map((part, index) => {
      const agent = part.startsWith("@") ? snapshot.agents.find((a) => a.name === part.slice(1)) : undefined;
      return agent ? <button className={styles.mention} key={index} onClick={() => select(agent.id)}>{part}</button> : part;
    });
  }
  return <section className={styles.panel} aria-labelledby="board-heading"><div className={styles.panelHeading}><h2 id="board-heading">Message board</h2><small>{snapshot.boardCount} posts · one level</small></div><p className={styles.muted}>One or two sentences per post. Agents can address a peer with @Name.</p><RecordError message={error} />
    <div className={styles.feed}>{[...records].sort((a, b) => b.sequence - a.sequence).map((record) => <article key={record.id} id={record.id} className={styles.post}><div><button className={styles.nameLink} onClick={() => select(record.agentId)}>{snapshot.agents.find((a) => a.id === record.agentId)?.name || record.agentId}</button><small>Turn {record.turn} · {time(record.createdAt)}</small></div><p>{mentions(text(record.data.text))}</p></article>)}{!records.length && <p className={styles.empty}>Contributions will appear here as agents begin.</p>}</div>
  </section>;
}

function Changes({ snapshot }: { snapshot: HarnessSnapshot }) {
  const { records, error } = useRecords(snapshot, "change");
  return <section className={styles.panel}><div className={styles.panelHeading}><h2>Canvas changelog</h2><small>{snapshot.changeCount} accepted changes</small></div><RecordError message={error} />{records.map((record) => <details className={styles.change} key={record.id} id={record.id}><summary>{snapshot.agents.find((a) => a.id === record.agentId)?.name} · v{text(record.data.beforeVersion)} → v{text(record.data.afterVersion)}<small>{time(record.createdAt)}</small></summary><p>{text(record.data.reason)}</p><pre>{text(record.data.diff)}</pre><small>Change {record.id}</small></details>)}{!records.length && <p className={styles.empty}>Accepted edits appear here with their author and diff.</p>}</section>;
}

function AgentInspector({ snapshot, agent, usage, close }: { snapshot: HarnessSnapshot; agent: Persona; usage?: Usage; close: () => void }) {
  const [tab, setTab] = useState("profile");
  const { records, error } = useRecords(snapshot, tab === "summaries" ? "summary" : tab === "calls" ? "call" : "conversation", agent.id);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} onClose={close} aria-label={`${agent.name} details`}><button className={styles.close} onClick={() => dialog.current?.close()}>Close</button><div className={styles.tabs} role="tablist" aria-label="Agent details">{["profile", "summaries", "conversation", "calls"].map((name) => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name === "summaries" ? "Reasoning summaries" : name[0].toUpperCase() + name.slice(1)}</button>)}</div>
    {tab === "profile" ? <><Profile agent={agent} />{usage && <Metrics usage={usage} compact />}</> : <><h2>{agent.name} · {tab === "summaries" ? "Reasoning summaries" : tab}</h2><RecordError message={error} />{records.map((record) => <article className={styles.inspection} key={record.id} id={record.id}><small>Turn {record.turn} · {time(record.createdAt)}</small>{tab === "summaries" ? <>{record.data.status === "unavailable" ? <p>Summary unavailable.</p> : <dl>{["approach", "assumptions", "decision", "uncertainties"].map((key) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(record.data[key]) ? (record.data[key] as unknown[]).map((value) => readableEvaluationText(text(value))).filter(Boolean).join(" · ") || "None stated" : readableEvaluationText(text(record.data[key]))}</dd></div>)}</dl>}{Array.isArray(record.data.evidenceRefs) && <EvidenceLinks snapshot={snapshot} ids={(record.data.evidenceRefs as unknown[]).filter((value): value is string => typeof value === "string")} />}</> : tab === "calls" ? <><strong>{text(record.data.phase)} · {text(record.data.outcome)}</strong><dl className={styles.compactMetrics}>{["model", "inputTokens", "outputTokens", "cachedTokens", "cacheUsed", "cacheUtilizationPercent", "latencyMs", "costUSD", "costSource", "requestId"].map((key) => <div key={key}><dt>{key}</dt><dd>{record.data[key] === null || record.data[key] === undefined ? "Unavailable" : text(record.data[key])}</dd></div>)}</dl><details><summary>Call record and price basis</summary><pre>{JSON.stringify(record.data, null, 2)}</pre></details></> : <><strong>{text((record.data.message as Record<string, unknown>)?.role)}</strong><pre>{JSON.stringify(record.data.message, null, 2)}</pre></>}</article>)}{!records.length && <p className={styles.empty}>No saved {tab} yet.</p>}</>}
  </dialog>;
}

function Scene({ snapshot, select }: { snapshot: HarnessSnapshot; select: (id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  return <section className={styles.scenePanel} aria-labelledby="scene-heading"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Nanoville research commons</p><h2 id="scene-heading">{snapshot.agents.length} independent minds</h2></div><label>Scene zoom <input aria-label="Scene zoom" type="range" min="0.65" max="1.5" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label></div><p className={styles.muted}>Pan the commons to explore. Select anyone here or in the roster to inspect their work.</p><div className={styles.sceneViewport}><div className={styles.scene} style={{ width: `${Math.max(720, Math.min(snapshot.agents.length, 10) * 118) * zoom}px` }}>
    {snapshot.agents.map((agent, index) => {
      const worker = snapshot.workers.find((w) => w.agentId === agent.id)!;
      const editing = snapshot.lease?.agentId === agent.id;
      const active = snapshot.status === "running" && worker.state === "running";
      const animation = editing ? styles.editing : active ? styles.working : styles.idle;
      const paused = snapshot.status !== "running" || ["paused", "finished", "capped", "failed"].includes(worker.state);
      return <button key={agent.id} className={`${styles.character} ${editing ? styles.lockHolder : ""}`} style={{ minHeight: `${128 * zoom}px` }} onClick={() => select(agent.id)} aria-label={`${agent.name}, ${editing ? "editing canvas" : labels[worker.state]}, turn ${worker.currentTurnIndex} of ${snapshot.config.maxTurnsPerAgent}`}><span className={styles.deskNumber}>{String(index + 1).padStart(2, "0")}</span><span role="img" aria-label={`${agent.name} animated sprite`} className={`${styles.sprite} ${animation} ${paused ? styles.still : ""}`} style={{ backgroundImage: `url("${asset(agent, "sprite")}")`, transform: `scale(${zoom})` } as CSSProperties} /><strong>{agent.name}</strong><small>{editing ? "Editing canvas" : labels[worker.state]}</small></button>;
    })}
  </div></div></section>;
}

function ScoreBreakdown({ scores, criteria, label }: { scores: number[]; criteria: string[]; label: string }) {
  return <div className={styles.scoreBreakdown} aria-label={label}>
    {scores.map((score, index) => <div className={styles.scoreRow} key={`${criteria[index]}-${index}`}>
      <span className={styles.scoreLabel}>{criteria[index] || `Criterion ${index + 1}`}</span>
      <div className={styles.scoreTrack} role="img" aria-label={`${criteria[index] || `Criterion ${index + 1}`}: ${score} out of 4`}>
        <span style={{ width: `${Math.max(0, Math.min(4, score)) * 25}%` }} />
      </div>
      <strong className={styles.scoreValue}>{score}<span>/4</span></strong>
    </div>)}
  </div>;
}

function Report({ snapshot }: { snapshot: HarnessSnapshot }) {
  const report = snapshot.report;
  const teamCriteria = ["Evidence quality", "Relevance", "Coordination", "Handling disagreement", "Actionable synthesis"];
  const agentCriteria = ["Useful contribution", "Technical accuracy", "Collaboration", "Stated reasoning summary", "Response to corrections"];
  const totalConversationScore = report?.conversationScores.reduce((total, score) => total + score, 0) ?? 0;
  return <section className={`${styles.panel} ${styles.evaluation}`} aria-labelledby="evaluation-heading">
    <div className={styles.evaluationHeader}><div><p className={styles.eyebrow}>Session results</p><h2 id="evaluation-heading">Final evaluation</h2></div><small>{snapshot.endedEarly ? "Stopped early" : "Final results"}</small></div>
    {snapshot.verification ? <div className={`${styles.verdict} ${snapshot.verification.status === "correct" ? styles.correct : ""}`}><div><small>Solution check</small><strong>Solution {snapshot.verification.status}</strong></div><p>{snapshot.verification.checks.join(" ")}</p><small>Automatic check · Canvas version {snapshot.verification.canvasVersion}</small></div> : <p className={styles.empty}>Solution checks and judging appear after all agents finish.</p>}
    {report ? <>
      <section className={styles.evaluationSummary} aria-labelledby="evaluation-summary-heading"><div className={styles.evaluationSectionHeading}><div><p className={styles.eyebrow}>Judge summary</p><h3 id="evaluation-summary-heading">What the team achieved</h3></div></div><p className={styles.summaryText}>{readableEvaluationText(report.summary)}</p></section>
      <section className={styles.conversationEvaluation} aria-labelledby="conversation-evaluation-heading">
        <div className={styles.evaluationSectionHeading}><div><p className={styles.eyebrow}>Team-level assessment</p><h3 id="conversation-evaluation-heading">Collaboration</h3><p className={styles.muted}>How well the team worked together on the message board.</p></div><div className={styles.totalScore}><strong>{totalConversationScore}<span>/20</span></strong><small>team score</small></div></div>
        <ScoreBreakdown scores={report.conversationScores} criteria={teamCriteria} label="Team collaboration scores" />
        <p className={styles.explanation}>{readableEvaluationText(report.conversationExplanation)}</p>
        <EvidenceLinks snapshot={snapshot} ids={report.conversationEvidenceIds} />
      </section>
      <section className={styles.agentEvaluations} aria-labelledby="agent-evaluations-heading">
        <div className={styles.evaluationSectionHeading}><div><p className={styles.eyebrow}>Individual assessment</p><h3 id="agent-evaluations-heading">Agent evaluations</h3><p className={styles.muted}>Open an agent to see their rubric scores, explanation, and supporting records.</p></div><small>{report.agents.length} agents</small></div>
        <div className={styles.agentEvaluationList}>{report.agents.map((grade) => {
          const agent = snapshot.agents.find((item) => item.id === grade.agentId);
          const total = grade.scores.reduce((sum, score) => sum + score, 0);
          return <details className={styles.agentEvaluation} key={grade.agentId}>
            <summary><span className={styles.agentEvaluationName}>{agent?.name || grade.agentId}</span><span className={styles.agentEvaluationBadges}>{grade.insufficientEvidence && <span className={styles.limitedEvidence}>Limited evidence</span>}<span className={styles.agentTotal}>{total}<small>/20</small></span></span></summary>
            <div className={styles.agentEvaluationBody}><ScoreBreakdown scores={grade.scores} criteria={agentCriteria} label={`${agent?.name || grade.agentId} evaluation scores`} /><p className={styles.explanation}>{readableEvaluationText(grade.explanation)}</p><EvidenceLinks snapshot={snapshot} ids={grade.evidenceIds} /></div>
          </details>;
        })}</div>
      </section>
      <div className={styles.evaluationFooter}><span>{report.coveredRecordIds.length} source records reviewed</span><span>Completed {time(report.completedAt)}</span></div>
    </> : snapshot.status === "reviewing" || snapshot.frozenSequence !== null ? <p role="status" className={styles.pendingEvaluation}>{snapshot.config.judgeEnabled ? "Judge report pending. Saved progress will be reused on retry." : "Narrative judge disabled for this run."}</p> : null}
  </section>;
}

function LiveSession({ snapshot, receive, mode, leave }: { snapshot: HarnessSnapshot; receive: (s: HarnessSnapshot) => void; mode: "chorus" | "nanoville"; leave: () => void }) {
  const [usage, setUsage] = useState<HarnessUsage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => client.subscribe(snapshot.id, -1, receive, setError), [snapshot.id, receive]); // latest revision is recovered on connect
  useEffect(() => {
    let active = true;
    void client.usage(snapshot.id).then((value) => { if (active) setUsage(value); }).catch((error: unknown) => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [snapshot.id, snapshot.revision]);
  async function act(action: "start" | "pause" | "resume" | "stop") {
    setBusy(true); setError("");
    try { receive(await client.command(snapshot.id, action)); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "Command failed."); return false; }
    finally { setBusy(false); }
  }
  const agent = snapshot.agents.find((a) => a.id === selected);
  const active = snapshot.status === "running" || snapshot.status === "reviewing";
  return <>
    <div className={styles.sessionTitle}><div><p className={styles.eyebrow}>Session {snapshot.id.slice(0, 8)} · {snapshot.config.model}</p><h1>{snapshot.problem.title}</h1><p>{snapshot.status} · {snapshot.agents.length} agents · {snapshot.config.maxTurnsPerAgent} turns per agent</p></div><div className={styles.actions}>{snapshot.status === "ready" && <button disabled={busy} onClick={() => void act("start")}>Start session</button>}{active && <button disabled={busy} onClick={() => void act("pause")}>Pause</button>}{snapshot.status === "paused" && <button disabled={busy} onClick={() => void act("resume")}>Resume</button>}{!["completed", "stopped"].includes(snapshot.status) && !snapshot.endedEarly && <button disabled={busy} onClick={() => void act("stop")}>Stop and evaluate</button>}<button disabled={busy} onClick={() => { if (active) { void act("pause").then((ok) => { if (ok) leave(); }); } else leave(); }}>Back to setup</button></div></div>
    <RecordError message={error || snapshot.error} />
    {usage && <section className={styles.topMetrics} aria-label="Session totals"><p className={styles.eyebrow}>Participant totals · {snapshot.agents.length} agents</p><Metrics usage={usage.participants} /><div className={styles.costFooter}><span>Judge: {money(usage.judge.reportedCostUSD + usage.judge.estimatedCostUSD)}</span><span>Session: {money(usage.total.reportedCostUSD + usage.total.estimatedCostUSD)}{usage.total.estimatedCostUSD > 0 ? " including estimates" : ""}</span><span>Wall time: {(usage.wallTimeMs / 1000).toFixed(0)} s</span></div></section>}
    {mode === "nanoville" && <Scene snapshot={snapshot} select={setSelected} />}
    <section className={styles.roster}><div className={styles.panelHeading}><h2>Participants</h2></div><div className={styles.liveRoster}>{snapshot.agents.map((agent) => {
      const worker = snapshot.workers.find((w) => w.agentId === agent.id)!;
      const totals = usage?.agents[agent.id];
      return <button key={agent.id} className={styles.agentRow} onClick={() => setSelected(agent.id)}><Portrait agent={agent} /><span><strong>{agent.name}</strong><small>{snapshot.lease?.agentId === agent.id ? "Editing canvas" : labels[worker.state]}</small><small>Turn {worker.currentTurnIndex} / {snapshot.config.maxTurnsPerAgent} · {worker.turnsCompleted} completed</small><progress aria-label={`${agent.name} turn progress`} max={snapshot.config.maxTurnsPerAgent} value={worker.turnsCompleted} />{totals && <small>{number(totals.inputTokens)} in · {number(totals.outputTokens)} out · {money(totals.reportedCostUSD + totals.estimatedCostUSD)}</small>}</span></button>;
    })}</div></section>
    <div className={styles.workGrid}><Board snapshot={snapshot} select={setSelected} /><section className={styles.panel}><div className={styles.panelHeading}><h2>Shared canvas</h2><small>v{snapshot.canvasVersion} · {snapshot.lease ? `${snapshot.agents.find((a) => a.id === snapshot.lease?.agentId)?.name} holds the lock` : "Lock available"}</small></div>{snapshot.canvas ? <Markdown>{snapshot.canvas}</Markdown> : <p className={styles.empty}>The team will build its combined solution here.</p>}<div className={styles.actions}><a href={`${client.base}/sessions/${snapshot.id}/export?format=markdown`} download>Export canvas</a><a href={`${client.base}/sessions/${snapshot.id}/export`} download>Export complete session</a></div></section></div>
    <Changes snapshot={snapshot} /><Report snapshot={snapshot} />
    {agent && <AgentInspector key={agent.id} snapshot={snapshot} agent={agent} usage={usage?.agents[agent.id]} close={() => setSelected(null)} />}
  </>;
}

function LegacyArchive({ id }: { id: string }) {
  const [value, setValue] = useState<LegacySnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void legacyClient.get(id).then((v) => { if (active) setValue(v); }).catch((e: unknown) => { if (active) setError(String(e)); }); return () => { active = false; }; }, [id]);
  return <section className={styles.panel}><p className={styles.eyebrow}>Historical session · read only</p><RecordError message={error} />{value ? <><h1>{value.scenario.title}</h1><Markdown>{value.canvas}</Markdown><h2>Conversation</h2>{value.turns.map((turn, i) => <p key={i}><strong>{turn.speakerName}</strong> {turn.text}</p>)}<a href={`/api/chorus/sessions/${encodeURIComponent(id)}/export?format=json&includeJournals=true`} download>Export archived session with journals</a></> : !error && <p>Loading saved session…</p>}<p><Link href="/">Start a new harness session</Link></p></section>;
}

export function ArchiveBrowser() {
  const [sessions, setSessions] = useState<LegacySnapshot[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void legacyClient.list().then((value) => { if (active) setSessions(value); }).catch((e: unknown) => { if (active) setError(String(e)); }); return () => { active = false; }; }, []);
  return <main className={styles.app}><header className={styles.header}><Link href="/" className={styles.brand}>The Chorus Project<span>Start a new harness session</span></Link></header><div className={styles.intro}><h1>Saved sessions</h1><p>Historical work remains readable and exportable under its original semantics.</p></div><RecordError message={error} />{sessions.map((session) => <article className={styles.panel} key={session.id}><h2><Link href={`/?session=${session.id}`}>{session.scenario.title}</Link></h2><p>{time(session.createdAt)} · {session.agents.length} participants · {session.status}</p><small>{session.id}</small></article>)}</main>;
}

export function HarnessApp({ mode = "chorus" }: { mode?: "chorus" | "nanoville" }) {
  const [catalog, setCatalog] = useState<HarnessCatalog | null>(null);
  const [problemId, setProblemId] = useState("");
  const [roster, setRoster] = useState<string[]>([]);
  const [adversaries, setAdversaries] = useState<string[]>([]);
  const [model, setModel] = useState("gpt-6-luna");
  const [cap, setCap] = useState(10);
  const [judge, setJudge] = useState(true);
  const [profile, setProfile] = useState<string | null>(null);
  const [agentCategory, setAgentCategory] = useState("All");
  const [snapshot, setSnapshot] = useState<HarnessSnapshot | null>(null);
  const [legacyId, setLegacyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const latest = useRef<HarnessSnapshot | null>(null);
  const receive = useCallback((next: HarnessSnapshot) => {
    if (latest.current && (next.id !== latest.current.id || next.revision <= latest.current.revision)) return;
    latest.current = next;
    setSnapshot(next);
    localStorage.setItem(storageKey, next.id);
  }, []);
  useEffect(() => {
    let active = true;
    void client.catalog().then((value) => { if (active) { setCatalog(value); setProblemId(value.problems[0].id); setRoster(value.problems[0].participantIds); setModel(value.defaultModel); } }).catch((e: unknown) => { if (active) setError(String(e)); });
    const id = new URLSearchParams(window.location.search).get("session") || localStorage.getItem(storageKey);
    if (id) { void client.get(id).then((next) => { if (active) receive(next); }).catch((e: unknown) => { if (active) { if (e instanceof HarnessError && e.code === "NOT_FOUND") setLegacyId(id); else setError(String(e)); } }).finally(() => { if (active) setRestoring(false); }); }
    else { queueMicrotask(() => { if (active) setRestoring(false); }); }
    return () => { active = false; };
  }, [receive]);
  async function start() {
    if (!catalog) return;
    setBusy(true); setError("");
    try {
      const created = await client.create({ problemId, participantIds: roster, adversaryIds: adversaries, model, maxTurnsPerAgent: cap, judgeEnabled: judge, maxCallsPerTurn: 8, maxToolsPerTurn: 16, maxPostsPerTurn: 3, leaseSeconds: 30, maxLeaseHoldSeconds: 120 });
      receive(created);
      receive(await client.command(created.id, "start"));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the session."); }
    finally { setBusy(false); }
  }
  function leave() { setSnapshot(null); latest.current = null; localStorage.removeItem(storageKey); const url = new URL(window.location.href); url.searchParams.delete("session"); window.history.replaceState({}, "", url); }
  const problem = catalog?.problems.find((p) => p.id === problemId);
  const selectedModel = catalog?.models.find((m) => m.id === model);
  const inspected = catalog?.agents.find((a) => a.id === profile);
  const agentCategories = catalog ? ["All", ...Array.from(new Set(catalog.agents.map((agent) => agent.domain).filter(Boolean))).sort()] : [];
  return <main className={styles.app}><header className={styles.header}><Link href="/" className={styles.brand}>{mode === "nanoville" ? "nanoville" : "The Chorus Project"}</Link></header>
    {legacyId ? <LegacyArchive id={legacyId} /> : snapshot ? <LiveSession key={snapshot.id} snapshot={snapshot} receive={receive} mode={mode} leave={leave} /> : <><div className={styles.intro}><h1>Set up an experiment</h1><p>Choose a problem, assemble a team, and watch independent agents discuss, revise, and build a shared solution.</p></div><RecordError message={error} />{!catalog || restoring ? <p role="status">Connecting to Chorus…</p> : <div className={styles.setup}><section className={styles.configuration}><h2>01 · Choose a problem</h2><label className={styles.field}>Problem<select value={problemId} onChange={(e) => { const p = catalog.problems.find((p) => p.id === e.target.value)!; setProblemId(p.id); setRoster(p.participantIds); setAdversaries([]); }} aria-label="Problem">{catalog.problems.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>{problem && <><p className={styles.eyebrow}>{problem.domain}</p><details open><summary>Problem statement</summary><pre className={styles.statement}>{problem.statement}</pre></details></>}<h2>02 · Set the run</h2><label className={styles.field}>Model<select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>{catalog.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.available === false ? " · unavailable" : ""}</option>)}</select></label>{selectedModel?.available === false && <p role="status" className={styles.warning}>{selectedModel.unavailableReason}</p>}{selectedModel?.compatibilityNote && <p role="status" className={styles.warning}>{selectedModel.compatibilityNote}</p>}<label className={styles.field}>Turns per agent<input type="number" aria-label="Turns per agent" min={1} max={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></label><label className={styles.check}><input type="checkbox" checked={judge} onChange={(e) => setJudge(e.target.checked)} /> Final judge</label><p className={styles.muted}>Agents run independently. Judging starts when everyone has finished or reached their cap.</p><div className={styles.startBox}><strong>{roster.length} agents × {cap} turns</strong><p>At most {roster.length * cap} contribution cycles.</p><button className={styles.primary} disabled={busy || roster.length < 2 || roster.length > 50 || !Number.isInteger(cap) || cap < 1 || cap > 100 || selectedModel?.available === false} onClick={() => void start()}>{busy ? "Starting…" : "Start session"}</button><small>{roster.length < 2 ? "Select at least two agents." : "A cycle can include up to three concise board posts."}</small></div></section><section><div className={styles.panelHeading}><div><h2>03 · Your team</h2><p className={styles.muted}>Relevant agents are selected for you. Add or remove anyone.</p></div><strong>{roster.length} selected</strong></div><div className={styles.categoryGroup} role="group" aria-label="Filter agents by category">{agentCategories.map((category) => <button type="button" key={category} aria-pressed={agentCategory === category} className={agentCategory === category ? styles.categoryActive : ""} onClick={() => setAgentCategory(category)}>{category}</button>)}</div><div className={styles.catalogGrid}>{catalog.agents.filter((agent) => agentCategory === "All" || agent.domain === agentCategory).map((agent) => <article className={`${styles.personaCard} ${roster.includes(agent.id) ? styles.selected : ""}`} key={agent.id} role="button" tabIndex={0} aria-label={`View ${agent.name} profile`} onClick={(event) => { if ((event.target as HTMLElement).closest("input, label")) return; setProfile(agent.id); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !(event.target as HTMLElement).closest("input, label")) { event.preventDefault(); setProfile(agent.id); } }}><div className={styles.personaSelect}><input type="checkbox" aria-label={`Select ${agent.name}`} checked={roster.includes(agent.id)} onChange={(e) => { setRoster(e.target.checked ? [...roster, agent.id] : roster.filter((id) => id !== agent.id)); if (!e.target.checked) setAdversaries(adversaries.filter((id) => id !== agent.id)); }} /><Portrait agent={agent} /><span><strong>{agent.name}</strong><small>{agent.role}</small></span></div>{roster.includes(agent.id) && <label className={styles.adversary}><input type="checkbox" aria-label={`${agent.name} private adversary`} checked={adversaries.includes(agent.id)} onChange={(e) => setAdversaries(e.target.checked ? [...adversaries, agent.id] : adversaries.filter((id) => id !== agent.id))} /> Private adversary</label>}</article>)}</div>{inspected && <ProfileDialog agent={inspected} close={() => setProfile(null)} /> }</section></div>}</>}
  </main>;
}
