"use client";

// Shared product UI. Source: chorus/sdk; generated into both applications.
import { Children, createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HarnessClient, HarnessError } from "./harness-client";
import type { ExperimentTasks, HarnessAction, HarnessCatalog, HarnessSnapshot, HarnessRecord, HarnessUsage, Persona, RepositoryFile, RepositoryTree, Usage } from "./harness-client";
import { ChorusClient } from "./client";
import type { Snapshot as LegacySnapshot } from "./client";
import styles from "./harness-workspace.module.css";

const client = new HarnessClient();
const legacyClient = new ChorusClient();
const storageKey = "chorus.harness.session";
const labels: Record<string, string> = { queued: "Ready", running: "Working", waiting_model: "Waiting for model", waiting_lock: "Waiting for canvas", paused: "Paused", finished: "Finished", capped: "Turn cap reached", failed: "Failed" };
const money = (value: number) => `$${value.toFixed(6)}`;
const number = (value: number) => value.toLocaleString();
const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "always" });
const timeListeners = new Set<() => void>();
let timeNow = Date.now();
let timeTimer: ReturnType<typeof setInterval> | undefined;

function subscribeTime(listener: () => void) {
  timeListeners.add(listener);
  if (!timeTimer) {
    timeNow = Date.now();
    timeTimer = setInterval(() => {
      timeNow = Date.now();
      timeListeners.forEach((notify) => notify());
    }, 15000);
  }
  return () => {
    timeListeners.delete(listener);
    if (!timeListeners.size) {
      clearInterval(timeTimer);
      timeTimer = undefined;
    }
  };
}

function relativeLabel(seconds: number) {
  const age = Math.abs(seconds);
  if (age < 60) return "Just now";
  if (age >= 31536000) return relativeTime.format(Math.trunc(seconds / 31536000), "year");
  if (age >= 2592000) return relativeTime.format(Math.trunc(seconds / 2592000), "month");
  if (age >= 86400) return relativeTime.format(Math.trunc(seconds / 86400), "day");
  if (age >= 3600) return relativeTime.format(Math.trunc(seconds / 3600), "hour");
  return relativeTime.format(Math.trunc(seconds / 60), "minute");
}

export function Timestamp({ value, format = "seconds" }: { value: string; format?: "seconds" | "short" | "full" }) {
  const now = useSyncExternalStore(subscribeTime, () => timeNow, () => null);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <>{value}</>;
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  if (format === "seconds") options.second = "2-digit";
  return <time dateTime={value}>{date.toLocaleString(undefined, format === "full" ? undefined : options)}{now !== null && <> <span>({relativeLabel((date.getTime() - now) / 1000)})</span></>}</time>;
}
const text = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) ?? "";
const readableEvaluationText = (value: string) => value.replace(/\b(?:board|change|summary|call):[a-f0-9]{16,}\b/gi, "").replace(/\(\s*(?:[,;]\s*)*\)/g, "").replace(/\[\s*\]/g, "").replace(/\b(?:evidence|sources?)\s*:\s*(?=$|[).,;])/gi, "").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/\s+([)\]])/g, "$1").trim();
const asset = (id: string, kind = "portrait") => `${client.base}/assets/${encodeURIComponent(id)}/${kind}.svg${kind === "portrait" ? "?v=mono-transparent-1" : ""}`;

const experimentPortraits: Partial<Record<string, { id: string; background: string }>> = {
  "frontend-engineer": { id: "parker", background: "#bed1e4" },
  "backend-engineer": { id: "rowan", background: "#b8d5cc" },
  "fullstack-engineer": { id: "avery", background: "#dfc0b4" },
  "technical-architect": { id: "casey", background: "#c9bfdf" },
  "product-manager": { id: "marlowe", background: "#e0cca2" },
  "project-manager": { id: "mika", background: "#c4d3ad" },
  designer: { id: "scout", background: "#e1c0d0" },
  "qa-engineer": { id: "finley", background: "#b7c6e6" },
  "platform-engineer": { id: "morgan", background: "#c5ced1" },
  "general-agent": { id: "oakley", background: "#ddc7b2" },
};

function Markdown({ children, spec, tasks }: { children: string; spec?: boolean; tasks?: boolean }) {
  return <div className={`${styles.markdown}${spec || tasks ? ` ${styles.specDocument}` : ""}`}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span>{alt || "Image omitted"}</span>,
    ...(spec && {
      h1: ({ children }) => children === "SPEC.md" ? null : <h1>{children}</h1>,
      p: ({ children }) => {
        const items = Children.toArray(children);
        const tail = items.at(-1);
        const timestamp = typeof tail === "string" ? tail.match(/^\s*·\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s*$/)?.[1] : undefined;
        return timestamp ? <p>{items.slice(0, -1)} · <Timestamp value={timestamp} /></p> : <p>{children}</p>;
      },
    }),
  }}>{children}</ReactMarkdown></div>;
}

type PortraitRenderer = (agent: Persona, className: string) => ReactNode;
const PortraitContext = createContext<PortraitRenderer | undefined>(undefined);

export function Portrait({ agent }: { agent: Persona }) {
  const renderPortrait = useContext(PortraitContext);
  const portrait = experimentPortraits[agent.id];
  if (renderPortrait && !portrait) return renderPortrait(agent, styles.portrait);
  if (!portrait && !agent.avatarBrief) {
    const initials = agent.name.split(/[\s-]+/).map((word) => word[0]).join("").toUpperCase();
    return <svg className={styles.portrait} viewBox="0 0 40 50" aria-hidden="true"><rect width="40" height="50" rx="6" fill="#d3ddd6" /><text x="20" y="26" textAnchor="middle" dominantBaseline="middle" fill="#24332b" fontSize="12" fontWeight="600">{initials}</text></svg>;
  }
  // Artwork is local, same-origin, packaged with Chorus, and already optimized SVG.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.portrait} src={asset(portrait?.id ?? agent.id)} alt={`${agent.name} portrait`} width={48} height={60} style={portrait && { backgroundColor: portrait.background }} />;
}

function Profile({ agent }: { agent: Persona }) {
  return <div className={styles.profile}>
    <Portrait agent={agent} />
    <h2>{agent.name}</h2>
    {agent.id === "general-agent" ? <p>No predefined persona</p> : <>
      {agent.role !== agent.name && <p className={styles.eyebrow}>{agent.role}</p>}
      {agent.personality && <p>{agent.introduction}</p>}
      <dl>
        {agent.personality ? <><dt>Personality</dt><dd>{agent.personality}</dd></> : <><dt>Background</dt><dd>{agent.introduction}</dd></>}
        <dt>Traits</dt><dd>{agent.traits.join(" · ")}</dd>
        <dt>Strengths</dt><dd>{agent.strengths}</dd>
        <dt>Weaknesses</dt><dd>{agent.weaknesses}</dd>
      </dl>
    </>}
  </div>;
}

export function ProfileDialog({ agent, close }: { agent: Persona; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} onClose={close} aria-label={`${agent.name} profile`}><button className={styles.close} onClick={() => dialog.current?.close()}>Close profile</button><Profile agent={agent} /></dialog>;
}

export function Metrics({ usage, compact = false }: { usage: Usage; compact?: boolean }) {
  const partial = (count: number) => count ? " (partial)" : "";
  return <dl className={compact ? styles.compactMetrics : styles.metrics}>
    <div><dt>Input tokens{partial(usage.unknownInputCalls)}</dt><dd>{number(usage.inputTokens)}</dd></div>
    <div><dt>Output tokens{partial(usage.unknownOutputCalls)}</dt><dd>{number(usage.outputTokens)}</dd></div>
    <div><dt>Cached tokens{partial(usage.unknownCacheCalls)}</dt><dd>{number(usage.cachedTokens)}</dd></div>
    <div><dt>Cache utilization</dt><dd>{usage.cacheUtilizationPercent === null ? "Unavailable" : `${usage.cacheUtilizationPercent.toFixed(1)}%`}</dd></div>
    <div><dt>Cache used</dt><dd>{usage.cacheUsed === null ? "Unknown" : usage.cacheUsed ? "Yes" : "No"}</dd></div>
    <div><dt>Calls</dt><dd>{usage.callCount}</dd></div>
    <div><dt>Total call time</dt><dd>{(usage.totalLatencyMs / 1000).toFixed(1)} s</dd></div>
    <div><dt>Mean / p95 latency</dt><dd>{(usage.meanLatencyMs / 1000).toFixed(2)} / {(usage.p95LatencyMs / 1000).toFixed(2)} s</dd></div>
    <div><dt>Reported cost</dt><dd>{money(usage.reportedCostUSD)}</dd></div>
    <div><dt>Calls with unknown cost</dt><dd>{usage.unknownCostCalls}</dd></div>
    <div><dt>Estimated cost</dt><dd>{money(usage.estimatedCostUSD)}</dd></div>
    <div><dt>Cache coverage</dt><dd>{usage.cacheCoveredCalls}/{usage.callCount} calls</dd></div>
  </dl>;
}

function useRecords(snapshot: HarnessSnapshot, kind: string, agent?: string, enabled = true) {
  const [result, setResult] = useState<{ key: string; records: HarnessRecord[]; error: string }>({ key: "", records: [], error: "" });
  const currentKey = `${snapshot.id}:${kind}:${agent || ""}`;
  const saved = useRef<{ key: string; cursor: number; records: HarnessRecord[] }>({ key: "", cursor: 0, records: [] });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const key = `${snapshot.id}:${kind}:${agent || ""}`;
    const previous = saved.current.key === key ? saved.current : { key, cursor: 0, records: [] };
    async function read() {
      let cursor = previous.cursor;
      const additions: HarnessRecord[] = [];
      for (;;) {
        const page = await client.records(snapshot.id, kind, cursor, agent);
        additions.push(...page.records);
        cursor = page.cursor;
        if (!active) return;
        if (!page.hasMore) break;
      }
      if (active) {
        const merged = [...new Map([...previous.records, ...additions].map((r) => [r.id, r])).values()];
        saved.current = { key, cursor, records: merged };
        setResult({ key, records: merged, error: "" });
      }
    }
    void read().catch((error: unknown) => { if (active) setResult({ key, records: previous.records, error: error instanceof Error ? error.message : "Could not load records." }); });
    return () => { active = false; };
  }, [snapshot.id, snapshot.revision, kind, agent, enabled]);
  return result.key === currentKey ? result : { records: [], error: "" };
}

function RecordError({ message }: { message: string }) { return message ? <p role="alert">{message}</p> : null; }

function EvidenceDialog({ record, close, experiment }: { record: HarnessRecord; close: () => void; experiment: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} onClose={close} aria-label="Source evidence"><button className={styles.close} onClick={() => dialog.current?.close()}>Close evidence</button><h2>{record.kind === "board" ? "Message board post" : record.kind === "change" ? (experiment ? "SPEC.md change" : "Canvas change") : record.kind === "summary" ? (experiment ? "Private reflection" : "Reasoning summary") : "Supporting record"}</h2><p className={styles.muted}>{!experiment && `Turn ${record.turn} · `}<Timestamp value={record.createdAt} /></p>{record.kind === "board" ? <p>{text(record.data.text)}</p> : record.kind === "change" ? <><p>{text(record.data.reason)}</p><pre className={styles.evidenceText}>{text(record.data.diff)}</pre></> : <pre className={styles.evidenceText}>{JSON.stringify(record.data, null, 2)}</pre>}</dialog>;
}

function EvidenceLinks({ snapshot, ids }: { snapshot: HarnessSnapshot; ids: string[] }) {
  const [record, setRecord] = useState<HarnessRecord | null>(null);
  const [error, setError] = useState("");
  async function open(id: string) { try { setRecord(await client.record(snapshot.id, id)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load source evidence."); } }
  return <div className={styles.evidenceLinks}>{ids.length > 0 && <span className={styles.evidenceLabel}>Supporting records:</span>}{ids.map((id, index) => <button key={id} onClick={() => void open(id)} aria-label={`Open supporting record ${index + 1}`}>Source {index + 1}</button>)}<RecordError message={error} />{record && <EvidenceDialog key={record.id} record={record} experiment={!!snapshot.experiment} close={() => setRecord(null)} />}</div>;
}

// Lets a host open its canvas view without coupling the board to its layout.
export const OpenCanvasContext = createContext<((opener: HTMLButtonElement) => void) | null>(null);

function Board({ snapshot, select, followPosts }: { followPosts?: boolean; snapshot: HarnessSnapshot; select: (id: string) => void }) {
  const { records, error } = useRecords(snapshot, "board");
  const openCanvas = useContext(OpenCanvasContext);
  const feed = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const newest = [...records].sort((a, b) => b.sequence - a.sequence);
  const visible = anchor === null ? newest : newest.filter(record => record.sequence <= anchor);
  const waiting = newest.length - visible.length;
  function mentions(content: string): ReactNode[] {
    return content.split(snapshot.experiment ? /(@[A-Za-z][A-Za-z0-9-]*)/g : /(@[A-Za-z]+)/g).map((part, index) => {
      const agent = part.startsWith("@") ? snapshot.agents.find((a) => (snapshot.experiment ? a.id : a.name) === part.slice(1)) : undefined;
      return agent ? <button className={styles.mention} key={index} onClick={() => select(agent.id)}>{part}</button> : part;
    });
  }
  return <section className={styles.panel} aria-labelledby="board-heading"><div className={styles.panelHeading}><h2 id="board-heading">Message board</h2><small>{snapshot.boardCount} posts{!followPosts && " · one level"}</small></div>{!followPosts && <p className={styles.muted}>One or two sentences per post. Agents can address a peer with @Name.</p>}<RecordError message={error} />
    {waiting > 0 && <button className={styles.newPosts} onClick={() => { setAnchor(null); feed.current?.scrollTo({ top: 0 }); }}>New posts · {waiting}</button>}
    <div className={styles.feed} ref={feed} onScroll={followPosts ? (event) => {
      if (event.currentTarget.scrollTop < 4) setAnchor(null);
      else if (newest.length) setAnchor(current => current ?? newest[0].sequence);
    } : undefined}>{visible.map((record) => {
      const author = snapshot.agents.find(person => person.id === record.agentId);
      return <article key={record.id} id={record.id} className={styles.post}>
        {followPosts && author && <Portrait agent={author} />}
        <div><button className={styles.nameLink} onClick={() => select(record.agentId)}>{author?.name || record.agentId}</button>
          <small>{!snapshot.experiment && `Turn ${record.turn} · `}<Timestamp value={record.createdAt} /></small></div>
        <p>{mentions(text(record.data.text))}</p>
        {openCanvas && <button className={styles.postLink} onClick={event => openCanvas(event.currentTarget)}>{snapshot.experiment ? "Open SPEC.md ↗" : "Open canvas ↗"}</button>}
      </article>;
    })}{!records.length && <p className={styles.empty}>Contributions will appear here as agents begin.</p>}</div>
  </section>;
}

function Changes({ snapshot }: { snapshot: HarnessSnapshot }) {
  const { records, error } = useRecords(snapshot, "change");
  const planning = useRecords(snapshot, snapshot.experiment?.planningCompletions ? "plan_completion" : "vote", undefined, !!snapshot.experiment);
  const timeline = [...records, ...planning.records].sort((a, b) => b.sequence - a.sequence);
  const name = (id: unknown) => snapshot.agents.find((agent) => agent.id === id)?.name;
  return <section className={styles.panel}>
    <div className={`${styles.panelHeading} ${styles.canvasHeading}`}><h2>{snapshot.experiment ? "SPEC.md timeline" : "Canvas changelog"}</h2><small>{snapshot.changeCount} accepted {snapshot.changeCount === 1 ? "change" : "changes"}</small></div>
    <RecordError message={error || planning.error} />
    {timeline.map((record) => <details className={styles.change} key={record.id} id={record.id}>
      <summary>{name(record.agentId)} · {record.kind === "change"
        ? `v${text(record.data.beforeVersion)} → v${text(record.data.afterVersion)}`
        : `${record.kind === "vote" ? "Voted complete" : "Finished planning"} at v${text(record.data.specRevision)}`}<small><Timestamp value={record.createdAt} /></small></summary>
      {record.kind === "change" && <>
        {!!record.data.taskOwnerId && <p>Task owner {name(record.data.taskOwnerId)}</p>}
        <p>{text(record.data.reason)}</p><pre>{text(record.data.diff)}</pre><small>Change {record.id}</small>
      </>}
    </details>)}
    {!timeline.length && <p className={styles.empty}>Accepted edits appear here with their author and diff.</p>}
  </section>;
}

type RepositoryEntries = Map<string, RepositoryTree["entries"]>;

function RepositoryFolder({ path, entries, selected, openFile }: { path: string; entries: RepositoryEntries; selected: string; openFile: (path: string) => void }) {
  const items = entries.get(path) ?? [];
  return <ul role="list" className={styles.repositoryFiles}>{items.map((item) => {
    const name = item.path.slice(item.path.lastIndexOf("/") + 1);
    return <li key={item.path}>{item.kind === "directory" ? (
      <details><summary>{name}/</summary><RepositoryFolder path={item.path} entries={entries} selected={selected} openFile={openFile} /></details>
    ) : item.kind === "submodule" ? <span>{name} (submodule)</span> : (
      <button type="button" aria-pressed={selected === item.path} onClick={() => openFile(item.path)}>{name}{item.kind === "link" && " (link)"}</button>
    )}</li>;
  })}</ul>;
}

function RepositoryBrowser({ snapshot, commits }: { snapshot: HarnessSnapshot; commits: HarnessRecord[] }) {
  const { id, experiment } = snapshot;
  const repository = experiment!.repository;
  const [branch, setBranch] = useState("main");
  const [path, setPath] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<{ branch: string; data?: RepositoryTree; error?: string }>();
  const [preview, setPreview] = useState<{ key: string; data?: RepositoryFile; error?: string }>();
  const branchVersion = branch === "main" ? repository.mainCommit : commits.findLast((record) => record.data.branch === branch)?.id;
  const tree = listing?.branch === branch ? listing.data : undefined;
  const treeRevision = tree?.revision;
  const fileKey = JSON.stringify([branch, treeRevision, path]);

  useEffect(() => {
    let current = true;
    void client.repositoryTree(id, branch).then((data) => {
      if (current) setListing({ branch, data });
    }).catch((error: unknown) => {
      if (current) setListing({ branch, error: error instanceof Error ? error.message : "Could not load the file tree." });
    });
    return () => { current = false; };
  }, [id, branch, branchVersion, refresh]);

  useEffect(() => {
    if (!treeRevision || !path) return;
    let current = true;
    void client.repositoryFile(id, branch, treeRevision, path).then((data) => {
      if (current) setPreview({ key: fileKey, data });
    }).catch((error: unknown) => {
      if (current) setPreview({ key: fileKey, error: error instanceof Error ? error.message : "Could not open this file." });
    });
    return () => { current = false; };
  }, [id, branch, treeRevision, path, fileKey]);

  const entries = useMemo(() => {
    const grouped: RepositoryEntries = new Map();
    for (const entry of tree?.entries ?? []) {
      const parent = entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/")));
      const siblings = grouped.get(parent) ?? [];
      siblings.push(entry);
      grouped.set(parent, siblings);
    }
    for (const siblings of grouped.values()) {
      siblings.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.path.localeCompare(b.path));
    }
    return grouped;
  }, [tree]);
  const file = preview?.key === fileKey ? preview : undefined;
  const listingError = listing?.branch === branch ? listing.error : undefined;
  return <section className={styles.repositoryBrowser} aria-label="Repository file browser">
    <div className={styles.repositoryControls}>
      <label>Branch <select value={branch} onChange={(event) => { setBranch(event.target.value); setPath(""); }}>
        <option value="main">main</option>
        {repository.worktrees.map((worktree) => <option key={worktree.branch} value={worktree.branch}>{worktree.branch}</option>)}
      </select></label>
      {treeRevision && <code title={treeRevision}>{treeRevision.slice(0, 12)}</code>}
      <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh files</button>
    </div>
    {listingError ? <RecordError message={listingError} /> : !tree ? <p role="status">Loading repository files…</p> :
      <div className={styles.repositoryLayout}>
        <div className={styles.repositoryTree} aria-label="File tree" role="region">
          <RepositoryFolder key={branch} path="" entries={entries} selected={path} openFile={setPath} />
          {tree.truncated && <p className={styles.muted}>Showing the first 1,000 entries.</p>}
          {!tree.entries.length && <p className={styles.muted}>This revision has no files.</p>}
        </div>
        <div className={styles.repositoryPreview} aria-label="File preview" role="region">
          {path ? <>
            <h3><code>{path}</code></h3>
            <RecordError message={file?.error ?? ""} />
            {file?.data ? file.data.status === "text" ? (
              <pre tabIndex={0}><code>{file.data.content || "(empty file)"}</code></pre>
            ) : <p className={styles.muted}>{file.data.status === "binary" ? "Binary file." : "File exceeds the 128 KB preview limit."}</p>
              : !file?.error && <p role="status">Loading file…</p>}
          </> : <p className={styles.muted}>Select a file to read its committed contents.</p>}
        </div>
      </div>}
  </section>;
}

export function ExperimentRepositoryView({ snapshot }: { snapshot: HarnessSnapshot }) {
  const commits = useRecords(snapshot, "commit");
  const prs = useRecords(snapshot, "pr");
  const repository = snapshot.experiment?.repository;
  if (!repository) return null;
  return <section className={styles.panel} aria-label="Experiment repository">
    <div className={styles.panelHeading}><h2>Repository</h2><code>main · {repository.mainCommit.slice(0, 12)}</code></div>
    <p><code>{repository.path}</code></p>
    <p>Starter baseline <code>{repository.baselineCommit}</code></p>
    <p>Next.js and React in <code>frontend/</code>. Express and SQLite in <code>backend/</code>.</p>
    <RepositoryBrowser snapshot={snapshot} commits={commits.records} />
    <RecordError message={commits.error || prs.error} />
    {repository.worktrees.map((worktree) => <details className={styles.change} key={worktree.agentId}>
      <summary>{snapshot.agents.find((agent) => agent.id === worktree.agentId)?.name} · <code>{worktree.branch}</code></summary>
      <p><code>{worktree.path}</code></p>
      {commits.records.filter((record) => record.agentId === worktree.agentId).reverse().map((record) => <p key={record.id}><code>{text(record.data.commit).slice(0, 12)}</code> {text(record.data.subject)}</p>)}
    </details>)}
    <h3>Local pull requests</h3>
    {!prs.records.length && <p className={styles.empty}>Pull request activity will appear here during Build.</p>}
    {[...prs.records].reverse().map((record) => <details className={styles.change} key={record.id}>
      <summary><code>{text(record.data.id).slice(0, 8)}</code> · {text(record.data.status)} · {snapshot.agents.find((agent) => agent.id === record.agentId)?.name}</summary>
      <p>{text(record.data.description || record.data.text || record.data.reason)}</p>
      {Array.isArray(record.data.taskIds) && record.data.taskIds.length > 0 && <p>Tasks {record.data.taskIds.map(text).join(", ")}</p>}
      {!!record.data.sourceCommit && <p>Source <code>{text(record.data.sourceCommit)}</code> · target <code>{text(record.data.targetCommit)}</code></p>}
      {!!record.data.diff && <pre>{text(record.data.diff)}</pre>}
    </details>)}
    <h3>Application startup</h3>
    <p className={styles.muted}>No startup observation was recorded.</p>
  </section>;
}

function experimentWorkerStatus(snapshot: HarnessSnapshot, worker: HarnessSnapshot["workers"][number], planned: boolean) {
  if (snapshot.lease?.agentId === worker.agentId) return "Editing SPEC.md";
  if (snapshot.experiment?.phase === "plan" && planned) return "Waiting for Build";
  if (snapshot.experiment?.phase === "plan" && snapshot.status === "running" && worker.state !== "failed") {
    return "Planning";
  }
  if (snapshot.experiment?.phase === "build" && worker.reportedStatus && !["finished", "failed", "paused"].includes(worker.state)) {
    return { working: "Working", waiting: "Waiting", blocked: "Blocked" }[worker.reportedStatus];
  }
  return worker.state === "waiting_lock" ? "Waiting for lock" : labels[worker.state];
}

function AgentUsage({ usage }: { usage: Usage }) {
  const { inputTokens, outputTokens, unknownInputCalls, unknownOutputCalls, callCount, estimatedCostUSD, reportedCostUSD, unknownCostCalls } = usage;
  const subtotal = (value: number, unknown: number) => unknown > 0 && unknown === callCount ? "—" : `${number(value)}${unknown ? "+" : ""}`;
  const estimate = estimatedCostUSD === 0 && (unknownCostCalls || reportedCostUSD) ? "—" : `${money(estimatedCostUSD)}${unknownCostCalls ? "+" : ""}`;
  return <span className={styles.agentUsage}>
    <small title="Input and output tokens. + indicates a partial count. — indicates unavailable data.">
      {subtotal(inputTokens, unknownInputCalls)} in · {subtotal(outputTokens, unknownOutputCalls)} out
    </small>
    <small title="Model calls and estimated cost in USD. + indicates a partial cost. — indicates no estimate available.">
      {number(callCount)} {callCount === 1 ? "call" : "calls"} · {estimate} est.
    </small>
  </span>;
}

function AgentTasks({ snapshot, agent }: { snapshot: HarnessSnapshot; agent: Persona }) {
  const { id, canvasVersion, experiment } = snapshot;
  const [tasks, setTasks] = useState<ExperimentTasks>();
  const [error, setError] = useState("");
  const worker = snapshot.workers.find((item) => item.agentId === agent.id)!;
  const completion = (experiment?.planningCompletions ?? experiment?.votes)?.find((item) => item.agentId === agent.id);
  const legacyVote = experiment?.planningCompletions == null;
  useEffect(() => {
    let current = true;
    void client.agentTasks(id, agent.id).then((value) => {
      if (current) { setTasks(value); setError(""); }
    }).catch((error: unknown) => {
      if (current) setError(error instanceof Error ? error.message : "Could not load this agent’s tasks.");
    });
    return () => { current = false; };
  }, [id, agent.id, canvasVersion]);

  return <section className={styles.agentTasks} role="tabpanel" aria-label="Tasks">
    <h2>{agent.name} tasks</h2>
    <dl className={styles.taskDetails}>
      <div><dt>Status</dt><dd>{experimentWorkerStatus(snapshot, worker, !!completion)}</dd></div>
      <div><dt>{legacyVote ? "Planning vote" : "Planning"}</dt><dd>{completion
        ? `${legacyVote ? "Voted complete" : "Finished planning"} at SPEC.md v${completion.specRevision}`
        : legacyVote ? "No completion vote recorded" : "No completion recorded"}</dd></div>
      {worker.currentTask && <div><dt>{worker.state === "finished" ? "Last reported task" : "Current task"}</dt><dd>{worker.currentTask}</dd></div>}
      {worker.reason && <div><dt>Agent note</dt><dd>{worker.reason}</dd></div>}
    </dl>
    <h3>To-do list {tasks && <small>SPEC.md v{tasks.revision}</small>}</h3>
    <RecordError message={error} />
    {tasks ? tasks.markdown ? <>
      <p role="status">{tasks.total ? `${tasks.completed} of ${tasks.total} complete` : "Completion status wasn’t recorded for this list."}</p>
      <Markdown tasks>{tasks.markdown}</Markdown>
    </> :
      <p className={styles.muted}>No to-do items recorded in SPEC.md.</p> :
      !error && <p role="status">Loading tasks…</p>}
    {worker.remainingTasks.length > 0 && <>
      <h3>Why items remain open</h3>
      <ul>{worker.remainingTasks.map(({ task, reason }) => <li key={task}><strong>{task}</strong> · {reason}</li>)}</ul>
    </>}
  </section>;
}

function AgentInspector({ snapshot, agent, usage, close }: { snapshot: HarnessSnapshot; agent: Persona; usage?: Usage; close: () => void }) {
  const experiment = !!snapshot.experiment;
  const defaultTab = experiment ? "Tasks" : "Profile";
  const [selectedTab, setTab] = useState<string>(defaultTab);
  const canReadSummaries = !experiment || snapshot.status === "completed" || snapshot.status === "killed";
  const { records, error } = useRecords(snapshot, "summary", agent.id, canReadSummaries);
  const summaries = canReadSummaries ? records.filter(({ data }) => data.status === "available") : [];
  const tabNames = [...(experiment ? ["Tasks"] : []), "Profile", ...(summaries.length ? ["Reasoning summaries"] : [])];
  const tab = tabNames.includes(selectedTab) ? selectedTab : defaultTab;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.dialog} onClose={close} aria-label={`${agent.name} details`}><button className={styles.close} onClick={() => dialog.current?.close()}>Close</button><div className={styles.tabs} role="tablist" aria-label="Agent details">{tabNames.map((name, index) => <button key={name} role="tab" aria-selected={tab === name} tabIndex={name === tab ? 0 : -1}
      onKeyDown={event => {
        const destinations: Record<string, number> = { ArrowRight: (index + 1) % tabNames.length, ArrowLeft: (index + tabNames.length - 1) % tabNames.length, Home: 0, End: tabNames.length - 1 };
        const next = destinations[event.key];
        if (next === undefined) return;
        event.preventDefault(); setTab(tabNames[next]);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }} onClick={() => setTab(name)}>{name}</button>)}</div>
    {tab === "Tasks" ? <AgentTasks snapshot={snapshot} agent={agent} /> : tab === "Profile" ? <><Profile agent={agent} />{usage && <Metrics usage={usage} compact />}</> :
      <section role="tabpanel" aria-label="Reasoning summaries">
        <h2>{agent.name} · Reasoning summaries</h2>
        <RecordError message={error} />
        {summaries.map((record) => <article className={styles.inspection} key={record.id} id={record.id}>
          <small>{!experiment && `Turn ${record.turn} · `}<Timestamp value={record.createdAt} /></small>
          {experiment ? <p>{text(record.data.decision)}</p> : <dl>
            {["approach", "assumptions", "decision", "uncertainties"].map((key) => {
              const value = record.data[key];
              const description = Array.isArray(value) ? value.map((item) => readableEvaluationText(text(item))).filter(Boolean).join(" · ") : readableEvaluationText(text(value));
              return <div key={key}><dt>{key}</dt><dd>{description || "None stated"}</dd></div>;
            })}
          </dl>}
          {Array.isArray(record.data.evidenceRefs) && <EvidenceLinks snapshot={snapshot} ids={record.data.evidenceRefs.filter((value): value is string => typeof value === "string")} />}
        </article>)}
      </section>}
  </dialog>;
}

function Scene({ snapshot, select }: { snapshot: HarnessSnapshot; select: (id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  return <section className={styles.scenePanel} aria-labelledby="scene-heading"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Nanoville research commons</p><h2 id="scene-heading">{snapshot.agents.length} independent minds</h2></div><label>Scene zoom <input aria-label="Scene zoom" type="range" min="0.65" max="1.5" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label></div><p className={styles.muted}>Pan the commons to explore. Select anyone here or in the roster to inspect their work.</p><div className={styles.sceneViewport}><div className={styles.scene} style={{ width: `${Math.max(720, Math.min(snapshot.agents.length, 10) * 118) * zoom}px` }}>
    {snapshot.agents.map((agent, index) => {
      const worker = snapshot.workers.find((w) => w.agentId === agent.id)!;
      const editing = snapshot.lease?.agentId === agent.id;
      const active = snapshot.status === "running" && worker.state === "running";
      const animation = editing ? styles.editing : active ? styles.working : styles.idle;
      const paused = snapshot.status !== "running" || ["paused", "finished", "capped", "failed"].includes(worker.state);
      return <button key={agent.id} className={`${styles.character} ${editing ? styles.lockHolder : ""}`} style={{ minHeight: `${128 * zoom}px` }} onClick={() => select(agent.id)} aria-label={`${agent.name}, ${editing ? "editing canvas" : labels[worker.state]}, turn ${worker.currentTurnIndex} of ${snapshot.config.maxTurnsPerAgent}`}><span className={styles.deskNumber}>{String(index + 1).padStart(2, "0")}</span><span role="img" aria-label={`${agent.name} animated sprite`} className={`${styles.sprite} ${animation} ${paused ? styles.still : ""}`} style={{ backgroundImage: `url("${asset(experimentPortraits[agent.id]?.id ?? agent.id, "sprite")}")`, transform: `scale(${zoom})` } as CSSProperties} /><strong>{agent.name}</strong><small>{editing ? "Editing canvas" : labels[worker.state]}</small></button>;
    })}
  </div></div></section>;
}

type Score = number | "not_assessable" | "not_applicable";

function ScoreBreakdown({ scores, criteria, label }: { scores: Score[]; criteria: string[]; label: string }) {
  return <div className={styles.scoreBreakdown} aria-label={label}>
    {scores.map((score, index) => <div className={styles.scoreRow} key={`${criteria[index]}-${index}`}>
      <span className={styles.scoreLabel}>{criteria[index] || `Criterion ${index + 1}`}</span>
      {typeof score === "number" ? <><div className={styles.scoreTrack} role="img" aria-label={`${criteria[index] || `Criterion ${index + 1}`}: ${score} out of 4`}>
        <span style={{ width: `${Math.max(0, Math.min(4, score)) * 25}%` }} />
      </div>
      <strong className={styles.scoreValue}>{score}<span>/4</span></strong></> :
        <span className={styles.muted}>{score === "not_assessable" ? "Not assessable" : "Not applicable"}</span>}
    </div>)}
  </div>;
}

type ExperimentReport = NonNullable<NonNullable<HarnessSnapshot["experiment"]>["report"]>;

function ExperimentScorecard({ snapshot, scores, criteria, label }: { snapshot: HarnessSnapshot; scores: ExperimentReport["application"]; criteria: string[]; label: string }) {
  const scored = scores.flatMap(({ score }) => typeof score === "number" ? [score] : []);
  return <div>
    <p>{scored.length ? `${scored.reduce((sum, score) => sum + score, 0)}/${scored.length * 4} · ` : ""}{scored.length} of {criteria.length} criteria scored</p>
    <ScoreBreakdown scores={scores.map(({ score }) => score)} criteria={criteria} label={label} />
    {scores.map((criterion, index) => <details className={styles.change} key={criteria[index]}>
      <summary>{criteria[index]} evidence</summary><p>{criterion.explanation}</p>
      <EvidenceLinks snapshot={snapshot} ids={criterion.evidenceIds} />
    </details>)}
  </div>;
}

function ExperimentResults({ snapshot }: { snapshot: HarnessSnapshot }) {
  const experiment = snapshot.experiment!;
  const report = experiment.report;
  const contextFailures = snapshot.workers.filter((worker) => worker.state === "failed" && worker.failureCode === "CONTEXT_LIMIT");
  return <section className={`${styles.panel} ${styles.evaluation}`} aria-label="Experiment results">
    <h2>Experiment results</h2>
    {experiment.frozen && <p>Evaluated main commit <code>{experiment.frozen.mainCommit}</code> · SPEC.md v{experiment.frozen.specRevision}</p>}
    {contextFailures.length > 0 && <p>Context limit exceeded by {contextFailures.map((worker) => snapshot.agents.find((agent) => agent.id === worker.agentId)?.name || worker.agentId).join(", ")} during {experiment.frozen ? "Build" : "Plan"}.</p>}
    {snapshot.workers.some((worker) => worker.state === "failed" && worker.failureCode !== "CONTEXT_LIMIT") && <p>One or more agents stopped after a provider or runtime failure.</p>}
    {snapshot.status === "killed" && <p>Experiment killed. The repository and recorded activity are preserved.</p>}
    {snapshot.status === "judge_failed" && <p>The judge did not finish a report. Attempts recorded {experiment.judgeAttempts}.</p>}
    {snapshot.status === "reviewing" && <p role="status">Judge report pending.</p>}
    {report && <>
      <p className={styles.summaryText}>{report.summary}</p>
      <section className={styles.evaluationSummary}><h3>Application quality</h3>
        <ExperimentScorecard snapshot={snapshot} label="Application quality scores" scores={report.application} criteria={["Runnability", "Core functionality", "Usability", "Integration and persistence", "Implementation quality"]} />
        <h4>Missing work</h4>
        {report.missingWork.length ? <ul>{report.missingWork.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>None identified by the judge.</p>}
      </section>
      <section className={styles.agentEvaluations}><h3>Individual contributions</h3>
        {report.agents.map((card) => <details className={styles.agentEvaluation} key={card.agentId}>
          <summary>{snapshot.agents.find((agent) => agent.id === card.agentId)?.name || card.agentId}</summary>
          <ExperimentScorecard snapshot={snapshot} label="Individual contribution scores" scores={card.criteria} criteria={["Planning contribution", "Delivered contribution", "Quality and correctness", "Verification and handoff", "Collaboration"]} />
        </details>)}
      </section>
      <section className={styles.conversationEvaluation}><h3>Collaboration</h3>
        <ExperimentScorecard snapshot={snapshot} label="Collaboration scores" scores={report.collaboration} criteria={["Shared specification", "Task distribution", "Dependency handling", "Feedback and disagreement", "Integrated outcome"]} />
      </section>
    </>}
  </section>;
}

function Report({ snapshot }: { snapshot: HarnessSnapshot }) {
  if (snapshot.experiment) return <ExperimentResults snapshot={snapshot} />;
  const report = snapshot.report;
  const teamCriteria = ["Evidence quality", "Relevance", "Coordination", "Handling disagreement", "Actionable synthesis"];
  const agentCriteria = ["Useful contribution", "Technical accuracy", "Collaboration", "Stated reasoning summary", "Response to corrections"];
  const totalConversationScore = report?.conversationScores.reduce((total, score) => total + score, 0) ?? 0;
  return <section className={`${styles.panel} ${styles.evaluation}`} aria-labelledby="evaluation-heading">
    <div className={styles.evaluationHeader}><div><p className={styles.eyebrow}>Session results</p><h2 id="evaluation-heading">Final evaluation</h2></div><small>{snapshot.endedEarly ? "Stopped early" : "Final results"}</small></div>
    {snapshot.verification ? <div className={`${styles.verdict} ${snapshot.verification.status === "correct" ? styles.correct : ""}`}><div><small>Solution check</small><strong>Solution {snapshot.verification.status}</strong></div><p>{snapshot.verification.checks.join(" ")}</p><small>Automatic check · Canvas version {snapshot.verification.canvasVersion}</small></div> : <p className={styles.empty}>Solution checks and judging appear after all agents finish.</p>}
    {report ? <>
      <section className={styles.evaluationSummary} aria-labelledby="evaluation-summary-heading"><div className={styles.evaluationSectionHeading}><div><p className={styles.eyebrow}>Judge summary</p><h3 id="evaluation-summary-heading">What the team achieved</h3></div></div><p className={styles.summaryText}>{readableEvaluationText(report.summary)}</p></section>
      <section className={styles.conversationEvaluation} aria-labelledby="conversation-evaluation-heading">
        <div className={styles.evaluationSectionHeading}><div><p className={styles.eyebrow}>Team-level assessment</p><h3 id="conversation-evaluation-heading">Collaboration</h3><p className={styles.muted}>How well the team worked together on the message board.</p></div><div className={styles.totalScore}><strong>{totalConversationScore}<span>/20</span></strong><small>team score</small></div></div>
        <ScoreBreakdown scores={report.conversationScores} criteria={teamCriteria} label="Team collaboration scores" />
        <p className={styles.explanation}>{readableEvaluationText(report.conversationExplanation)}</p>
        <EvidenceLinks snapshot={snapshot} ids={report.conversationEvidenceIds} />
      </section>
      <section className={styles.agentEvaluations} aria-labelledby="agent-evaluations-heading">
        <div className={styles.evaluationSectionHeading}><div><p className={styles.eyebrow}>Individual assessment</p><h3 id="agent-evaluations-heading">Agent evaluations</h3><p className={styles.muted}>Open an agent to see their rubric scores, explanation, and supporting records.</p></div><small>{report.agents.length} agents</small></div>
        <div className={styles.agentEvaluationList}>{report.agents.map((grade) => {
          const agent = snapshot.agents.find((item) => item.id === grade.agentId);
          const total = grade.scores.reduce((sum, score) => sum + score, 0);
          return <details className={styles.agentEvaluation} key={grade.agentId}>
            <summary><span className={styles.agentEvaluationName}>{agent?.name || grade.agentId}</span><span className={styles.agentEvaluationBadges}>{grade.insufficientEvidence && <span className={styles.limitedEvidence}>Limited evidence</span>}<span className={styles.agentTotal}>{total}<small>/20</small></span></span></summary>
            <div className={styles.agentEvaluationBody}><ScoreBreakdown scores={grade.scores} criteria={agentCriteria} label={`${agent?.name || grade.agentId} evaluation scores`} /><p className={styles.explanation}>{readableEvaluationText(grade.explanation)}</p><EvidenceLinks snapshot={snapshot} ids={grade.evidenceIds} /></div>
          </details>;
        })}</div>
      </section>
      <div className={styles.evaluationFooter}><span>{report.coveredRecordIds.length} source records reviewed</span><span>Completed <Timestamp value={report.completedAt} /></span></div>
    </> : snapshot.status === "reviewing" || snapshot.frozenSequence !== null ? <p role="status" className={styles.pendingEvaluation}>{snapshot.config.judgeEnabled ? "Judge report pending. Saved progress will be reused on retry." : "Narrative judge disabled for this run."}</p> : null}
  </section>;
}

export type SceneProps = { snapshot: HarnessSnapshot; select: (id: string) => void; selected: string | null };
export type WorkspaceParts = Record<"heading" | "error" | "metrics" | "scene" | "roster" | "board" | "canvas" | "changes" | "report" | "inspector", ReactNode>;
export type RunControls = {
  snapshot: HarnessSnapshot;
  usage: HarnessUsage | null;
  busy: boolean;
  act: (action: HarnessAction) => Promise<boolean>;
  leave: () => void;
};
export type HarnessPresentation = {
  followPosts?: boolean;
  portrait?: PortraitRenderer;
  brand?: ReactNode;
  className?: string;
  setup?: (agents: Persona[]) => ReactNode;
  scene?: (props: SceneProps) => ReactNode;
  workspace?: (parts: WorkspaceParts, controls: RunControls) => ReactNode;
};

export function LiveSession({ snapshot, receive, mode, leave, presentation }: { presentation?: HarnessPresentation; snapshot: HarnessSnapshot; receive: (s: HarnessSnapshot) => void; mode: "chorus" | "nanoville"; leave: () => void }) {
  const [usage, setUsage] = useState<HarnessUsage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const commandPending = useRef(false);
  const [connectionError, setConnectionError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => client.subscribe(snapshot.id, -1, (next) => { setConnectionError(""); receive(next); }, setConnectionError), [snapshot.id, receive]); // latest revision is recovered on connect
  useEffect(() => {
    let active = true;
    void client.usage(snapshot.id).then((value) => { if (active) setUsage(value); }).catch((error: unknown) => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [snapshot.id, snapshot.revision]);
  async function act(action: HarnessAction) {
    if (commandPending.current) return false;
    commandPending.current = true;
    setBusy(true); setError("");
    try { receive(await client.command(snapshot.id, action)); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "Command failed."); return false; }
    finally { commandPending.current = false; setBusy(false); }
  }
  const agent = snapshot.agents.find((a) => a.id === selected);
  const active = snapshot.status === "running" || snapshot.status === "reviewing";
  const experiment = snapshot.experiment;
  const parts: WorkspaceParts = {
    heading: <div className={styles.sessionTitle}><div><p className={styles.eyebrow}>Session {snapshot.id.slice(0, 8)} · {snapshot.config.model}</p><h1>{snapshot.problem.title}</h1><p>{snapshot.status} · {snapshot.agents.length} agents · {snapshot.config.maxTurnsPerAgent} turns per agent</p></div><div className={styles.actions}>{snapshot.status === "ready" && <button disabled={busy} onClick={() => void act("start")}>Start session</button>}{active && <button disabled={busy} onClick={() => void act("pause")}>Pause</button>}{snapshot.status === "paused" && <button disabled={busy} onClick={() => void act("resume")}>Resume</button>}{!["completed", "stopped"].includes(snapshot.status) && !snapshot.endedEarly && <button disabled={busy} onClick={() => void act("stop")}>Stop and evaluate</button>}<button disabled={busy} onClick={() => { if (active) { void act("pause").then((ok) => { if (ok) leave(); }); } else leave(); }}>Back to setup</button></div></div>,
    error: <RecordError message={error || connectionError || snapshot.error} />,
    metrics: usage && <section className={styles.topMetrics} aria-label="Session totals"><p className={styles.eyebrow}>Participant totals · {snapshot.agents.length} agents</p><Metrics usage={usage.participants} /><div className={styles.costFooter}><span>Judge: {money(usage.judge.reportedCostUSD + usage.judge.estimatedCostUSD)}</span><span>Session: {money(usage.total.reportedCostUSD + usage.total.estimatedCostUSD)}{usage.total.estimatedCostUSD > 0 ? " including estimates" : ""}</span><span>Wall time: {(usage.wallTimeMs / 1000).toFixed(0)} s</span></div></section>,
    scene: presentation?.scene ? presentation.scene({ snapshot, select: setSelected, selected }) : mode === "nanoville" ? <Scene snapshot={snapshot} select={setSelected} /> : null,
    roster: <section className={styles.roster}><div className={styles.panelHeading}><h2>Participants</h2></div><div className={styles.liveRoster}>{snapshot.agents.map((agent) => {
      const worker = snapshot.workers.find((w) => w.agentId === agent.id)!;
      const totals = usage?.agents[agent.id];
      if (experiment) {
        const planned = (experiment.planningCompletions ?? experiment.votes).some((item) => item.agentId === agent.id);
        const completion = experiment.phase === "plan" && planned ? (experiment.planningCompletions ? "Finished planning" : "Voted complete") :
          experiment.phase === "build" && worker.state === "finished" ? "Finished building" : null;
        return <button key={agent.id} className={styles.agentRow} onClick={() => setSelected(agent.id)}>
          <Portrait agent={agent} />
          <span>
            <span className={styles.workerHeading}>
              <strong>{agent.name}</strong>
              {completion && <span className={styles.voteCheck} role="img" aria-label={completion} title={completion}>✓</span>}
            </span>
            <small>{experimentWorkerStatus(snapshot, worker, planned)}</small>
            {totals && <AgentUsage usage={totals} />}
          </span>
        </button>;
      }
      const stateLabel = snapshot.lease?.agentId === agent.id ? `Editing canvas · ${labels[worker.state]}` : labels[worker.state];
      return <button key={agent.id} className={styles.agentRow} onClick={() => setSelected(agent.id)}>
        <Portrait agent={agent} />
        <span>
          <span className={styles.workerHeading}><strong>{agent.name}</strong><i className={styles.workerStatusDot} data-state={worker.state} title={stateLabel} role="img" aria-label={stateLabel} /></span>
          <small>Turn {worker.currentTurnIndex} / {snapshot.config.maxTurnsPerAgent} · {worker.turnsCompleted} completed</small>
          <progress aria-label={`${agent.name} turn progress`} max={snapshot.config.maxTurnsPerAgent} value={worker.turnsCompleted} />
          {totals && <small>{number(totals.inputTokens)} in · {number(totals.outputTokens)} out · {money(totals.reportedCostUSD)} reported · {money(totals.estimatedCostUSD)} est.{totals.unknownCostCalls > 0 && " · partial cost"}</small>}
        </span>
      </button>;
    })}</div></section>,
    board: <Board followPosts={presentation?.followPosts} snapshot={snapshot} select={setSelected} />,
    canvas: <section className={styles.panel}><div className={`${styles.panelHeading} ${styles.canvasHeading}`}><h2>{experiment ? "SPEC.md" : "Shared canvas"}</h2><small>v{snapshot.canvasVersion} · {snapshot.lease ? `${snapshot.agents.find((a) => a.id === snapshot.lease?.agentId)?.name} holds the lock` : "Lock available"}</small></div>{snapshot.canvas ? <Markdown spec={!!experiment}>{snapshot.canvas}</Markdown> : <p className={styles.empty}>The team will build its combined solution here.</p>}<div className={styles.actions}><a href={`${client.base}/sessions/${snapshot.id}/export?format=markdown`} download>{experiment ? "Export SPEC.md" : "Export canvas"}</a><a href={`${client.base}/sessions/${snapshot.id}/export`} download>Export complete session</a></div></section>,
    changes: <Changes snapshot={snapshot} />,
    report: <Report snapshot={snapshot} />,
    inspector: agent && <AgentInspector key={agent.id} snapshot={snapshot} agent={agent} usage={usage?.agents[agent.id]} close={() => setSelected(null)} />,
  };
  if (presentation?.workspace) {
    // act only consults the command lock when a control invokes it.
    // eslint-disable-next-line react-hooks/refs
    return presentation.workspace(parts, { snapshot, usage, busy, act, leave });
  }
  return <>{parts.heading}{parts.error}{parts.metrics}{parts.scene}{parts.roster}<div className={styles.workGrid}>{parts.board}{parts.canvas}</div>{parts.changes}{parts.report}{parts.inspector}</>;

}

export function LegacyArchive({ id, newSessionHref = "/" }: { id: string; newSessionHref?: string }) {
  const [value, setValue] = useState<LegacySnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void legacyClient.get(id).then((v) => { if (active) setValue(v); }).catch((e: unknown) => { if (active) setError(String(e)); }); return () => { active = false; }; }, [id]);
  return <section className={styles.panel}><p className={styles.eyebrow}>Historical session · read only</p><RecordError message={error} />{value ? <><h1>{value.scenario.title}</h1><Markdown>{value.canvas}</Markdown><h2>Conversation</h2>{value.turns.map((turn, i) => <p key={i}><strong>{turn.speakerName}</strong> {turn.text}</p>)}<a href={`/api/chorus/sessions/${encodeURIComponent(id)}/export?format=json&includeJournals=true`} download>Export archived session with journals</a></> : !error && <p>Loading saved session…</p>}<p><a href={newSessionHref}>Start a new harness session</a></p></section>;
}

export function ArchiveBrowser() {
  const [sessions, setSessions] = useState<LegacySnapshot[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; void legacyClient.list().then((value) => { if (active) setSessions(value); }).catch((e: unknown) => { if (active) setError(String(e)); }); return () => { active = false; }; }, []);
  return <main className={styles.app}><header className={styles.header}><Link href="/" className={styles.brand}>The Chorus Project<span>Start a new harness session</span></Link></header><div className={styles.intro}><h1>Saved sessions</h1><p>Historical work remains readable and exportable under its original semantics.</p></div><RecordError message={error} />{sessions.map((session) => <article className={styles.panel} key={session.id}><h2><Link href={`/?session=${session.id}`}>{session.scenario.title}</Link></h2><p><Timestamp value={session.createdAt} /> · {session.agents.length} participants · {session.status}</p><small>{session.id}</small></article>)}</main>;
}

export function HarnessApp({ mode = "chorus", presentation }: { mode?: "chorus" | "nanoville"; presentation?: HarnessPresentation }) {
  const [catalog, setCatalog] = useState<HarnessCatalog | null>(null);
  const [problemId, setProblemId] = useState("");
  const [roster, setRoster] = useState<string[]>([]);
  const [adversaries, setAdversaries] = useState<string[]>([]);
  const [model, setModel] = useState("gpt-6-luna");
  const [judgeModel, setJudgeModel] = useState<string | null>(null);
  const [cap, setCap] = useState(10);
  const [judge, setJudge] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const [agentCategory, setAgentCategory] = useState("All");
  const [snapshot, setSnapshot] = useState<HarnessSnapshot | null>(null);
  const [legacyId, setLegacyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const latest = useRef<HarnessSnapshot | null>(null);
  const receive = useCallback((next: HarnessSnapshot) => {
    if (latest.current && (next.id !== latest.current.id || next.revision <= latest.current.revision)) return;
    latest.current = next;
    setSnapshot(next);
    localStorage.setItem(storageKey, next.id);
  }, []);
  useEffect(() => {
    let active = true;
    void client.catalog().then((value) => { if (active) { setCatalog(value); setProblemId(value.problems[0].id); setRoster(value.problems[0].participantIds); setModel(value.defaultModel); } }).catch((e: unknown) => { if (active) setError(String(e)); });
    const id = new URLSearchParams(window.location.search).get("session") || localStorage.getItem(storageKey);
    if (id) { void client.get(id).then((next) => { if (active) receive(next); }).catch((e: unknown) => { if (active) { if (e instanceof HarnessError && e.code === "NOT_FOUND") setLegacyId(id); else setError(String(e)); } }).finally(() => { if (active) setRestoring(false); }); }
    else { queueMicrotask(() => { if (active) setRestoring(false); }); }
    return () => { active = false; };
  }, [receive]);
  async function start() {
    if (!catalog) return;
    setBusy(true); setError("");
    try {
      const created = await client.createRun({ problemId, participantIds: roster, adversaryIds: adversaries, model, judgeModel, maxTurnsPerAgent: cap, judgeEnabled: judge });
      receive(created);
      receive(await client.command(created.id, "start"));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start the session."); }
    finally { setBusy(false); }
  }
  function leave() { setSnapshot(null); latest.current = null; localStorage.removeItem(storageKey); const url = new URL(window.location.href); url.searchParams.delete("session"); window.history.replaceState({}, "", url); }
  const problem = catalog?.problems.find((p) => p.id === problemId);
  const selectedModel = catalog?.models.find((m) => m.id === model);
  const selectedJudgeModel = catalog?.models.find((m) => m.id === (judgeModel ?? model));
  const inspected = catalog?.agents.find((a) => a.id === profile);
  const agentCategories = catalog ? ["All", ...Array.from(new Set(catalog.agents.map((agent) => agent.domain).filter(Boolean))).sort()] : [];
  return <PortraitContext.Provider value={presentation?.portrait}><main className={`${styles.app} ${presentation?.className || ""}`}><header className={styles.header}><Link href="/" className={styles.brand}>{presentation?.brand || (mode === "nanoville" ? "nanoville" : "The Chorus Project")}</Link></header>
    {legacyId ? <LegacyArchive id={legacyId} /> : snapshot ? <LiveSession key={snapshot.id} snapshot={snapshot} receive={receive} mode={mode} leave={leave} presentation={presentation} /> : <><div className={styles.intro}><h1>Set up an experiment</h1><p>Choose a problem, assemble a team, and watch independent agents discuss, revise, and build a shared solution.</p></div><RecordError message={error} />{!catalog || restoring ? <p role="status">Connecting to Chorus…</p> : <div className={styles.setup}>{presentation?.setup && <div className={styles.setupPresentation}>{presentation.setup(catalog.agents.filter((agent) => roster.includes(agent.id)))}</div>}<section className={styles.configuration}><h2>01 · Choose a problem</h2><label className={styles.field}>Problem<select value={problemId} onChange={(e) => { const p = catalog.problems.find((p) => p.id === e.target.value)!; setProblemId(p.id); setRoster(p.participantIds); setAdversaries([]); }} aria-label="Problem">{catalog.problems.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>{problem && <><p className={styles.eyebrow}>{problem.domain}</p><details open><summary>Problem statement</summary><pre className={styles.statement}>{problem.statement}</pre></details></>}<h2>02 · Set the run</h2><label className={styles.field}>Model<select aria-label="Model" value={model} onChange={(e) => setModel(e.target.value)}>{catalog.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.available === false ? " · unavailable" : ""}</option>)}</select></label>{selectedModel?.available === false && <p role="status" className={styles.warning}>{selectedModel.unavailableReason}</p>}{selectedModel?.compatibilityNote && <p role="status" className={styles.warning}>{selectedModel.compatibilityNote}</p>}<label className={styles.field}>Turns per agent<input type="number" aria-label="Turns per agent" min={1} max={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></label><label className={styles.check}><input type="checkbox" checked={judge} onChange={(e) => setJudge(e.target.checked)} /> Final judge</label>{judge && <label className={styles.field}>Judge model<select aria-label="Judge model" value={judgeModel ?? model} onChange={(e) => setJudgeModel(e.target.value)}>{catalog.models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.available === false ? " · unavailable" : ""}</option>)}</select></label>}<p className={styles.muted}>Judging starts after all agents finish or reach their turn cap.</p><div className={styles.startBox}><strong>{roster.length} agents × {cap} turns</strong><p>At most {roster.length * cap} contribution cycles.</p><button className={styles.primary} disabled={busy || roster.length < 2 || roster.length > 50 || !Number.isInteger(cap) || cap < 1 || cap > 100 || selectedModel?.available === false || (judge && selectedJudgeModel?.available === false)} onClick={() => void start()}>{busy ? "Starting…" : "Start session"}</button><small>{roster.length < 2 ? "Select at least two agents." : "A cycle can include up to three concise board posts."}</small></div></section><section><div className={styles.panelHeading}><div><h2>03 · Your team</h2><p className={styles.muted}>Relevant agents are selected for you. Add or remove anyone.</p></div><strong>{roster.length} selected</strong></div><div className={styles.categoryGroup} role="group" aria-label="Filter agents by category">{agentCategories.map((category) => <button type="button" key={category} aria-pressed={agentCategory === category} className={agentCategory === category ? styles.categoryActive : ""} onClick={() => setAgentCategory(category)}>{category}</button>)}</div><div className={styles.catalogGrid}>{catalog.agents.filter((agent) => agentCategory === "All" || agent.domain === agentCategory).map((agent) => <article className={`${styles.personaCard} ${roster.includes(agent.id) ? styles.selected : ""}`} key={agent.id} role="button" tabIndex={0} aria-label={`View ${agent.name} profile`} onClick={(event) => { if ((event.target as HTMLElement).closest("input, label")) return; setProfile(agent.id); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !(event.target as HTMLElement).closest("input, label")) { event.preventDefault(); setProfile(agent.id); } }}><div className={styles.personaSelect}><input type="checkbox" aria-label={`Select ${agent.name}`} checked={roster.includes(agent.id)} onChange={(e) => { setRoster(e.target.checked ? [...roster, agent.id] : roster.filter((id) => id !== agent.id)); if (!e.target.checked) setAdversaries(adversaries.filter((id) => id !== agent.id)); }} /><Portrait agent={agent} /><span><strong>{agent.name}</strong><small>{agent.role}</small></span></div>{roster.includes(agent.id) && <label className={styles.adversary}><input type="checkbox" aria-label={`${agent.name} private adversary`} checked={adversaries.includes(agent.id)} onChange={(e) => setAdversaries(e.target.checked ? [...adversaries, agent.id] : adversaries.filter((id) => id !== agent.id))} /> Private adversary</label>}</article>)}</div>{inspected && <ProfileDialog agent={inspected} close={() => setProfile(null)} /> }</section></div>}</>}
  </main></PortraitContext.Provider>;
}
