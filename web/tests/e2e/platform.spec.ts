import { test, expect } from "@playwright/test";

test("selects an OpenRouter model and submits its namespaced ID", async ({ page }) => {
  await page.route("**/api/chorus/catalog", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    catalog.models = catalog.models.map((model: object) => ({ ...model, available: true, unavailableReason: null }));
    await route.fulfill({ response, json: catalog });
  });
  await page.route("**/api/chorus/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postDataJSON().model).toBe("deepseek/deepseek-v4.1-flash-1017");
    await route.fulfill({ status: 502, json: { code: "MODEL_REQUEST_FAILED", error: "OpenRouter selection verified.", requestId: "test" } });
  });
  await page.goto("/archive");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "debate", exact: true }).click();
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await expect(page.getByText("OpenRouter", { exact: true })).toBeVisible();
  await page.getByRole("option", { name: "DeepSeek V4.1 Flash 1017", exact: true }).click();
  await page.getByRole("button", { name: "Run Simulation", exact: true }).click();
  await expect(page.getByText("OpenRouter selection verified.", { exact: true })).toBeVisible();
});

test("offers six models across three provider groups, and submits the selected OpenAI model", async ({ page }) => {
  await page.route("**/api/chorus/catalog", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    catalog.models = catalog.models.map((model: object) => ({ ...model, available: true, unavailableReason: null }));
    await route.fulfill({ response, json: catalog });
  });
  await page.route("**/api/chorus/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postDataJSON().model).toBe("gpt-6-luna");
    await route.fulfill({ status: 502, json: { code: "MODEL_REQUEST_FAILED", error: "OpenAI test request captured.", requestId: "test" } });
  });
  await page.goto("/archive");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "debate", exact: true }).click();
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await expect(model).toContainText("Qwen 3.5 4B MLX");
  await model.click();
  await expect(page.getByRole("option")).toHaveText(["Qwen 3.5 0.8B MLX", "Qwen 3.5 4B MLX", "GPT-6-Luna", "DeepSeek V4.1 Flash 1017", "MiniMax M3.1 Flash", "GLM 5.3 Flash"]);
  await expect(page.getByText("OpenAI APIs", { exact: true })).toBeVisible();
  await page.getByRole("option", { name: "GPT-6-Luna", exact: true }).click();
  await page.getByRole("button", { name: "Run Simulation", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "OpenAI test request captured." })).toHaveText("OpenAI test request captured.");
});

test("shows unconfigured OpenAI as unavailable without blocking local models", async ({ page }) => {
  await page.goto("/archive");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "debate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run Simulation", exact: true })).toBeEnabled();
  await expect(page.getByText(/Set CHORUS_API_KEY/)).toBeVisible();
  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await expect(page.getByRole("option", { name: /GPT-6-Luna/ })).toBeDisabled();
});
test("runs a catalog scenario through Chorus and restores the same session on reload", async ({ page, request }) => {
  await page.goto("/archive");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "debate", exact: true }).click();
  await page.getByRole("button", { name: "Run Simulation", exact: true }).click();
  await expect(page.getByText("Discussion complete · 20 turns", { exact: true })).toBeVisible({ timeout: 30000 });
  const id = await page.evaluate(() => localStorage.getItem("chorus-web.session"));
  expect(id).toBeTruthy();
  const snapshot = await (await request.get(`/api/chorus/sessions/${id}`)).json();
  expect(snapshot.status).toBe("completed");
  expect(snapshot.turns).toHaveLength(20);
  await page.reload();
  await expect(page.getByText(`Session ${id!.slice(0, 8)}`)).toBeVisible();
  const response = await request.get(`/api/chorus/sessions/${id}/export?format=json`);
  expect(await response.text()).not.toContain("PRIVATE-E2E");
  expect(await (await request.get("http://127.0.0.1:11436/state")).json()).toMatchObject({ privateLeak: false });
});
test("the application can display and control an existing platform session", async ({ page, request }) => {
  const scenarios = await (await request.get("/api/chorus/scenarios?collection=chorus-web")).json();
  const scenario = scenarios.find((s: { id: string }) => s.id === "chorus-web:debate");
  const snapshot = await (await request.post("/api/chorus/sessions", { data: { scenarioId: scenario.id, participantIds: scenario.suggestedAgents, model: "qwen3.5:4b-mlx", maxTurns: 5, judgeEnabled: false } })).json();
  await page.addInitScript((id) => localStorage.setItem("chorus-web.session", id), snapshot.id);
  await page.goto("/archive");
  await expect(page.getByText(`Session ${snapshot.id.slice(0, 8)}`)).toBeVisible();
  expect((await (await request.get(`/api/chorus/sessions/${snapshot.id}`)).json()).turns).toHaveLength(0);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText("Discussion complete · 5 turns", { exact: true })).toBeVisible();
});

test("sets multiple adversaries and restores fixed observer assignments", async ({ page, request }) => {
  await request.post("http://127.0.0.1:11436/reset", { data: {} });
  await page.goto("/archive");
  await page.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "debate", exact: true }).click();
  const checkboxes = page.getByRole("checkbox", { name: /Adversary:/ });
  expect(await checkboxes.count()).toBeGreaterThanOrEqual(2);
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByRole("checkbox", { name: /Enable Judge/ }).check();
  await page.screenshot({ path: "test-results/adversary-setup.png", fullPage: true });
  await page.getByRole("button", { name: "Run Simulation", exact: true }).click();
  await expect(page.getByText(/Observer only · Adversaries:/)).toBeVisible();
  await expect(page.getByText("Discussion complete · 20 turns", { exact: true })).toBeVisible({ timeout: 30000 });
  const id = await page.evaluate(() => localStorage.getItem("chorus-web.session"));
  const saved = await (await request.get(`/api/chorus/sessions/${id}`)).json();
  expect(saved.config.adversaryIds).toHaveLength(2);
  await page.reload();
  await expect(page.getByText(/Observer only · Adversaries:/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Adversary:/ })).toHaveCount(0);
  const names = saved.agents.filter((agent: { id: string }) => saved.config.adversaryIds.includes(agent.id)).map((agent: { name: string }) => agent.name);
  const state = await (await request.get("http://127.0.0.1:11436/state")).json();
  expect(state).toMatchObject({ checkpointCalls: 3, finalCalls: 1, privateLeak: false });
  for (const call of state.assignmentCalls) expect(call.assigned).toBe(call.phase !== "judge" && names.includes(call.speaker));
});
