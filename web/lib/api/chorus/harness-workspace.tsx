"use client";

// Shared product UI. Source: chorus/sdk; generated into both applications.
import { Children, createContext, useContext, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { Heading, List, ListItem, PhrasingContent, Root, RootContent } from "mdast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { HarnessClient, HarnessError } from "./harness-client";
import type { ExperimentTasks, HarnessAction, HarnessCatalog, HarnessSnapshot, HarnessRecord, HarnessUsage, Persona, RepositoryCommitDiff, RepositoryFile, RepositoryTree, Usage } from "./harness-client";
import { ChorusClient } from "./client";
import type { Snapshot as LegacySnapshot } from "./client";
import { RepositoryFileViewer } from "./repository-viewer";
import styles from "./harness-workspace.module.css";

const client = new HarnessClient();
const legacyClient = new ChorusClient();
const storageKey = "chorus.harness.session";
const labels: Record<string, string> = { queued: "Ready", running: "Working", waiting_model: "Waiting for model", waiting_lock: "Waiting for canvas", paused: "Paused", finished: "Finished", capped: "Turn cap reached", failed: "Failed" };
const money = (value: number) => `$${value.toFixed(6)}`;
const unknownValue = <span className="chorus-unknown" title="Unknown: the provider did not report this value">—<span className={styles.srOnly}> Unknown</span></span>;
const number = (value: number) => value.toLocaleString();
const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "always" });
const timeListeners = new Set<() => void>();
let timeNow = Date.now();
let timeTimer: ReturnType<typeof setInterval> | undefined;

type SelectOption = { value: string; label: string; group?: string };
export type HarnessSelectProps = {
  label: string;
  value: string | null;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  container?: RefObject<HTMLElement | null>;
};

// Hosts supply their own select without coupling this shared workspace to a UI kit.
export const HarnessSelectContext = createContext<((props: HarnessSelectProps) => ReactNode) | null>(null);

function WorkspaceSelect(props: HarnessSelectProps) {
  const renderSelect = useContext(HarnessSelectContext);
  if (renderSelect) return renderSelect(props);
  const groups = new Set(props.options.map((option) => option.group));
  return (
    <select aria-label={props.label} value={props.value ?? ""} onChange={(event) => props.onValueChange(event.target.value)}>
      {props.placeholder && <option value="" disabled>{props.placeholder}</option>}
      {[...groups].map((group) => {
        const options = props.options.filter((item) => item.group === group)
          .map(({ value, label }) => <option key={value} value={value}>{label}</option>);
        return group ? <optgroup key={group} label={group}>{options}</optgroup> : options;
      })}
    </select>
  );
}

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

export function Timestamp({ value, format = "seconds" }: { value: string; format?: "seconds" | "short" | "full" | "relative" }) {
  const now = useSyncExternalStore(subscribeTime, () => timeNow, () => null);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <>{value}</>;
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
  if (format === "seconds" || format === "relative") options.second = "2-digit";
  const exact = date.toLocaleString(undefined, format === "full" ? undefined : options);
  const relative = now === null ? null : relativeLabel((date.getTime() - now) / 1000);
  if (format === "relative") return <time dateTime={value} title={exact}>{relative ?? exact}</time>;
  return <time dateTime={value}>{exact}{relative && <> <span>({relative})</span></>}</time>;
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

type SpecSection = "document" | "tasks" | "history";
type SpecMarkdown = { section: SpecSection; agents: Persona[]; owner?: string };
const specParser = unified().use(remarkParse).use(remarkGfm).freeze();

function checklistItems(list: List): ListItem[] {
  return list.children.flatMap((item) => [item, ...item.children.flatMap((child) => child.type === "list" ? checklistItems(child) : [])]);
}

function specParagraph(value: string): RootContent {
  return { type: "paragraph", children: [{ type: "text", value }] };
}

function specHeading(node: RootContent, depth: number) {
  return node.type === "heading" && node.depth === depth && node.children.length === 1 && node.children[0].type === "text"
    ? node.children[0].value : undefined;
}

function specTaskGroups(checklist: RootContent[], agents: Persona[]) {
  const owners = new Map(agents.map((agent) => [`${agent.name} (${agent.id})`, agent]));
  const groups = new Map<Heading, { agent: Persona; items: ListItem[] }>();
  let items: ListItem[] | undefined;
  for (const node of checklist) {
    if (node.type === "heading" && node.depth === 3) {
      const agent = owners.get(specHeading(node, 3) ?? "");
      items = agent ? [] : undefined;
      if (agent && items) groups.set(node, { agent, items });
    } else if (node.type === "list" && items) {
      items.push(...checklistItems(node).filter((item) => typeof item.checked === "boolean"));
    }
  }
  return groups;
}

function remarkSpec({ section, agents, owner }: SpecMarkdown) {
  return (tree: Root) => {
    const product = tree.children.findIndex((node) => specHeading(node, 2) === "Product specification");
    const tasks = tree.children.findIndex((node) => specHeading(node, 2) === "Task Distribution");
    const history = tree.children.findIndex((node) => specHeading(node, 2) === "Change log");
    const definitions = tree.children.filter((node) => node.type === "definition");
    const show = (nodes: RootContent[]) => {
      tree.children = [...nodes.filter((node) => node.type !== "definition"), ...definitions];
    };
    if (section === "document") {
      if (product >= 0 && tasks > product) {
        const document = tree.children.slice(product, tasks);
        if (document.length === 1) document.push(specParagraph("No product requirements yet."));
        show(document);
      }
      return;
    }
    if (section === "history") {
      show(history >= 0 ? tree.children.slice(history) : []);
      return;
    }
    if (tasks < 0) {
      show([specParagraph("No task checklist in this revision.")]);
      return;
    }
    const checklist = tree.children.slice(tasks, history > tasks ? history : undefined);
    const groups = specTaskGroups(checklist, agents);
    const selected: RootContent[] = [checklist[0]];
    let include = !owner;
    for (const node of checklist.slice(1)) {
      if (node.type === "heading" && node.depth === 3) {
        const group = groups.get(node);
        include = !owner || group?.agent.id === owner;
        if (group && include) {
          const { agent, items } = group;
          node.children = [{ type: "text", value: agent.name }];
          node.data = { ...node.data, hProperties: { "data-owner": agent.id, "data-task-total": items.length,
            "data-task-done": items.filter((item) => item.checked).length } };
        }
      }
      if (include) selected.push(node);
    }
    if (selected.length === 1) selected.push(specParagraph("No task checklist in this revision."));
    show(selected);
  };
}

function Markdown({ children, spec, tasks }: { children: string; spec?: SpecMarkdown; tasks?: boolean }) {
  return <div className={`${styles.markdown}${spec || tasks ? ` ${styles.specDocument}` : ""}`}><ReactMarkdown remarkPlugins={spec ? [remarkGfm, [remarkSpec, spec]] : [remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span>{alt || "Image omitted"}</span>,
    pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
    ...(spec && {
      h1: ({ children }) => children === "SPEC.md" ? null : <h1>{children}</h1>,
      h3: ({ children, node }) => {
        const agent = spec.agents.find(({ id }) => id === node?.properties["data-owner"]);
        const total = Number(node?.properties["data-task-total"]);
        return agent ? <h3 className={styles.specOwner}>
          <span aria-hidden="true"><AgentAvatar agent={agent} agents={spec.agents} size={18} /></span><span>{children}</span>
          <small>{total ? `${node?.properties["data-task-done"]} of ${total} done` : "No tasks"}</small>
        </h3> : <h3>{children}</h3>;
      },
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

/** "initials" draws the design system's voice-coloured initials; "portrait" keeps the packaged artwork. */
export type AvatarStyle = "portrait" | "initials";
const AvatarStyleContext = createContext<AvatarStyle>("portrait");

function voiceOf(agents: Persona[], id: string) {
  const index = agents.findIndex((agent) => agent.id === id);
  return index < 0 ? undefined : (index % 8) + 1;
}

function agentInitials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N} -]/gu, "").split(/[\s-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** An agent's mark in lists and posts: initials on its voice colour, or its portrait in other hosts. */
export function AgentAvatar({ agent, agents, size = 24 }: { agent: Persona; agents: Persona[]; size?: number }) {
  const style = useContext(AvatarStyleContext);
  if (style === "portrait") return <Portrait agent={agent} />;
  const voice = voiceOf(agents, agent.id);
  return <span className={styles.avatar} aria-hidden="true" style={{
    width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)),
    background: voice ? `var(--voice-${voice})` : undefined,
  }}>{agentInitials(agent.name)}</span>;
}

export function Portrait({ agent }: { agent: Persona }) {
  const renderPortrait = useContext(PortraitContext);
  const portrait = experimentPortraits[agent.id];
  const artworkId = "avatarId" in agent ? agent.avatarId : portrait?.id;
  if (renderPortrait && !artworkId) return renderPortrait(agent, styles.portrait);
  if (!artworkId && !agent.avatarBrief) {
    const initials = agent.name.split(/[\s-]+/).map((word) => word[0]).join("").toUpperCase();
    return <svg className={styles.portrait} viewBox="0 0 40 50" aria-hidden="true"><rect width="40" height="50" rx="6" fill="#d3ddd6" /><text x="20" y="26" textAnchor="middle" dominantBaseline="middle" fill="#24332b" fontSize="12" fontWeight="600">{initials}</text></svg>;
  }
  // Artwork is local, same-origin, packaged with Chorus, and already optimized SVG.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.portrait} src={asset(artworkId ?? agent.id)} alt={`${agent.name} portrait`} width={48} height={60} style={portrait && { backgroundColor: portrait.background }} />;
}

function Profile({ agent, showHeader = true }: { agent: Persona; showHeader?: boolean }) {
  return <div className={styles.profile}>
    {showHeader && <header className={styles.profileHeader}>
      <span aria-hidden="true"><Portrait agent={agent} /></span><h2>{agent.name}</h2>
    </header>}
    {agent.id === "general-agent" ? <p>No predefined persona</p> : <>
      {showHeader && agent.role !== agent.name && <p className={styles.profileRole}>{agent.role}</p>}
      {agent.personality && <p>{agent.introduction}</p>}
      <dl>
        {agent.personality ? <><dt>Personality</dt><dd>{agent.personality}</dd></> : <><dt>Background</dt><dd>{agent.introduction}</dd></>}
        <dt>Traits</dt><dd>{agent.traits.join(" · ")}</dd>
        <dt>Strengths</dt><dd>{agent.strengths}</dd>
        <dt>Weaknesses</dt><dd>{agent.weaknesses}</dd>
        {"systemPrompt" in agent && <><dt>System prompt</dt><dd>{agent.systemPrompt}</dd></>}
      </dl>
    </>}
  </div>;
}

export function ProfileDialog({ agent, close }: { agent: Persona; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={`${styles.dialog} ${styles.profileDialog}`} onClose={close} aria-label={`${agent.name} profile`}><button className={styles.close} onClick={() => dialog.current?.close()}>Close profile</button><Profile agent={agent} /></dialog>;
}

export function Metrics({ usage, compact = false }: { usage: Usage; compact?: boolean }) {
  const tokens = (count: number, unknown: number) => {
    if (!unknown) return number(count);
    return unknown === usage.callCount ? unknownValue : `${number(count)} (partial)`;
  };
  return <dl className={compact ? styles.compactMetrics : styles.metrics}>
    <div><dt>Input tokens</dt><dd>{tokens(usage.inputTokens, usage.unknownInputCalls)}</dd></div>
    <div><dt>Output tokens</dt><dd>{tokens(usage.outputTokens, usage.unknownOutputCalls)}</dd></div>
    <div><dt title="Included in input tokens">Cached tokens</dt><dd>{tokens(usage.cachedTokens, usage.unknownCacheCalls)}</dd></div>
    <div><dt>Cache utilization</dt><dd>{usage.cacheUtilizationPercent === null ? "Unavailable" : `${usage.cacheUtilizationPercent.toFixed(1)}%`}</dd></div>
    <div><dt>Cache used</dt><dd>{usage.cacheUsed === null ? unknownValue : usage.cacheUsed ? "Yes" : "No"}</dd></div>
    <div><dt>Calls</dt><dd>{usage.callCount}</dd></div>
    <div><dt>Total call time</dt><dd>{(usage.totalLatencyMs / 1000).toFixed(1)} s</dd></div>
    <div><dt>Mean / p95 latency</dt><dd>{(usage.meanLatencyMs / 1000).toFixed(2)} / {(usage.p95LatencyMs / 1000).toFixed(2)} s</dd></div>
    <div><dt>Reported cost</dt><dd>{money(usage.reportedCostUSD)}</dd></div>
    <div><dt>Calls with unknown cost</dt><dd>{usage.unknownCostCalls}</dd></div>
    <div><dt>Estimated cost</dt><dd title="Estimated from the saved rate snapshot">≈ {money(usage.estimatedCostUSD)}</dd></div>
    <div><dt>Cache coverage</dt><dd>{usage.cacheCoveredCalls}/{usage.callCount} calls</dd></div>
  </dl>;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });

function usageCost(usage: Usage): ReactNode {
  const { reportedCostUSD, estimatedCostUSD, unknownCostCalls, callCount } = usage;
  if (unknownCostCalls > 0 && unknownCostCalls === callCount) return unknownValue;
  const amounts: string[] = [];
  if (reportedCostUSD || !estimatedCostUSD) amounts.push(usd.format(reportedCostUSD));
  if (estimatedCostUSD) amounts.push(`≈ ${usd.format(estimatedCostUSD)}`);
  return <span title={estimatedCostUSD ? "≈ marks an estimate from the saved rate snapshot" : undefined}>
    {amounts.join(" + ") + (unknownCostCalls ? " (partial)" : "")}
  </span>;
}

function UsageOverview({ usage, wallTimeMs }: { usage: Usage; wallTimeMs?: number }) {
  return <dl className={styles.usageOverview}>
    <div><dt>{wallTimeMs === undefined ? "Cost" : "Session cost"}</dt><dd>{usageCost(usage)}</dd></div>
    {wallTimeMs !== undefined && <div><dt>Wall time</dt><dd>{(wallTimeMs / 1000).toFixed(1)} s</dd></div>}
    <div><dt>Model calls</dt><dd>{number(usage.callCount)}</dd></div>
  </dl>;
}

function UsageDetails({ usage, scope }: { usage: Usage; scope: string }) {
  return <details className={styles.usageDetails}>
    <summary aria-label={`Tokens, cache, latency and cost for ${scope.toLowerCase()}`}>Tokens, cache, latency and cost</summary>
    <Metrics usage={usage} compact />
  </details>;
}

export function SessionUsageView({ usage, error, retry }: { usage: HarnessUsage | null; error: string; retry: () => void }) {
  const headingId = useId();
  const sections: [string, Usage][] = usage ? [["Participants", usage.participants], ["Final judge", usage.judge]] : [];
  if (usage && "teamGeneration" in usage) sections.unshift(["Team generation", usage.teamGeneration]);
  return <div className={styles.usageView}>
    {error && <div className={styles.viewError}><RecordError message={`${usage ? "Could not refresh usage" : "Could not load usage"}. ${error}`} />
      <button type="button" onClick={retry}>Retry usage</button>
    </div>}
    {usage ? <>
      <section aria-labelledby={headingId}>
        <h3 id={headingId}>Whole session</h3>
        <UsageOverview usage={usage.total} wallTimeMs={usage.wallTimeMs} />
        <Metrics usage={usage.total} compact />
      </section>
      {sections.map(([label, totals]) => (
        <section key={label} aria-label={label}>
          <h3>{label}</h3>
          <UsageOverview usage={totals} />
          <Metrics usage={totals} compact />
        </section>
      ))}
    </> : !error && <p role="status" className={styles.empty}>Loading usage…</p>}
  </div>;
}

function useRecords(snapshot: HarnessSnapshot, kind: string, agent?: string, enabled = true) {
  const [attempt, setAttempt] = useState(0);
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
  }, [snapshot.id, snapshot.revision, kind, agent, enabled, attempt]);
  const retry = () => setAttempt((value) => value + 1);
  return result.key === currentKey
    ? { ...result, loaded: true, retry }
    : { records: [], error: "", loaded: false, retry };
}

function RecordError({ message }: { message: string }) { return message ? <p role="alert">{message}</p> : null; }

function evidenceTitle(kind: string, experiment: boolean) {
  switch (kind) {
    case "board": return "Message board post";
    case "change": return experiment ? "SPEC.md change" : "Canvas change";
    case "summary": return experiment ? "Private reflection" : "Reasoning summary";
    case "commit": return "Commit";
    case "pr": return "Local pull request";
    case "plan_completion": return "Planning completion";
    case "vote": return "Planning vote";
    case "activity": return "Agent activity";
    case "conversation": return "Conversation record";
    case "process": return "Process record";
    default: return "Supporting record";
  }
}

function EvidenceRecord({ record, snapshot }: { record: HarnessRecord; snapshot: HarnessSnapshot }) {
  const { data, kind } = record;
  const experiment = !!snapshot.experiment;
  const author = snapshot.agents.find((agent) => agent.id === record.agentId)?.name ?? record.agentId;
  let description: string | undefined;
  let patch: string | undefined;
  if (kind === "board") description = text(data.text);
  if (kind === "change" || kind === "pr") {
    description = [data.description, data.text, data.reason]
      .filter((value): value is string => typeof value === "string" && !!value.trim()).join("\n\n");
    if (typeof data.diff === "string" && data.diff) patch = data.diff;
  }
  if (kind === "summary" && typeof data.decision === "string") description = data.decision;
  if (kind === "commit" && typeof data.subject === "string") description = data.subject;
  if ((kind === "vote" || kind === "plan_completion") && typeof data.specRevision === "number") {
    description = `SPEC.md v${data.specRevision}`;
  }
  const raw = <pre className={styles.evidenceText} tabIndex={0}>{JSON.stringify(data, null, 2)}</pre>;
  return (
    <section className={styles.evidenceRecord} aria-label={evidenceTitle(kind, experiment)}>
      <h3>{evidenceTitle(kind, experiment)}</h3>
      <p className={styles.evidenceMeta}>
        {author} · {!experiment && `Turn ${record.turn} · `}<Timestamp value={record.createdAt} />
      </p>
      {kind === "pr" && typeof data.status === "string" && <p className={styles.evidenceMeta}>{data.status}</p>}
      {description && <p className={styles.evidenceDescription}>{description}</p>}
      {kind === "commit" && typeof data.commit === "string" && <p><code>{data.commit}</code></p>}
      {patch && <DiffPreview patch={patch} />}
      {description || patch ? (
        <details className={styles.evidenceRaw}>
          <summary>Record data</summary>
          {raw}
        </details>
      ) : raw}
    </section>
  );
}

function EvidenceDialog({ snapshot, ids, initialIndex = 0, criterion, close }: {
  snapshot: HarnessSnapshot;
  ids: string[];
  initialIndex?: number;
  criterion?: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{ key: string; record?: HarnessRecord; error?: string }>();
  const recordId = ids[index];
  const key = JSON.stringify([recordId, attempt]);
  const entry = result?.key === key ? result : undefined;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (!recordId) return;
    let current = true;
    void client.record(snapshot.id, recordId).then((record) => {
      if (current) setResult({ key, record });
    }).catch((error: unknown) => {
      if (current) setResult({ key, error: error instanceof Error ? error.message : "Could not load source evidence." });
    });
    return () => { current = false; };
  }, [snapshot.id, recordId, key]);

  return (
    <dialog ref={dialog} className={`${styles.dialog} ${styles.evidenceDialog}`} onClose={close} aria-label="Source evidence">
      <header className={styles.evidenceHeader}>
        <h2>{criterion ? `${criterion} evidence` : "Source evidence"}</h2>
        <button type="button" onClick={() => dialog.current?.close()}>Close evidence</button>
      </header>
      <div className={styles.evidenceBody}>
        {ids.length > 1 && (
          <div className={styles.evidenceSelect}>
            <span>Source</span>
            <WorkspaceSelect label="Source" value={String(index)} container={dialog}
              onValueChange={(value) => setIndex(Number(value))}
              options={ids.map((id, item) => ({ value: String(item), label: `${item + 1} of ${ids.length} · ${evidenceTitle(id.split(":")[0], !!snapshot.experiment)}` }))} />
          </div>
        )}
        {!recordId ? <p>No supporting record was cited.</p> : entry?.record ? <EvidenceRecord key={entry.record.id} record={entry.record} snapshot={snapshot} /> : entry?.error ? (
          <>
            <RecordError message={entry.error} />
            <button type="button" onClick={() => retry((value) => value + 1)}>Retry evidence</button>
          </>
        ) : <p role="status">Loading source evidence…</p>}
      </div>
    </dialog>
  );
}

function EvidenceLinks({ snapshot, ids }: { snapshot: HarnessSnapshot; ids: string[] }) {
  const [index, setIndex] = useState<number | null>(null);
  if (!ids.length) return null;
  return (
    <div className={styles.evidenceLinks}>
      <span className={styles.evidenceLabel}>Supporting records</span>
      {ids.map((id, item) => (
        <button key={`${id}-${item}`} type="button" onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setIndex(item);
        }} aria-label={`Open supporting record ${item + 1}`}>Source {item + 1}</button>
      ))}
      {index !== null && <EvidenceDialog snapshot={snapshot} ids={ids} initialIndex={index} close={() => setIndex(null)} />}
    </div>
  );
}

// An agent keeps one of eight voice colors, by roster order, for the whole run.
function voiceStyle(snapshot: HarnessSnapshot, agentId: string): CSSProperties | undefined {
  const index = snapshot.agents.findIndex((agent) => agent.id === agentId);
  return index < 0 ? undefined : { ["--voice" as string]: `var(--voice-${(index % 8) + 1})` };
}

function toolSummary(result: unknown) {
  if (!result || typeof result !== "object") return text(result).slice(0, 160);
  const value = result as Record<string, unknown>;
  if (typeof value.error === "string") return value.error;
  const keys = ["id", "status", "phase", "revision", "sequence", "commit", "path", "accepted", "checkId"];
  const parts = keys.filter((key) => value[key] !== undefined && value[key] !== null && typeof value[key] !== "object")
    .map((key) => `${key} ${String(value[key])}`);
  return parts.join(" · ") || Object.keys(value).slice(0, 4).join(", ");
}

function ToolCallRow({ record }: { record: HarnessRecord }) {
  const result = record.data.result;
  const failed = !!result && typeof result === "object" && typeof (result as Record<string, unknown>).error === "string";
  const code = failed ? text((result as Record<string, unknown>).code) : "";
  const body = JSON.stringify(result, null, 2) ?? "";
  return <details className={styles.toolCall} data-status={failed ? "error" : "ok"}>
    <summary>
      <span className={styles.toolName}>{text(record.data.name)}</span>
      <span className={styles.toolSummary}>{toolSummary(result)}</span>
      <span className={styles.toolState}>{failed ? <>✕ {code || "Error"}</> : <span aria-label="Succeeded">✓</span>}</span>
    </summary>
    <pre tabIndex={0}>{body.length > 6000 ? `${body.slice(0, 6000)}\n… ${body.length - 6000} more characters` : body}</pre>
  </details>;
}

/** The tool calls an agent made since its previous post: the work behind this one. Loaded on request, after the run ends. */
function PostToolCalls({ snapshot, record, since }: { snapshot: HarnessSnapshot; record: HarnessRecord; since: number }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; calls: HarnessRecord[]; error?: string }>({ status: "idle", calls: [] });
  const [open, setOpen] = useState(false);
  async function load() {
    setState({ status: "loading", calls: [] });
    try {
      const calls = new Map<string, HarnessRecord>();
      let cursor = since;
      for (let page = 0; page < 5; page += 1) {
        const result = await client.records(snapshot.id, "tool", cursor, record.agentId);
        for (const item of result.records) if (item.sequence < record.sequence) calls.set(item.id, item);
        cursor = result.cursor;
        if (!result.hasMore || result.records.some((item) => item.sequence > record.sequence)) break;
      }
      setState({ status: "done", calls: [...calls.values()].filter((item) => item.data.name !== "board_write").sort((a, b) => a.sequence - b.sequence) });
    } catch (error) {
      setState({ status: "error", calls: [], error: error instanceof Error ? error.message : "Could not load tool calls." });
    }
  }
  return <div className={styles.toolCalls}>
    <button type="button" className={styles.toolToggle} aria-expanded={open} onClick={() => {
      setOpen(!open);
      if (!open && state.status === "idle") void load();
    }}>{open ? "Hide tool calls" : "Tool calls since last post"}</button>
    {open && (state.status === "loading" ? <p role="status" className={styles.muted}>Loading tool calls…</p>
      : state.status === "error" ? <div className={styles.viewError}><RecordError message={state.error ?? ""} /><button type="button" onClick={() => void load()}>Retry tool calls</button></div>
        : state.status === "done" && (state.calls.length
          ? <div className={styles.toolList}>{state.calls.map((call) => <ToolCallRow key={call.id} record={call} />)}</div>
          : <p className={styles.muted}>No tool calls were recorded between this agent’s posts.</p>))}
  </div>;
}

// Lets a host open its canvas view without coupling the board to its layout.
export const OpenCanvasContext = createContext<((opener: HTMLButtonElement) => void) | null>(null);

function Board({ snapshot, select, followPosts }: { followPosts?: boolean; snapshot: HarnessSnapshot; select: (id: string) => void }) {
  const { records, error } = useRecords(snapshot, "board");
  const openCanvas = useContext(OpenCanvasContext);
  const toolsVisible = !!snapshot.experiment && !snapshot.experiment.deepswe && ["completed", "killed"].includes(snapshot.status);
  const feed = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const newest = [...records].sort((a, b) => b.sequence - a.sequence);
  const visible = anchor === null ? newest : newest.filter(record => record.sequence <= anchor);
  const waiting = newest.length - visible.length;
  function mentions(content: string): ReactNode[] {
    return content.split(snapshot.experiment ? /(@[A-Za-z][A-Za-z0-9-]*)/g : /(@[A-Za-z]+)/g).map((part, index) => {
      const agent = part.startsWith("@") ? snapshot.agents.find((a) => (snapshot.experiment ? a.id : a.name) === part.slice(1)) : undefined;
      return agent ? <button className={styles.mention} style={voiceStyle(snapshot, agent.id)} key={index} onClick={() => select(agent.id)}>{part}</button> : part;
    });
  }
  return <section className={followPosts ? `${styles.panel} ${styles.compactBoard}` : styles.panel} aria-labelledby="board-heading"><div className={styles.panelHeading}><h2 id="board-heading">Message board</h2><small>{snapshot.boardCount} posts{!followPosts && " · one level"}</small></div>{!followPosts && <p className={styles.muted}>One or two sentences per post. Agents can address a peer with @Name.</p>}<RecordError message={error} />
    {waiting > 0 && <button className={styles.newPosts} onClick={() => { setAnchor(null); feed.current?.scrollTo({ top: 0 }); }}>New posts · {waiting}</button>}
    <div className={styles.feed} ref={feed} onScroll={followPosts ? (event) => {
      if (event.currentTarget.scrollTop < 4) setAnchor(null);
      else if (newest.length) setAnchor(current => current ?? newest[0].sequence);
    } : undefined}>{visible.map((record) => {
      const author = snapshot.agents.find(person => person.id === record.agentId);
      const head = <div className={followPosts ? styles.postHead : undefined}>
        <button className={styles.nameLink} onClick={() => select(record.agentId)}>{author?.name || record.agentId}</button>
        {followPosts && author?.role && author.role !== author.name && <span className={styles.postRole}>{author.role}</span>}
        <small>{!snapshot.experiment && `Turn ${record.turn} · `}<Timestamp value={record.createdAt} format={followPosts ? "relative" : "seconds"} /></small></div>;
      const body = <>
        <p>{mentions(text(record.data.text))}</p>
        {followPosts && toolsVisible && <PostToolCalls snapshot={snapshot} record={record}
          since={newest.find((item) => item.agentId === record.agentId && item.sequence < record.sequence)?.sequence ?? 0} />}
        {openCanvas && <button className={styles.postLink} onClick={event => openCanvas(event.currentTarget)}>{snapshot.experiment ? "Open SPEC.md ↗" : "Open canvas ↗"}</button>}
      </>;
      return <article key={record.id} id={record.id} className={followPosts ? `${styles.post} ${styles.harnessPost}` : styles.post} style={voiceStyle(snapshot, record.agentId)} tabIndex={-1}>
        {followPosts ? <>
          {author ? <AgentAvatar agent={author} agents={snapshot.agents} size={28} /> : <span />}
          <div className={styles.postMain}>{head}{body}</div>
        </> : <>{head}{body}</>}
      </article>;
    })}{!records.length && <p className={styles.empty}>Contributions will appear here as agents begin.</p>}</div>
  </section>;
}

function CanvasChanges({ snapshot }: { snapshot: HarnessSnapshot }) {
  const { records, error, loaded, retry } = useRecords(snapshot, "change");
  const timeline = [...records].sort((a, b) => b.sequence - a.sequence);
  return <>
    <div className={styles.specTimelineHeading}><h3>Canvas changelog</h3><small>{snapshot.changeCount} accepted {snapshot.changeCount === 1 ? "change" : "changes"}</small></div>
    {error && <div className={styles.viewError}><RecordError message={error} /><button type="button" onClick={retry}>Retry changes</button></div>}
    {timeline.map((record) => <details className={styles.specEdit} key={record.id} id={record.id}>
      <summary>
        <strong>{snapshot.agents.find(({ id }) => id === record.agentId)?.name ?? record.agentId}</strong>
        <code>v{text(record.data.beforeVersion)} → v{text(record.data.afterVersion)}</code>
        <Timestamp value={record.createdAt} format="relative" />
      </summary>
      <div className={styles.specEditBody}>
        {record.data.reason ? <Markdown>{text(record.data.reason)}</Markdown> : null}
        {record.data.diff ? <DiffPreview patch={text(record.data.diff)} /> : null}
        <small className={styles.recordIdentifier}>Record <code>{record.id}</code></small>
      </div>
    </details>)}
    {!timeline.length && !error && <p role="status" className={styles.empty}>{loaded ? "No canvas changes have been accepted yet." : "Loading changes…"}</p>}
  </>;
}

const canvasViews = ["Document", "Changes"] as const;

function BenchmarkCanvas({ snapshot }: { snapshot: HarnessSnapshot }) {
  const [view, setView] = useState<typeof canvasViews[number]>("Document");
  const editor = snapshot.agents.find((agent) => agent.id === snapshot.lease?.agentId);
  const exportPath = `${client.base}/sessions/${snapshot.id}/export`;
  return <section className={styles.specWorkspace} aria-label="Benchmark canvas">
    <header className={styles.specHeader}>
      <div className={styles.specTitle}><h2>Shared canvas</h2><code>v{snapshot.canvasVersion}</code>
        <small>{editor ? `${editor.name} holds the lock` : "Lock available"}</small>
      </div>
      <div className={styles.specExports}>
        <a href={`${exportPath}?format=markdown`} download>Export canvas</a>
        <a href={exportPath} download>Export complete session</a>
      </div>
    </header>
    <div className={styles.specToolbar}>
      <div className={styles.specViews} role="group" aria-label="Canvas views">
        {canvasViews.map((item) => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>
          {item}{item === "Changes" && <small aria-hidden="true">{snapshot.changeCount}</small>}
        </button>)}
      </div>
    </div>
    <div className={styles.specContent} role="region" aria-label="Canvas document" tabIndex={0} hidden={view !== "Document"}>
      {snapshot.canvas ? <Markdown>{snapshot.canvas}</Markdown> : <p className={styles.empty}>The team will build its combined solution here.</p>}
    </div>
    <div className={styles.specContent} role="region" aria-label="Canvas changes" tabIndex={0} hidden={view !== "Changes"}>
      <CanvasChanges snapshot={snapshot} />
    </div>
  </section>;
}

function SpecTimeline({ snapshot }: { snapshot: HarnessSnapshot }) {
  const changes = useRecords(snapshot, "change");
  const planning = useRecords(snapshot, snapshot.experiment?.planningCompletions ? "plan_completion" : "vote");
  const timeline = [...changes.records, ...planning.records].sort((a, b) => b.sequence - a.sequence);
  const name = (id: unknown) => snapshot.agents.find((agent) => agent.id === id)?.name ?? text(id);

  return <>
    <div className={styles.specTimelineHeading}>
      <h3>Revision history</h3><small>{snapshot.changeCount} accepted {snapshot.changeCount === 1 ? "change" : "changes"}</small>
    </div>
    {(changes.error || planning.error) && <div className={styles.viewError}>
      <RecordError message={changes.error || planning.error} />
      <button type="button" onClick={() => { if (changes.error) changes.retry(); if (planning.error) planning.retry(); }}>Retry changes</button>
    </div>}
    {!timeline.length && !changes.error && !planning.error && <p className={styles.empty}>
      {changes.loaded && planning.loaded ? "Accepted edits and planning updates will appear here." : "Loading changes…"}
    </p>}
    {timeline.map((record) => {
      const { data } = record;
      const who = name(record.agentId) || "System";
      if (record.kind !== "change") return <div className={styles.specTimelineNote} key={record.id} id={record.id}>
        <span><strong>{who}</strong> {record.kind === "vote" ? "voted complete" : "finished planning"} at v{text(data.specRevision)}</span>
        <Timestamp value={record.createdAt} format="relative" />
      </div>;
      const scope = data.section === "tasks" ? "Tasks" : data.section === "product" ? "Product spec"
        : data.section === "deliverables" ? "Deliverable plan" : "";
      return <details key={record.id} id={record.id} className={styles.specEdit}>
        <summary>
          <span><strong>{who}</strong><small>{[scope, data.taskOwnerId ? `Owner ${name(data.taskOwnerId)}` : ""].filter(Boolean).join(" · ")}</small></span>
          <code>v{text(data.beforeVersion)} → v{text(data.afterVersion)}</code>
          <Timestamp value={record.createdAt} format="relative" />
        </summary>
        <div className={styles.specEditBody}>
          {data.reason ? <Markdown>{text(data.reason)}</Markdown> : null}
          {data.verification ? <p><strong>Verification</strong> {text(data.verification)}</p> : null}
          {data.diff ? <DiffPreview patch={text(data.diff)} /> : null}
        </div>
      </details>;
    })}
    {snapshot.canvas && snapshot.changeCount > 0 && <details className={styles.specRawHistory}>
      <summary>History from SPEC.md</summary>
      <Markdown spec={{ section: "history", agents: snapshot.agents }}>{snapshot.canvas}</Markdown>
    </details>}
  </>;
}

const specViews = ["Document", "Tasks", "Changes"] as const;

function ExperimentSpecView({ snapshot }: { snapshot: HarnessSnapshot }) {
  const [view, setView] = useState<typeof specViews[number]>("Document");
  const [owner, setOwner] = useState("");
  const editing = snapshot.agents.find((agent) => agent.id === snapshot.lease?.agentId);
  const exportPath = `${client.base}/sessions/${snapshot.id}/export`;

  return <section className={styles.specWorkspace} aria-label="Experiment specification">
    <header className={styles.specHeader}>
      <div className={styles.specTitle}><h2>SPEC.md</h2><code>v{snapshot.canvasVersion}</code>
        {editing && <small>{editing.name} editing</small>}
      </div>
      <div className={styles.specExports}>
        <a href={`${exportPath}?format=markdown`} download>Export SPEC.md</a>
        <a href={exportPath} download>Export complete session</a>
      </div>
    </header>
    <div className={styles.specToolbar}>
      <div className={styles.specViews} role="group" aria-label="Specification views">
        {specViews.map((item) => <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>
          {item}{item === "Changes" && <small aria-hidden="true">{snapshot.changeCount}</small>}
        </button>)}
      </div>
      {view === "Tasks" && <div className={styles.specOwnerFilter}>
        <WorkspaceSelect label="Task owner" value={owner} onValueChange={setOwner}
          options={[{ value: "", label: "All owners" }, ...snapshot.agents.map(({ id, name }) => ({ value: id, label: name }))]} />
      </div>}
    </div>
    {specViews.map((item) => <div key={item} className={styles.specContent} role="region" aria-label={`Specification ${item.toLowerCase()}`} tabIndex={0} hidden={view !== item}>
      {item === "Changes" ? <SpecTimeline snapshot={snapshot} /> : snapshot.canvas
        ? <Markdown spec={{ section: item === "Document" ? "document" : "tasks", agents: snapshot.agents, owner }}>{snapshot.canvas}</Markdown>
        : <p className={styles.empty}>The team’s specification will appear here.</p>}
    </div>)}
  </section>;
}

type RepositoryEntries = Map<string, RepositoryTree["entries"]>;
type RepositoryMetadata = NonNullable<HarnessSnapshot["experiment"]>["repository"];

function RepositoryFolder({ path, entries, selected, openFile }: {
  path: string;
  entries: RepositoryEntries;
  selected: string;
  openFile: (path: string) => void;
}) {
  const items = entries.get(path) ?? [];
  return (
    <ul role="list" className={styles.repositoryFiles}>
      {items.map((item) => {
        const name = item.path.slice(item.path.lastIndexOf("/") + 1);
        return (
          <li key={item.path}>
            {item.kind === "directory" ? (
              <details>
                <summary>{name}/</summary>
                <RepositoryFolder path={item.path} entries={entries} selected={selected} openFile={openFile} />
              </details>
            ) : item.kind === "submodule" ? (
              <span>{name} (submodule)</span>
            ) : (
              <button type="button" aria-pressed={selected === item.path} onClick={() => openFile(item.path)}>
                {name}{item.kind === "link" && " (link)"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type RepositoryChange = {
  id: string;
  branch: string;
  agentId: string;
  label: string;
  record: HarnessRecord;
} & (
  | { kind: "commit"; revision: string }
  | { kind: "pr"; number: string; patch: string; history: HarnessRecord[] }
);

function repositoryChanges(commits: HarnessRecord[], prs: HarnessRecord[], repository: RepositoryMetadata) {
  const branchFor = (record: HarnessRecord) => text(record.data.branch) ||
    repository.worktrees.find((item) => item.agentId === record.agentId)?.branch || "main";
  const changes: RepositoryChange[] = commits.map((record) => ({
    id: record.id, kind: "commit", branch: branchFor(record), agentId: record.agentId,
    label: text(record.data.subject) || "Commit", revision: text(record.data.commit), record,
  }));
  const pullRequests = new Map<string, HarnessRecord[]>();
  for (const record of prs) {
    const id = text(record.data.id) || record.id;
    const history = pullRequests.get(id) ?? [];
    history.push(record);
    pullRequests.set(id, history);
  }
  for (const [id, history] of pullRequests) {
    const record = history.findLast(({ data }) => data.status !== "review") ?? history[0];
    changes.push({
      id: `pr:${id}`, kind: "pr", branch: branchFor(record), agentId: record.agentId,
      label: text(record.data.description).split("\n")[0] || "Local pull request",
      number: id.slice(0, 8), patch: text(history.findLast(({ data }) => typeof data.diff === "string")?.data.diff),
      record, history,
    });
  }
  return changes.sort((a, b) => b.record.sequence - a.record.sequence);
}

type DiffRow = { line: string; kind?: "file" | "hunk" | "added" | "removed"; old?: number; next?: number };

function diffRows(lines: string[]): DiffRow[] {
  let oldLine = 0, newLine = 0, inHunk = false;
  return lines.map((line) => {
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) {
      inHunk = false;
      return { line, kind: "file" };
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { line, kind: "hunk" };
    }
    if (line.startsWith("@@")) return { line, kind: "hunk" };
    if (line.startsWith("+")) return { line, kind: "added", next: inHunk ? newLine++ : undefined };
    if (line.startsWith("-")) return { line, kind: "removed", old: inHunk ? oldLine++ : undefined };
    if (inHunk && !line.startsWith("\\")) return { line, old: oldLine++, next: newLine++ };
    return { line };
  });
}

function DiffPreview({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  if (lines.length > 5000) return <pre className={styles.repositoryDiff} tabIndex={0} aria-label="Unified diff"><code>{patch}</code></pre>;
  const added = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const removed = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  return (
    <pre className={`${styles.repositoryDiff} ${styles.numberedDiff}`} tabIndex={0} aria-label="Unified diff">
      <span className={styles.diffStat} aria-label={`${added} added, ${removed} removed`}>
        <span data-tone="added">+{added}</span> <span data-tone="removed">−{removed}</span>
      </span>
      <code>
        {diffRows(lines).map((row, index) => <span key={index} data-row={row.kind}>
          <span className={styles.diffNumber} aria-hidden="true">{row.old ?? ""}</span>
          <span className={styles.diffNumber} aria-hidden="true">{row.next ?? ""}</span>
          <span className={styles.diffText} data-line={row.kind}>{row.line}</span>{"\n"}
        </span>)}
      </code>
    </pre>
  );
}

function PullRequestDetails({ change, agentName }: {
  change: Extract<RepositoryChange, { kind: "pr" }>;
  agentName: (id: string) => string;
}) {
  const { data } = change.record;
  return (
    <details className={styles.repositoryDetails}>
      <summary>Pull request details</summary>
      {typeof data.description === "string" && <p>{data.description}</p>}
      {Array.isArray(data.taskIds) && data.taskIds.length > 0 && <p>Tasks {data.taskIds.map(text).join(", ")}</p>}
      {typeof data.sourceCommit === "string" && typeof data.targetCommit === "string" && (
        <p>Source <code>{data.sourceCommit}</code> · target <code>{data.targetCommit}</code></p>
      )}
      <ul>
        {[...change.history].reverse().map((event) => (
          <li key={event.id}>
            <strong>{text(event.data.status)} · {agentName(event.agentId)}</strong>{" "}
            <Timestamp value={event.createdAt} format="relative" />
            {typeof event.data.text === "string" && <p>{event.data.text}</p>}
            {typeof event.data.reason === "string" && <p>{event.data.reason}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

const publicCheckLabels: Record<string, string> = {
  unchecked: "Unchecked", running: "Running", passed: "Passed", failed: "Failed",
  timed_out: "Timed out", unavailable: "Runner unavailable", cancelled: "Cancelled",
};

function PublicChecksPanel({ snapshot, history = false }: { snapshot: HarnessSnapshot; history?: boolean }) {
  const experiment = snapshot.experiment!;
  const { records, error, loaded, retry } = useRecords(snapshot, "public_check", undefined, history);
  const pin = experiment.publicCheckProfile;
  if (!pin) return null;
  const commit = experiment.frozen?.mainCommit ?? experiment.repository.mainCommit;
  const attempts = [...new Map(records.map(record => [record.data.runId, record])).values()].reverse();
  const checks = experiment.frozen?.publicChecks ?? pin.profile.commands.map(({ id }) => ({
    checkId: id, status: attempts.find(row => row.data.checkId === id && row.data.commit === commit)?.data.status ?? "unchecked",
  }));
  return <section className={history ? styles.publicChecks : styles.resultsSummary} aria-label="Public checks">
    <h3>Public checks</h3>
    <p>{pin.profile.name} · {experiment.frozen ? "Submitted" : "Merged"} main <code title={commit}>{commit.slice(0, 12)}</code></p>
    {error && <div className={styles.viewError}><RecordError message={error} /><button onClick={retry}>Retry</button></div>}
    {!history || loaded ? <ul>{checks.map(check => <li key={check.checkId}>
      <code>{check.checkId}</code> · {publicCheckLabels[text(check.status)]}
    </li>)}</ul> : <p role="status">Loading public checks…</p>}
    {history && attempts.length > 0 && <div>
      <h4>Check history</h4>
      {attempts.map(record => {
        const sha = text(record.data.commit);
        const name = snapshot.agents.find(agent => agent.id === record.agentId)?.name ?? record.agentId;
        return <details key={text(record.data.runId)}>
          <summary><code>{text(record.data.checkId)}</code> · {publicCheckLabels[text(record.data.status)]} · <code title={sha}>{sha.slice(0, 12)}</code></summary>
          <p>Requested by {name} · <Timestamp value={record.createdAt} /></p>
          {typeof record.data.output === "string" && record.data.output && <pre>{record.data.output}</pre>}
          {record.data.truncated === true && <p>Output truncated.</p>}
        </details>;
      })}
    </div>}
  </section>;
}

function RepositoryBrowser({ snapshot, repository, visible, frozenRevision }: {
  snapshot: HarnessSnapshot;
  repository: RepositoryMetadata;
  visible: boolean;
  frozenRevision?: string;
}) {
  const { id, agents } = snapshot;
  const commits = useRecords(snapshot, "commit", undefined, visible);
  const prs = useRecords(snapshot, "pr", undefined, visible);
  const [branch, setBranch] = useState("main");
  const [path, setPath] = useState("");
  const [view, setView] = useState<"files" | "changes" | "checks">("files");
  const [changeId, setChangeId] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<{ branch: string; data?: RepositoryTree; error?: string }>();
  const [preview, setPreview] = useState<{ key: string; data?: RepositoryFile; error?: string }>();
  const [diff, setDiff] = useState<{ key: string; data?: RepositoryCommitDiff; error?: string }>();
  const allChanges = useMemo(
    () => repositoryChanges(commits.records, prs.records, repository),
    [commits.records, prs.records, repository],
  );
  const changes = branch === "main" ? allChanges : allChanges.filter((change) => change.branch === branch);
  const change = changes.find((item) => item.id === changeId);
  const commit = view === "changes" && change?.kind === "commit" ? change : undefined;
  const diffBranch = commit?.branch;
  const diffRevision = commit?.revision;
  const diffKey = JSON.stringify([diffBranch, diffRevision]);
  const branchVersion = branch === "main" ? repository.mainCommit :
    commits.records.findLast((record) => record.data.branch === branch)?.id;
  const activeTree = listing?.branch === branch ? listing : undefined;
  const tree = activeTree?.data;
  const treeRevision = tree?.revision;
  const fileKey = JSON.stringify([branch, treeRevision, path]);
  const file = preview?.key === fileKey ? preview : undefined;
  const commitDiff = diff?.key === diffKey ? diff : undefined;
  const requestedRevision = branch === "main" ? frozenRevision : undefined;
  const agentName = (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId;
  const worktree = repository.worktrees.find((item) => item.branch === branch);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    void client.repositoryTree(id, branch, requestedRevision).then((data) => {
      if (current) setListing({ branch, data });
    }).catch((error: unknown) => {
      if (current) setListing({ branch, error: error instanceof Error ? error.message : "Could not load the file tree." });
    });
    return () => { current = false; };
  }, [id, branch, branchVersion, requestedRevision, refresh, visible]);

  useEffect(() => {
    if (!visible || view !== "files" || !treeRevision || !path) return;
    let current = true;
    void client.repositoryFile(id, branch, treeRevision, path).then((data) => {
      if (current) setPreview({ key: fileKey, data });
    }).catch((error: unknown) => {
      if (current) setPreview({ key: fileKey, error: error instanceof Error ? error.message : "Could not open this file." });
    });
    return () => { current = false; };
  }, [id, branch, treeRevision, path, fileKey, refresh, visible, view]);

  useEffect(() => {
    if (!visible || !diffBranch || !diffRevision) return;
    let current = true;
    void client.repositoryCommitDiff(id, diffBranch, diffRevision).then((data) => {
      if (current) setDiff({ key: diffKey, data });
    }).catch((error: unknown) => {
      if (current) setDiff({ key: diffKey, error: error instanceof Error ? error.message : "Could not open this commit diff." });
    });
    return () => { current = false; };
  }, [id, diffBranch, diffRevision, diffKey, refresh, visible]);

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

  function openBranch(next: string) {
    setBranch(next);
    setPath("");
    setChangeId(allChanges.find((item) => next === "main" || item.branch === next)?.id ?? "");
  }

  return (
    <section className={styles.repositoryBrowser} aria-label="Experiment repository">
      <div className={styles.repositoryControls}>
        <div className={styles.repositoryBranch}>
          <span>Branch</span>
          <WorkspaceSelect label="Branch" value={branch} onValueChange={openBranch} options={[
            { value: "main", label: "main" },
            ...repository.worktrees.map((item) => ({ value: item.branch, label: `${agentName(item.agentId)} · ${item.branch}` })),
          ]} />
        </div>
        {treeRevision && <code className={styles.repositoryRevision} title={treeRevision}>{treeRevision.slice(0, 12)}</code>}
        <div className={styles.repositoryActions} role="group" aria-label="Repository view">
          <button type="button" aria-pressed={view === "files"} onClick={() => setView("files")}>Files</button>
          <button type="button" aria-pressed={view === "changes"} onClick={() => {
            if (!changeId) setChangeId(changes[0]?.id ?? "");
            setView("changes");
          }}>Changes <small aria-hidden="true">{changes.length}</small></button>
          {snapshot.experiment?.publicCheckProfile && <button type="button" aria-pressed={view === "checks"} onClick={() => setView("checks")}>Checks</button>}
          {view !== "checks" && <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh files</button>}
        </div>
      </div>
      {view === "checks" ? <PublicChecksPanel snapshot={snapshot} history /> : <div className={styles.repositoryLayout}>
        <section className={styles.repositoryTree} aria-label="File tree">
          <h3>File tree</h3>
          <RecordError message={activeTree?.error ?? ""} />
          {!activeTree && <p role="status">Loading repository files…</p>}
          {tree && (
            <>
              <RepositoryFolder key={branch} path="" entries={entries} selected={view === "files" ? path : ""} openFile={(filePath) => {
                setPath(filePath);
                setView("files");
              }} />
              {tree.truncated && <p className={styles.muted}>Showing the first 1,000 entries.</p>}
              {!tree.entries.length && <p className={styles.muted}>This revision has no files.</p>}
            </>
          )}
        </section>
        {view === "files" ? (
          <section className={styles.repositoryPreview} aria-label="File preview">
            <h3>{path ? <code>{path}</code> : "File preview"}</h3>
            <RecordError message={file?.error ?? ""} />
            {path ? file?.data && treeRevision ? <RepositoryFileViewer key={fileKey} file={file.data} id={id}
              branch={branch} revision={treeRevision} path={path} openFile={setPath} /> : !file?.error && <p role="status">Loading file…</p> : (
              <p className={styles.muted}>Select a file to read its committed contents.</p>
            )}
          </section>
        ) : (
          <section className={styles.repositoryPreview} aria-label="Change preview">
            <div className={styles.repositoryChangeHeading}>
              <h3>Changes</h3>
              <small>{worktree ? agentName(worktree.agentId) : "All agents"}</small>
            </div>
            <RecordError message={commits.error || prs.error} />
            {changes.length > 0 ? (
              <div className={styles.repositoryChangeSelect}>
                <span>Change</span>
                <WorkspaceSelect label="Change" value={change?.id ?? null} placeholder="Choose a commit or pull request" onValueChange={setChangeId}
                  options={(["pr", "commit"] as const).flatMap((kind) => changes.filter((item) => item.kind === kind).map((item) => ({
                    value: item.id,
                    group: kind === "pr" ? "Local pull requests" : "Commits",
                    label: `${item.kind === "pr" ? `PR ${item.number} · ${text(item.record.data.status)}` : item.revision.slice(0, 8)} · ${agentName(item.agentId)} · ${item.label}`,
                  })))} />
              </div>
            ) : commits.loaded && prs.loaded ? (
              !commits.error && !prs.error && <p className={styles.muted}>No commits or pull requests recorded for this branch.</p>
            ) : <p role="status">Loading changes…</p>}
            {change?.kind === "commit" && (
              <>
                <p className={styles.repositoryChangeMeta}>
                  <code title={change.revision}>{change.revision.slice(0, 12)}</code>
                  {" · "}{change.branch}{" · "}<Timestamp value={change.record.createdAt} format="relative" />
                </p>
                <RecordError message={commitDiff?.error ?? ""} />
                {commitDiff?.data ? (
                  <>
                    {commitDiff.data.truncated && <p className={styles.muted}>Showing up to the first 128 KB of this commit diff.</p>}
                    {commitDiff.data.patch ? <DiffPreview patch={commitDiff.data.patch} /> :
                      !commitDiff.data.truncated && <p className={styles.muted}>This commit has no file changes.</p>}
                  </>
                ) : !commitDiff?.error && <p role="status">Loading commit diff…</p>}
              </>
            )}
            {change?.kind === "pr" && (
              <>
                <p className={styles.repositoryChangeMeta}>
                  <strong>{text(change.record.data.status)}</strong>{" · "}{agentName(change.agentId)}{" · "}<code>{change.branch}</code>
                </p>
                <PullRequestDetails change={change} agentName={agentName} />
                {change.patch ? <DiffPreview patch={change.patch} /> :
                  <p className={styles.muted}>No diff was saved for this pull request.</p>}
              </>
            )}
          </section>
        )}
      </div>}
      <details className={styles.repositoryInfo}>
        <summary>Repository details</summary>
        <p>Repository <code>{repository.path}</code></p>
        {worktree && <p>Agent worktree <code>{worktree.path}</code></p>}
        <p>Starter baseline <code>{repository.baselineCommit}</code></p>
      </details>
    </section>
  );
}

export function ExperimentRepositoryView({ snapshot, visible = true }: { snapshot: HarnessSnapshot; visible?: boolean }) {
  const repository = snapshot.experiment?.repository;
  return repository ? <RepositoryBrowser snapshot={snapshot} repository={repository} visible={visible} /> : null;
}

type AgentState = { label: string; tone: "idle" | "active" | "waiting" | "blocked" | "failed" | "finished" };
const benchmarkAgentTones: Record<HarnessSnapshot["workers"][number]["state"], AgentState["tone"]> = {
  queued: "idle", running: "active", waiting_model: "waiting", waiting_lock: "waiting", paused: "waiting",
  finished: "finished", capped: "finished", failed: "failed",
};

function experimentWorkerStatus(snapshot: HarnessSnapshot, worker: HarnessSnapshot["workers"][number], planned: boolean): AgentState {
  const phase = snapshot.experiment?.phase;
  if (worker.state === "failed") return { label: "Failed", tone: "failed" };
  if (phase === "plan" && (planned || worker.state === "finished")) return { label: "Finished planning", tone: "finished" };
  if (worker.state === "finished") return { label: phase === "build" ? "Finished building" : "Finished", tone: "finished" };
  if (snapshot.status === "killed" || snapshot.status === "stopped") return { label: "Stopped", tone: "idle" };
  if (snapshot.status === "stopping") return { label: "Stopping", tone: "waiting" };
  if (snapshot.status === "paused" || worker.state === "paused") return { label: "Paused", tone: "waiting" };
  if (snapshot.status === "ready") return { label: "Ready", tone: "idle" };
  if (phase === "build" && worker.reportedStatus === "blocked") return { label: "Blocked", tone: "blocked" };
  if (snapshot.lease?.agentId === worker.agentId) return { label: "Editing SPEC.md", tone: "active" };
  if (worker.state === "waiting_model") return { label: "Waiting for model", tone: "waiting" };
  if (worker.state === "waiting_lock") return { label: "Waiting for SPEC.md", tone: "waiting" };
  if (phase === "build" && worker.reportedStatus === "waiting") return { label: "Waiting", tone: "waiting" };
  if (phase === "plan" && snapshot.status === "running") return { label: "Planning", tone: "active" };
  return { label: labels[worker.state], tone: worker.state === "running" ? "active" : "idle" };
}

function AgentStatus({ state }: { state: AgentState }) {
  return <span className={styles.agentStatus} data-tone={state.tone}>{state.label}</span>;
}

function isCurrentTask(snapshot: HarnessSnapshot, worker: HarnessSnapshot["workers"][number]) {
  return snapshot.status === "running" && !["finished", "failed", "paused"].includes(worker.state);
}

function taskLabel(item: ListItem) {
  const first = item.children[0];
  const label = (node: PhrasingContent): string => {
    if ("children" in node) return node.children.map(label).join("");
    if ("value" in node) return node.value;
    if ("alt" in node) return node.alt ?? "";
    return node.type === "break" ? " " : "";
  };
  return first?.type === "paragraph" ? first.children.map(label).join("") : "";
}

const rosterFilters = ["All", "Needs attention", "Finished"] as const;

function ParticipantsRoster({ snapshot, select }: { snapshot: HarnessSnapshot; select: (id: string) => void }) {
  const [filter, setFilter] = useState<typeof rosterFilters[number]>("All");
  const experiment = snapshot.experiment;
  const spec = experiment ? snapshot.canvas : "";
  const document = useMemo(() => spec ? specParser.parse(spec).children : [], [spec]);
  const taskStart = document.findIndex((node) => specHeading(node, 2) === "Task Distribution");
  const history = document.findIndex((node) => specHeading(node, 2) === "Change log");
  const groups = taskStart < 0 ? [] : specTaskGroups(document.slice(taskStart, history > taskStart ? history : undefined), snapshot.agents).values();
  const checklists = new Map([...groups].map(({ agent, items }) => [agent.id, items]));
  const roster = snapshot.agents.map((agent) => {
    const worker = snapshot.workers.find(({ agentId }) => agentId === agent.id)!;
    const planned = (experiment?.planningCompletions ?? experiment?.votes)?.some(({ agentId }) => agentId === agent.id) ?? false;
    const status = experiment ? experimentWorkerStatus(snapshot, worker, planned) : {
      label: snapshot.lease?.agentId === agent.id ? "Editing canvas" : labels[worker.state], tone: benchmarkAgentTones[worker.state],
    };
    return { agent, worker, status, needsAttention: status.tone === "blocked" || status.tone === "failed" };
  });
  const subsets = {
    All: roster,
    "Needs attention": roster.filter(({ needsAttention }) => needsAttention),
    Finished: roster.filter(({ status }) => status.tone === "finished"),
  };
  return <section className={styles.roster}>
    <div className={styles.panelHeading}><h2>Participants</h2></div>
    <div className={styles.rosterFilters} role="group" aria-label="Filter participants">
      {rosterFilters.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>
        {item} <span>{subsets[item].length}</span>
      </button>)}
    </div>
    {subsets[filter].length ? <ul className={styles.participantList} role="list">
      {subsets[filter].map(({ agent, worker, status, needsAttention }) => {
        const items = checklists.get(agent.id);
        const total = items?.length;
        const completed = items?.filter(({ checked }) => checked).length ?? 0;
        const next = items?.find(({ checked }) => !checked);
        const reported = worker.currentTask;
        const activity = reported || (next ? taskLabel(next) : "");
        const showReason = worker.reason && (needsAttention || status.tone === "waiting");
        return <li key={agent.id}><button type="button" className={styles.participantRow} onClick={() => select(agent.id)}>
          <span aria-hidden="true"><AgentAvatar agent={agent} agents={snapshot.agents} size={28} /></span>
          <span className={styles.participantBody}>
            <span className={styles.participantHeading}><strong>{agent.name}</strong><AgentStatus state={status} /></span>
            {activity && <span className={styles.participantActivity}>{reported ? !isCurrentTask(snapshot, worker) && <small>Last task · </small> : <small>Open task · </small>}{activity}</span>}
            {showReason && <span className={styles.participantReason} data-tone={status.tone}>{worker.reason}</span>}
            {experiment ? <span className={styles.participantTasks}>
              {total ? <><span>{completed}/{total} tasks done</span>{status.tone === "finished" && completed < total && <span>{total - completed} open</span>}</>
                : total === 0 ? "No tasks assigned" : "View tasks"}
              <span aria-hidden="true" className={styles.participantArrow}>›</span>
            </span> : <span className={styles.participantTurn}>
              <span>Turn {worker.currentTurnIndex}/{snapshot.config.maxTurnsPerAgent} · {worker.turnsCompleted} completed</span>
              <progress aria-label={`${agent.name} turn progress`} max={snapshot.config.maxTurnsPerAgent} value={worker.turnsCompleted} />
              <span aria-hidden="true" className={styles.participantArrow}>›</span>
            </span>}
          </span>
        </button></li>;
      })}
    </ul> : <p className={styles.participantEmpty}>
      {filter === "Needs attention" ? "No blocked or failed agents." : "No agents have finished this phase yet."}
    </p>}
  </section>;
}

function AgentTasks({ snapshot, agent }: { snapshot: HarnessSnapshot; agent: Persona }) {
  const { id, canvasVersion, experiment } = snapshot;
  const [tasks, setTasks] = useState<ExperimentTasks>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
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
  }, [id, agent.id, canvasVersion, attempt]);

  return <section className={styles.agentTasks}>
    <dl className={styles.taskDetails}>
      {worker.currentTask && <div><dt>{isCurrentTask(snapshot, worker) ? "Current task" : "Last task"}</dt><dd>{worker.currentTask}</dd></div>}
      {worker.reason && <div><dt>{experimentWorkerStatus(snapshot, worker, !!completion).tone === "blocked" ? "Blocker" : "Agent note"}</dt><dd>{worker.reason}</dd></div>}
      {completion && <div><dt>{legacyVote ? "Planning vote" : "Planning"}</dt><dd>{legacyVote ? "Voted complete" : "Finished"} at SPEC.md v{completion.specRevision}</dd></div>}
    </dl>
    <h3>Assigned tasks {tasks && <small>SPEC.md v{tasks.revision}</small>}</h3>
    {error && <div className={styles.viewError}>
      <RecordError message={error} />
      <button type="button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry tasks</button>
    </div>}
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

const summaryFields = ["approach", "assumptions", "decision", "uncertainties"] as const;
const summaryPageSize = 20;

function summaryText(value: unknown) {
  return Array.isArray(value) ? value.map((item) => readableEvaluationText(text(item))).filter(Boolean).join(" · ") : readableEvaluationText(text(value));
}

function AgentSummaries({ records, snapshot, error, retry }: { records: HarnessRecord[]; snapshot: HarnessSnapshot; error: string; retry: () => void }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(summaryPageSize);
  const list = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const matching = [...records].reverse().filter((record) => !needle || summaryFields.some((field) => summaryText(record.data[field]).toLowerCase().includes(needle)));

  return <div ref={list} className={styles.agentSummaries}>
    <div className={styles.agentSummaryIntro}>
      <span>{matching.length} {matching.length === 1 ? "summary" : "summaries"}</span>
    </div>
    {records.length > summaryPageSize && <input type="search" aria-label="Search summaries" placeholder="Search summaries…" value={query} onChange={(event) => {
      setQuery(event.target.value);
      setLimit(summaryPageSize);
    }} />}
    {error && <div className={styles.viewError}><RecordError message={error} /><button type="button" onClick={retry}>Retry summaries</button></div>}
    {!matching.length && !error && <p className={styles.empty}>No summaries match your search.</p>}
    {matching.slice(0, limit).map((record) => <article className={styles.agentSummary} key={record.id} id={record.id} tabIndex={-1}>
      <header><h3>{snapshot.experiment ? "Reflection" : `Turn ${record.turn}`}</h3><Timestamp value={record.createdAt} format="relative" /></header>
      {snapshot.experiment ? <p>{text(record.data.decision)}</p> : <dl>
        {summaryFields.map((key) => <div key={key}><dt>{key}</dt><dd>{summaryText(record.data[key]) || "None stated"}</dd></div>)}
      </dl>}
      {Array.isArray(record.data.evidenceRefs) && <EvidenceLinks snapshot={snapshot} ids={record.data.evidenceRefs.filter((value): value is string => typeof value === "string")} />}
    </article>)}
    {matching.length > limit && <button type="button" className={styles.detailButton} onClick={() => {
      setLimit((value) => value + summaryPageSize);
      requestAnimationFrame(() => list.current?.querySelectorAll("article")[limit]?.focus());
    }}>Show more summaries</button>}
  </div>;
}

function AgentInspector({ snapshot, agent, usage, usageLoaded, usageError, retryUsage, close }: {
  snapshot: HarnessSnapshot;
  agent: Persona;
  usage?: Usage;
  usageLoaded: boolean;
  usageError: string;
  retryUsage: () => void;
  close: () => void;
}) {
  const experiment = snapshot.experiment;
  const defaultTab = experiment ? "Tasks" : "Profile";
  const [selectedTab, setTab] = useState(defaultTab);
  const canReadSummaries = !experiment || snapshot.status === "completed" || snapshot.status === "killed";
  const { records, error, retry } = useRecords(snapshot, "summary", agent.id, canReadSummaries);
  const summaries = canReadSummaries ? records.filter(({ data }) => data.status === "available") : [];
  const tabNames = [...(experiment ? ["Tasks"] : []), "Profile", "Usage", ...(canReadSummaries && (summaries.length || error) ? ["Reasoning summaries"] : [])];
  const tab = tabNames.includes(selectedTab) ? selectedTab : defaultTab;
  const worker = snapshot.workers.find(({ agentId }) => agentId === agent.id)!;
  const planned = (experiment?.planningCompletions ?? experiment?.votes)?.some(({ agentId }) => agentId === agent.id) ?? false;
  const status = experiment ? experimentWorkerStatus(snapshot, worker, planned) : { label: labels[worker.state], tone: benchmarkAgentTones[worker.state] };
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const tabId = (name: string) => `${headingId}-${name.replaceAll(" ", "-")}`;
  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} className={`${styles.dialog} ${styles.agentInspector}`} onClose={close} aria-label={`${agent.name} details`}>
    <header className={styles.agentInspectorHeader}>
      <span aria-hidden="true"><Portrait agent={agent} /></span>
      <div><h2>{agent.name}</h2>{agent.role !== agent.name && <p>{agent.role}</p>}<AgentStatus state={status} /></div>
      <button type="button" className={styles.close} onClick={() => dialog.current?.close()}>Close</button>
    </header>
    <div className={styles.tabs} role="tablist" aria-label="Agent details">
      {tabNames.map((name, index) => <button key={name} type="button" id={tabId(name)} role="tab" aria-selected={tab === name}
        aria-controls={`${tabId(name)}-panel`} tabIndex={name === tab ? 0 : -1}
        onKeyDown={(event) => {
          const destinations: Record<string, number> = { ArrowRight: (index + 1) % tabNames.length, ArrowLeft: (index + tabNames.length - 1) % tabNames.length, Home: 0, End: tabNames.length - 1 };
          const next = destinations[event.key];
          if (next === undefined) return;
          event.preventDefault();
          setTab(tabNames[next]);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}
        onClick={() => setTab(name)}>{name}</button>)}
    </div>
    {tabNames.map((name) => <section key={name} id={`${tabId(name)}-panel`} role="tabpanel" aria-labelledby={tabId(name)}
      hidden={name !== tab} tabIndex={0} className={styles.agentInspectorPanel}>
      {name === "Tasks" && name === tab && <AgentTasks snapshot={snapshot} agent={agent} />}
      {name === "Profile" && <Profile agent={agent} showHeader={false} />}
      {name === "Usage" && <>
        {usageError && <div className={styles.viewError}><RecordError message={usageError} /><button type="button" onClick={retryUsage}>Retry usage</button></div>}
        {usage ? <><UsageOverview usage={usage} /><UsageDetails usage={usage} scope="This agent" /></> :
          !usageError && <p role="status">{usageLoaded ? "No usage recorded for this agent." : "Loading usage…"}</p>}
      </>}
      {name === "Reasoning summaries" && <AgentSummaries records={summaries} snapshot={snapshot} error={error} retry={retry} />}
    </section>)}
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
type EvidenceSelection = { criterion: string; ids: string[] };

const applicationCriteria = ["Runnability", "Core functionality", "Usability", "Integration and persistence", "Implementation quality"];
const deliverableCriteria = ["Brief coverage", "Correctness or internal consistency", "Completeness", "Clarity and usability", "Format and presentation quality"];
const collaborationCriteria = ["Shared specification", "Task distribution", "Dependency handling", "Feedback and disagreement", "Integrated outcome"];
const contributionCriteria = ["Planning contribution", "Delivered contribution", "Quality and correctness", "Verification and handoff", "Collaboration"];

const outcomes: Record<HarnessSnapshot["status"], string> = {
  ready: "Ready",
  running: "In progress",
  reviewing: "Judging",
  paused: "Paused",
  completed: "Completed",
  stopped: "Stopped",
  stopping: "Stopping",
  killed: "Killed",
  judge_failed: "Judge failed",
  verify_failed: "Ungraded",
};

function ResultsHeading({ title, outcome, detail, tone }: {
  title: string;
  outcome: string;
  detail?: string;
  tone?: "positive" | "attention" | "negative";
}) {
  return (
    <header className={styles.resultsHeading}>
      <h2>{title}</h2>
      <div className={styles.resultsOutcome}>
        <span data-tone={tone}>{outcome}</span>
        {detail && <small>{detail}</small>}
      </div>
    </header>
  );
}

function ScoreTotal({ scores }: { scores: Score[] }) {
  const rated = scores.filter((score): score is number => typeof score === "number");
  return (
    <span className={styles.resultsTotal}>
      {rated.length > 0 && <strong>{rated.reduce((sum, score) => sum + score, 0)}/{rated.length * 4}</strong>}
      <small>{rated.length} of {scores.length} scored</small>
    </span>
  );
}

function ExperimentScorecard({ scores, criteria, label, openEvidence }: {
  scores: ExperimentReport["application"];
  criteria: string[];
  label: string;
  openEvidence: (selection: EvidenceSelection) => void;
}) {
  return (
    <ul className={styles.criterionList} role="list" aria-label={label}>
      {scores.map(({ score, explanation, evidenceIds }, index) => {
        const criterion = criteria[index];
        return (
          <li className={styles.criterionRow} key={criterion}>
            <details>
              <summary>
                <span>{criterion}</span>
                {typeof score === "number" ? (
                  <span className={styles.criterionScore}>
                    <span className={styles.scoreTrack} aria-hidden="true"><span style={{ width: `${score * 25}%` }} /></span>
                    <strong>{score}/4</strong>
                  </span>
                ) : (
                  <span className={styles.unscored}>{score === "not_assessable" ? "Not assessable" : "Not applicable"}</span>
                )}
              </summary>
              <p>{explanation}</p>
            </details>
            {evidenceIds.length > 0 && (
              <button className={styles.criterionEvidence} type="button"
                aria-label={`Open evidence for ${criterion} (${evidenceIds.length} ${evidenceIds.length === 1 ? "source" : "sources"})`}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  openEvidence({ criterion, ids: evidenceIds });
                }}>
                Evidence <small>{evidenceIds.length}</small>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ArtifactFilePreview({ id, revision, path }: { id: string; revision: string; path: string }) {
  const [selected, setSelected] = useState(path);
  const [result, setResult] = useState<{ path: string; data?: RepositoryFile; error?: string }>();
  const state = result?.path === selected ? result : undefined;
  useEffect(() => {
    let active = true;
    void client.repositoryFile(id, "main", revision, selected).then((data) => {
      if (active) setResult({ path: selected, data });
    }).catch((error: unknown) => {
      if (active) setResult({ path: selected, error: error instanceof Error ? error.message : "Could not open this artifact." });
    });
    return () => { active = false; };
  }, [id, revision, selected]);
  return <>
    {selected !== path && <button onClick={() => setSelected(path)}>Back to {path}</button>}
    {state?.data ? <RepositoryFileViewer key={selected} file={state.data} id={id} branch="main"
      revision={revision} path={selected} openFile={setSelected} />
      : state?.error ? <RecordError message={state.error} /> : <p role="status">Loading file…</p>}
  </>;
}

type ExperimentState = NonNullable<HarnessSnapshot["experiment"]>;
type PlannedOutput = NonNullable<ExperimentState["deliverablePlan"]>["outputs"][number];
type ArtifactCheck = NonNullable<ExperimentState["frozen"]>["artifactChecks"][number];
const artifactStatus = { ready: "Ready", missing: "Missing", invalid: "Invalid", unavailable: "Unavailable" };

function ResultArtifact({ snapshot, revision, output, check }: {
  snapshot: HarnessSnapshot;
  revision: string;
  output: PlannedOutput;
  check: ArtifactCheck;
}) {
  const [open, setOpen] = useState(false);
  const label = output.path || (output.kind === "repository" ? "Repository changes" : output.format);
  return <li className={styles.resultArtifact}>
    <div className={styles.resultsSectionHeading}>
      <strong>{label}</strong>
      <small>{[output.primary ? "Primary" : output.required ? "Required" : "Optional", artifactStatus[check.status]].join(" · ")}</small>
    </div>
    <p>{output.description}</p>
    <p className={styles.resultsNote}>{check.detail}</p>
    {check.status === "ready" && (
      <div className={styles.artifactActions}>
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary>{output.kind === "file" ? "Open" : "Open frozen repository"}</summary>
          {open && (output.kind === "file" ? <ArtifactFilePreview id={snapshot.id} revision={revision} path={output.path} />
            : <RepositoryBrowser snapshot={snapshot} repository={snapshot.experiment!.repository} visible frozenRevision={revision} />)}
        </details>
        {output.kind === "file" && <a href={client.artifactDownload(snapshot.id, output.path)} download>Download</a>}
      </div>
    )}
  </li>;
}

function ExperimentResults({ snapshot }: { snapshot: HarnessSnapshot }) {
  const experiment = snapshot.experiment!;
  const report = experiment.report;
  const custom = experiment.rubric === "deliverable-v1";
  const qualityLabel = custom ? "Deliverable quality" : "Application quality";
  const frozen = experiment.frozen;
  const artifacts = experiment.deliverablePlan?.outputs.map((output, index) => ({ output, check: frozen?.artifactChecks[index], index }))
    .sort((a, b) => Number(b.output.primary) - Number(a.output.primary));
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const contextFailures = snapshot.workers.filter((worker) => worker.state === "failed" && worker.failureCode === "CONTEXT_LIMIT");
  const agentName = (id: string) => snapshot.agents.find((agent) => agent.id === id)?.name ?? id;
  let pending: string | undefined;
  if (snapshot.status === "killed") pending = "Experiment killed. The repository and recorded activity are preserved.";
  else if (snapshot.status === "judge_failed") pending = `The judge did not finish a report. Attempts recorded ${experiment.judgeAttempts}.`;
  else if (snapshot.status === "reviewing") pending = "Judge report pending.";
  else if (!report) pending = snapshot.status === "completed"
    ? "No judge report was saved for this experiment."
    : "The judge report appears after the build phase.";

  return (
    <section className={`${styles.panel} ${styles.resultsView}`} aria-label="Experiment results">
      <ResultsHeading title="Experiment results" outcome={outcomes[snapshot.status]}
        tone={snapshot.status === "completed" ? "positive" : snapshot.status === "judge_failed" ? "negative" : ["killed", "paused"].includes(snapshot.status) ? "attention" : undefined} />
      {report && (
        <section className={styles.resultsSummary} aria-labelledby="experiment-judge-summary">
          <h3 id="experiment-judge-summary">Judge summary</h3>
          <p>{report.summary}</p>
        </section>
      )}
      {pending && <p className={styles.resultsNote} role="status">{pending}</p>}
      {snapshot.status === "judge_failed" && <RecordError message={snapshot.error} />}
      {experiment.frozen && (
        <p className={styles.resultsProvenance}>
          {report ? "Evaluated main commit" : "Frozen main commit"}{" "}
          <code title={experiment.frozen.mainCommit}>{experiment.frozen.mainCommit.slice(0, 12)}</code>
          {" · "}SPEC.md v{experiment.frozen.specRevision}
          {report && (custom ? " · Deliverables and records review" : " · Code and records review")}
        </p>
      )}
      {experiment.frozen && experiment.publicCheckProfile && <PublicChecksPanel snapshot={snapshot} />}
      {frozen && artifacts?.length ? (
        <section className={styles.resultsSection} aria-labelledby="final-deliverables">
          <h3 id="final-deliverables">Deliverables</h3>
          <ul className={styles.resultArtifacts}>
            {artifacts.map(({ output, check, index }) => check && <ResultArtifact key={index} snapshot={snapshot} revision={frozen.mainCommit} output={output} check={check} />)}
          </ul>
        </section>
      ) : null}
      {contextFailures.length > 0 && (
        <p className={styles.resultsNote}>Context limit exceeded by {contextFailures.map((worker) => agentName(worker.agentId)).join(", ")} during {experiment.frozen ? "Build" : "Plan"}.</p>
      )}
      {snapshot.workers.some((worker) => worker.state === "failed" && worker.failureCode !== "CONTEXT_LIMIT") && (
        <p className={styles.resultsNote}>One or more agents stopped after a provider or runtime failure.</p>
      )}
      {report && (
        <>
          <div className={styles.resultsScorecards}>
            <section className={styles.resultsSection} aria-labelledby="experiment-quality">
              <div className={styles.resultsSectionHeading}>
                <h3 id="experiment-quality">{qualityLabel}</h3>
                <ScoreTotal scores={report.application.map(({ score }) => score)} />
              </div>
              <ExperimentScorecard label={`${qualityLabel} scores`} scores={report.application} criteria={custom ? deliverableCriteria : applicationCriteria} openEvidence={setEvidence} />
            </section>
            <section className={styles.resultsSection} aria-labelledby="experiment-collaboration">
              <div className={styles.resultsSectionHeading}>
                <h3 id="experiment-collaboration">Collaboration</h3>
                <ScoreTotal scores={report.collaboration.map(({ score }) => score)} />
              </div>
              <ExperimentScorecard label="Collaboration scores" scores={report.collaboration} criteria={collaborationCriteria} openEvidence={setEvidence} />
            </section>
          </div>
          <section className={styles.resultsSection} aria-labelledby="missing-work">
            <h3 id="missing-work">Missing work</h3>
            {report.missingWork.length ? (
              <ul className={styles.missingWork}>{report.missingWork.map((item, index) => <li key={index}>{item}</li>)}</ul>
            ) : <p className={styles.resultsNote}>None identified by the judge.</p>}
          </section>
          <section className={styles.resultsSection} aria-labelledby="individual-contributions">
            <h3 id="individual-contributions">Individual contributions</h3>
            <div className={styles.resultsAgents}>
              {report.agents.map((card) => {
                const name = agentName(card.agentId);
                return (
                  <details key={card.agentId} className={styles.resultsAgent}>
                    <summary><strong>{name}</strong><ScoreTotal scores={card.criteria.map(({ score }) => score)} /></summary>
                    <ExperimentScorecard label={`${name} scores`} scores={card.criteria} criteria={contributionCriteria}
                      openEvidence={({ criterion, ids }) => setEvidence({ criterion: `${name} · ${criterion}`, ids })} />
                  </details>
                );
              })}
            </div>
          </section>
        </>
      )}
      {evidence && <EvidenceDialog snapshot={snapshot} ids={evidence.ids} criterion={evidence.criterion} close={() => setEvidence(null)} />}
    </section>
  );
}

function DeepSWEResults({ snapshot }: { snapshot: HarnessSnapshot }) {
  const experiment = snapshot.experiment!;
  const run = experiment.deepswe!;
  const result = run.result;
  const outcome = result ? (result.reward === 1 ? "Passed" : "Failed")
    : snapshot.status === "reviewing" ? "Verifying" : outcomes[snapshot.status];
  const tests = result && [
    ["tests", result.tests], ["passed", result.passed], ["failed", result.failed],
  ].filter(([, count]) => count !== null);
  return (
    <section className={`${styles.panel} ${styles.resultsView}`} aria-label="DeepSWE results">
      <ResultsHeading title="Chorus on DeepSWE" outcome={outcome} detail={run.task.id}
        tone={result?.reward === 1 ? "positive" : result?.reward === 0 ? "negative" : snapshot.status === "verify_failed" ? "attention" : undefined} />
      {snapshot.status === "verify_failed" && <RecordError message={snapshot.error} />}
      {snapshot.status === "reviewing" && <p className={styles.resultsNote} role="status">Pier is grading the frozen patch.</p>}
      {run.stopReason && <p className={styles.resultsNote}>Solving ended at the {run.stopReason === "call_limit" ? "model-call limit" : "deadline"}.</p>}
      {run.condition && <details><summary>{run.condition.name} · Run settings</summary>
        <p>{run.callLimit} shared calls · {run.solvingSeconds} seconds</p>
        <ul>{run.condition.slots.map((slot, index) => <li key={index}>
          {snapshot.agents[index].name} · {slot.guidance === "neutral" ? "Neutral" : slot.guidance === "role" ? "Role only" : "Full profile"} · {slot.model ?? snapshot.config.model}
        </li>)}</ul>
      </details>}
      {experiment.frozen && experiment.publicCheckProfile && <PublicChecksPanel snapshot={snapshot} />}
      {result && <section className={styles.resultsSummary} aria-label="Verifier tests">
        <h3>Verifier tests</h3>
        <p>{tests?.length ? tests.map(([label, count]) => `${count} ${label}`).join(" · ") : "Test totals unavailable."}</p>
        {result.compilationFailure && <details open><summary>Suite compilation failure</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{result.compilationFailure}</pre>
        </details>}
      </section>}
      {experiment.frozen && run.patchDigest && <section className={styles.resultsSummary} aria-label="Submitted patch">
        <h3>Submitted patch</h3>
        <p>Base <code title={run.task.baseCommit}>{run.task.baseCommit.slice(0, 12)}</code> · Main <code title={experiment.frozen.mainCommit}>{experiment.frozen.mainCommit.slice(0, 12)}</code></p>
        <p>SHA-256 <code title={run.patchDigest}>{run.patchDigest.slice(0, 16)}</code> · {run.verificationAttempts} {run.verificationAttempts === 1 ? "grading attempt" : "grading attempts"}</p>
        <a href={client.deepswePatch(snapshot.id)} download>Download patch</a>
      </section>}
    </section>
  );
}

function Report({ snapshot }: { snapshot: HarnessSnapshot }) {
  if (snapshot.experiment?.deepswe) return <DeepSWEResults snapshot={snapshot} />;
  if (snapshot.experiment) return <ExperimentResults snapshot={snapshot} />;
  const report = snapshot.report;
  const verification = snapshot.verification;
  const teamCriteria = ["Evidence quality", "Relevance", "Coordination", "Handling disagreement", "Actionable synthesis"];
  const agentCriteria = ["Useful contribution", "Technical accuracy", "Collaboration", "Stated reasoning summary", "Response to corrections"];
  return (
    <section className={`${styles.panel} ${styles.resultsView}`} aria-label="Final evaluation">
      <ResultsHeading title="Final evaluation" outcome={verification ? `Solution ${verification.status}` : outcomes[snapshot.status]}
        detail={snapshot.endedEarly ? "Stopped early" : undefined}
        tone={verification?.status === "correct" ? "positive" : verification ? "negative" : undefined} />
      {report && (
        <section className={styles.resultsSummary} aria-labelledby="benchmark-judge-summary">
          <h3 id="benchmark-judge-summary">Judge summary</h3>
          <p>{readableEvaluationText(report.summary)}</p>
        </section>
      )}
      {verification ? (
        <div className={styles.resultsVerification}>
          <strong>Automatic check</strong>
          <p>{verification.checks.join(" ")}</p>
          <small>Canvas version {verification.canvasVersion}</small>
        </div>
      ) : <p className={styles.resultsNote}>Solution checks appear after the run finishes.</p>}
      {report ? (
        <>
          <section className={styles.resultsSection} aria-labelledby="benchmark-collaboration">
            <div className={styles.resultsSectionHeading}>
              <h3 id="benchmark-collaboration">Collaboration</h3>
              <ScoreTotal scores={report.conversationScores} />
            </div>
            <ScoreBreakdown scores={report.conversationScores} criteria={teamCriteria} label="Team collaboration scores" />
            <p className={styles.resultsNote}>{readableEvaluationText(report.conversationExplanation)}</p>
            <EvidenceLinks snapshot={snapshot} ids={report.conversationEvidenceIds} />
          </section>
          <section className={styles.resultsSection} aria-labelledby="agent-evaluations-heading">
            <h3 id="agent-evaluations-heading">Agent evaluations</h3>
            <div className={styles.resultsAgents}>
              {report.agents.map((grade) => {
                const name = snapshot.agents.find((item) => item.id === grade.agentId)?.name ?? grade.agentId;
                return (
                  <details className={styles.resultsAgent} key={grade.agentId}>
                    <summary>
                      <strong>{name}</strong>
                      {grade.insufficientEvidence && <small className={styles.limitedEvidence}>Limited evidence</small>}
                      <ScoreTotal scores={grade.scores} />
                    </summary>
                    <div className={styles.resultsAgentBody}>
                      <ScoreBreakdown scores={grade.scores} criteria={agentCriteria} label={`${name} evaluation scores`} />
                      <p className={styles.resultsNote}>{readableEvaluationText(grade.explanation)}</p>
                      <EvidenceLinks snapshot={snapshot} ids={grade.evidenceIds} />
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
          <div className={styles.resultsFooter}>
            <span>{report.coveredRecordIds.length} source records reviewed</span>
            <span>Completed <Timestamp value={report.completedAt} /></span>
          </div>
        </>
      ) : (snapshot.status === "reviewing" || snapshot.frozenSequence !== null) && (
        <p role="status" className={styles.resultsNote}>{snapshot.config.judgeEnabled ? "Judge report pending. Saved progress will be reused on retry." : "Narrative judge disabled for this run."}</p>
      )}
    </section>
  );
}

export type SceneProps = { snapshot: HarnessSnapshot; select: (id: string) => void; selected: string | null };
export type WorkspaceParts = Record<"heading" | "error" | "metrics" | "scene" | "roster" | "board" | "canvas" | "changes" | "report" | "inspector", ReactNode>;
export type RunControls = {
  snapshot: HarnessSnapshot;
  usage: HarnessUsage | null;
  usageError: string;
  retryUsage: () => void;
  busy: boolean;
  act: (action: HarnessAction) => Promise<boolean>;
  leave: () => void;
};
export type HarnessPresentation = {
  followPosts?: boolean;
  avatars?: AvatarStyle;
  portrait?: PortraitRenderer;
  brand?: ReactNode;
  className?: string;
  setup?: (agents: Persona[]) => ReactNode;
  scene?: (props: SceneProps) => ReactNode;
  workspace?: (parts: WorkspaceParts, controls: RunControls) => ReactNode;
};

export function LiveSession({ snapshot, receive, mode, leave, presentation }: { presentation?: HarnessPresentation; snapshot: HarnessSnapshot; receive: (s: HarnessSnapshot) => void; mode: "chorus" | "nanoville"; leave: () => void }) {
  const [usage, setUsage] = useState<HarnessUsage | null>(null);
  const [usageError, setUsageError] = useState("");
  const [usageAttempt, setUsageAttempt] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const commandPending = useRef(false);
  const [connectionError, setConnectionError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => client.subscribe(snapshot.id, -1, (next) => { setConnectionError(""); receive(next); }, setConnectionError), [snapshot.id, receive]); // latest revision is recovered on connect
  useEffect(() => {
    let active = true;
    void client.usage(snapshot.id).then((value) => {
      if (active) { setUsage(value); setUsageError(""); }
    }).catch((error: unknown) => {
      if (active) setUsageError(error instanceof Error ? error.message : "Usage is temporarily unavailable.");
    });
    return () => { active = false; };
  }, [snapshot.id, snapshot.revision, usageAttempt]);
  function retryUsage() {
    setUsageError("");
    setUsageAttempt((value) => value + 1);
  }
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
    error: <RecordError message={error || connectionError || (["judge_failed", "verify_failed"].includes(snapshot.status) ? "" : snapshot.error) || (!presentation?.workspace ? usageError : "")} />,
    metrics: usage && <section className={styles.topMetrics} aria-label="Session totals"><p className={styles.eyebrow}>Participant totals · {snapshot.agents.length} agents</p><Metrics usage={usage.participants} /><div className={styles.costFooter}><span>Judge: {money(usage.judge.reportedCostUSD + usage.judge.estimatedCostUSD)}</span><span>Session: {money(usage.total.reportedCostUSD + usage.total.estimatedCostUSD)}{usage.total.estimatedCostUSD > 0 ? " including estimates" : ""}</span><span>Wall time: {(usage.wallTimeMs / 1000).toFixed(0)} s</span></div></section>,
    scene: presentation?.scene ? presentation.scene({ snapshot, select: setSelected, selected }) : mode === "nanoville" ? <Scene snapshot={snapshot} select={setSelected} /> : null,
    roster: <ParticipantsRoster snapshot={snapshot} select={setSelected} />,
    board: <Board followPosts={presentation?.followPosts} snapshot={snapshot} select={setSelected} />,
    canvas: experiment ? <ExperimentSpecView snapshot={snapshot} /> : <BenchmarkCanvas snapshot={snapshot} />,
    changes: null,
    report: <Report snapshot={snapshot} />,
    inspector: agent && <AgentInspector key={agent.id} snapshot={snapshot} agent={agent} usage={usage?.agents[agent.id]} usageLoaded={!!usage} usageError={usageError} retryUsage={retryUsage} close={() => setSelected(null)} />,
  };
  if (presentation?.workspace) {
    return <AvatarStyleContext.Provider value={presentation.avatars ?? "portrait"}>
      {/* act only consults the command lock when a control invokes it. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {presentation.workspace(parts, { snapshot, usage, usageError, retryUsage, busy, act, leave })}
    </AvatarStyleContext.Provider>;
  }
  return <>{parts.heading}{parts.error}{parts.metrics}{parts.scene}{parts.roster}<div className={styles.workGrid}>{parts.board}{parts.canvas}</div>{parts.changes}{parts.report}{parts.inspector}</>;

}

const archiveViews = ["Conversation", "Canvas"] as const;
const archiveTurnPage = 50;

export function LegacyArchive({ id, newSessionHref = "/", archiveHref = "/archive" }: { id: string; newSessionHref?: string; archiveHref?: string }) {
  const [state, setState] = useState<{ id: string; value?: LegacySnapshot; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<typeof archiveViews[number]>("Conversation");
  const [turnLimit, setTurnLimit] = useState(archiveTurnPage);
  const conversation = useRef<HTMLElement>(null);
  const current = state?.id === id ? state : undefined;
  const value = current?.value;
  useEffect(() => {
    let active = true;
    void legacyClient.get(id).then((value) => {
      if (active) setState({ id, value });
    }).catch((error: unknown) => {
      if (active) setState({ id, error: error instanceof Error ? error.message : "Could not load this saved run." });
    });
    return () => { active = false; };
  }, [id, attempt]);

  return <section className={styles.historicalRun} aria-label="Historical run">
    <header className={styles.historicalHeader}>
      <div className={styles.historicalTopline}>
        <a href={archiveHref}>‹ Back to archive</a>
        <span>Historical session · read only</span>
      </div>
      {value && <>
        <h2>{value.scenario.title}</h2>
        <div className={styles.historicalMeta}>
          <div>
            <span className={styles.historicalStatus} data-state={value.status}>{value.status}</span>
            <Timestamp value={value.createdAt} format="short" />
            <span>{value.agents.length} {value.agents.length === 1 ? "agent" : "agents"}</span>
          </div>
          <a href={`/api/chorus/sessions/${encodeURIComponent(id)}/export?format=json&includeJournals=true`} download>Export archived session with journals</a>
        </div>
      </>}
    </header>
    {current?.error && <div className={styles.viewError}>
      <RecordError message={current.error} />
      <button type="button" onClick={() => { setState(undefined); setAttempt((value) => value + 1); }}>Retry historical run</button>
    </div>}
    {value ? <>
      <div className={styles.specToolbar}>
        <div className={styles.specViews} role="group" aria-label="Historical views">
          {archiveViews.map((item) => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>
            {item}{item === "Conversation" && <small aria-hidden="true">{value.turns.length}</small>}
          </button>)}
        </div>
      </div>
      <section ref={conversation} className={styles.historicalContent} aria-label="Historical conversation" tabIndex={0} hidden={view !== "Conversation"}>
        {value.turns.length ? <>
          <ol className={styles.historicalTurns}>
            {value.turns.slice(0, turnLimit).map((turn, index) => <li key={index}>
              <article tabIndex={-1}>
                <header><strong>{turn.speakerName}</strong><small>Turn {turn.turnNumber}{turn.kind === "skipped" ? " · Skipped" : turn.kind === "judge" ? " · Judge" : ""}</small></header>
                <p>{turn.text}</p>
              </article>
            </li>)}
          </ol>
          {value.turns.length > turnLimit && <button type="button" className={styles.detailButton} onClick={() => {
            setTurnLimit((limit) => limit + archiveTurnPage);
            requestAnimationFrame(() => conversation.current?.querySelectorAll("article")[turnLimit]?.focus());
          }}>Show more turns</button>}
        </> : <p className={styles.empty}>This run has no recorded turns.</p>}
      </section>
      <section className={styles.historicalContent} aria-label="Historical canvas" tabIndex={0} hidden={view !== "Canvas"}>
        {value.canvas ? <Markdown>{value.canvas}</Markdown> : <p className={styles.empty}>This run has no saved canvas.</p>}
      </section>
    </> : !current?.error && <p role="status" className={styles.empty}>Loading saved session…</p>}
    <footer className={styles.historicalFoot}><a href={newSessionHref}>Start a new harness session</a></footer>
  </section>;
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
  const modelOptions = (catalog?.models ?? []).map((m) => ({ value: m.id, label: m.available === false ? `${m.label} · unavailable` : m.label }));
  const inspected = catalog?.agents.find((a) => a.id === profile);
  const agentCategories = catalog ? ["All", ...Array.from(new Set(catalog.agents.map((agent) => agent.domain).filter(Boolean))).sort()] : [];
  return <PortraitContext.Provider value={presentation?.portrait}><main className={`${styles.app} ${presentation?.className || ""}`}><header className={styles.header}><Link href="/" className={styles.brand}>{presentation?.brand || (mode === "nanoville" ? "nanoville" : "The Chorus Project")}</Link></header>
    {legacyId ? <LegacyArchive id={legacyId} /> : snapshot ? <LiveSession key={snapshot.id} snapshot={snapshot} receive={receive} mode={mode} leave={leave} presentation={presentation} /> : <><div className={styles.intro}><h1>Set up an experiment</h1><p>Choose a problem, assemble a team, and watch independent agents discuss, revise, and build a shared solution.</p></div><RecordError message={error} />{!catalog || restoring ? <p role="status">Connecting to Chorus…</p> : <div className={styles.setup}>{presentation?.setup && <div className={styles.setupPresentation}>{presentation.setup(catalog.agents.filter((agent) => roster.includes(agent.id)))}</div>}<section className={styles.configuration}><h2>01 · Choose a problem</h2><div className={styles.field}>Problem<WorkspaceSelect label="Problem" value={problemId} options={catalog.problems.map((p) => ({ value: p.id, label: p.title }))} onValueChange={(value) => { const p = catalog.problems.find((p) => p.id === value)!; setProblemId(p.id); setRoster(p.participantIds); setAdversaries([]); }} /></div>{problem && <><p className={styles.eyebrow}>{problem.domain}</p><details open><summary>Problem statement</summary><pre className={styles.statement}>{problem.statement}</pre></details></>}<h2>02 · Set the run</h2><div className={styles.field}>Model<WorkspaceSelect label="Model" value={model} onValueChange={setModel} options={modelOptions} /></div>{selectedModel?.available === false && <p role="status" className={styles.warning}>{selectedModel.unavailableReason}</p>}{selectedModel?.compatibilityNote && <p role="status" className={styles.warning}>{selectedModel.compatibilityNote}</p>}<label className={styles.field}>Turns per agent<input type="number" aria-label="Turns per agent" min={1} max={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></label><label className={styles.check}><input type="checkbox" checked={judge} onChange={(e) => setJudge(e.target.checked)} /> Final judge</label>{judge && <div className={styles.field}>Judge model<WorkspaceSelect label="Judge model" value={judgeModel ?? model} onValueChange={setJudgeModel} options={modelOptions} /></div>}<p className={styles.muted}>Judging starts after all agents finish or reach their turn cap.</p><div className={styles.startBox}><strong>{roster.length} agents × {cap} turns</strong><p>At most {roster.length * cap} contribution cycles.</p><button className={styles.primary} disabled={busy || roster.length < 2 || roster.length > 50 || !Number.isInteger(cap) || cap < 1 || cap > 100 || selectedModel?.available === false || (judge && selectedJudgeModel?.available === false)} onClick={() => void start()}>{busy ? "Starting…" : "Start session"}</button><small>{roster.length < 2 ? "Select at least two agents." : "A cycle can include up to three concise board posts."}</small></div></section><section><div className={styles.panelHeading}><div><h2>03 · Your team</h2><p className={styles.muted}>Relevant agents are selected for you. Add or remove anyone.</p></div><strong>{roster.length} selected</strong></div><div className={styles.categoryGroup} role="group" aria-label="Filter agents by category">{agentCategories.map((category) => <button type="button" key={category} aria-pressed={agentCategory === category} className={agentCategory === category ? styles.categoryActive : ""} onClick={() => setAgentCategory(category)}>{category}</button>)}</div><div className={styles.catalogGrid}>{catalog.agents.filter((agent) => agentCategory === "All" || agent.domain === agentCategory).map((agent) => <article className={`${styles.personaCard} ${roster.includes(agent.id) ? styles.selected : ""}`} key={agent.id} role="button" tabIndex={0} aria-label={`View ${agent.name} profile`} onClick={(event) => { if ((event.target as HTMLElement).closest("input, label")) return; setProfile(agent.id); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !(event.target as HTMLElement).closest("input, label")) { event.preventDefault(); setProfile(agent.id); } }}><div className={styles.personaSelect}><input type="checkbox" aria-label={`Select ${agent.name}`} checked={roster.includes(agent.id)} onChange={(e) => { setRoster(e.target.checked ? [...roster, agent.id] : roster.filter((id) => id !== agent.id)); if (!e.target.checked) setAdversaries(adversaries.filter((id) => id !== agent.id)); }} /><Portrait agent={agent} /><span><strong>{agent.name}</strong><small>{agent.role}</small></span></div>{roster.includes(agent.id) && <label className={styles.adversary}><input type="checkbox" aria-label={`${agent.name} private adversary`} checked={adversaries.includes(agent.id)} onChange={(e) => setAdversaries(e.target.checked ? [...adversaries, agent.id] : adversaries.filter((id) => id !== agent.id))} /> Private adversary</label>}</article>)}</div>{inspected && <ProfileDialog agent={inspected} close={() => setProfile(null)} /> }</section></div>}</>}
  </main></PortraitContext.Provider>;
}
