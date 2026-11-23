"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { ChorusClient, type Snapshot } from "@/lib/api/chorus/client";
import type { HarnessSnapshot } from "@/lib/api/chorus/harness-client";
import { HarnessSelect } from "./select";
import { Shell, sessionHref, message, type RunHistory } from "./shell";

const legacyClient = new ChorusClient();
const statusLabels: Record<HarnessSnapshot["status"], string> = {
  completed: "Completed",
  running: "Running",
  reviewing: "Reviewing",
  paused: "Paused",
  ready: "Ready",
  stopping: "Stopping",
  stopped: "Stopped",
  killed: "Killed",
  judge_failed: "Judge failed",
};
const createdFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const exactCreatedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "long" });

type ArchiveRun = {
  id: string;
  title: string;
  status: HarnessSnapshot["status"];
  createdAt: string;
  participants: number;
  kind: "Experiment" | "Benchmark" | "Historical";
  phase?: string;
};

function ArchiveRow({ run }: { run: ArchiveRun }) {
  const date = new Date(run.createdAt);
  const validDate = Number.isFinite(date.getTime());

  return (
    <li>
      <a className="archive-item" href={sessionHref(run.id)}>
        <span className="archive-run">
          <strong>{run.title}</strong>
          <small>
            {run.kind}{run.phase && ` · ${run.phase}`} · {run.participants} {run.participants === 1 ? "agent" : "agents"}
            <code className="archive-id" title={run.id}>{run.id.slice(0, 8)}</code>
          </small>
        </span>
        <span className="archive-run-status">
          <i className={`status-dot ${run.status}`} aria-hidden="true" />
          {statusLabels[run.status]}
        </span>
        <time className="archive-date" dateTime={run.createdAt} title={validDate ? exactCreatedFormat.format(date) : undefined}>
          {validDate ? createdFormat.format(date) : run.createdAt}
        </time>
        <ChevronRight className="archive-open" aria-hidden="true" />
      </a>
    </li>
  );
}

function ArchiveList({ history }: { history: RunHistory }) {
  const [legacy, setLegacy] = useState<Snapshot[] | null>(null);
  const [legacyError, setLegacyError] = useState("");
  const [legacyAttempt, setLegacyAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");

  useEffect(() => {
    let mounted = true;
    void legacyClient.list().then((items) => {
      if (mounted) setLegacy(items);
    }).catch((error: unknown) => {
      if (mounted) setLegacyError(message(error));
    });
    return () => { mounted = false; };
  }, [legacyAttempt]);

  const runs = useMemo(() => {
    const current: ArchiveRun[] = history.runs.map((run) => ({
      id: run.id,
      title: run.problem.title,
      status: run.status,
      createdAt: run.createdAt,
      participants: run.agents.length,
      kind: run.experiment ? "Experiment" : "Benchmark",
      phase: run.experiment?.phase,
    }));
    const historical: ArchiveRun[] = (legacy ?? []).map((run) => ({
      id: run.id,
      title: run.scenario.title,
      status: run.status,
      createdAt: run.createdAt,
      participants: run.agents.length,
      kind: "Historical",
    }));
    return [...current, ...historical].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  }, [history.runs, legacy]);

  const needle = query.trim().toLowerCase();
  const filtered = runs.filter((run) =>
    (!status || run.status === status) &&
    (!kind || run.kind === kind) &&
    (!needle || run.title.toLowerCase().includes(needle) || run.id.toLowerCase().includes(needle)),
  );
  const loading = history.loading || (!legacy && !legacyError);

  return (
    <section className="archive-page" aria-label="Saved runs">
      <div className="archive-toolbar" role="search" aria-label="Find saved runs">
        <label className="archive-search">
          <Search aria-hidden="true" />
          <input type="search" aria-label="Search saved runs" placeholder="Search by name or run ID"
            value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <HarnessSelect label="Filter by status" value={status} onValueChange={setStatus}
          options={[{ value: "", label: "All statuses" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
        <HarnessSelect label="Filter by type" value={kind} onValueChange={setKind} options={[
          { value: "", label: "All types" }, { value: "Experiment", label: "Experiments" },
          { value: "Benchmark", label: "Benchmarks" }, { value: "Historical", label: "Historical sessions" },
        ]} />
        <span className="archive-count" role="status">
          {loading ? "Loading runs…" : needle || status || kind
            ? `${filtered.length} of ${runs.length} runs`
            : `${runs.length} ${runs.length === 1 ? "run" : "runs"}`}
        </span>
      </div>
      {history.error && (
        <div className="archive-error" role="alert">
          <span>Could not load experiments and benchmarks. {history.error}</span>
          <button type="button" className="subtle-btn" onClick={history.retry}>Retry current runs</button>
        </div>
      )}
      {legacyError && (
        <div className="archive-error" role="alert">
          <span>Could not load historical sessions. {legacyError}</span>
          <button type="button" className="subtle-btn" onClick={() => {
            setLegacyError("");
            setLegacyAttempt((value) => value + 1);
          }}>Retry historical sessions</button>
        </div>
      )}
      {filtered.length > 0 ? (
        <>
          <div className="archive-columns" aria-hidden="true">
            <span>Run</span><span>Status</span><span>Created</span>
          </div>
          <ul className="archive-list" role="list" aria-label="Archived runs">
            {filtered.map((run) => <ArchiveRow key={`${run.kind}:${run.id}`} run={run} />)}
          </ul>
        </>
      ) : !loading && (
        runs.length > 0 ? <p className="archive-empty">No saved runs match these filters.</p> :
          !history.error && !legacyError && <p className="archive-empty">No saved runs yet.</p>
      )}
    </section>
  );
}

export function RunArchive() {
  return (
    <Shell title="Archive" archive>
      {(history) => <ArchiveList history={history} />}
    </Shell>
  );
}
