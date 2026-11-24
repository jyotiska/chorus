"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import type {
  HarnessSnapshot,
  HarnessUsage,
} from "@/lib/api/chorus/harness-client";

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

export function RunProgress({
  snapshot,
  usage,
  active,
}: {
  snapshot: HarnessSnapshot;
  usage: HarnessUsage | null;
  active: boolean;
}) {
  const experiment = snapshot.experiment;
  const failed = snapshot.workers.filter(({ state }) => state === "failed").length;
  let progress: string;

  if (!experiment) {
    const completed = snapshot.workers.reduce((sum, worker) => sum + worker.turnsCompleted, 0);
    const cap = snapshot.config.maxTurnsPerAgent * snapshot.agents.length;
    progress = `${completed} / ${cap} turns`;
  } else if (experiment.phase === "plan") {
    progress = experiment.planningCompletions
      ? `${experiment.planningCompletions.length} / ${snapshot.agents.length} finished`
      : `${experiment.votes.length} / ${experiment.majority} votes`;
  } else if (experiment.phase === "verify") {
    progress = snapshot.status === "reviewing" ? "Grading patch" : "Patch frozen";
  } else {
    const stopped = snapshot.workers.filter(({ state }) => ["finished", "failed", "capped"].includes(state)).length;
    progress = `${stopped} / ${snapshot.agents.length} stopped`;
  }

  return (
    <>
      {experiment && (
        <div className="run-phases" role="group" aria-label="Experiment phase">
          {["plan", "build", experiment.deepswe ? "verify" : "judge"].map((phase) => (
            <span key={phase} aria-current={experiment.phase === phase ? "step" : undefined}>
              {phase[0].toUpperCase() + phase.slice(1)}
            </span>
          ))}
        </div>
      )}
      <span className="run-progress">{progress}</span>
      <span className="run-elapsed" title="Elapsed time">
        <Clock3 aria-hidden="true" />
        <span className="sr-only">Elapsed time </span>
        <Elapsed ms={usage?.wallTimeMs} ticking={active} />
      </span>
      {failed > 0 && (
        <span className="run-failures" role="status">
          {failed} {failed === 1 ? "agent" : "agents"} failed
        </span>
      )}
    </>
  );
}
