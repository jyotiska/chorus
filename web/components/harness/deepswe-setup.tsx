"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CampaignManifest, DeepSWECatalog, DeepSWECondition } from "@/lib/api/chorus/harness-client";
import { harness, message } from "./shell";

type Slot = DeepSWECondition["slots"][number];
const neutral = (): Slot => ({ guidance: "neutral", profileId: null, model: null });

function ConditionEditor({ value, catalog, change }: {
  value: DeepSWECondition; catalog: DeepSWECatalog; change: (condition: DeepSWECondition) => void;
}) {
  const profiles = catalog.agents.filter(agent => agent.role);
  const models = catalog.models.map(model =>
    <option key={model.id} value={model.id} disabled={model.available === false}>{model.label}</option>);
  function editSlot(index: number, patch: Partial<Slot>) {
    change({ ...value, slots: value.slots.map((slot, i) => i === index ? { ...slot, ...patch } : slot) });
  }
  return <section className="swe-condition" aria-label={value.name || "Condition"}>
    <div className="swe-fields">
      <label>Condition name<input required maxLength={80} value={value.name} onChange={e => change({ ...value, name: e.target.value })} /></label>
      <label>Team model<select value={value.model} onChange={e => change({ ...value, model: e.target.value })}>{models}</select></label>
    </div>
    <ol className="swe-roster">
      {value.slots.map((slot, i) => <li key={i}>
        <strong>Worker {i + 1}</strong>
        <label>Guidance<select value={slot.guidance} onChange={e => {
          const guidance = e.target.value as Slot["guidance"];
          editSlot(i, { guidance, profileId: guidance === "neutral" ? null : slot.profileId ?? profiles[0].id });
        }}><option value="neutral">No personality or role</option><option value="role">Role only</option><option value="full">Full profile</option></select></label>
        {slot.guidance !== "neutral" && <label>Profile<select value={slot.profileId ?? ""} onChange={e => editSlot(i, { profileId: e.target.value })}>
          {profiles.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
        <label>Worker model<select value={slot.model ?? ""} onChange={e => editSlot(i, { model: e.target.value || null })}>
          <option value="">Use team model</option>{models}</select></label>
        <button type="button" aria-label={`Remove worker ${i + 1}`} disabled={value.slots.length === 1}
          onClick={() => change({ ...value, slots: value.slots.filter((_, j) => i !== j) })}>Remove</button>
      </li>)}
    </ol>
    <button type="button" disabled={value.slots.length >= 15} onClick={() => change({ ...value, slots: [...value.slots, neutral()] })}>Add worker</button>
    <div className="swe-fields">
      <label>Total model calls<input type="number" min={1} max={10000} required value={value.callLimit || ""} onChange={e => change({ ...value, callLimit: Number(e.target.value) })} /></label>
      <label>Solving time (seconds)<input type="number" min={1} max={86400} required value={value.solvingSeconds || ""} onChange={e => change({ ...value, solvingSeconds: Number(e.target.value) })} /></label>
    </div>
  </section>;
}

export function DeepSWESetup() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<DeepSWECatalog | null>(null);
  const [conditions, setConditions] = useState<DeepSWECondition[]>([]);
  const [repeats, setRepeats] = useState(1);
  const [name, setName] = useState("DeepSWE comparison");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof harness.campaigns>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef({ key: "", id: "" });
  useEffect(() => {
    const controller = new AbortController();
    void harness.deepsweCatalog(controller.signal).then(c => {
      if (controller.signal.aborted) return;
      setCatalog(c);
      setConditions([{ name: "Default team", model: c.model.id, callLimit: c.callLimit, solvingSeconds: c.solvingSeconds,
        slots: c.problem.participantIds.map(profileId => ({ profileId, guidance: "full", model: null })) }]);
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    void harness.campaigns().then(list => { if (!controller.signal.aborted) setHistory(list); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, []);
  if (!catalog || !conditions.length) return error ? <p role="alert">{error}</p> : <p role="status">Checking DeepSWE availability…</p>;
  const trials = conditions.length * repeats;
  const calls = repeats * conditions.reduce((sum, c) => sum + c.callLimit, 0);
  const unavailable = conditions.some(c => [c.model, ...c.slots.map(s => s.model ?? c.model)].some(id =>
    !catalog.models.some(m => m.id === id && m.available !== false)));
  const reason = catalog.unavailableReason || (unavailable ? "Choose an available model for each worker." : "");
  async function launch() {
    if (!catalog?.task || reason || busy) return;
    setBusy(true);
    setError("");
    try {
      const settings = { name: trials === 1 ? conditions[0].name : name, task: catalog.task, conditions, seed: 0, repeats };
      const key = JSON.stringify(settings);
      if (pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() };
      const manifest: CampaignManifest = { ...settings, requestId: pending.current.id };
      const report = await harness.launchCampaign(manifest);
      router.push(`/deepswe/${encodeURIComponent(report.id)}`);
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return <form className="swe-form" onSubmit={e => { e.preventDefault(); void launch(); }}>
    <section className="problem-field"><h2>{catalog.problem.title}</h2><p>{catalog.problem.id}</p>
      {catalog.problem.statement && <details><summary>Problem statement</summary><p className="saved-statement">{catalog.problem.statement}</p></details>}
    </section>
    <div className="swe-actions"><button type="button" onClick={() => {
      const base = conditions[0];
      setConditions([{ ...base, name: "Solo", slots: [neutral()] }, { ...base, name: "Team of three", slots: [neutral(), neutral(), neutral()] }]);
      setRepeats(3);
    }}>Use solo vs. team preset</button></div>
    {conditions.map((condition, index) => <div key={index}>
      <ConditionEditor value={condition} catalog={catalog} change={next => setConditions(conditions.map((old, i) => i === index ? next : old))} />
      <div className="swe-actions">
        <button type="button" disabled={conditions.length >= 8} onClick={() => {
          let n = conditions.length + 1;
          while (conditions.some(c => c.name === `Condition ${n}`)) n++;
          setConditions([...conditions, { ...condition, name: `Condition ${n}` }]);
        }}>Duplicate condition</button>
        {conditions.length > 1 && <button type="button" onClick={() => setConditions(conditions.filter((_, i) => i !== index))}>Remove condition</button>}
      </div>
    </div>)}
    <div className="swe-fields"><label>Repeats per condition<input type="number" required min={1} max={30} value={repeats || ""} onChange={e => setRepeats(Number(e.target.value))} /></label>
      {trials > 1 && <label>Campaign name<input value={name} maxLength={100} required onChange={e => setName(e.target.value)} /></label>}
    </div>
    <p>{trials} {trials === 1 ? "trial" : "trials"} · Up to {calls} model calls</p>
    {reason && <p role="status" className="notice">{reason}</p>}
    {error && <p role="alert">{error}</p>}
    <button type="submit" className="primary-btn" disabled={!catalog.task || !!reason || busy}>{busy ? "Starting…" : trials === 1 ? "Start DeepSWE run" : "Start campaign"}</button>
    {history.length > 0 && <section><h2>Saved campaigns</h2><ul>{history.map(item => <li key={item.id}>
      <Link href={`/deepswe/${encodeURIComponent(item.id)}`}>{item.name}</Link> · {item.status} · {new Date(item.createdAt).toLocaleString()}
    </li>)}</ul></section>}
  </form>;
}
