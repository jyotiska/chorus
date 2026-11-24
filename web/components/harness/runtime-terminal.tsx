"use client";

import { useEffect, useRef, useState } from "react";
import type { Terminal as Xterm } from "@xterm/xterm";
import { HarnessClient } from "@/lib/api/chorus/harness-client";
import { message } from "./shell";

const client = new HarnessClient();

export function RuntimeTerminal({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ attempt: -1, text: "", closed: false });
  const current = status.attempt === attempt ? status : { text: "Opening shell…", closed: false };

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let closed = false;
    let terminal: Xterm | undefined;
    let connection: WebSocket | undefined;
    let observer: ResizeObserver | undefined;

    async function connect() {
      const [{ Terminal }, { FitAddon }, ticket] = await Promise.all([
        import("@xterm/xterm"), import("@xterm/addon-fit"), client.terminal(id),
      ]);
      if (closed || !container) return;
      const socket = new WebSocket(ticket.url);
      socket.binaryType = "arraybuffer";
      connection = socket;
      const view = new Terminal({ cursorBlink: true, scrollback: 2500, fontSize: 13,
        theme: { background: "#111615", foreground: "#e6eee9", cursor: "#d8eee0" } });
      terminal = view;
      const fit = new FitAddon();
      view.loadAddon(fit);
      view.open(container);
      const encoder = new TextEncoder();
      view.onData((value) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const bytes = encoder.encode(value);
        for (let start = 0; start < bytes.length; start += 16384) socket.send(bytes.subarray(start, start + 16384));
      });
      function size() {
        if (container?.clientWidth && container.clientHeight) fit.fit();
      }
      function reportSize() {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ rows: view.rows, cols: view.cols }));
      }
      view.onResize(reportSize);
      observer = new ResizeObserver(size);
      observer.observe(container);
      socket.onopen = () => {
        if (closed) return;
        size();
        reportSize();
        setStatus({ attempt, text: "Shell connected", closed: false });
        if (container.clientWidth) view.focus();
      };
      socket.onmessage = (event) => { if (!closed && event.data instanceof ArrayBuffer) view.write(new Uint8Array(event.data)); };
      socket.onclose = (event) => {
        if (!closed) setStatus({ attempt, text: event.reason || "Terminal disconnected", closed: true });
      };
    }

    void connect().catch((error) => {
      if (!closed) setStatus({ attempt, text: message(error), closed: true });
    });
    return () => {
      closed = true;
      observer?.disconnect();
      connection?.close();
      terminal?.dispose();
    };
  }, [id, attempt]);

  return <>
    <div className="runtime-terminal-state">
      <span role="status">{current.text}</span>
      {current.closed && <button type="button" onClick={() => setAttempt(attempt + 1)}>Connect terminal</button>}
    </div>
    <div ref={host} aria-label="Experiment terminal" className="runtime-terminal-screen" />
  </>;
}
