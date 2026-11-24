"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCheck,
  CircleStop,
  Columns2,
  Ellipsis,
  FileText,
  GitBranch,
  Globe,
  Gauge,
  Link as LinkIcon,
  MessagesSquare,
  Pause,
  Play,
  Terminal,
  Users,
} from "lucide-react";
import {
  SessionUsageView,
  ExperimentRepositoryView,
  OpenCanvasContext,
  type WorkspaceParts,
  type RunControls,
} from "@/lib/api/chorus/harness-workspace";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { message, sessionHref, Shell, Sheet } from "./shell";
import { RunProgress } from "./session-summary";
import { RepositoryRuntime } from "./runtime";

type Tab = "Board" | "Canvas" | "Repository" | "Results" | "Browser" | "Terminal";
const splitPreferenceKey = "chorus.harness.boardSplit";

export function LiveWorkspace({
  parts,
  controls,
  initialError,
}: {
  parts: WorkspaceParts;
  controls: RunControls;
  initialError: string;
}) {
  const { snapshot, usage, usageError, retryUsage, act, busy, leave } = controls;
  const experiment = snapshot.experiment;
  const documentName = experiment ? "SPEC.md" : "Canvas";
  const finished =
    ["completed", "stopped", "killed", "judge_failed"].includes(snapshot.status);
  let outcome = "Run finished";
  if (snapshot.status === "killed") outcome = "Killed";
  else if (snapshot.status === "judge_failed") outcome = "Judge failed";
  else if (experiment) outcome = "Report ready";
  else if (snapshot.verification) outcome = `Solution ${snapshot.verification.status}`;
  const active =
    snapshot.status === "running" || snapshot.status === "reviewing";
  const canKill = experiment &&
    (active || snapshot.status === "paused" || snapshot.status === "judge_failed");
  const [tab, setTab] = useState<Tab>(() => (finished ? "Results" : "Board"));
  const [repositoryOpened, setRepositoryOpened] = useState(false);
  const [runtimeOpened, setRuntimeOpened] = useState(false);
  const [terminalOpened, setTerminalOpened] = useState(false);
  const [drawer, setDrawer] = useState<"Participants" | "Usage" | "Problem statement" | null>(null);
  const [notice, setNotice] = useState("");
  const canvasOpener = useRef<HTMLButtonElement | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const confirmKill = useRef(false);
  const killDialog = useRef<HTMLDialogElement>(null);
  const boardButton = useRef<HTMLButtonElement>(null);
  const canvasButton = useRef<HTMLButtonElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  const [roomForBoth, setRoomForBoth] = useState(false);
  const [splitChoice, setSplitChoice] = useState(
    () => typeof window === "undefined" || localStorage.getItem(splitPreferenceKey) !== "closed",
  );
  useEffect(() => {
    if (!panes.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoomForBoth(entry.contentRect.width >= 820),
    );
    observer.observe(panes.current);
    return () => observer.disconnect();
  }, []);
  const split = tab === "Board" && roomForBoth && splitChoice;
  const splitLabel = split
    ? experiment ? "Close SPEC.md" : "Close canvas"
    : "Open beside board";
  async function copy() {
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
      {experiment && snapshot.status === "judge_failed" && (
        <button disabled={busy} onClick={() => void act("retry_judge")}>Retry judge</button>
      )}
      <DropdownMenu onOpenChangeComplete={(open) => {
        if (!open && confirmKill.current) {
          confirmKill.current = false;
          menuTrigger.current?.focus();
          killDialog.current?.showModal();
        }
      }}>
        <DropdownMenuTrigger ref={menuTrigger} className="icon-btn" aria-label="Run actions" title="Run actions">
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="run-actions-menu">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="run-menu-model" title={snapshot.config.model}>
              Model <code>{snapshot.config.model}</code>
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => void copy()}><LinkIcon /> Copy session link</DropdownMenuItem>
            {experiment?.rubric === "deliverable-v1" && (
              <DropdownMenuItem onClick={() => setDrawer("Problem statement")}><FileText /> View problem statement</DropdownMenuItem>
            )}
            {!experiment && !finished && !snapshot.endedEarly && (
              <DropdownMenuItem disabled={busy} onClick={() => void act("stop")}>Stop and evaluate</DropdownMenuItem>
            )}
            {canKill && <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => { confirmKill.current = true; }}>
              <CircleStop /> Kill experiment
            </DropdownMenuItem>}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  return (
    <Shell
      title={snapshot.problem.title}
      snapshot={snapshot}
      headerDetails={<RunProgress snapshot={snapshot} usage={usage} active={active} />}
      actions={actions}
      onNew={() => void newSession()}
      busy={busy}
    >
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
            <button aria-current={tab === "Repository" ? "page" : undefined} onClick={() => {
              setRepositoryOpened(true);
              setTab("Repository");
            }}>
              <GitBranch />
              Repository
            </button>
          )}
          <button
            className="results-tab"
            aria-label="Results"
            title={finished ? outcome : undefined}
            aria-current={tab === "Results" ? "page" : undefined}
            onClick={() => setTab("Results")}
          >
            <CheckCheck />
            Results
            {finished && tab !== "Results" && (
              <span className="result-outcome" data-state={snapshot.status} role="status">
                <span className="sr-only">{outcome}</span>
              </span>
            )}
          </button>
          {experiment && <>
            <button aria-current={tab === "Browser" ? "page" : undefined} onClick={() => {
              setRuntimeOpened(true);
              setTab("Browser");
            }}><Globe />Browser</button>
            <button aria-current={tab === "Terminal" ? "page" : undefined} onClick={() => {
              setRuntimeOpened(true);
              setTerminalOpened(true);
              setTab("Terminal");
            }}><Terminal />Terminal</button>
          </>}
        </nav>
        <div className="inspect-buttons">
          {tab === "Board" && roomForBoth && (
            <button
              aria-label={splitLabel}
              title={splitLabel}
              aria-pressed={split}
              onClick={() => {
                setSplitChoice(!split);
                localStorage.setItem(splitPreferenceKey, split ? "closed" : "open");
              }}
            >
              <Columns2 />
            </button>
          )}
          <button
            aria-label={`Participants (${snapshot.agents.length})`}
            aria-haspopup="dialog"
            title="Participants"
            onClick={() => setDrawer("Participants")}
          >
            <Users />
            <span className="inspect-label">Participants</span>
            <small>{snapshot.agents.length}</small>
          </button>
          <button aria-label="Usage" aria-haspopup="dialog" title="Usage" onClick={() => setDrawer("Usage")}>
            <Gauge />
            <span className="inspect-label">Usage</span>
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
        <div className="canvas-pane spec-pane" hidden={tab !== "Canvas" && !split}>
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
        {experiment && repositoryOpened && (
          <div className="repository-pane" hidden={tab !== "Repository"}>
            <ExperimentRepositoryView snapshot={snapshot} visible={tab === "Repository"} />
          </div>
        )}
        {experiment && runtimeOpened && <RepositoryRuntime key={snapshot.id} id={snapshot.id}
          view={tab === "Browser" || tab === "Terminal" ? tab : null} terminalOpened={terminalOpened}
          runtimeReset={() => setTerminalOpened(false)} />}
      </div>
      {drawer && (
        <Sheet key={drawer} title={drawer} className={drawer === "Participants" ? "participants-sheet" : undefined}
          close={() => setDrawer((current) => current === drawer ? null : current)}>
          {drawer === "Participants" ? parts.roster : drawer === "Problem statement"
            ? <p className="saved-statement">{snapshot.problem.statement}</p>
            : <SessionUsageView usage={usage} error={usageError} retry={retryUsage} />}
        </Sheet>
      )}
      {experiment && (
        <dialog
          ref={killDialog}
          className="kill-confirmation"
          aria-labelledby="kill-title"
          aria-describedby="kill-description"
          role="alertdialog"
        >
          <h2 id="kill-title">Kill experiment?</h2>
          <p id="kill-description">Active work will stop. The repository and recorded activity will be preserved.</p>
          <form method="dialog">
            <button className="subtle-btn" autoFocus>Cancel</button>
            <button
              className="danger-btn"
              type="button"
              disabled={!canKill || busy}
              onClick={() => {
                killDialog.current?.close();
                void act("kill");
              }}
            >
              Kill experiment
            </button>
          </form>
        </dialog>
      )}
      {parts.inspector}
    </Shell>
  );
}
