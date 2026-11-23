"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LegacyArchive, LiveSession } from "@/lib/api/chorus/harness-workspace";
import {
  HarnessError,
  type ExperimentCatalog,
  type HarnessCatalog,
  type HarnessSnapshot,
} from "@/lib/api/chorus/harness-client";
import { Launcher } from "./setup";
import { LiveWorkspace } from "./live";
import { Shell, harness, sessionHref, message } from "./shell";

const storageKey = "chorus.harness.session";

export function ChorusApp({ legacyCatalog }: { legacyCatalog: boolean }) {
  const [setup, setSetup] = useState<{ catalog: HarnessCatalog | ExperimentCatalog; experiment: boolean } | null>(null);
  const [snapshot, setSnapshot] = useState<HarnessSnapshot | null>(null);
  const [previous, setPrevious] = useState<HarnessSnapshot | null>(null);
  const [legacy, setLegacy] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const latest = useRef<HarnessSnapshot | null>(null);
  const receive = useCallback((next: HarnessSnapshot) => {
    const current = latest.current;
    if (!current || current.id !== next.id || next.revision <= current.revision)
      return;
    latest.current = next;
    setSnapshot(next);
  }, []);
  function adopt(run: HarnessSnapshot) {
    latest.current = run;
    setSnapshot(run);
    localStorage.setItem(storageKey, run.id);
    window.history.replaceState(window.history.state, "", sessionHref(run.id));
  }
  function leave() {
    latest.current = null;
    setSnapshot(null);
    setLegacy("");
    setError("");
    localStorage.removeItem(storageKey);
    window.history.replaceState(window.history.state, "", "/");
  }
  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(location.search);
    const id =
      params.get("session") ||
      (!params.has("new") && localStorage.getItem(storageKey));
    if (params.has("new") && !id) {
      localStorage.removeItem(storageKey);
      window.history.replaceState(window.history.state, "", "/");
    }
    const experiment = !legacyCatalog || params.has("experiment");
    void (experiment ? harness.experimentCatalog() : harness.catalog())
      .then((catalog) => {
        if (alive) setSetup({ catalog, experiment });
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    async function restore() {
      try {
        if (id) {
          const run = await harness.get(id);
          if (alive) adopt(run);
        }
      } catch (e) {
        if (alive) {
          if (e instanceof HarnessError && e.code === "NOT_FOUND" && id)
            setLegacy(id);
          else setError(message(e));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void restore();
    return () => {
      alive = false;
    };
  }, [legacyCatalog]);
  async function start(run: HarnessSnapshot) {
    setPrevious(run);
    // A reload during Start must recover the already-created session.
    localStorage.setItem(storageKey, run.id);
    window.history.replaceState(window.history.state, "", sessionHref(run.id));
    try {
      adopt(await harness.command(run.id, "start"));
    } catch (e) {
      adopt(run);
      setError(message(e));
    }
  }
  if (snapshot)
    return (
      <LiveSession
        key={snapshot.id}
        snapshot={snapshot}
        receive={receive}
        mode="chorus"
        leave={leave}
        presentation={{
          followPosts: true,
          workspace: (parts, controls) => (
            <LiveWorkspace
              parts={parts}
              controls={controls}
              initialError={error}
            />
          ),
        }}
      />
    );
  if (legacy)
    return (
      <Shell title="Historical session" archive onNew={leave}>
        <div className="archive-record">
          <LegacyArchive key={legacy} id={legacy} newSessionHref="/?new=1" archiveHref={legacyCatalog ? "/archive?experiment=1" : "/archive"} />
        </div>
      </Shell>
    );
  const experimentSetup = setup?.experiment ?? !legacyCatalog;
  return (
    <Shell
      title={experimentSetup ? "New experiment" : "New session"}
      experimentSetup={experimentSetup}
      onNew={() => document.getElementById("choose-problem")?.click()}
    >
      {error && (
        <div role="alert">
          {error}{" "}
          <button onClick={() => location.reload()}>Retry connection</button>
        </div>
      )}
      {!loading && setup ? (
        <Launcher catalog={setup.catalog} experiment={setup.experiment} previousRun={previous} start={start} />
      ) : (
        !error && (
          <p className="loading" role="status">
            Connecting to Chorus…
          </p>
        )
      )}
    </Shell>
  );
}
