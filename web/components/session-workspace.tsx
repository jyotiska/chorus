"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ChorusClient, type Catalog, type Journal, type Snapshot } from "@/lib/api/chorus/client";
import { UsageDetails } from "@/lib/api/chorus/usage-view";
import styles from "./session-workspace.module.css";

type Agent = Snapshot["agents"][number];
type Change = Snapshot["turns"][number]["statChanges"][number];
type Popup = Change & { key: string };
const client = new ChorusClient();
const signed = (value: number) => value > 0 ? `+${value}` : String(value);
const displayName = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2");

export function AgentState({ agent }: { agent: Agent }) {
  return <div className={styles.agentState}>
    <p>{agent.personality.socialStyle} · {agent.personality.challengeResponse === "sensitive" ? "Non-confrontational" : agent.personality.challengeResponse === "resilient" ? "Resilient under challenge" : "Balanced under challenge"}</p>
    <dl className={styles.meters}>
      <div><dt>Energy</dt><dd>{agent.energy} / 100<meter aria-label={`${displayName(agent.name)} energy`} min={0} max={100} low={30} value={agent.energy} /></dd></div>
      <div><dt>Confidence</dt><dd>{agent.confidence} / 100<meter aria-label={`${displayName(agent.name)} confidence`} min={0} max={100} low={35} value={agent.confidence} /></dd></div>
    </dl>
  </div>;
}

function useStatChanges(snapshot: Snapshot) {
  const seen = useRef({ id: snapshot.id, count: snapshot.turns.length });
  const frames = useRef(new Set<number>());
  const [popups, setPopups] = useState<Popup[]>([]);
  useEffect(() => () => { frames.current.forEach(cancelAnimationFrame); }, []);
  useEffect(() => {
    const previous = seen.current;
    seen.current = { id: snapshot.id, count: snapshot.turns.length };
    // Restores and duplicate snapshots display current values without replaying history.
    if (previous.id !== snapshot.id || snapshot.turns.length <= previous.count) return;
    const additions = snapshot.turns.slice(previous.count).flatMap((turn) => turn.statChanges
      .filter((change) => change.energy !== 0 || change.confidence !== 0)
      .map((change) => ({ ...change, key: `${snapshot.id}:${turn.turnNumber}:${change.agentId}` })));
    if (!additions.length) return;
    const frame = requestAnimationFrame(() => {
      frames.current.delete(frame);
      // Fast runs can commit several turns before an effect expires. Keep the latest
      // badge per participant; the full change history remains in the saved turns.
      setPopups((current) => Array.from(new Map([...current, ...additions].map((popup) => [popup.agentId, popup])).values()));
    });
    frames.current.add(frame);
  }, [snapshot.id, snapshot.turns]);
  return { popups, dismiss: (key: string) => setPopups((current) => current.filter((item) => item.key !== key)) };
}

function StatPopup({ popup, dismiss }: { popup: Popup; dismiss: (key: string) => void }) {
  const onDismiss = useRef(dismiss);
  useEffect(() => { onDismiss.current = dismiss; }, [dismiss]);
  useEffect(() => {
    const timer = setTimeout(() => onDismiss.current(popup.key), 2800);
    return () => clearTimeout(timer);
  }, [popup.key]);
  return <span className={styles.statPopup} title={popup.reasons.join(" · ")}>
    {popup.energy !== 0 && <span>{signed(popup.energy)} energy</span>}
    {popup.confidence !== 0 && <span>{signed(popup.confidence)} confidence</span>}
  </span>;
}

function ObserverJournal({ id, revision, agent }: { id: string; revision: number; agent: Agent }) {
  const [result, setResult] = useState<{ id: string; revision: number; attempt: number; entries: Journal[]; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void client.journals(id).then((entries) => {
      if (active) setResult({ id, revision, attempt, entries });
    }).catch(() => {
      if (active) setResult({ id, revision, attempt, entries: [], error: "Cannot load observer journals. Public work is still available." });
    });
    return () => { active = false; };
  }, [id, revision, attempt]);
  const current = result?.id === id ? result : null;
  const entries = current?.entries.filter((entry) => entry.agentId === agent.id).toReversed() ?? [];
  const loading = !current || current.revision !== revision || current.attempt !== attempt;
  return <section aria-label={`${displayName(agent.name)} observer journal`} className={styles.journal}>
    <h3>Observer journal</h3>
    <p className={styles.muted}>Private reflections, visible to the observer only. They are not sent to other participants or the judge.</p>
    {loading && <p role="status">Loading journal…</p>}
    {!loading && current?.error && <><p role="alert">{current.error}</p><Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>Retry journal</Button></>}
    {!loading && !current?.error && entries.length === 0 && <p>No journal entries yet. Entries appear after this agent contributes.</p>}
    {entries.map((entry) => <article key={`${entry.agentId}:${entry.turnNumber}`} className={styles.journalEntry}>
      <h4>Turn {entry.turnNumber}</h4>
      <p>{entry.text ?? "Journal unavailable for this turn. The public contribution was preserved."}</p>
    </article>)}
  </section>;
}

function FinalJudgement({ snapshot, blocked }: { snapshot: Snapshot; blocked: boolean }) {
  const review = snapshot.finalJudgement;
  function criterionLabel(criterion: string) {
    if (criterion === "Expected deliverable") return snapshot.scenario.deliverable;
    const match = /^Guideline (\d+)$/.exec(criterion);
    return match ? snapshot.scenario.guidelines[Number(match[1]) - 1] ?? criterion : criterion;
  }
  return <section aria-label="Final judge judgement" className={styles.judgement}>
    <div className={styles.panelHead}><h2>Final judgement</h2><span>{snapshot.endedEarly ? "Early-stop review" : "Turn-limit review"}</span></div>
    <div className={styles.panelBody}>
      {review ? <>
        <strong className={styles.verdict}>{review.verdict}</strong><p>{review.summary}</p>
        <UsageDetails details={snapshot.finalUsageDetails} className={styles.usageMetadata} />
        <h3>Requirements assessment</h3>
        <dl className={styles.requirements}>{review.requirements.map((item) => <div key={item.criterion}>
          <dt>{criterionLabel(item.criterion)}<span>{item.status}</span></dt><dd>{item.evidence}</dd>
        </div>)}</dl>
        {([["Strengths", review.strengths], ["Improvements", review.improvements], ["Next priorities", review.nextPriorities]] as const).map(([title, items]) => <div key={title}><h3>{title}</h3><ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}
        <h3>Response to feedback</h3><p>{review.feedbackResponse}</p>
      </> : <p role="status">{snapshot.status === "paused" ? blocked ? "Final review cannot resume with this configuration. Your document is preserved." : "Final review paused. Resume to retry; your document is preserved." : "The judge is reviewing the committed discussion and final canvas…"}</p>}
    </div>
  </section>;
}

export function SessionWorkspace({ snapshot, catalog, busy, error, errorCode, onControl }: {
  snapshot: Snapshot; catalog: Catalog; busy: boolean; error: string | null; errorCode?: string | null;
  onControl: (action: "start" | "pause" | "resume" | "stop") => Promise<void>;
}) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const inspectedAgent = snapshot.agents.find((agent) => agent.id === inspectedId);
  const { popups, dismiss } = useStatChanges(snapshot);
  const logRef = useRef<HTMLDivElement>(null);
  const followLog = useRef(true);
  const completedTurns = snapshot.turns.filter((turn) => turn.kind !== "judge").length;
  const skippedTurns = snapshot.turns.filter((turn) => turn.kind === "skipped").length;
  const reviews = snapshot.turns.filter((turn) => turn.kind === "judge").length;
  const finalReviewDue = snapshot.config.judgeEnabled && (snapshot.endedEarly || completedTurns >= snapshot.config.maxTurns);
  const retiredModel = !catalog.models.some((model) => model.id === snapshot.config.model);
  const blocked = retiredModel || errorCode === "CONTEXT_LIMIT" || errorCode === "VERSION_MISMATCH";
  const finished = snapshot.status === "completed" || snapshot.status === "stopped";
  const running = snapshot.status === "running" || snapshot.status === "reviewing";
  const activeAgent = snapshot.pending?.kind === "turn" ? snapshot.agents.find((agent) => agent.id === snapshot.pending?.speakerId) : null;
  const modelLabel = catalog.models.find((model) => model.id === snapshot.config.model)?.label ?? snapshot.config.model;

  useEffect(() => {
    if (logRef.current && followLog.current) logRef.current.scrollTop = 0;
  }, [snapshot.turns]);

  return <>
    <nav aria-label="Session controls" className={styles.toolbar}>
      <Button disabled={busy || finished || ((snapshot.status === "paused" || snapshot.status === "ready") && blocked)} onClick={() => void onControl(snapshot.status === "ready" ? "start" : snapshot.status === "paused" ? "resume" : "pause")}>{snapshot.status === "ready" ? "Start" : snapshot.status === "paused" ? "Resume" : "Pause"}</Button>
      <Button variant="outline" disabled={busy || finished || finalReviewDue || (retiredModel && snapshot.config.judgeEnabled)} onClick={() => void onControl("stop")}>Stop</Button>
      <a href={`/api/chorus/sessions/${snapshot.id}/export`}>Export canvas</a>
      <span role="status" className={styles.sessionStatus}>{snapshot.status === "reviewing" ? "Judge reviewing…" : snapshot.status === "ready" ? "Ready" : snapshot.status.charAt(0).toUpperCase() + snapshot.status.slice(1)}</span>
    </nav>
    {retiredModel && <p role="alert" className={styles.notice}>This session uses a retired model. Its saved work remains available; choose New simulation to start with a current model.</p>}
    {error && <div role="alert" className={styles.notice}><p>{error}</p>{blocked && !retiredModel && <p>Your saved work remains available. Start a new simulation{errorCode === "CONTEXT_LIMIT" ? " with fewer turns" : " with the current engine"}.</p>}</div>}
    {snapshot.config.adversaryIds.length > 0 && <p className={styles.notice}>Observer only · Adversaries: {snapshot.agents.filter((agent) => snapshot.config.adversaryIds.includes(agent.id)).map((agent) => displayName(agent.name)).join(", ")}. Assignments are fixed for this session and hidden from participants and the judge.</p>}
    <div className={styles.workspace}>
      <aside aria-label="Participants" className={styles.participants}>
        <div className={styles.panelHead}><h2>Participants</h2><span>{snapshot.agents.length + Number(snapshot.config.judgeEnabled)}</span></div>
        <ul className={styles.participantList}>{snapshot.agents.map((agent) => <li key={agent.id}>
          <button type="button" className={styles.participant} aria-label={`Inspect ${displayName(agent.name)}`} aria-expanded={inspectedId === agent.id} aria-controls="agent-profile" onClick={() => { setInspectedId((id) => id === agent.id ? null : agent.id); setJournalOpen(false); }}>
            <strong>{displayName(agent.name)}</strong><span>{activeAgent?.id === agent.id ? "Speaking…" : agent.role}</span>
            <span>Energy {agent.energy} · Confidence {agent.confidence}</span>
          </button>
          <div className={styles.popups} aria-live="polite">{popups.filter((popup) => popup.agentId === agent.id).map((popup) => <StatPopup key={popup.key} popup={popup} dismiss={dismiss} />)}</div>
        </li>)}</ul>
        {snapshot.config.judgeEnabled && <p className={styles.judgeLabel}>Judge · {snapshot.pending?.kind === "checkpoint" || snapshot.pending?.kind === "final" ? "Reviewing…" : "Progress reviewer"}</p>}
        {inspectedAgent && <section id="agent-profile" aria-label={`${displayName(inspectedAgent.name)} profile`} className={styles.profile}>
          <h3>{displayName(inspectedAgent.name)}</h3><p>{inspectedAgent.description}</p>
          <ul className={styles.traits}>{inspectedAgent.traits.map((trait) => <li key={trait}>{trait}</li>)}</ul>
          {snapshot.config.adversaryIds.includes(inspectedAgent.id) && <p>Adversary · Observer only. Displayed traits and stat rules remain the baseline.</p>}
          <p>Mood: {inspectedAgent.mood}</p><AgentState agent={inspectedAgent} />
          <LatestChange snapshot={snapshot} agent={inspectedAgent} />
          <p className={styles.muted}>These values describe the simulation, not a model’s internal feelings.</p>
          <Button variant="outline" aria-expanded={journalOpen} onClick={() => setJournalOpen((open) => !open)}>{journalOpen ? "Hide observer journal" : "View observer journal"}</Button>
          {journalOpen && <ObserverJournal key={snapshot.id} id={snapshot.id} revision={snapshot.revision} agent={inspectedAgent} />}
        </section>}
      </aside>
      <section aria-label="Discussion" className={styles.discussion}>
        <div className={styles.panelHead}>
          <div><p className={styles.muted}>{snapshot.scenario.title} · Session {snapshot.id.slice(0, 8)}</p><h1>{snapshot.scenario.summary}</h1>
            <p className={styles.muted}>{modelLabel} · {snapshot.config.maxTurns} turns · {completedTurns} slots used{skippedTurns > 0 && ` · ${skippedTurns} skipped`}{snapshot.config.judgeEnabled && ` · ${reviews} reviews`}</p>
          </div>
        </div>
        <div ref={logRef} role="log" aria-label="Agent discussion" aria-live="polite" className={styles.transcript} onScroll={(event) => { followLog.current = event.currentTarget.scrollTop < 80; }}>
          {running && <p role="status" className={styles.panelBody}>{snapshot.pending?.kind === "checkpoint" || snapshot.pending?.kind === "final" ? "Judge is reviewing the discussion…" : activeAgent ? `${displayName(activeAgent.name)} is responding…` : "Starting the discussion…"}</p>}
          {snapshot.status === "completed" && <p className={styles.panelBody}>Discussion complete · {completedTurns} turns</p>}
          {snapshot.status === "stopped" && <p className={styles.panelBody}>Discussion stopped · {completedTurns} turns saved in this session</p>}
          {snapshot.turns.toReversed().map((turn) => <article className={`${styles.turn} ${turn.kind === "judge" ? styles.judgeTurn : ""}`} key={`${turn.kind}:${turn.turnNumber}`}>
            <div className={styles.turnHeading}><h2>{turn.kind === "skipped" ? "System notice" : displayName(turn.speakerName)}</h2><span>{turn.kind === "judge" ? `Review after turn ${turn.turnNumber}` : `Turn ${String(turn.turnNumber).padStart(2, "0")}${turn.kind === "skipped" ? " · Skipped" : ""}`}</span></div>
            <UsageDetails details={turn.usageDetails} totals={turn.tokenUsage} latencySeconds={turn.latencySeconds} className={styles.usageMetadata} />
            {turn.kind === "skipped" ? <p>Turn skipped after repeated invalid replies from {displayName(turn.speakerName)}. The canvas is unchanged; this slot counts toward the turn limit.</p> : <>
              {turn.kind === "agent" && <span className={styles.canvasNotice}>{turn.actions.length ? "Updated the canvas" : "Canvas unchanged this turn"}</span>}
              {turn.kind === "agent" ? <AgentReply text={turn.text} /> : <p className={styles.speech}>{turn.text}</p>}
            </>}
          </article>)}
          {snapshot.turns.length === 0 && !running && <p className={styles.panelBody}>{finished ? "No public contributions were saved." : "The discussion has not started."}</p>}
        </div>
      </section>
      <aside aria-label="Shared document and judgement" className={styles.documentColumn}>
        <section aria-labelledby="canvas-heading" className={styles.canvas}>
          <div className={styles.panelHead}><div><h2 id="canvas-heading">{finished ? "Final document" : "Canvas"}</h2><p className={styles.muted}>Shared document · read only for the judge</p></div><span>{snapshot.canvas.trim() ? finished ? "Saved" : "In progress" : "Empty"}</span></div>
          <div className={`${styles.panelBody} ${styles.markdown}`}>
            {snapshot.canvas.trim() ? <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span>, a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span> }}>{snapshot.canvas}</Markdown> : <p>Agents will build the shared document here as the discussion progresses.</p>}
          </div>
        </section>
        {(snapshot.finalJudgement || finalReviewDue) && <FinalJudgement snapshot={snapshot} blocked={blocked} />}
      </aside>
    </div>
  </>;
}

function AgentReply({ text }: { text: string }) {
  const reply = useRef<HTMLParagraphElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const element = reply.current;
    if (!element || expanded) return;
    const observer = new ResizeObserver(() => setOverflowing(element.scrollHeight > element.clientHeight + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <div>
    <p ref={reply} className={`${styles.speech} ${expanded ? "" : styles.briefSpeech}`}>{text}</p>
    {(overflowing || expanded) && <button type="button" className={styles.expandReply} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Read full reply"}</button>}
  </div>;
}

function LatestChange({ snapshot, agent }: { snapshot: Snapshot; agent: Agent }) {
  const turn = snapshot.turns.findLast((turn) => turn.statChanges.some((change) => change.agentId === agent.id));
  const change = turn?.statChanges.find((change) => change.agentId === agent.id);
  if (!change || !turn) return null;
  return <div className={styles.latestChange}><h4>Latest change · Turn {turn.turnNumber}</h4><p>{signed(change.energy)} energy · {signed(change.confidence)} confidence</p><ul>{change.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>;
}
