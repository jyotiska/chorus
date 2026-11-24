"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { DeepSWECampaign, DeepSWEComparison } from "@/lib/api/chorus/harness-client";
import { harness, message, sessionHref, Shell } from "./shell";

function HistoricalComparison({ current }: { current: DeepSWECampaign }) {
  const [history, setHistory] = useState<Awaited<ReturnType<typeof harness.campaigns>>>([]);
  const [otherId, setOtherId] = useState("");
  const [other, setOther] = useState<DeepSWECampaign | null>(null);
  const [baseline, setBaseline] = useState("");
  const [candidate, setCandidate] = useState(current.manifest.conditions[0].name);
  const [comparison, setComparison] = useState<DeepSWEComparison | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void harness.campaigns().then(items => { if (active) setHistory(items.filter(c => c.id !== current.id)); })
      .catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [current.id]);
  useEffect(() => {
    if (!otherId) return;
    const controller = new AbortController();
    void harness.campaign(otherId, controller.signal).then(report => {
      if (controller.signal.aborted) return;
      setOther(report);
      setBaseline(report.manifest.conditions[0].name);
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [otherId]);
  useEffect(() => {
    if (!other || !baseline) return;
    let active = true;
    void harness.compareCampaigns(current.id, other.id, candidate, baseline).then(result => {
      if (active) { setComparison(result); setError(""); }
    }).catch(e => { if (active) { setError(message(e)); setComparison(null); } });
    return () => { active = false; };
  }, [current, other, baseline, candidate]);
  if (!history.length && !error) return null;
  return <section><h2>Compare with a previous campaign</h2>
    <div className="swe-fields"><label>Baseline campaign<select value={otherId} onChange={e => {
      setOther(null); setBaseline(""); setComparison(null); setError(""); setOtherId(e.target.value);
    }}><option value="">Select campaign</option>{history.map(c =>
      <option value={c.id} key={c.id}>{c.name} · {new Date(c.createdAt).toLocaleString()}</option>)}</select></label>
      {other && <><label>Baseline condition<select value={baseline} onChange={e => { setComparison(null); setBaseline(e.target.value); }}>
        {other.manifest.conditions.map(c => <option key={c.name}>{c.name}</option>)}</select></label>
        <label>Current condition<select value={candidate} onChange={e => { setComparison(null); setCandidate(e.target.value); }}>
          {current.manifest.conditions.map(c => <option key={c.name}>{c.name}</option>)}</select></label></>}
    </div>
    {error && <p role="alert">{error}</p>}
    {comparison && <div aria-live="polite"><p>{comparison.deltaPoints === null ? "Awaiting paired grades" :
      `${comparison.baselinePercent?.toFixed(1)}% → ${comparison.candidatePercent?.toFixed(1)}% (${comparison.deltaPoints.toFixed(1)} pp)`}</p>
      <p>{comparison.paired} matched repeats · {comparison.wins} gains · {comparison.losses} losses · {comparison.ties} ties.
        Planned repeats: {comparison.baselinePlanned} baseline, {comparison.candidatePlanned} current.</p>
      <p>{comparison.changedSettings.length ? `Changed settings: ${comparison.changedSettings.join(", ")}.` : "The saved conditions use the same settings."}</p>
    </div>}
  </section>;
}

export function CampaignReport({ id }: { id: string }) {
  const router = useRouter();
  const [report, setReport] = useState<DeepSWECampaign | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  const repeatKey = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const next = await harness.campaign(id, controller.signal);
        if (controller.signal.aborted) return;
        setReport(next);
        setError("");
        if (next.status === "running") timer = setTimeout(load, 1500);
      } catch (failure) { if (!controller.signal.aborted) setError(message(failure)); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, revision]);
  async function act(action: "resume" | "cancel" | "repeat") {
    if (!report || busy) return;
    setBusy(true);
    try {
      if (action === "repeat") {
        repeatKey.current ||= crypto.randomUUID();
        const copy = await harness.launchCampaign({ ...report.manifest, requestId: repeatKey.current });
        router.push(`/deepswe/${encodeURIComponent(copy.id)}`);
      } else {
        setReport(await harness.campaignControl(id, action));
      }
      refresh(n => n + 1);
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <Shell title={report?.manifest.name ?? "DeepSWE campaign"}>
    <article className="swe-report">
      {error && <p role="alert">{error} <button onClick={() => refresh(n => n + 1)}>Refresh</button></p>}
      {report ? <>
        <h1>{report.manifest.name}</h1>
        <p>{report.manifest.task.id} · {report.status} · {report.trials.length} planned trials · Up to {report.callCeiling} calls</p>
        {report.error && <p role="status">{report.error}</p>}
        <div className="swe-actions">
          {report.status === "paused" && <button disabled={busy} onClick={() => void act("resume")}>Resume</button>}
          {["paused", "running"].includes(report.status) && <button disabled={busy} onClick={() => void act("cancel")}>Cancel campaign</button>}
          {["finished", "cancelled"].includes(report.status) && <button disabled={busy} onClick={() => void act("repeat")}>Repeat campaign</button>}
          <button onClick={() => refresh(n => n + 1)}>Refresh results</button>
          <a href={`${harness.base}/deepswe/campaigns/${encodeURIComponent(id)}`} download="deepswe-results.json">Export JSON</a>
        </div>
        <h2>Resolution rate</h2>
        <p>Baseline: {report.manifest.conditions[0].name}. Differences use repeats graded in both conditions.</p>
        <div className="swe-scroll"><table><thead><tr><th>Condition</th><th>Passed / graded</th><th>Graded / planned</th><th>Score</th><th>Paired change</th></tr></thead>
          <tbody>{report.scores.map((s, i) => <tr key={s.condition}><th>{s.condition}</th><td>{s.passed} / {s.graded}</td><td>{s.graded} / {s.planned}</td>
            <td>{s.ratePercent === null ? "Awaiting grades" : s.ratePercent.toFixed(1) + "%"}</td>
            <td>{i === 0 ? "Baseline" : s.deltaPoints === null ? "Awaiting pairs" : `${s.deltaPoints > 0 ? "+" : ""}${s.deltaPoints.toFixed(1)} pp (${s.pairedCount} paired)`}</td></tr>)}</tbody>
        </table></div>
        <h2>Trials</h2>
        <div className="swe-scroll"><table><thead><tr><th>Condition</th><th>Repeat</th><th>Outcome</th><th>Calls</th><th>Usage</th><th>Session</th></tr></thead>
          <tbody>{report.trials.map(t => <tr key={`${t.condition}/${t.repeat}`}><th>{t.condition}</th><td>{t.repeat}</td>
            <td>{t.reward === 1 ? "Passed" : t.reward === 0 ? "Failed" : t.status === "verify_failed" ? "Ungraded" : t.status}</td><td>{t.calls}</td>
            <td>{t.usage ? <>
              {Math.round((t.wallTimeMs ?? 0) / 1000)} s · {t.usage.inputTokens + t.usage.outputTokens} known tokens
              {(t.usage.unknownInputCalls > 0 || t.usage.unknownOutputCalls > 0) && " (partial)"}
              <br/>${t.usage.reportedCostUSD.toFixed(4)} reported · ${t.usage.estimatedCostUSD.toFixed(4)} estimated
              {t.usage.unknownCostCalls > 0 && ` · ${t.usage.unknownCostCalls} calls unpriced`}
            </> : "—"}</td><td>{t.sessionId && <Link href={sessionHref(t.sessionId)}>Inspect trial</Link>}</td></tr>)}</tbody>
        </table></div>
        <HistoricalComparison current={report} />
        <details><summary>Saved run settings</summary><pre>{JSON.stringify(report.manifest, null, 2)}</pre></details>
        <Link href="/?new=1">New experiment</Link>
      </> : !error && <p role="status">Loading campaign…</p>}
    </article>
  </Shell>;
}
