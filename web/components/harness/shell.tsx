"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
  MessagesSquare,
} from "lucide-react";
import {
  HarnessClient,
  type HarnessSnapshot,
} from "@/lib/api/chorus/harness-client";
import Link from "next/link";
import { Timestamp } from "@/lib/api/chorus/harness-workspace";
import shared from "@/lib/api/chorus/harness-workspace.module.css";

export const harness = new HarnessClient();
export const sessionHref = (id: string) =>
  `/?session=${encodeURIComponent(id)}`;
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
  dialogRef,
  close,
  children,
}: {
  title: string;
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
      className="sheet"
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

type Props = {
  children: ReactNode;
  title: string;
  actions?: ReactNode;
  status?: string;
  context?: string;
  snapshot?: HarnessSnapshot;
  onNew?: () => void;
  busy?: boolean;
  archive?: boolean;
};

export function Shell({
  children,
  title,
  status,
  context,
  actions,
  snapshot,
  onNew,
  busy,
  archive,
}: Props) {
  const [list, setList] = useState<HarnessSnapshot[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const active = status === "running" || status === "reviewing";
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
  const rail = (
    <>
      <div className="rail-brand">
        <Mark />
        <strong>Chorus</strong>
        <button
          aria-label="Collapse sidebar"
          className="icon-btn sidebar-collapse"
          onClick={() => setCollapsed(true)}
        >
          <PanelLeftClose />
        </button>
      </div>
      {onNew ? (
        <button className="new-session" disabled={busy} onClick={onNew}>
          <Plus />
          {active ? "Pause and return to setup" : "New session"}
        </button>
      ) : (
        <Link className="new-session" href="/?new=1">
          <Plus />
          New session
        </Link>
      )}
      <div className="rail-label">Recent sessions</div>
      <nav className="run-list" aria-label="Recent sessions">
        {runs.map((run) => (
          <a
            key={run.id}
            href={sessionHref(run.id)}
            aria-current={run.id === snapshot?.id ? "page" : undefined}
          >
            <span className="run-name">
              <MessagesSquare />
              {run.problem.title}
            </span>
            <small className="run-meta">
              <span className="run-state">
                <span className={`status-dot ${run.status}`} aria-hidden="true" />
                {run.status.replaceAll("_", " ")}
              </span>
              <Timestamp value={run.createdAt} format="short" />
            </small>
          </a>
        ))}
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
          <button title={error} onClick={() => setAttempt((n) => n + 1)}>
            Retry history
          </button>
        )}
      </nav>
      <a
        className="archive-link"
        href="/archive"
        aria-current={archive ? "page" : undefined}
      >
        <Archive /> Archive
      </a>
    </>
  );
  return (
    <div
      className={`chorus-shell ${shared.darkWorkspace} ${collapsed ? "rail-collapsed" : ""}`}
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
                className="icon-btn expand"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen />
              </button>
              <div className="collapsed-brand" aria-label="Chorus">
                <Mark />
                <strong>Chorus</strong>
              </div>
            </>
          )}
          <div className="header-titles">
            <div className="header-meta">
              <span className="header-context">{context || "Workspace"}</span>
              {status && (
                <span className={`run-status ${status}`} role="status">
                  <i className={`status-dot ${status}`} aria-hidden="true" />
                  {status}
                </span>
              )}
            </div>
            <h1>{title}</h1>
          </div>
          <div className="header-actions">{actions}</div>
        </header>
        {children}
      </main>
    </div>
  );
}
