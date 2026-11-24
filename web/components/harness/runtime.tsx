"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Play, RotateCw, Square } from "lucide-react";
import { HarnessClient, type WorkspaceAction, type WorkspaceRuntime } from "@/lib/api/chorus/harness-client";
import { RuntimeTerminal } from "./runtime-terminal";
import { message } from "./shell";

const client = new HarnessClient();

function PreviewFrame({ home }: { home: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = new URL(home).origin;
  const [navigation, setNavigation] = useState({ url: home, back: false, forward: false, available: true });
  const [draft, setDraft] = useState<string>();
  const [error, setError] = useState("");
  const source = `${origin}/.chorus-preview/?${new URLSearchParams({ parent: window.location.origin })}`;

  useEffect(() => {
    function receive(event: MessageEvent) {
      const data = event.data;
      if (event.origin !== origin || event.source !== frame.current?.contentWindow ||
          data?.type !== "chorus-preview-location" || typeof data.url !== "string") return;
      try {
        if (new URL(data.url).origin !== origin) return;
      } catch { return; }
      setNavigation({ url: data.url, back: data.back === true, forward: data.forward === true, available: data.available === true });
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin]);

  function command(action: "open" | "back" | "forward" | "refresh", url?: string) {
    frame.current?.contentWindow?.postMessage({ type: "chorus-preview-command", action, url }, origin);
  }

  function open(event: FormEvent) {
    event.preventDefault();
    try {
      const url = new URL((draft ?? navigation.url).trim(), origin);
      if (url.origin !== origin || url.pathname.startsWith("/.chorus-preview/")) throw new Error();
      setError("");
      setDraft(undefined);
      command("open", url.href);
    } catch {
      setError("Enter a path or a URL for the selected forwarded port.");
    }
  }

  return <>
    <form className="runtime-navigation" onSubmit={open}>
      <button type="button" aria-label="Back" disabled={!navigation.back} onClick={() => command("back")}><ArrowLeft /></button>
      <button type="button" aria-label="Forward" disabled={!navigation.forward} onClick={() => command("forward")}><ArrowRight /></button>
      <button type="button" aria-label="Refresh" onClick={() => command("refresh")}><RotateCw /></button>
      <input aria-label="Address" spellCheck={false} value={draft ?? navigation.url} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit">Go</button>
      <a aria-label="Open in new tab" title="Open in new tab" href={navigation.url} target="_blank" rel="noreferrer"><ExternalLink /></a>
    </form>
    {error && <p role="alert" className="runtime-error">{error}</p>}
    {!navigation.available && <p role="status">The page could not be displayed in the preview. Try opening it in a new tab.</p>}
    <iframe ref={frame} src={source} title="Application preview" className="runtime-frame"
      sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />
  </>;
}

export function RepositoryRuntime({ id, view, terminalOpened, runtimeReset }: {
  id: string; view: "Browser" | "Terminal" | null; terminalOpened: boolean; runtimeReset: () => void;
}) {
  const [runtime, setRuntime] = useState<WorkspaceRuntime>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const [port, setPort] = useState("");
  const [selectedPort, setSelectedPort] = useState<number>();
  const mutation = useRef(false);
  const sequence = useRef(0);
  const selected = runtime?.forwards.find((route) => route.port === (selectedPort ?? 3000)) ?? runtime?.forwards[0];
  const active = view !== null;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    async function refresh() {
      const generation = sequence.current;
      if (!mutation.current) {
        try {
          const next = await client.runtime(id);
          if (!cancelled && generation === sequence.current) setRuntime(next);
        } catch (error) {
          if (!cancelled && generation === sequence.current) setError(message(error));
        }
      }
      if (!cancelled) timeout = setTimeout(refresh, 1000);
    }
    void refresh();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [id, active]);

  async function perform(action: WorkspaceAction["action"], port?: number) {
    if (mutation.current) return;
    mutation.current = true;
    sequence.current++;
    setPending(action);
    setError("");
    try {
      const next = await client.runtimeAction(id, { action, port: port ?? null });
      setRuntime(next);
      if (action === "reset") {
        setSelectedPort(undefined);
        runtimeReset();
      }
      if (action === "run") setSelectedPort(3000);
      if (action === "forward") {
        setSelectedPort(port);
        setPort("");
      }
    } catch (error) {
      setError(message(error));
    } finally {
      mutation.current = false;
      setPending("");
    }
  }

  const initializing = pending === "run" || runtime?.state === "starting";
  const running = runtime?.state === "running";
  const source = runtime?.revision ?? runtime?.availableRevision;
  const outOfDate = runtime?.revision && runtime.revision !== runtime.availableRevision;

  return <>
    {active && (!runtime || !runtime.enabled) && <div className="runtime-pane">
      {error ? <p role="alert" className="runtime-error">{error}</p>
        : <p role="status">{runtime ? "Start Chorus with Docker Compose to use Browser and Terminal." : "Checking workspace…"}</p>}
    </div>}
    {runtime?.enabled && <>
      <section hidden={view !== "Browser"} className="runtime-pane" aria-label="Browser workspace">
        <div className="runtime-toolbar">
          <button type="button" disabled={Boolean(pending) || initializing || running} onClick={() => void perform("run")}><Play />Run</button>
          {(initializing || running) && <button type="button" disabled={Boolean(pending)} onClick={() => void perform("stop")}><Square />Stop</button>}
          <span role="status">{initializing ? "Starting" : running ? "Running" : runtime.state === "failed" ? "Failed" : "Stopped"}</span>
          {source && <code title={source}>{source.slice(0, 12)}</code>}
          {runtime.revision && <button type="button" disabled={Boolean(pending)} onClick={() => {
            if (window.confirm("Reset the workspace? This stops its apps and shell and discards temporary changes.")) void perform("reset");
          }}>{outOfDate ? "Load latest commit" : "Reset workspace"}</button>}
        </div>
        {(error || runtime.error) && <p role="alert" className="runtime-error">{error || runtime.error}</p>}
        {runtime.forwards.length > 1 && <label className="runtime-select">Forwarded port
          <select value={selected?.port} onChange={(event) => setSelectedPort(Number(event.target.value))}>
            {runtime.forwards.map((route) => <option key={route.port} value={route.port}>{route.port}</option>)}
          </select>
        </label>}
        {selected ? <PreviewFrame key={selected.url} home={selected.url} />
          : <div className="runtime-placeholder">Run the repository or forward a server port from Terminal.</div>}
        {(runtime.logs.frontend || runtime.logs.backend) && <details className="runtime-logs" open={runtime.state === "failed" || undefined}>
          <summary>Service logs</summary>
          {(["backend", "frontend"] as const).map((service) => runtime.logs[service] && <div key={service}>
            <strong>{service === "backend" ? "Backend" : "Frontend"}</strong><pre tabIndex={0}>{runtime.logs[service]}</pre>
          </div>)}
        </details>}
      </section>
      <section hidden={view !== "Terminal"} className="runtime-pane" aria-label="Terminal workspace">
        <form className="runtime-toolbar" onSubmit={(event) => { event.preventDefault(); void perform("forward", Number(port)); }}>
          <label className="runtime-port">Workspace port <input type="number" min="1024" max="65535" required value={port}
            onChange={(event) => setPort(event.target.value)} /></label>
          <button type="submit" disabled={Boolean(pending)}>Forward port</button>
          {selected && <span>Port {selected.port} is available in Browser.</span>}
        </form>
        {error && <p role="alert" className="runtime-error">{error}</p>}
        {terminalOpened && <RuntimeTerminal id={id} />}
        <p className="runtime-note">Shell changes are temporary and shared with the preview.</p>
      </section>
    </>}
  </>;
}
