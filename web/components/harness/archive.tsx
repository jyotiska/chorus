"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { ChorusClient, type Snapshot } from "@/lib/api/chorus/client";
import type { HarnessSnapshot } from "@/lib/api/chorus/harness-client";
import { Timestamp } from "@/lib/api/chorus/harness-workspace";
import { Shell, harness, sessionHref, message } from "./shell";

export function HistoricalArchive() {
  const [sessions, setSessions] = useState<Snapshot[] | null>(null);
  const [harnessSessions, setHarnessSessions] = useState<HarnessSnapshot[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void new ChorusClient()
      .list()
      .then((items) => {
        if (mounted) setSessions(items);
      })
      .catch((e) => {
        if (mounted) setError(message(e));
      });
    void harness.list().then((items) => {
      if (mounted) setHarnessSessions(items);
    }).catch((e) => {
      if (mounted) setError(message(e));
    });
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <Shell title="Archive" archive>
      <section className="archive-page">
        <h2>Historical sessions</h2>
        <p>
          Open a saved experiment or benchmark to inspect its records and exports.
        </p>
        {error && (
          <p role="alert">
            {error} <button onClick={() => location.reload()}>Retry</button>
          </p>
        )}
        {!error && (!sessions || !harnessSessions) && <p role="status">Loading archive…</p>}
        {sessions?.length === 0 && harnessSessions?.length === 0 && <p>No saved sessions yet.</p>}
        {harnessSessions?.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).map((run) => (
          <a key={run.id} className="archive-item" href={sessionHref(run.id)}>
            <div>
              <b>{run.problem.title}</b>
              <small><Timestamp value={run.createdAt} format="full" /> · {run.agents.length} participants · {run.experiment?.phase ?? "Benchmark"} · {run.status}</small>
              <code className="archive-id">{run.id}</code>
            </div>
            <ArrowUpRight />
          </a>
        ))}
        {sessions?.map((run) => (
          <a key={run.id} className="archive-item" href={sessionHref(run.id)}>
            <div>
              <b>{run.scenario.title}</b>
              <small>
                <Timestamp value={run.createdAt} format="full" /> · {run.agents.length}{" "}
                participants · {run.status}
              </small>
              <code className="archive-id">{run.id}</code>
            </div>
            <ArrowUpRight />
          </a>
        ))}
      </section>
    </Shell>
  );
}
