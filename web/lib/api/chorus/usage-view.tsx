// Shared usage presentation. Source: chorus/sdk/usage-view.tsx; regenerate copies.
import type { Contracts } from "./contracts.generated";

type Turn = Contracts["snapshot"]["turns"][number];
type Telemetry = NonNullable<Turn["usageDetails"]>;
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-US");
const percent = (part: number, total: number) => `${(100 * part / total).toFixed(1)}%`;

export function UsageDetails({ details, totals, latencySeconds, className }: {
  details?: Telemetry | null;
  totals?: Turn["tokenUsage"];
  latencySeconds?: number;
  className?: string;
}) {
  const reply = details?.response;
  const calls = details?.calls ?? [];
  const lastSpoken = calls.filter((call) => call.phase === "spoken").at(-1);
  const context = reply?.context ?? lastSpoken?.context;
  const countTotal = (field: "input" | "output" | "cachedInput") => {
    const known = calls.filter((call) => call[field] != null);
    return known.length ? `${number(known.reduce((sum, call) => sum + call[field]!, 0))}${known.length < calls.length ? ` (partial: ${known.length}/${calls.length} calls)` : ""}` : "—";
  };
  const completeTotal = (field: "input" | "output" | "cachedInput") => calls.length && calls.every((call) => call[field] != null) ? calls.reduce((sum, call) => sum + call[field]!, 0) : null;
  const cached = reply ? reply.cachedInput : completeTotal("cachedInput");
  const cacheLabel = reply ? reply.cacheStatus === "hit" ? "Cache hit" : reply.cacheStatus === "no_read" ? "No cache read" : "Cache usage unavailable"
    : calls.some((call) => (call.cachedInput ?? 0) > 0) ? "Cache hit across turn" : cached === 0 ? "No cache read" : "Cache usage unavailable";
  return <div className={className}>
    <p aria-label={reply ? "Response token usage" : "Turn token usage"}>
      <span>{reply ? "Input" : "Turn input"} {number(reply ? reply.input : totals?.input ?? completeTotal("input"))}</span>
      <span>{reply ? "Output" : "Turn output"} {number(reply ? reply.output : totals?.output ?? completeTotal("output"))}</span>
      <span title="Cached tokens are included in input tokens.">{reply || !calls.length ? "Cached" : "Turn cached"} {reply ? number(cached) : countTotal("cachedInput")}{cached != null && reply?.input ? ` (${percent(cached, reply.input)})` : ""}</span>
      <span>{cacheLabel}</span>
      {latencySeconds !== undefined && <span>{latencySeconds.toFixed(1)}s</span>}
    </p>
    <p title="Input for one model call versus the enforced Chorus window. Completion space is reserved separately.">
      {reply || !lastSpoken ? "Context input" : "Last attempted response context input"} {context?.inputSource === "estimated" ? "~" : ""}{number(context?.inputTokens)} / {number(context?.effectiveWindowTokens)}
      {context ? ` (${percent(context.inputTokens, context.effectiveWindowTokens)})` : ""}
    </p>
    {calls.length > 0 && <details>
      <summary>Usage details · {calls.length} {calls.length === 1 ? "call" : "calls"}</summary>
      <p>Turn totals · Input {countTotal("input")} · Output {countTotal("output")} · Cached {countTotal("cachedInput")}</p>
      {reply && <p>{reply.model} · {reply.route}{reply.provider ? ` · ${reply.provider}` : ""}</p>}
      {context && <p>Model capacity {number(context.modelWindowTokens)} · Chorus cap {number(context.configuredWindowTokens)} · Completion reserve {number(context.completionReserveTokens)} · Usable input {number(context.usableInputTokens)}</p>}
      <p>Cache reads are part of input. Reasoning tokens are part of output. Counts marked ~ are estimates; — means unavailable.</p>
      <div style={{ overflowX: "auto" }}><table>
        <caption>Model calls for this turn</caption>
        <thead><tr>{["Phase / attempt", "Input", "Output", "Cached", "Cache writes", "Reasoning", "Status"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{calls.map((call) => <tr key={call.id}>
          <th scope="row" title={`${call.model} · ${call.route} · ${call.provider ?? "provider unavailable"} · ${call.requestId ?? "request ID unavailable"}`}>{call.phase} / {call.attempt}</th>
          <td>{number(call.input)}</td><td>{number(call.output)}</td><td>{number(call.cachedInput)}</td><td>{number(call.cacheWriteInput)}</td><td>{number(call.reasoningOutput)}</td>
          <td>{call.outcome === "success" ? call.accepted ? "Accepted" : call.rejectionReason ? `Rejected: ${call.rejectionReason}` : call.validationPassed ? "Validated · not published" : "Unpublished" : call.outcome}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
  </div>;
}
