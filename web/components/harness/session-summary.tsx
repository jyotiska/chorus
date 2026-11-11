"use client";

import { useEffect, useState } from "react";
import type {
  HarnessSnapshot,
  HarnessUsage,
  Usage,
} from "@/lib/api/chorus/harness-client";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function tokens(count: number, unknown: number, calls: number) {
  if (unknown === 0) return count.toLocaleString();
  return unknown === calls ? "Unknown" : `${count.toLocaleString()} (partial)`;
}

function cost(total: Usage) {
  const { reportedCostUSD, estimatedCostUSD, unknownCostCalls, callCount } =
    total;
  if (unknownCostCalls > 0 && unknownCostCalls === callCount) return "Unknown";
  const amounts: string[] = [];
  if (reportedCostUSD || !estimatedCostUSD)
    amounts.push(usd.format(reportedCostUSD));
  if (estimatedCostUSD) amounts.push(`${usd.format(estimatedCostUSD)} est.`);
  return amounts.join(" + ") + (unknownCostCalls ? " (partial)" : "");
}

function Elapsed({ ms, ticking }: { ms?: number; ticking: boolean }) {
  const [sample, setSample] = useState<{
    base: number;
    elapsed: number;
  } | null>(null);
  useEffect(() => {
    if (ms === undefined || !ticking) return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      setSample({ base: ms, elapsed: ms + performance.now() - start });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ms, ticking]);
  if (ms === undefined) return <>—</>;
  const seconds = Math.floor(
    (ticking && sample?.base === ms ? sample.elapsed : ms) / 1000,
  );
  const minutes = Math.floor(seconds / 60);
  return (
    <>
      {minutes >= 60 ? Math.floor(minutes / 60) + ":" : ""}
      {String(minutes % 60).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </>
  );
}

export function SessionSummary({
  snapshot,
  usage,
}: {
  snapshot: HarnessSnapshot;
  usage: HarnessUsage | null;
}) {
  const total = usage?.total;
  const completed = snapshot.workers.reduce(
    (sum, worker) => sum + worker.turnsCompleted,
    0,
  );
  const cap = snapshot.config.maxTurnsPerAgent * snapshot.agents.length;
  const experiment = snapshot.experiment;
  const stopped = snapshot.workers.filter((worker) => ["finished", "failed"].includes(worker.state)).length;
  const failed = snapshot.workers.filter((worker) => worker.state === "failed").length;
  const finished =
    ["completed", "stopped", "killed", "judge_failed"].includes(snapshot.status);
  return (
    <dl className="session-summary" aria-label="Session totals" tabIndex={0}>
      <div>
        <dt>Elapsed</dt>
        <dd>
          <Elapsed ms={usage?.wallTimeMs} ticking={!finished} />
        </dd>
      </div>
      {experiment ? experiment.phase === "plan" ? (
        experiment.planningCompletions ? (
          <div><dt>Planning progress</dt><dd>{experiment.planningCompletions.length} / {snapshot.agents.length} finished</dd></div>
        ) : (
          <div><dt>Planning votes</dt><dd>{experiment.votes.length} / {experiment.majority} needed</dd></div>
        )
      ) : (
        <div><dt>Agents stopped</dt><dd>{stopped} / {snapshot.agents.length}{failed ? ` · ${failed} failed` : ""}</dd></div>
      ) : (
        <div title="Completed turns across all agents / combined turn cap"><dt>Turns completed</dt><dd>{completed} / {cap}</dd></div>
      )}
      <div>
        <dt>Tokens</dt>
        <dd className="token-counts">
          <span>
            {total
              ? tokens(
                  total.inputTokens,
                  total.unknownInputCalls,
                  total.callCount,
                )
              : "—"}{" "}
            <small>in</small>
          </span>
          <span>
            {total
              ? tokens(
                  total.outputTokens,
                  total.unknownOutputCalls,
                  total.callCount,
                )
              : "—"}{" "}
            <small>out</small>
          </span>
          <span title="Included in input tokens">
            {total
              ? tokens(
                  total.cachedTokens,
                  total.unknownCacheCalls,
                  total.callCount,
                )
              : "—"}{" "}
            <small>cached</small>
          </span>
        </dd>
      </div>
      <div>
        <dt>Model calls</dt>
        <dd>{total?.callCount.toLocaleString() ?? "—"}</dd>
      </div>
      <div>
        <dt>Session cost</dt>
        <dd>{total ? cost(total) : "—"}</dd>
      </div>
    </dl>
  );
}
