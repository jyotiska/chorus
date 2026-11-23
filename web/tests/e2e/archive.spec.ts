import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Snapshot } from "../../lib/api/chorus/client";
import type { HarnessSnapshot } from "../../lib/api/chorus/harness-client";

test.use({ locale: "en-US", timezoneId: "UTC" });

test("Archive sorts, filters, and reopens current and historical runs", async ({ page, request }) => {
  const experimentResponse = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ["general-agent"], model: "qwen3.5:4b-mlx" },
  });
  const benchmarkResponse = await request.post("/api/chorus/v2/sessions", {
    data: { problemId: "production-mix", participantIds: ["drew", "mika"], model: "qwen3.5:4b-mlx" },
  });
  const scenarios = await (await request.get("/api/chorus/scenarios?collection=chorus-web")).json();
  const debate = scenarios.find((scenario: { id: string }) => scenario.id === "chorus-web:debate");
  const historicalResponse = await request.post("/api/chorus/sessions", {
    data: {
      scenarioId: debate.id, participantIds: debate.suggestedAgents, model: "qwen3.5:4b-mlx", maxTurns: 5, judgeEnabled: false,
    },
  });
  expect(experimentResponse.status()).toBe(201);
  expect(benchmarkResponse.status()).toBe(201);
  expect(historicalResponse.ok()).toBe(true);
  const experiment: HarnessSnapshot = await experimentResponse.json();
  const benchmark: HarnessSnapshot = await benchmarkResponse.json();
  const historical: Snapshot = await historicalResponse.json();
  const startHistory = await request.post(`/api/chorus/sessions/${historical.id}/commands`, {
    data: { commandId: "archive-test-start", action: "start", expectedRevision: historical.revision },
  });
  expect(startHistory.ok()).toBe(true);
  await expect.poll(async () => (await (await request.get(`/api/chorus/sessions/${historical.id}`)).json()).status).toBe("completed");
  const savedHistory: Snapshot = await (await request.get(`/api/chorus/sessions/${historical.id}`)).json();

  let currentRequests = 0;
  await page.route("**/api/chorus/v2/sessions", (route) => {
    currentRequests++;
    return route.fulfill({ json: [
      { ...benchmark, status: "stopped", createdAt: "2026-11-20T10:00:00Z" },
      { ...experiment, status: "completed", createdAt: "2026-11-21T21:30:00-05:00" },
    ] });
  });
  let historicalRequests = 0;
  await page.route("**/api/chorus/sessions", (route) => {
    if (++historicalRequests === 1) {
      return route.fulfill({
        status: 502, json: { code: "BACKEND_UNAVAILABLE", error: "Historical records are temporarily offline.", requestId: "archive-test" },
      });
    }
    return route.fulfill({ json: [{ ...historical, status: "paused", createdAt: "2026-11-22T02:00:00Z" }] });
  });
  let historicalDetailRequests = 0;
  await page.route(`**/api/chorus/sessions/${historical.id}`, (route) => {
    if (++historicalDetailRequests > 1) return route.continue();
    return route.fulfill({ status: 502, json: { code: "BACKEND_UNAVAILABLE", error: "Saved run temporarily offline.", requestId: "history-test" } });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/archive?experiment=1");
  const archive = page.getByRole("region", { name: "Saved runs" });
  const list = archive.getByRole("list", { name: "Archived runs" });
  const rows = list.getByRole("link");
  const experimentRow = list.getByRole("link", { name: new RegExp(experiment.problem.title) });
  const historicalRow = list.getByRole("link", { name: new RegExp(historical.scenario.title) });
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expect(page.locator(".compact-shell")).toHaveCSS("color-scheme", "dark");
  await expect(archive.getByRole("alert")).toContainText("Historical records are temporarily offline.");
  await expect(rows).toHaveCount(2);
  expect(currentRequests).toBe(1);
  await archive.getByRole("button", { name: "Retry historical sessions" }).click();
  await expect(archive.getByRole("alert")).toHaveCount(0);
  await expect(rows).toHaveCount(3);
  expect(currentRequests).toBe(1);
  expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute("href")))).toEqual([
    `/?session=${experiment.id}`, `/?session=${historical.id}`, `/?session=${benchmark.id}`,
  ]);
  await expect(experimentRow.getByText("Completed", { exact: true })).toBeVisible();
  await expect(experimentRow.locator("time")).toHaveText(/Nov 22, 2026.*2:30 AM/);
  await expect(historicalRow.getByText("Paused", { exact: true })).toBeVisible();
  await expect(archive.getByRole("status")).toHaveText("3 runs");
  await page.screenshot({ path: "test-results/archive-desktop.png" });

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(experimentRow.locator("time")).toBeInViewport({ ratio: 1 });
  await expect(historicalRow.getByText("Paused", { exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await page.screenshot({ path: "test-results/archive-phone.png" });

  const search = archive.getByRole("searchbox", { name: "Search saved runs" });
  const status = archive.getByRole("combobox", { name: "Filter by status" });
  const type = archive.getByRole("combobox", { name: "Filter by type" });
  await search.fill("PRODUCTION");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Stopped");
  await expect(status).toHaveAttribute("data-slot", "select-trigger");
  await status.click();
  await page.getByRole("option", { name: "Paused", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(archive.getByText("No saved runs match these filters.")).toBeVisible();
  await search.fill(historical.id.slice(0, 8));
  await type.click();
  await page.getByRole("option", { name: "Historical sessions", exact: true }).click();
  await expect(archive.getByRole("status")).toHaveText("1 of 3 runs");
  await historicalRow.press("Enter");
  const savedRun = page.getByRole("region", { name: "Historical run", exact: true });
  await expect(savedRun.getByRole("alert")).toHaveText("Saved run temporarily offline.");
  await savedRun.getByRole("button", { name: "Retry historical run" }).press("Enter");
  await expect(savedRun.getByText("Historical session · read only", { exact: true })).toBeVisible();
  await expect(savedRun.getByRole("heading", { name: historical.scenario.title })).toBeVisible();
  const conversation = savedRun.getByRole("region", { name: "Historical conversation" });
  await expect(conversation.getByRole("article")).toHaveCount(savedHistory.turns.length);
  await expect(conversation.getByRole("article").first()).toContainText(savedHistory.turns[0].speakerName);
  await savedRun.getByRole("button", { name: "Canvas" }).press("Enter");
  await expect(conversation).toBeHidden();
  await expect(savedRun.getByRole("region", { name: "Historical canvas" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const downloaded = page.waitForEvent("download");
  await savedRun.getByRole("link", { name: "Export archived session with journals" }).press("Enter");
  const savedExport = JSON.parse(await readFile((await (await downloaded).path())!, "utf8"));
  expect(savedExport).toMatchObject({ id: historical.id, canvas: savedHistory.canvas, turns: savedHistory.turns });
  expect(savedExport.journals).toBeInstanceOf(Array);
  await page.setViewportSize({ width: 1280, height: 800 });
  await savedRun.getByRole("button", { name: "Conversation" }).click();
  await page.screenshot({ path: "test-results/historical-run.png" });

  await savedRun.getByRole("link", { name: /Back to archive/ }).press("Enter");
  await experimentRow.click();
  await expect(page.getByRole("heading", { name: experiment.problem.title, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start experiment", exact: true })).toBeVisible();
});
