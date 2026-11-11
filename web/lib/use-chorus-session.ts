"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChorusClient, ChorusError, type SessionConfig, type Snapshot } from "@/lib/api/chorus/client";

const client = new ChorusClient();
const savedKey = "chorus-web.session";

// This hook manages transport and selection; execution always belongs to Chorus.
export function useChorusSession() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [commandPending, setCommandPending] = useState(true);
  const [problem, setProblem] = useState<{ message: string; code?: string } | null>(null);
  const selected = useRef("");
  const latest = useRef<Snapshot | null>(null);
  const generation = useRef(0);
  const locked = useRef(true);

  const accept = useCallback((value: Snapshot) => {
    if (selected.current !== value.id || (latest.current && value.revision < latest.current.revision)) return;
    const advanced = !latest.current || value.revision > latest.current.revision;
    latest.current = value;
    setSnapshot(value);
    setProblem((current) => !advanced && current?.code ? current : null);
  }, []);

  function report(error: unknown) {
    setProblem({ message: error instanceof Error ? error.message : "Cannot reach Chorus.", code: error instanceof ChorusError ? error.code : undefined });
  }

  useEffect(() => {
    let active = true;
    const epoch = generation.current;
    const saved = new URLSearchParams(window.location.search).get("session") || localStorage.getItem(savedKey);
    void (async () => {
      try {
        if (saved) {
          const restored = await client.get(saved);
          if (!active || epoch !== generation.current) return;
          selected.current = restored.id;
          localStorage.setItem(savedKey, restored.id);
          accept(restored);
        }
      } catch (error) { if (active && epoch === generation.current) report(error); }
      finally { if (active && epoch === generation.current) { locked.current = false; setCommandPending(false); } }
    })();
    return () => { active = false; };
  }, [accept]);

  useEffect(() => {
    if (!snapshot?.id) return;
    const id = snapshot.id;
    const epoch = generation.current;
    return client.subscribe(id, latest.current?.revision ?? -1, accept, (message) => {
      if (selected.current === id && generation.current === epoch) setProblem({ message });
    });
  }, [snapshot?.id, accept]);

  async function start(config: SessionConfig) {
    if (locked.current) return;
    locked.current = true;
    setCommandPending(true);
    setProblem(null);
    const epoch = ++generation.current;
    try {
      const created = await client.create(config);
      if (epoch !== generation.current) return;
      selected.current = created.id;
      latest.current = null;
      localStorage.setItem(savedKey, created.id);
      const url = new URL(window.location.href);
      if (url.searchParams.has("session")) { url.searchParams.set("session", created.id); window.history.replaceState(null, "", url); }
      accept(created);
      accept(await client.command(created.id, "start"));
    } catch (error) { if (epoch === generation.current) report(error); }
    finally { if (epoch === generation.current) { locked.current = false; setCommandPending(false); } }
  }

  async function control(action: "start" | "pause" | "resume" | "stop") {
    const id = selected.current;
    if (!id || locked.current) return;
    const epoch = generation.current;
    locked.current = true;
    setCommandPending(true);
    try { accept(await client.command(id, action)); }
    catch (error) { if (selected.current === id && generation.current === epoch) report(error); }
    finally { if (generation.current === epoch) { locked.current = false; setCommandPending(false); } }
  }

  async function back() {
    if (locked.current) return;
    locked.current = true;
    setCommandPending(true);
    try {
      if (selected.current) {
        const current = await client.get(selected.current);
        if (current.status === "running" || current.status === "reviewing") {
          try { await client.command(current.id, "pause"); }
          catch (error) {
            // Completion may race the pause request; finished or already paused work is safe to leave.
            if (!(error instanceof ChorusError) || error.code !== "INVALID_STATE") throw error;
            const refreshed = await client.get(current.id);
            if (refreshed.status === "running" || refreshed.status === "reviewing") throw error;
          }
        }
      }
      ++generation.current;
      selected.current = "";
      latest.current = null;
      localStorage.removeItem(savedKey);
      const url = new URL(window.location.href);
      url.searchParams.delete("session");
      window.history.replaceState(null, "", url);
      setSnapshot(null);
      setProblem(null);
    } catch (error) { report(error); }
    finally { locked.current = false; setCommandPending(false); }
  }

  return { snapshot, commandPending, error: problem?.message || snapshot?.error || null, errorCode: problem?.code || snapshot?.errorCode, start, control, back };
}
