import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { Snapshot } from "../../lib/api/chorus/client";

const fakeModel = "http://127.0.0.1:11436";
const displayName = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2");

async function createSession(request: APIRequestContext, config: object = {}): Promise<Snapshot> {
  const scenarios = await (await request.get("/api/chorus/scenarios?collection=chorus-web")).json();
  const scenario = scenarios.find((item: { id: string }) => item.id === "chorus-web:debate");
  const response = await request.post("/api/chorus/sessions", { data: {
    scenarioId: scenario.id, participantIds: scenario.suggestedAgents, model: "qwen3.5:4b-mlx", maxTurns: 5, judgeEnabled: false, ...config,
  } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openSnapshot(page: Page, snapshot: Snapshot) {
  await page.route(`**/api/chorus/sessions/${snapshot.id}`, (route) => route.fulfill({ json: { ...snapshot, revision: 1000 } }));
  // The real stream stays open after this fixture revision without overwriting it.
  await page.goto(`/archive?session=${snapshot.id}`);
  await expect(page.getByText(`Session ${snapshot.id.slice(0, 8)}`)).toBeVisible();
}

test.beforeEach(async ({ request }) => { await request.post(`${fakeModel}/reset`, { data: {} }); });

test("live stats and profiles update, journals stay separate, and reload does not replay changes", async ({ page, request }) => {
  const initial = await createSession(request, { judgeEnabled: true });
  await page.goto(`/archive?session=${initial.id}`);
  const firstAgent = initial.agents[0];
  const name = displayName(firstAgent.name);
  await page.getByRole("button", { name: `Inspect ${name}`, exact: true }).click();
  const profile = page.getByRole("region", { name: `${name} profile`, exact: true });
  await expect(profile.getByRole("meter", { name: `${name} energy`, exact: true })).toHaveAttribute("value", String(firstAgent.energy));
  await profile.getByRole("button", { name: "View observer journal" }).click();
  await expect(profile.getByText(/No journal entries yet/)).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(/^[+-]\d+ energy$/).first()).toBeVisible();
  await expect(page.getByText("Discussion complete · 5 turns", { exact: true })).toBeVisible();
  const saved: Snapshot = await (await request.get(`/api/chorus/sessions/${initial.id}`)).json();
  const currentAgent = saved.agents.find((agent) => agent.id === firstAgent.id)!;
  expect(currentAgent.energy).not.toBe(firstAgent.energy);
  await expect(profile.getByRole("meter", { name: `${name} energy`, exact: true })).toHaveAttribute("value", String(currentAgent.energy));
  await expect(profile.getByRole("meter", { name: `${name} confidence`, exact: true })).toHaveAttribute("value", String(currentAgent.confidence));
  await expect(profile.getByText(/Speaking \(/).first()).toBeVisible();
  await expect(profile.getByText(/PRIVATE-E2E/).first()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/parity-live-profile.png", fullPage: true });
  await expect(page.getByRole("log")).not.toContainText("PRIVATE-E2E");
  await expect(page.getByRole("region", { name: "Final judge judgement" })).toContainText("Response to feedback");
  expect(await (await request.get(`/api/chorus/sessions/${initial.id}/export`)).text()).not.toContain("PRIVATE-E2E");
  expect(await (await request.get(`${fakeModel}/state`)).json()).toMatchObject({ privateLeak: false });
  await page.reload();
  await page.getByRole("button", { name: `Inspect ${name}`, exact: true }).click();
  await expect(profile.getByRole("meter", { name: `${name} energy`, exact: true })).toHaveAttribute("value", String(currentAgent.energy));
  await expect(page.getByText(/^[+-]\d+ energy$/)).toHaveCount(0);
});

test("Pause cancels pending work, Resume preserves history, and Stop produces an early review", async ({ page, request }) => {
  await request.post(`${fakeModel}/reset`, { data: { canvasDelayMs: 500 } });
  const initial = await createSession(request, { maxTurns: 20, judgeEnabled: true });
  await page.goto(`/archive?session=${initial.id}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Running" })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  const paused: Snapshot = await (await request.get(`/api/chorus/sessions/${initial.id}`)).json();
  expect(paused.status).toBe("paused");
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  const restored: Snapshot = await (await request.get(`/api/chorus/sessions/${initial.id}`)).json();
  expect(restored.turns).toEqual(paused.turns);
  expect(restored.agents).toEqual(paused.agents);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("I added proposed safeguard");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const judgement = page.getByRole("region", { name: "Final judge judgement" });
  await expect(judgement).toContainText("Early-stop review");
  await expect(judgement).toContainText("Requirements assessment");
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeDisabled();
});

test("skipped slots are system notices, count toward the limit, and leave journals absent", async ({ page, request }) => {
  await request.post(`${fakeModel}/reset`, { data: { invalidSpeechTurn: 2 } });
  const initial = await createSession(request, { judgeEnabled: true });
  await page.goto(`/archive?session=${initial.id}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Discussion complete · 5 turns", { exact: true })).toBeVisible();
  await expect(page.getByRole("log").getByText("System notice", { exact: true })).toBeVisible();
  await expect(page.getByText("Turn 02 · Skipped", { exact: true })).toBeVisible();
  await expect(page.getByRole("log").getByLabel("Turn token usage")).toHaveCount(1);
  const skippedNotice = page.getByRole("log").locator("article").filter({ hasText: "Turn 02 · Skipped" });
  await skippedNotice.getByText("Usage details · 4 calls", { exact: true }).click();
  await expect(skippedNotice).toContainText("Rejected:");
  await expect(skippedNotice).toContainText("Previous attempt:");
  await expect(skippedNotice).toContainText("Validated · not published");
  await expect(skippedNotice).toContainText("Last attempted response context input");
  await expect(page.getByText(/5 slots used · 1 skipped/)).toBeVisible();
  const journals = await (await request.get(`/api/chorus/sessions/${initial.id}/journals`)).json();
  expect(journals.some((entry: { turnNumber: number }) => entry.turnNumber === 2)).toBe(false);
  const saved: Snapshot = await (await request.get(`/api/chorus/sessions/${initial.id}`)).json();
  expect(saved.turns.find((turn) => turn.kind === "skipped")?.statChanges).toEqual([]);
  await expect(page.getByRole("region", { name: "Final judge judgement" })).toContainText("Requirements assessment");
});

test("Markdown and structured judgement are readable on desktop and mobile", async ({ page, request }) => {
  const initial = await createSession(request);
  const snapshot: Snapshot = { ...initial, status: "completed", canvas: "# Launch brief\n\n## Proposal\n\n- Human review\n- Retention limits\n\n| Owner | Task |\n| --- | --- |\n| Team | Validate |\n\n<script>window.injected = true</script>\n\n[Unsafe](javascript:alert(1))\n\n![Model image](https://example.com/tracker.png)", config: { ...initial.config, judgeEnabled: true },
    finalJudgement: { verdict: "Partially meets requirements", summary: "The team proposed a narrow trial.", requirements: [{ criterion: "Expected deliverable", status: "Partially met", evidence: "The plan includes [Human review]." }, { criterion: "Unfamiliar criterion", status: "Missing", evidence: "This criterion remains unaddressed." }], strengths: ["The plan includes [Human review]."], improvements: ["Validate the proposed measures."], nextPriorities: ["Test the proposed safeguards."], feedbackResponse: "The team considered available feedback." },
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSnapshot(page, snapshot);
  await expect(page.getByRole("heading", { name: "Launch brief", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Validate");
  const judgement = page.getByRole("region", { name: "Final judge judgement" });
  await expect(judgement).toContainText(initial.scenario.deliverable);
  await expect(judgement).toContainText("Unfamiliar criterion");
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.getByText("Unsafe", { exact: true })).toBeVisible();
  await expect(page.locator('img[src="https://example.com/tracker.png"]')).toHaveCount(0);
  expect(await page.evaluate(() => "injected" in window)).toBe(false);
  await page.screenshot({ path: "test-results/parity-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("heading", { name: "Final document", exact: true })).toBeAttached();
  await page.screenshot({ path: "test-results/parity-mobile.png", fullPage: true });
});

for (const errorCode of ["CONTEXT_LIMIT", "VERSION_MISMATCH", "MODEL_NOT_FOUND"] as const) {
  test(`${errorCode} preserves work and blocks unsupported Resume`, async ({ page, request }) => {
    const initial = await createSession(request);
    await openSnapshot(page, { ...initial, status: "paused", canvas: "# Preserved document", errorCode, error: "Cannot continue this saved session.", config: { ...initial.config, model: errorCode === "MODEL_NOT_FOUND" ? "retired-model" : initial.config.model } });
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Preserved document", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export canvas", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New simulation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Run Simulation", exact: true })).toBeEnabled();
    expect(new URL(page.url()).searchParams.has("session")).toBe(false);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Choose a scenario" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
  });
}

test("journal failure can retry, and unavailable entries preserve public output", async ({ page, request }) => {
  const initial = await createSession(request);
  await page.route(`**/api/chorus/sessions/${initial.id}/journals`, (route) => route.fulfill({ status: 502, json: { code: "BACKEND_UNAVAILABLE", error: "Offline", requestId: "test" } }));
  await openSnapshot(page, { ...initial, status: "paused", canvas: "# Preserved document" });
  const name = displayName(initial.agents[0].name);
  await page.getByRole("button", { name: `Inspect ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "View observer journal", exact: true }).click();
  await expect(page.getByRole("region", { name: `${name} observer journal`, exact: true }).getByRole("alert")).toContainText("Cannot load observer journals");
  await page.route(`**/api/chorus/sessions/${initial.id}/journals`, (route) => route.fulfill({ json: [{ agentId: initial.agents[0].id, turnNumber: 1, createdAt: initial.createdAt, text: null }] }));
  await page.getByRole("button", { name: "Retry journal", exact: true }).click();
  await expect(page.getByText("Journal unavailable for this turn. The public contribution was preserved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preserved document", exact: true })).toBeVisible();
});

test("a delayed journal cannot reappear after returning to setup and opening another session", async ({ page, request }) => {
  const first = await createSession(request);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/chorus/sessions/${first.id}/journals`, async (route) => {
    await delayed;
    await route.fulfill({ json: [{ agentId: first.agents[0].id, turnNumber: 1, createdAt: first.createdAt, text: "PRIVATE-OLD-SESSION" }] }).catch(() => {});
  });
  await openSnapshot(page, first);
  await page.getByRole("button", { name: `Inspect ${displayName(first.agents[0].name)}`, exact: true }).click();
  await page.getByRole("button", { name: "View observer journal", exact: true }).click();
  await expect(page.getByText("Loading journal…")).toBeVisible();
  await page.getByRole("button", { name: "New simulation", exact: true }).click();
  await page.getByRole("button", { name: "Run Simulation", exact: true }).click();
  await expect.poll(() => page.evaluate((id) => { const selected = localStorage.getItem("chorus-web.session"); return Boolean(selected && selected !== id); }, first.id)).toBe(true);
  const nextId = await page.evaluate(() => localStorage.getItem("chorus-web.session"));
  release();
  await expect(page.getByText(`Session ${nextId!.slice(0, 8)}`)).toBeVisible();
  await expect(page.getByText("PRIVATE-OLD-SESSION")).toHaveCount(0);
});

test("repeated clicks submit one command while a request is pending", async ({ page, request }) => {
  const initial = await createSession(request);
  await openSnapshot(page, initial);
  let commands = 0;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/chorus/sessions/${initial.id}/commands`, async (route) => {
    commands++;
    await delayed;
    await route.fulfill({ json: { ...initial, revision: 1001, status: "running" } });
  });
  const start = page.getByRole("button", { name: "Start", exact: true });
  await start.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); button.click(); });
  await expect.poll(() => commands).toBe(1);
  await expect(start).toBeDisabled();
  release();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  expect(commands).toBe(1);
});

test("a Nanoville-created session uses its saved participants and can be controlled here", async ({ page, request }) => {
  const scenarios = await (await request.get("/api/chorus/scenarios?collection=nanoville")).json();
  const scenario = scenarios[0];
  const initial: Snapshot = await (await request.post("/api/chorus/sessions", { data: {
    scenarioId: scenario.id, participantIds: scenario.suggestedAgents.slice(0, 3), model: "qwen3.5:4b-mlx", maxTurns: 5, judgeEnabled: false,
  } })).json();
  await page.goto(`/archive?session=${initial.id}`);
  await expect(page.getByRole("button", { name: `Inspect ${displayName(initial.agents[0].name)}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Discussion complete · 5 turns", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(`Session ${initial.id.slice(0, 8)}`)).toBeVisible();
});

test("invalid external snapshots cannot replace the current session", async ({ page, request }) => {
  const initial = await createSession(request);
  await openSnapshot(page, { ...initial, canvas: "# Valid saved document" });
  await page.route(`**/api/chorus/sessions/${initial.id}/commands`, (route) => route.fulfill({ json: {
    ...initial, revision: 1001, canvas: "# Invalid replacement", agents: initial.agents.map((agent) => ({ ...agent, energy: 101 })),
  } }));
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "invalid Snapshot" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Valid saved document", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invalid replacement", exact: true })).toHaveCount(0);
});

test("duplicate, stale, and invalid event snapshots preserve the latest committed state", async ({ page, request }) => {
  const initial = await createSession(request);
  const agent = initial.agents[0];
  const turn: Snapshot["turns"][number] = { kind: "agent", turnNumber: 1, speakerId: agent.id, speakerName: agent.name, text: "I propose human review.", actions: [], tokenUsage: { input: null, output: null }, latencySeconds: 0.5, statChanges: [{ agentId: agent.id, energy: -4, confidence: 1, reasons: ["Speaking recovery rules."] }] };
  const latest: Snapshot = { ...initial, revision: 2, status: "paused", canvas: "# Latest document", turns: [turn], agents: initial.agents.map((item) => item.id === agent.id ? { ...item, energy: 76, confidence: 81 } : item) };
  let reads = 0;
  await page.route(`**/api/chorus/sessions/${initial.id}`, (route) => route.fulfill({ json: ++reads === 1 ? initial : latest }));
  const events = [latest, latest, { ...initial, revision: 1, canvas: "# Stale document" }, { ...latest, revision: 3, canvas: "# Invalid event", agents: [{ ...agent, energy: 101 }] }];
  await page.route(`**/api/chorus/sessions/${initial.id}/events?*`, (route) => route.fulfill({ contentType: "text/event-stream", body: events.map((snapshot) => `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`).join("") }));
  await page.goto(`/archive?session=${initial.id}`);
  await expect(page.getByRole("heading", { name: "Latest document", exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Inspect ${displayName(agent.name)}`, exact: true }).click();
  await expect(page.getByRole("meter", { name: `${displayName(agent.name)} energy`, exact: true })).toHaveAttribute("value", "76");
  await expect(page.getByRole("heading", { name: "Stale document", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Invalid event", exact: true })).toHaveCount(0);
  await expect(page.getByRole("log").getByText("I propose human review.", { exact: true })).toHaveCount(1);
});

test("discussion lists the newest contributions and checkpoint reviews first", async ({ page, request }) => {
  const initial = await createSession(request, { maxTurns: 20, judgeEnabled: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/archive?session=${initial.id}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Discussion complete · 20 turns", { exact: true })).toBeVisible();
  const feed = page.getByRole("log", { name: "Agent discussion" });
  await expect(feed.locator("article").first()).toContainText("Turn 20");
  await expect(feed.locator("article").last()).toContainText("Turn 01");
  const labels = await feed.locator("article > div:first-child > span").allTextContents();
  expect(labels.indexOf("Review after turn 15")).toBeLessThan(labels.indexOf("Turn 15"));
  expect(labels.indexOf("Turn 16")).toBeLessThan(labels.indexOf("Review after turn 15"));
  expect(await feed.evaluate((element) => element.scrollTop)).toBe(0);
  const saved: Snapshot = await (await request.get(`/api/chorus/sessions/${initial.id}`)).json();
  expect(saved.turns[0].turnNumber).toBe(1);
  expect(saved.turns.at(-1)?.turnNumber).toBe(20);
  const usage = feed.getByLabel("Response token usage").first();
  await expect(usage).toContainText("Input");
  await expect(usage).toContainText("Cache usage unavailable");
  await expect(feed.getByText(/Context input .*32,768/).first()).toBeVisible();
  for (const turn of saved.turns.filter((turn) => turn.kind === "agent")) {
    expect(turn.text.length).toBeLessThanOrEqual(180);
    expect(turn.text.split(/\s+/).length).toBeLessThanOrEqual(30);
  }
  await page.reload();
  await expect(feed.locator("article").first()).toContainText("Turn 20");
  expect(await feed.evaluate((element) => element.scrollTop)).toBe(0);
});

test("agent replies stay within two display lines and older full text remains expandable", async ({ page, request }) => {
  const initial = await createSession(request);
  const text = "A preserved older reply explains the proposed human-review safeguard, its owner, and the evidence still needed before the team can proceed. ".repeat(5);
  const turn: Snapshot["turns"][number] = { kind: "agent", turnNumber: 1, speakerId: initial.agents[0].id, speakerName: initial.agents[0].name, text, actions: [], tokenUsage: { input: 20, output: 10 }, latencySeconds: 0.1, statChanges: [] };
  await openSnapshot(page, { ...initial, status: "paused", turns: [turn] });
  const entry = page.getByRole("log").locator("article").first();
  const reply = entry.getByText(text, { exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(entry.getByRole("button", { name: "Read full reply", exact: true })).toBeVisible();
    expect(await reply.evaluate((element) => element.clientHeight <= Number.parseFloat(getComputedStyle(element).lineHeight) * 2 + 1)).toBe(true);
  }
  await entry.getByRole("button", { name: "Read full reply", exact: true }).click();
  await expect(entry.getByRole("button", { name: "Show less", exact: true })).toHaveAttribute("aria-expanded", "true");
  expect(await reply.evaluate((element) => element.clientHeight > Number.parseFloat(getComputedStyle(element).lineHeight) * 2)).toBe(true);
  await expect(reply).toHaveText(text);
  await entry.getByRole("button", { name: "Show less", exact: true }).click();
  expect(await reply.evaluate((element) => element.clientHeight <= Number.parseFloat(getComputedStyle(element).lineHeight) * 2 + 1)).toBe(true);
});

test("reply cache metrics and context caps remain readable on mobile and after reload", async ({ page, request }) => {
  const initial = await createSession(request);
  type Metrics = NonNullable<Snapshot["turns"][number]["usageDetails"]>["calls"][number];
  const response: Metrics = {
    id: "call-usage", agentId: initial.agents[0].id, promptVersion: "test", phase: "spoken", attempt: 1, model: "gpt-6-luna", route: "openai",
    provider: null, requestId: "resp-example", input: 12000, output: 420, cachedInput: 10000, cacheWriteInput: 0,
    reasoningOutput: 0, costUSD: null, cacheStatus: "hit", outcome: "success", accepted: true, durationMs: 300,
    context: { modelWindowTokens: 1050000, configuredWindowTokens: 32768, effectiveWindowTokens: 32768,
      inputTokens: 12000, inputSource: "provider", completionReserveTokens: 300, usableInputTokens: 32468, capabilityVersion: "2026-11-01" },
  };
  const turn: Snapshot["turns"][number] = {
    kind: "agent", turnNumber: 1, speakerId: initial.agents[0].id, speakerName: initial.agents[0].name,
    text: "I propose human review.", actions: [], tokenUsage: { input: 14000, output: 720 }, latencySeconds: 0.3,
    statChanges: [], usageDetails: { response, calls: [{ ...response, id: "call-draft", phase: "canvas", input: 2000, output: 300, cachedInput: 0 }, response] },
  };
  await openSnapshot(page, { ...initial, status: "paused", turns: [turn] });
  const entry = page.getByRole("log").locator("article").first();
  await expect(entry.getByLabel("Response token usage")).toContainText("Input 12,000");
  await expect(entry.getByText("Cached 10,000 (83.3%)", { exact: true })).toBeVisible();
  await expect(entry.getByText("Cache hit", { exact: true })).toBeVisible();
  await entry.getByText("Usage details · 2 calls", { exact: true }).click();
  await expect(entry.getByText(/Turn totals · Input 14,000 · Output 720/)).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(entry.getByText(/Context input 12,000 \/ 32,768/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: "test-results/usage-mobile.png", fullPage: true });
  await page.reload();
  await expect(entry.getByText("Cache hit", { exact: true })).toBeVisible();
});
