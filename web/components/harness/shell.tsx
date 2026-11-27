"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import {
  Archive,
  Check,
  CircleDashed,
  CircleStop,
  Clock3,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  HarnessClient,
  type HarnessSnapshot,
} from "@/lib/api/chorus/harness-client";
import Link from "next/link";
import shared from "@/lib/api/chorus/harness-workspace.module.css";
import { CommandPalette, Kbd, modKey, type Command } from "./command-palette";

export const harness = new HarnessClient();
export const sessionHref = (id: string) =>
  `/?session=${encodeURIComponent(id)}`;
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const noSubscription = () => () => {};
// Full navigation, like the rail's links: the app restores the session from the URL on load.
const openPage = (href: string) => window.open(href, "_self");

type Tone = "live" | "ok" | "warn" | "bad" | "idle";

/** A run status as the design system's tone, glyph and word. */
export function runStatus(run: Pick<HarnessSnapshot, "status" | "experiment">): { tone: Tone; label: string } {
  const deepswe = Boolean(run.experiment?.deepswe);
  switch (run.status) {
    case "running": return { tone: "live", label: "Running" };
    case "reviewing": return { tone: "live", label: deepswe ? "Verifying" : run.experiment ? "Judging" : "Reviewing" };
    case "paused": return { tone: "warn", label: "Paused" };
    case "stopping": return { tone: "warn", label: "Stopping" };
    case "completed": return { tone: "ok", label: "Completed" };
    case "judge_failed": return { tone: "bad", label: "Judge failed" };
    case "verify_failed": return { tone: "bad", label: "Verification failed" };
    case "killed": return { tone: "idle", label: "Killed" };
    case "ready": return { tone: "idle", label: "Ready" };
    default: {
      const text = String(run.status).replaceAll("_", " ");
      return { tone: "idle", label: text[0].toUpperCase() + text.slice(1) };
    }
  }
}

export function StatusGlyph({ tone, status }: { tone: Tone; status: string }) {
  if (tone === "live") return <span className={`status-dot ${status}`} aria-hidden="true" />;
  const Icon = tone === "ok" ? Check : tone === "bad" ? X : tone === "warn" ? (status === "stopping" ? Clock3 : Pause)
    : status === "killed" ? CircleStop : CircleDashed;
  return <Icon aria-hidden="true" />;
}

/** Relative while a run is live, clock time today, date before that. */
function RailTime({ run, live }: { run: HarnessSnapshot; live: boolean }) {
  const created = new Date(run.createdAt);
  const now = new Date();
  let label: string;
  if (live) {
    const minutes = Math.max(0, Math.round((now.getTime() - created.getTime()) / 60000));
    label = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
  } else if (created.toDateString() === now.toDateString()) {
    label = created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  } else {
    label = created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return <time dateTime={run.createdAt} title={created.toLocaleString()} suppressHydrationWarning>{label}</time>;
}

function railDetail(run: HarnessSnapshot) {
  const team = `${run.agents.length} ${run.agents.length === 1 ? "agent" : "agents"}`;
  const phase = run.experiment?.phase;
  return phase ? `${phase[0].toUpperCase()}${phase.slice(1)} · ${team}` : team;
}

function railGroup(run: HarnessSnapshot) {
  if (["running", "reviewing", "stopping"].includes(run.status)) return "Running";
  const created = new Date(run.createdAt);
  return created.toDateString() === new Date().toDateString() ? "Today" : "Earlier";
}

export function Mark() {
  return (
    <span className="chorus-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function Sheet({
  title,
  className,
  dialogRef,
  close,
  children,
}: {
  title: string;
  className?: string;
  dialogRef?: RefObject<HTMLDialogElement | null>;
  close: () => void;
  children: ReactNode;
}) {
  const fallbackRef = useRef<HTMLDialogElement>(null);
  const ref = dialogRef ?? fallbackRef;
  useEffect(() => {
    ref.current?.showModal();
  }, [ref]);
  return (
    <dialog
      className={className ? `sheet ${className}` : "sheet"}
      ref={ref}
      aria-label={title}
      onClose={close}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            ref.current.close();
        }
      }}
    >
      <div className="sheet-head">
        <h2>{title}</h2>
        <button
          className="icon-btn"
          aria-label={`Close ${title}`}
          onClick={() => ref.current?.close()}
        >
          <X />
        </button>
      </div>
      <div className="sheet-content">{children}</div>
    </dialog>
  );
}

export type RunHistory = {
  runs: HarnessSnapshot[];
  loading: boolean;
  error: string;
  retry: () => void;
};

type Props = {
  children: ReactNode | ((history: RunHistory) => ReactNode);
  title: string;
  /** Page commands offered in the Cmd+K palette, before navigation. */
  commands?: Command[];
  actions?: ReactNode;
  headerDetails?: ReactNode;
  snapshot?: HarnessSnapshot;
  onNew?: () => void;
  busy?: boolean;
  archive?: boolean;
  experimentSetup?: boolean;
};

export function Shell({
  children,
  title,
  actions,
  headerDetails,
  snapshot,
  onNew,
  busy,
  archive,
  experimentSetup,
  commands = [],
}: Props) {
  const [list, setList] = useState<HarnessSnapshot[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [palette, setPalette] = useState(false);
  const mod = useSyncExternalStore(noSubscription, modKey, () => "⌘");
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      } else if (key === "b") {
        event.preventDefault();
        setCollapsed((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const status = snapshot?.status;
  const active = status === "running" || status === "reviewing";
  const compact = Boolean(snapshot || experimentSetup || archive);
  useEffect(() => {
    let mounted = true;
    void harness
      .list()
      .then((value) => {
        if (mounted) {
          setList(value);
          setLoaded(true);
          setError("");
        }
      })
      .catch((err) => {
        if (mounted) setError(message(err));
      });
    return () => {
      mounted = false;
    };
  }, [snapshot?.id, status, attempt]);
  const runs = (
    snapshot
      ? [snapshot, ...list.filter((item) => item.id !== snapshot.id)]
      : list
  ).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  function retryHistory() {
    setError("");
    setAttempt((value) => value + 1);
  }
  const rail = (
    <>
      <div className="rail-brand">
        <Mark />
        <strong>Chorus</strong>
        <button
          aria-label="Collapse sidebar"
          title={`Collapse sidebar (${mod}B)`}
          className="icon-btn sidebar-collapse"
          onClick={() => setCollapsed(true)}
        >
          <PanelLeftClose />
        </button>
      </div>
      {onNew ? (
        <button className="new-session" disabled={busy} onClick={onNew}>
          <Plus />
          {experimentSetup || snapshot?.experiment
            ? "New experiment"
            : active ? "Pause and return to setup" : "New session"}
        </button>
      ) : (
        <Link className="new-session" href="/?new=1">
          <Plus />
          New session
        </Link>
      )}
      <nav className="run-list" aria-label="Recent sessions">
        {["Running", "Today", "Earlier"].map((group) => {
          const members = runs.filter((run) => railGroup(run) === group);
          if (!members.length) return null;
          return (
            <section key={group} aria-label={group}>
              <div className="rail-label" role="heading" aria-level={2}>{group}</div>
              {members.map((run) => {
                const state = runStatus(run);
                return (
                  <a
                    key={run.id}
                    href={sessionHref(run.id)}
                    title={run.problem.title}
                    aria-current={run.id === snapshot?.id ? "page" : undefined}
                  >
                    <span className="run-name">{run.problem.title}</span>
                    <small className="run-meta">
                      <span className={`run-state tone-${state.tone}`}>
                        <StatusGlyph tone={state.tone} status={run.status} />
                        {state.label}
                      </span>
                      <span className="run-detail">{railDetail(run)}</span>
                      <RailTime run={run} live={group === "Running"} />
                    </small>
                  </a>
                );
              })}
            </section>
          );
        })}
        {!runs.length && (
          <p className="rail-empty">
            {error
              ? "Session history unavailable."
              : loaded
                ? "No sessions yet"
                : "Loading sessions…"}
          </p>
        )}
        {error && (
          <button title={error} onClick={retryHistory}>
            Retry history
          </button>
        )}
      </nav>
      <div className="rail-foot">
        <a
          className="archive-link"
          href="/archive"
          aria-current={archive ? "page" : undefined}
        >
          <Archive /> Archive
        </a>
      </div>
    </>
  );
  return (
    <div
      className={`chorus-shell ${shared.darkWorkspace}${compact ? " compact-shell" : ""}${snapshot ? " live-shell" : ""}${experimentSetup ? " experiment-setup" : ""}${collapsed ? " rail-collapsed" : ""}`}
    >
      <aside className="desktop-rail">{rail}</aside>
      {mobileOpen && (
        <Sheet title="Sessions" close={() => setMobileOpen(false)}>
          <div className="drawer-rail">{rail}</div>
        </Sheet>
      )}
      <main className="work-area">
        <header className="work-header">
          <button
            className="icon-btn mobile-menu"
            aria-label="Open sessions"
            onClick={() => setMobileOpen(true)}
          >
            <PanelLeftOpen />
          </button>
          {collapsed && (
            <>
              <button
                aria-label="Expand sidebar"
                title={`Expand sidebar (${mod}B)`}
                className="icon-btn expand"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen />
              </button>
              {!compact && (
                <div className="collapsed-brand" aria-label="Chorus">
                  <Mark />
                  <strong>Chorus</strong>
                </div>
              )}
            </>
          )}
          <div className="header-titles">
            {!compact && <span className="header-context">Workspace</span>}
            <h1 title={snapshot ? title : undefined}>{title}</h1>
          </div>
          {snapshot && (
            <div className="run-header-details">
              {status && (() => {
                const state = runStatus(snapshot);
                return (
                  <span className={`run-status ${status}`} role="status">
                    <StatusGlyph tone={state.tone} status={status} />
                    {state.label}
                  </span>
                );
              })()}
              {headerDetails}
            </div>
          )}
          <div className="header-actions">
            <button
              className="search-btn"
              aria-label="Search runs and actions"
              title={`Search runs and actions (${mod}K)`}
              onClick={() => setPalette(true)}
            >
              <Search />
              <span className="search-label">Search</span>
              <Kbd keys={[mod, "K"]} />
            </button>
            {actions}
          </div>
        </header>
        {typeof children === "function" ? children({
          runs: list, loading: !loaded && !error, error, retry: retryHistory,
        }) : children}
      </main>
      {palette && (
        <CommandPalette
          close={() => setPalette(false)}
          commands={[
            ...commands,
            ...(onNew ? [{
              id: "new", group: "Go to", label: experimentSetup || snapshot?.experiment ? "New experiment" : "New session",
              icon: <Plus />, run: onNew,
            }] : []),
            {
              id: "sidebar", group: "Go to", label: collapsed ? "Expand sidebar" : "Collapse sidebar",
              icon: collapsed ? <PanelLeftOpen /> : <PanelLeftClose />, keys: [mod, "B"], run: () => setCollapsed(!collapsed),
            },
            { id: "archive", group: "Go to", label: "Archive", icon: <Archive />, run: () => openPage("/archive") },
            ...runs.filter((run) => run.id !== snapshot?.id).slice(0, 12).map((run) => ({
              id: `run-${run.id}`, group: "Runs", label: run.problem.title, hint: runStatus(run).label,
              icon: <FileText />, run: () => openPage(sessionHref(run.id)),
            })),
          ]}
        />
      )}
    </div>
  );
}
