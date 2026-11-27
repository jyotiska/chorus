"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  CheckCheck,
  CircleStop,
  Ellipsis,
  FileText,
  GitBranch,
  Globe,
  Gauge,
  Link as LinkIcon,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
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
import { modKey, type Command } from "./command-palette";

type Tab = "Board" | "Canvas" | "Repository" | "Results" | "Browser" | "Terminal";
type SideTab = "Canvas" | "Participants" | "Usage";
// Kept from the earlier split view, so a reader's open or closed choice carries over.
const sidePreferenceKey = "chorus.harness.boardSplit";
const sideTabKey = "chorus.harness.sideTab";
// The side pane needs room for a readable main pane beside its 420px.
const sidePaneRoom = 860;

/** The side pane sits beside the Board; Results, Repository and the runtime views need the full width. */
const besideSide = (tab: Tab) => tab === "Board";

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

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
  const deepswe = experiment?.deepswe;
  const documentName = experiment ? "SPEC.md" : "Canvas";
  const finished =
    ["completed", "stopped", "killed", "judge_failed", "verify_failed"].includes(snapshot.status);
  let outcome = "Run finished";
  if (snapshot.status === "killed") outcome = "Killed";
  else if (snapshot.status === "judge_failed") outcome = "Judge failed";
  else if (snapshot.status === "verify_failed") outcome = "Ungraded";
  else if (deepswe?.result) outcome = deepswe.result.reward === 1 ? "Passed" : "Failed";
  else if (experiment) outcome = "Report ready";
  else if (snapshot.verification) outcome = `Solution ${snapshot.verification.status}`;
  const active =
    snapshot.status === "running" || snapshot.status === "reviewing";
  const canKill = experiment &&
    (active || ["paused", "judge_failed", "verify_failed"].includes(snapshot.status));
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
  const [roomForSide, setRoomForSide] = useState(false);
  const [sideChoice, setSideChoice] = useState(
    () => typeof window === "undefined" || localStorage.getItem(sidePreferenceKey) !== "closed",
  );
  const [sideTab, setSideTab] = useState<SideTab>(() => {
    const saved = typeof window === "undefined" ? null : localStorage.getItem(sideTabKey);
    return saved === "Participants" || saved === "Usage" ? saved : "Canvas";
  });
  useEffect(() => {
    if (!panes.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoomForSide(entry.contentRect.width >= sidePaneRoom),
    );
    observer.observe(panes.current);
    return () => observer.disconnect();
  }, []);
  const sideAvailable = roomForSide && besideSide(tab);
  const sideVisible = sideAvailable && sideChoice;
  const sideLabel = sideVisible ? "Hide side pane" : "Show side pane";

  function chooseSide(open: boolean) {
    setSideChoice(open);
    localStorage.setItem(sidePreferenceKey, open ? "open" : "closed");
  }
  function showSideTab(next: SideTab) {
    setSideTab(next);
    localStorage.setItem(sideTabKey, next);
  }
  /** Participants and Usage open in the side pane when it fits, otherwise in a sheet. */
  function inspect(next: "Participants" | "Usage") {
    if (sideAvailable) {
      chooseSide(true);
      showSideTab(next);
    } else setDrawer(next);
  }
  const view = (next: Tab) => () => {
    if (next === "Repository") setRepositoryOpened(true);
    if (next === "Browser" || next === "Terminal") setRuntimeOpened(true);
    if (next === "Terminal") setTerminalOpened(true);
    setTab(next);
  };
  const mainTabs: { id: Tab; label: string; icon: ReactNode; count?: number }[] = [
    { id: "Board", label: "Board", icon: <MessagesSquare />, count: snapshot.boardCount },
    ...(!sideVisible ? [{ id: "Canvas" as Tab, label: documentName, icon: <FileText /> }] : []),
    ...(experiment ? [{ id: "Repository" as Tab, label: "Repository", icon: <GitBranch /> }] : []),
    { id: "Results", label: "Results", icon: <CheckCheck /> },
  ];
  const mod = modKey();
  const viewKey = (index: number) => (mod === "⌘" ? ["⌃", String(index + 1)] : ["Alt", String(index + 1)]);

  // Keyboard: Cmd/Ctrl+\ toggles the side pane, Ctrl+1–4 (Alt+1–4 off macOS) picks a view,
  // and J/K move between Board posts when no field has focus. Browsers keep Cmd+1–9 for tabs.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === "\\") {
        if (!sideAvailable) return;
        event.preventDefault();
        chooseSide(!sideVisible);
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code);
      const viewChord = mod === "⌘" ? event.ctrlKey && !event.altKey : event.altKey && !event.ctrlKey;
      if (digit && viewChord && !event.shiftKey && !event.metaKey) {
        const target = mainTabs[Number(digit[1]) - 1];
        if (!target) return;
        event.preventDefault();
        view(target.id)();
        return;
      }
      if ((event.key === "j" || event.key === "k") && !event.metaKey && !event.ctrlKey && !event.altKey
        && tab === "Board" && !isTyping(event.target) && !document.querySelector("dialog[open]")) {
        const posts = [...document.querySelectorAll<HTMLElement>(".board-pane article[id]")];
        if (!posts.length) return;
        const current = posts.findIndex((post) => post.contains(document.activeElement));
        const index = current < 0 ? 0 : current + (event.key === "j" ? 1 : -1);
        const next = posts[Math.max(0, Math.min(posts.length - 1, index))];
        event.preventDefault();
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest" });
      }
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          {deepswe ? "Start DeepSWE run" : experiment ? "Start experiment" : "Start session"}
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
      {deepswe && snapshot.status === "verify_failed" && (
        <button disabled={busy} onClick={() => { setTab("Results"); void act("retry_verification"); }}>Retry verification</button>
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
            {(experiment?.rubric === "deliverable-v1" || deepswe) && (
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
  const commands: Command[] = [
    ...(snapshot.status === "ready" ? [{ id: "start", group: "Run", label: deepswe ? "Start DeepSWE run" : experiment ? "Start experiment" : "Start session", icon: <Play />, disabled: busy, run: () => void act("start") }] : []),
    ...(active && !experiment ? [{ id: "pause", group: "Run", label: "Pause", icon: <Pause />, disabled: busy, run: () => void act("pause") }] : []),
    ...(snapshot.status === "paused" ? [{ id: "resume", group: "Run", label: "Resume", icon: <Play />, disabled: busy, run: () => void act("resume") }] : []),
    ...(experiment && snapshot.status === "judge_failed" ? [{ id: "retry-judge", group: "Run", label: "Retry judge", disabled: busy, run: () => void act("retry_judge") }] : []),
    { id: "copy", group: "Run", label: "Copy session link", icon: <LinkIcon />, run: () => void copy() },
    ...(canKill ? [{ id: "kill", group: "Run", label: "Kill experiment…", icon: <CircleStop />, danger: true, disabled: busy, run: () => killDialog.current?.showModal() }] : []),
    ...mainTabs.map((item, index) => ({ id: `view-${item.id}`, group: "Views", label: item.label, icon: item.icon, keys: viewKey(index), hint: item.id === "Results" && finished ? outcome : undefined, run: view(item.id) })),
    ...(sideVisible ? [{ id: "view-canvas", group: "Views", label: `${documentName} in side pane`, icon: <FileText />, run: () => showSideTab("Canvas") }] : []),
    ...(experiment && !deepswe ? [
      { id: "view-browser", group: "Views", label: "Browser", icon: <Globe />, run: view("Browser") },
      { id: "view-terminal", group: "Views", label: "Terminal", icon: <Terminal />, run: view("Terminal") },
    ] : []),
    ...(sideAvailable ? [{ id: "side", group: "Views", label: sideLabel, icon: sideVisible ? <PanelRightClose /> : <PanelRightOpen />, keys: [mod, "\\"], run: () => chooseSide(!sideVisible) }] : []),
    { id: "participants", group: "Views", label: "Participants", icon: <Users />, hint: `${snapshot.agents.length} agents`, run: () => inspect("Participants") },
    { id: "usage", group: "Views", label: "Usage", icon: <Gauge />, run: () => inspect("Usage") },
  ];
  const sideTabs: { id: SideTab; label: string; icon: ReactNode; count?: number }[] = [
    { id: "Canvas", label: documentName, icon: <FileText /> },
    { id: "Participants", label: "Participants", icon: <Users />, count: snapshot.agents.length },
    { id: "Usage", label: "Usage", icon: <Gauge /> },
  ];
  return (
    <Shell
      title={snapshot.problem.title}
      commands={commands}
      snapshot={snapshot}
      headerDetails={<RunProgress snapshot={snapshot} usage={usage} active={active} />}
      actions={actions}
      onNew={() => void newSession()}
      busy={busy}
    >
      <div className="workspace-tabs">
        <nav aria-label="Session views">
          {mainTabs.map((item, index) => (
            <button
              key={item.id}
              ref={item.id === "Board" ? boardButton : item.id === "Canvas" ? canvasButton : undefined}
              className={item.id === "Results" ? "results-tab" : undefined}
              aria-label={item.label}
              title={`${item.id === "Results" && finished ? outcome : item.label} (${viewKey(index).join("")})`}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => {
                if (item.id === "Canvas") canvasOpener.current = null;
                view(item.id)();
              }}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined && <small className="tab-count" aria-hidden="true">{item.count}</small>}
              {item.id === "Results" && finished && tab !== "Results" && (
                <span className="result-outcome" data-state={snapshot.status} role="status">
                  <span className="sr-only">{outcome}</span>
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="inspect-buttons">
          {!sideVisible && <>
            <button
              aria-label={`Participants (${snapshot.agents.length})`}
              aria-haspopup={sideAvailable ? undefined : "dialog"}
              title="Participants"
              onClick={() => inspect("Participants")}
            >
              <Users />
            </button>
            <button aria-label="Usage" aria-haspopup={sideAvailable ? undefined : "dialog"} title="Usage" onClick={() => inspect("Usage")}>
              <Gauge />
            </button>
          </>}
          {experiment && !deepswe && <>
            <span className="inspect-divider" aria-hidden="true" />
            <button aria-label="Browser" title="Browser" aria-pressed={tab === "Browser"} onClick={view("Browser")}>
              <Globe />
            </button>
            <button aria-label="Terminal" title="Terminal" aria-pressed={tab === "Terminal"} onClick={view("Terminal")}>
              <Terminal />
            </button>
          </>}
          {sideAvailable && (
            <button aria-label={sideLabel} title={`${sideLabel} (${mod}\\)`} aria-pressed={sideVisible} onClick={() => chooseSide(!sideVisible)}>
              {sideVisible ? <PanelRightClose /> : <PanelRightOpen />}
            </button>
          )}
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
      <div ref={panes} className={`work-panes ${sideVisible ? "beside" : ""}`}>
        <div className="board-pane" hidden={tab !== "Board"}>
          <OpenCanvasContext.Provider
            value={
              sideVisible
                ? (opener) => {
                    canvasOpener.current = opener;
                    showSideTab("Canvas");
                  }
                : (opener) => {
                    canvasOpener.current = opener;
                    setTab("Canvas");
                    requestAnimationFrame(() => canvasButton.current?.focus());
                  }
            }
          >
            {parts.board}
          </OpenCanvasContext.Provider>
        </div>
        {/* One SPEC.md container for both places, so its view and open changes survive moving between them. */}
        <div className={`canvas-pane spec-pane${sideVisible ? " in-side" : ""}`}
          hidden={!(tab === "Canvas" || (sideVisible && sideTab === "Canvas"))}>
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
        {sideVisible && (
          <aside className={`side-pane${sideTab === "Canvas" ? " tabs-only" : ""}`} aria-label="Side pane">
            <nav className="side-tabs" aria-label="Side pane views">
              {sideTabs.map((item) => (
                <button key={item.id} aria-label={item.label} aria-current={sideTab === item.id ? "page" : undefined} onClick={() => showSideTab(item.id)}>
                  {item.icon}
                  {item.label}
                  {item.count !== undefined && <small className="tab-count" aria-hidden="true">{item.count}</small>}
                </button>
              ))}
            </nav>
            {sideTab !== "Canvas" && <div className={`side-content side-${sideTab.toLowerCase()}`} role="region" aria-label={sideTab}>
              {sideTab === "Participants" ? parts.roster
                : <SessionUsageView usage={usage} error={usageError} retry={retryUsage} />}
            </div>}
          </aside>
        )}
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
