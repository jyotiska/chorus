import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const sessions = await (await request.get("/api/chorus/v2/sessions")).json();
  for (const state of sessions) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await (
        await request.get(`/api/chorus/v2/sessions/${state.id}`)
      ).json();
      if (!["running", "reviewing"].includes(current.status)) break;
      const result = await request.post(
        `/api/chorus/v2/sessions/${state.id}/commands`,
        {
          data: {
            commandId: crypto.randomUUID(),
            expectedRevision: current.revision,
            action: "pause",
          },
        },
      );
      if (result.ok()) break;
    }
  }
});

test("Luna defaults, relevant agents auto-select, and user edits survive renders", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "Model", exact: true }),
  ).toContainText("GPT-6-Luna");
  await page.getByRole("button", { name: "Edit team", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(
    50,
  );
  const domain = page.getByRole("combobox", { name: "Domain", exact: true });
  await domain.click();
  await page.getByRole("option", { name: "Technology", exact: true }).click();
  await expect(domain).toHaveText("Technology");
  await expect(page.getByRole("checkbox", { name: /^Select / })).not.toHaveCount(50);
  await domain.click();
  await page.getByRole("option", { name: "All domains", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(50);
  await expect(
    page.getByRole("checkbox", { name: "Select Alex", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Select Alex", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Select Avery", exact: true })
    .check();
  await page.getByRole("checkbox", { name: "Avery private adversary" }).check();
  await page.getByRole("textbox", { name: "Search agents" }).fill("Avery");
  await page.getByRole("button", { name: "View Avery profile" }).click();
  await page.getByRole("button", { name: "Close profile" }).click();
  await page.getByRole("button", { name: "Close Edit team" }).click();
  await page.getByRole("spinbutton", { name: "Turns per agent" }).fill("3");
  await page.getByRole("button", { name: "Edit team", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Avery private adversary" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Select Alex", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Select Avery", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Close Edit team" }).click();
  await page.getByRole("button", { name: /Choose problem:/ }).click();
  await page.getByRole("textbox", { name: "Search problems" }).fill("ledger");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /ledger/i })
    .click();
  await expect(
    page.getByRole("button", { name: /Choose problem:/ }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Edit team", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Select Quinn", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Select Avery", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Close Edit team" }).click();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .click();
  await page.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeEnabled();
});

test("actual tool loop completes with concise mentions, summaries, usage, and final report", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:11436/reset", {
    data: { harnessDelayMs: 250 },
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Choose problem:/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Optimize a production mix/ })
    .click();
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .click();
  await page.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Turns per agent" }).fill("1");
  await page.getByRole("checkbox", { name: "Final judge" }).check();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: "test-results/redesign-setup.png" });
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Message board" })
      .getByRole("article")
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/live-session-monitor.png" });
  await expect(
    page
      .getByRole("button", { name: "Results", exact: true })
      .filter({ has: page.getByRole("status") }),
  ).toBeVisible({ timeout: 35000 });
  await expect(
    page.getByRole("heading", { name: "Message board" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "Shared canvas" }),
  ).toBeInViewport();
  await page.screenshot({ path: "test-results/redesign-board.png" });
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Shared canvas" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Open beside board" }).click();
  await page
    .getByRole("button", { name: "Results", exact: true })
    .filter({ has: page.getByRole("status") })
    .click();
  await expect(
    page.getByText("Solution correct", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The team produced a checked shared solution.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/redesign-results.png" });
  await page
    .getByRole("button", { name: "Open supporting record 1", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Source evidence" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close evidence", exact: true })
    .click();
  const id = await page.evaluate(() =>
    localStorage.getItem("chorus.harness.session"),
  );
  const state = await (
    await request.get(`/api/chorus/v2/sessions/${id}`)
  ).json();
  expect(state.status).toBe("completed");
  expect(state.config.maxTurnsPerAgent).toBe(1);
  expect(
    state.workers.every((w: { turnsStarted: number }) => w.turnsStarted === 1),
  ).toBe(true);
  const board = await (
    await request.get(`/api/chorus/v2/sessions/${id}/records?kind=board`)
  ).json();
  expect(board.records).toHaveLength(5);
  for (const row of board.records) {
    expect(row.data.text.length).toBeLessThanOrEqual(400);
    expect(row.data.text).toContain("@");
    expect(row.data).not.toHaveProperty("parentId");
  }
  await page.getByRole("button", { name: /^Participants/ }).click();
  await page
    .getByRole("button", { name: /Drew/ })
    .filter({ has: page.locator("progress") })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Drew details" }),
  ).toBeVisible();
  const inspector = page.getByRole("dialog", { name: "Drew details" });
  await page.getByRole("tab", { name: "Reasoning summaries" }).click();
  await expect(
    page.getByText("Published validated work only.", { exact: true }),
  ).toBeVisible();
  await expect(inspector.getByRole("tab")).toHaveText(["Profile", "Reasoning summaries"]);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Close Participants" }).click();
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Whole session" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Usage", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await page.getByText("Canvas changelog", { exact: true }).waitFor();
  await page.locator(".canvas-pane details").first().locator("summary").click();
  await expect(
    page.locator(".canvas-pane details[open] pre").first(),
  ).toBeVisible();
  for (const [label, format] of [
    ["Export canvas", "markdown"],
    ["Export complete session", "json"],
  ]) {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: label, exact: true }).click();
    const path = await (await download).path();
    const contents = await readFile(path!, "utf8");
    if (format === "json") expect(JSON.parse(contents).session.id).toBe(id);
    else expect(contents).toBe(state.canvas);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/redesign-phone-canvas.png" });
  await page.getByRole("button", { name: "Back to board" }).click();
  await expect(
    page.getByRole("button", { name: "Board", exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(
    page.getByText("Solution correct", { exact: true }),
  ).toBeVisible();
  const usage = await (
    await request.get(`/api/chorus/v2/sessions/${id}/usage`)
  ).json();
  expect(usage.total.callCount).toBeGreaterThan(usage.participants.callCount);
  expect(usage.total.unknownInputCalls).toBe(0);
  const summary = page.getByLabel("Session totals", { exact: true });
  await expect(summary.locator(".token-counts > span").first()).toHaveText(
    `${usage.total.inputTokens.toLocaleString()} in`,
  );
  await expect(
    summary
      .locator("div")
      .filter({ has: page.locator("dt", { hasText: "Turns completed" }) })
      .locator("dd"),
  ).toHaveText("5 / 5");
  const exported = await (
    await request.get(`/api/chorus/v2/sessions/${id}/export`)
  ).json();
  expect(exported.records.summary).toHaveLength(5);
  expect(exported.records.change).toHaveLength(1);
  expect(exported.session.report.agents).toHaveLength(5);
});

test("fifty-agent roster is complete, artwork loads, and narrow screens contain overflow", async ({
  page,
  request,
  baseURL,
}) => {
  const catalog = await (await request.get("/api/chorus/v2/catalog")).json();
  const response = await request.post("/api/chorus/v2/sessions", {
    data: {
      problemId: "production-mix",
      participantIds: catalog.agents.map((a: { id: string }) => a.id),
      model: "qwen3.5:4b-mlx",
      maxTurnsPerAgent: 1,
      judgeEnabled: false,
    },
  });
  expect(response.ok()).toBe(true);
  const state = await response.json();
  await page.goto(`/?session=${state.id}`);
  await expect(
    page.getByRole("heading", { name: "Message board" }),
  ).toBeInViewport();
  const strip = page.getByRole("region", { name: "Live agents" });
  const agents = strip.getByRole("button");
  await expect(agents).toHaveCount(50);
  expect(
    await agents.evaluateAll(
      (buttons) =>
        new Set(buttons.map((b) => b.getBoundingClientRect().top)).size,
    ),
  ).toBe(1);
  await agents.last().click();
  await expect(page.getByRole("dialog", { name: /details$/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 768, height: 900 });
  const board = await page
    .getByRole("heading", { name: "Message board" })
    .boundingBox();
  const canvas = await page
    .getByRole("heading", { name: "Shared canvas" })
    .boundingBox();
  expect(canvas!.x).toBeGreaterThan(board!.x + board!.width);
  expect(Math.abs(board!.y - canvas!.y)).toBeLessThan(12);
  await page.getByRole("button", { name: /^Participants/ }).click();
  await expect(page.getByRole("progressbar")).toHaveCount(50);
  await expect(
    page.getByRole("img", { name: "Alex portrait", exact: true }),
  ).toHaveAttribute("src", /\/api\/chorus\/v2\/assets\/alex\/portrait\.svg/);
  if (baseURL?.includes(":3100")) {
    await expect(
      page.getByRole("img", { name: /animated sprite/ }),
    ).toHaveCount(50);
    await page.getByRole("slider", { name: "Scene zoom" }).fill("1.25");
  }
  expect(
    (await request.get("/api/chorus/v2/assets/oakley/sprite.svg")).status(),
  ).toBe(200);
  expect(
    (await request.get("/api/chorus/v2/assets/alex/portrait.svg")).status(),
  ).toBe(200);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Participants", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/harness-${baseURL?.includes(":3100") ? "nanoville" : "chorus"}-50-mobile.png`,
    fullPage: true,
  });
});

test("each session opens beside the board, with phone navigation and stop controls", async ({
  page,
  request,
  context,
}) => {
  const config = {
    problemId: "production-mix",
    participantIds: ["drew", "mika"],
    model: "qwen3.5:4b-mlx",
    maxTurnsPerAgent: 10,
    judgeEnabled: false,
  };
  const create = async () => {
    const response = await request.post("/api/chorus/v2/sessions", {
      data: config,
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).id as string;
  };
  await request.post("http://127.0.0.1:11436/reset", {
    data: { harnessDelayMs: 600 },
  });
  const first = await create(),
    second = await create();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?session=${first}`);
  await page.getByRole("button", { name: "Close canvas" }).click();
  await page.locator(`.run-list a[href="/?session=${second}"]`).click();
  await expect(page).toHaveURL(new RegExp(second));
  await expect(
    page.getByRole("button", { name: "Close canvas" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Close canvas" }),
  ).toBeVisible();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Run actions" }).click();
  await page.getByRole("button", { name: "Copy session link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    page.url(),
  );
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Pause and return to setup" }).click();
  await expect(
    page.getByRole("heading", { name: "Set up a session" }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/chorus/v2/sessions/${second}`)).json())
      .status,
  ).toBe("paused");
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Open sessions" }).click();
    const drawer = page.getByRole("dialog", { name: "Sessions" });
    await expect(drawer.locator(`a[href="/?session=${second}"]`)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
  }
  await page.goto(`/?session=${second}`);
  await page.getByRole("button", { name: "Run actions" }).click();
  await page.getByRole("button", { name: "Stop and evaluate" }).click();
  await page
    .getByRole("button", { name: "Results", exact: true })
    .filter({ has: page.getByRole("status") })
    .click();
  await expect(page.getByText("Stopped early", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Narrative judge disabled for this run."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page
    .getByRole("button", { name: "Open beside board", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Message board" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "Shared canvas" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("a long board holds the reading position through incoming posts and a phone canvas visit", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/chorus/v2/sessions", {
    data: {
      problemId: "production-mix",
      participantIds: ["drew", "mika"],
      model: "qwen3.5:4b-mlx",
    },
  });
  const source = await response.json();
  let count = 45;
  const fixture = () => ({
    ...source,
    revision: 500 + count,
    boardCount: count,
    status: count === 45 ? "ready" : "running",
  });
  const endpoint = `**/api/chorus/v2/sessions/${source.id}`;
  await page.route(endpoint + "/usage", async (route) => {
    const usage = await (await route.fetch()).json();
    Object.assign(usage.total, {
      callCount: 3,
      inputTokens: 40,
      unknownInputCalls: 1,
      outputTokens: 0,
      unknownOutputCalls: 3,
      cachedTokens: 0,
      unknownCacheCalls: 0,
      reportedCostUSD: 0.01,
      estimatedCostUSD: 0.002,
      unknownCostCalls: 1,
    });
    await route.fulfill({ json: usage });
  });
  await page.route(endpoint, (route) => route.fulfill({ json: fixture() }));
  await page.route(endpoint + "/commands", (route) => {
    count++;
    return route.fulfill({ json: fixture() });
  });
  await page.route(endpoint + "/records?**", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get("kind") !== "board") return route.continue();
    const after = Number(query.get("after"));
    const records = Array.from({ length: count - after }, (_, index) => {
      const sequence = after + index + 1;
      return {
        id: `board:fixture-${sequence}`,
        sequence,
        agentId: "drew",
        kind: "board",
        turn: sequence,
        createdAt: source.createdAt,
        data: { text: `Contribution ${sequence} is ready for review.` },
      };
    });
    return route.fulfill({
      json: { records, cursor: count, highWater: count, hasMore: false },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${source.id}`);
  const totals = page.getByLabel("Session totals", { exact: true });
  await expect(totals).toContainText("40 (partial)");
  await expect(totals).toContainText("Unknown");
  await expect(totals).toContainText("$0.01 + $0.002 est. (partial)");
  const row = page
    .getByRole("article")
    .filter({ hasText: "Contribution 25 is ready" });
  const opener = row.getByRole("button", { name: /Open canvas/ });
  await opener.scrollIntoViewIfNeeded();
  const before = (await row.boundingBox())!.y;
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New posts · 1" }),
  ).toBeVisible();
  await expect
    .poll(async () => Math.round((await row.boundingBox())!.y))
    .toBe(Math.round(before));
  await opener.click();
  await expect(
    page.getByRole("heading", { name: "Shared canvas" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to board" }).click();
  await expect(opener).toBeFocused();
  expect(Math.round((await row.boundingBox())!.y)).toBe(Math.round(before));
  await page.getByRole("button", { name: "New posts · 1" }).click();
  await expect(page.getByRole("article").first()).toContainText(
    "Contribution 46",
  );
});

test("a failed Start can retry the created run without duplicating it", async ({
  page,
}) => {
  let creations = 0,
    commands = 0;
  await page.route("**/api/chorus/v2/sessions", (route) => {
    if (route.request().method() === "POST") creations++;
    return route.continue();
  });
  await page.route("**/api/chorus/v2/sessions/*/commands", (route) => {
    if (++commands === 1)
      return route.fulfill({
        status: 502,
        json: {
          error: "Start interrupted",
          code: "MODEL_REQUEST_FAILED",
          requestId: "start-test",
        },
      });
    return route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .click();
  await page.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Start interrupted" }),
  ).toBeVisible();
  const saved = page.url();
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Start interrupted")).toBeHidden();
  expect(page.url()).toBe(saved);
  expect(creations).toBe(1);
});
