"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCheck,
  Columns2,
  Ellipsis,
  FileText,
  GitBranch,
  Gauge,
  Link as LinkIcon,
  MessagesSquare,
  Pause,
  Play,
  Users,
} from "lucide-react";
import {
  Metrics,
  ExperimentRepositoryView,
  OpenCanvasContext,
  type WorkspaceParts,
  type RunControls,
} from "@/lib/api/chorus/harness-workspace";
import { message, sessionHref, Shell, Sheet } from "./shell";
import { SessionSummary } from "./session-summary";

type Tab = "Board" | "Canvas" | "Repository" | "Results";

export function LiveWorkspace({
  parts,
  controls,
  initialError,
}: {
  parts: WorkspaceParts;
  controls: RunControls;
  initialError: string;
}) {
  const { snapshot, usage, act, busy, leave } = controls;
  const experiment = snapshot.experiment;
  const documentName = experiment ? "SPEC.md" : "Canvas";
  const finished =
    ["completed", "stopped", "killed", "judge_failed"].includes(snapshot.status);
  const active =
    snapshot.status === "running" || snapshot.status === "reviewing";
  const [tab, setTab] = useState<Tab>(() => (finished ? "Results" : "Board"));
  const [drawer, setDrawer] = useState<"Participants" | "Usage" | null>(null);
  const [notice, setNotice] = useState("");
  const canvasOpener = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const boardButton = useRef<HTMLButtonElement>(null);
  const canvasButton = useRef<HTMLButtonElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  const [roomForBoth, setRoomForBoth] = useState(false);
  const [splitChoice, setSplitChoice] = useState<boolean | null>(null);
  useEffect(() => {
    if (!panes.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoomForBoth(entry.contentRect.width >= 660),
    );
    observer.observe(panes.current);
    return () => observer.disconnect();
  }, []);
  const split = tab === "Board" && (splitChoice ?? roomForBoth);
  async function copy() {
    menu.current?.hidePopover();
    try {
      await navigator.clipboard.writeText(
        new URL(sessionHref(snapshot.id), location.origin).href,
      );
      setNotice("Session link copied");
    } catch (e) {
      setNotice(`Could not copy link. ${message(e)}`);
    }
  }
  async function newSession() {
    if (experiment || !active || (await act("pause"))) leave();
  }
  const actions = (
    <>
      {snapshot.status === "ready" && (
        <button disabled={busy} onClick={() => void act("start")}>
          <Play />
          {experiment ? "Start experiment" : "Start session"}
        </button>
      )}
      {active && !experiment && (
        <button disabled={busy} onClick={() => void act("pause")}>
          <Pause />
          Pause
        </button>
      )}
      {snapshot.status === "paused" && (
        <button disabled={busy} onClick={() => void act("resume")}>
          <Play />
          Resume
        </button>
      )}
      {experiment && ["running", "reviewing", "paused", "stopping", "judge_failed"].includes(snapshot.status) && (
        <button className="kill-experiment" disabled={busy || snapshot.status === "stopping"} onClick={() => void act("kill")}>
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M4 17l16 5m0-5L4 22" stroke="currentColor" strokeWidth="2" />
            <circle cx="4" cy="17" r="1.7" />
            <circle cx="20" cy="17" r="1.7" />
            <circle cx="4" cy="22" r="1.7" />
            <circle cx="20" cy="22" r="1.7" />
            <path fillRule="evenodd" d="M12 1a8 8 0 0 0-8 8c0 3 1.8 5 4 5.7V17h2v-1.5h1V17h2v-1.5h1V17h2v-2.3c2.2-.7 4-2.7 4-5.7a8 8 0 0 0-8-8ZM8.5 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM12 11l-1.4 2.4h2.8L12 11Z" />
          </svg>
          {snapshot.status === "stopping" ? "Stopping…" : "Kill experiment"}
        </button>
      )}
      {experiment && snapshot.status === "judge_failed" && (
        <button disabled={busy} onClick={() => void act("retry_judge")}>Retry judge</button>
      )}
      <button
        className="icon-btn"
        aria-label="Run actions"
        popoverTarget="run-menu"
      >
        <Ellipsis />
      </button>
      <div id="run-menu" ref={menu} popover="auto" className="run-menu">
        <button onClick={() => void copy()}>
          <LinkIcon />
          Copy session link
        </button>
        {!experiment && !finished && !snapshot.endedEarly && (
          <button
            disabled={busy}
            onClick={() => {
              menu.current?.hidePopover();
              void act("stop");
            }}
          >
            Stop and evaluate
          </button>
        )}
      </div>
    </>
  );
  return (
    <Shell
      title={snapshot.problem.title}
      context={`${experiment ? "Experiment" : "Session"} / ${snapshot.config.model}`}
      status={snapshot.status}
      snapshot={snapshot}
      actions={actions}
      onNew={() => void newSession()}
      busy={busy}
    >
      {experiment && (
        <div className="workspace-tabs">
          <nav aria-label="Experiment phase">
            {(["plan", "build", "judge"] as const).map((phase) => (
              <span key={phase} aria-current={experiment.phase === phase ? "step" : undefined} aria-live={phase === "plan" ? "polite" : undefined}>
                {phase === "plan" && experiment.phase !== "plan" ? (
                  <><Check aria-hidden="true" />Plan complete</>
                ) : phase[0].toUpperCase() + phase.slice(1)}
              </span>
            ))}
          </nav>
          {snapshot.status === "killed" && <strong role="status">Killed</strong>}
          {snapshot.status === "stopping" && <strong role="status">Stopping…</strong>}
        </div>
      )}
      <SessionSummary snapshot={snapshot} usage={usage} />
      <div
        className="agent-strip"
        role="region"
        aria-label="Live agents"
        aria-hidden={drawer === "Participants" || undefined}
        inert={drawer === "Participants"}
      >
        {parts.roster}
      </div>
      <div className="workspace-tabs">
        <nav aria-label="Session views">
          <button
            ref={boardButton}
            aria-current={tab === "Board" ? "page" : undefined}
            onClick={() => setTab("Board")}
          >
            <MessagesSquare />
            Board
          </button>
          <button
            ref={canvasButton}
            aria-current={tab === "Canvas" ? "page" : undefined}
            onClick={() => {
              canvasOpener.current = null;
              setTab("Canvas");
            }}
          >
            <FileText />
            {documentName}
          </button>
          {experiment && (
            <button aria-current={tab === "Repository" ? "page" : undefined} onClick={() => setTab("Repository")}>
              <GitBranch />
              Repository
            </button>
          )}
          <button
            aria-current={tab === "Results" ? "page" : undefined}
            onClick={() => setTab("Results")}
          >
            <CheckCheck />
            Results
            {finished && tab !== "Results" && (
              <span className="result-outcome" role="status">
                {experiment ? (snapshot.status === "killed" ? "Killed" : snapshot.status === "judge_failed" ? "Judge failed" : "Report ready") : snapshot.verification
                  ? `Solution ${snapshot.verification.status}`
                  : "Run finished"}
              </span>
            )}
          </button>
        </nav>
        <div className="inspect-buttons">
          {tab === "Board" && (
            <button
              aria-label={split ? (experiment ? "Close SPEC.md" : "Close canvas") : "Open beside board"}
              aria-pressed={split}
              onClick={() => setSplitChoice(!split)}
            >
              <Columns2 />
              <span className="split-label">
                {split ? (experiment ? "Close SPEC.md" : "Close canvas") : "Open beside board"}
              </span>
            </button>
          )}
          <button onClick={() => setDrawer("Participants")}>
            <Users />
            Participants <small>{snapshot.agents.length}</small>
          </button>
          <button onClick={() => setDrawer("Usage")}>
            <Gauge />
            Usage
          </button>
        </div>
      </div>
      {initialError && snapshot.status === "ready" && (
        <p role="alert">{initialError}</p>
      )}
      {parts.error}
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      <div ref={panes} className={`work-panes ${split ? "beside" : ""}`}>
        <div className="board-pane" hidden={tab !== "Board"}>
          <OpenCanvasContext.Provider
            value={
              split
                ? null
                : (opener) => {
                    canvasOpener.current = opener;
                    setTab("Canvas");
                    canvasButton.current?.focus();
                  }
            }
          >
            {parts.board}
          </OpenCanvasContext.Provider>
        </div>
        <div className="canvas-pane" hidden={tab !== "Canvas" && !split}>
          {tab === "Canvas" && (
            <div className="pane-tools">
              <button
                onClick={() => {
                  setTab("Board");
                  const opener = canvasOpener.current;
                  canvasOpener.current = null;
                  requestAnimationFrame(() =>
                    (opener?.isConnected ? opener : boardButton.current)?.focus(
                      { preventScroll: true },
                    ),
                  );
                }}
              >
                <BookOpen />
                Back to board
              </button>
            </div>
          )}
          {parts.canvas}
          {parts.changes}
        </div>
        <div className="report-pane" hidden={tab !== "Results"}>
          {parts.report}
        </div>
        {experiment && tab === "Repository" && (
          <div className="report-pane"><ExperimentRepositoryView snapshot={snapshot} /></div>
        )}
      </div>
      {drawer && (
        <Sheet title={drawer} close={() => setDrawer(null)}>
          {drawer === "Participants" ? (
            parts.roster
          ) : usage ? (
            <div className="usage-view">
              <p>{(usage.wallTimeMs / 1000).toFixed(1)} s wall time</p>
              {(["participants", "judge", "total"] as const).map((key) => (
                <section key={key}>
                  <h3>
                    {
                      {
                        participants: "Participants",
                        judge: "Final judge",
                        total: "Whole session",
                      }[key]
                    }
                  </h3>
                  <Metrics usage={usage[key]} />
                </section>
              ))}
            </div>
          ) : (
            <p role="status">Loading usage…</p>
          )}
        </Sheet>
      )}
      {parts.inspector}
    </Shell>
  );
}
