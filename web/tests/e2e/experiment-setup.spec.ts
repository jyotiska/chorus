import { expect, test } from "@playwright/test";

test("repository experiment defaults and explicit selections survive changes to the brief", async ({ page }) => {
  await page.goto("/?experiment=1");
  await expect(page.getByText("6 agents", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Starter scaffolding" })).toHaveCount(0);
  await expect(page.getByText("Plan → Build → Judge", { exact: true })).toHaveCount(0);
  const team = page.getByRole("region", { name: "Experiment team" });
  const selectedAgents = team.getByRole("list", { name: "Selected agents" });
  const defaultNames = [
    "Front-end engineer", "Back-end engineer", "Technical architect",
    "Product manager", "Designer", "QA engineer",
  ];
  await expect(selectedAgents.getByRole("listitem")).toHaveText(defaultNames);
  const avatars = team.locator("img");
  await expect(avatars).toHaveCount(6);
  await expect.poll(() => avatars.evaluateAll((images) =>
    new Set(images.filter((image) => (image as HTMLImageElement).naturalWidth > 0)
      .map((image) => image.getAttribute("src"))).size
  )).toBe(6);
  await expect(page.getByRole("spinbutton", { name: "Turns per agent" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Final judge" })).toHaveCount(0);

  await page.getByRole("button", { name: "Edit team" }).click();
  await expect(page.getByRole("checkbox", { name: /^Select / })).toHaveCount(10);
  await expect(page.getByRole("checkbox", { name: /^Select /, checked: true })).toHaveCount(6);
  for (const name of defaultNames) {
    await expect(page.getByRole("checkbox", { name: `Select ${name}`, exact: true })).toBeChecked();
  }
  await expect(page.getByRole("checkbox", { name: /private adversary/ })).toHaveCount(0);

  await page.getByRole("button", { name: "View General agent profile" }).click();
  const general = page.getByRole("dialog", { name: "General agent profile" });
  await expect(general.getByText("No predefined persona")).toBeVisible();
  await expect(general.locator("dt")).toHaveCount(0);
  await general.getByRole("button", { name: "Close profile" }).click();

  await page.getByRole("button", { name: "View Designer profile" }).click();
  const designer = page.getByRole("dialog", { name: "Designer profile" });
  await expect(designer.locator("dt")).toHaveText(["Background", "Traits", "Strengths", "Weaknesses"]);
  await designer.getByRole("button", { name: "Close profile" }).click();
  await page.getByRole("checkbox", { name: "Select Designer" }).uncheck();
  await page.getByRole("checkbox", { name: "Select General agent" }).check();
  await page.getByRole("button", { name: "Close Edit team" }).click();
  const editedNames = [...defaultNames.filter((name) => name !== "Designer"), "General agent"];
  await expect(selectedAgents.getByRole("listitem")).toHaveText(editedNames);

  await page.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const judge = page.getByRole("combobox", { name: "Judge model" });
  await judge.click();
  await page.getByRole("listbox").getByRole("option", { name: "Qwen 3.5 0.8B MLX", exact: true }).click();
  await expect(judge).toHaveText("Qwen 3.5 0.8B MLX");
  await page.getByRole("button", { name: "Choose problem: Build a to-do app like Todoist" }).click();
  const problems = page.getByRole("dialog", { name: "Choose a problem" });
  await expect(problems.locator(".problem-list button")).toHaveCount(4);
  await problems.getByRole("button", { name: /Build a form-building app like Typeform/ }).click();
  await expect(selectedAgents.getByRole("listitem")).toHaveText(editedNames);
  await page.getByRole("button", { name: "Edit team" }).click();
  await expect(page.getByRole("checkbox", { name: "Select Designer" })).not.toBeChecked();
  await page.getByRole("button", { name: "Close Edit team" }).click();

  await page.route("**/api/chorus/v2/experiments", (route) =>
    route.fulfill({ status: 409, json: { code: "CONFLICT", error: "Setup test response", requestId: "setup-test" } }),
  );
  const launch = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/v2/experiments"));
  await page.getByRole("button", { name: "Start experiment" }).click();
  expect((await launch).postDataJSON()).toEqual({
    problemId: "typeform",
    participantIds: ["frontend-engineer", "backend-engineer", "technical-architect", "product-manager", "qa-engineer", "general-agent"],
    model: "qwen3.5:4b-mlx",
    judgeModel: "qwen3.5:0.8b-mlx",
  });
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Setup test response");
});

test("restores SPEC.md and the repository and preserves them after a kill", async ({ page, request }) => {
  const response = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ["general-agent"], model: "qwen3.5:4b-mlx" },
  });
  expect(response.status()).toBe(201);
  const run = await response.json();
  await page.goto(`/?session=${run.id}`);
  await expect(page.getByRole("navigation", { name: "Experiment phase" }).getByText("Plan")).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("0 / 1 finished")).toBeVisible();
  await page.getByRole("button", { name: "Repository", exact: true }).click();
  await expect(page.getByRole("region", { name: "Experiment repository" }).getByText(run.experiment.repository.path, { exact: true })).toBeVisible();
  await expect(page.getByText("General agent · agents/general-agent")).toBeVisible();
  const tree = page.getByRole("region", { name: "File tree" });
  await tree.getByText("frontend/", { exact: true }).click();
  await tree.getByRole("button", { name: "package.json", exact: true }).click();
  const preview = page.getByRole("region", { name: "File preview" });
  await expect(preview.getByRole("heading")).toHaveText("frontend/package.json");
  await expect(preview.locator("pre")).toContainText('"next"');
  await page.getByRole("combobox", { name: "Branch" }).selectOption("agents/general-agent");
  await expect(tree.getByText("frontend/", { exact: true })).toBeVisible();
  await expect(preview).toContainText("Select a file");

  await page.getByRole("region", { name: "Live agents" }).getByRole("button", { name: /General agent/ }).click();
  const inspector = page.getByRole("dialog", { name: "General agent details" });
  await expect(inspector.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  await expect(inspector.getByText("No to-do items recorded in SPEC.md.")).toBeVisible();
  await inspector.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Start experiment" }).click();
  await page.getByRole("button", { name: "Kill experiment" }).click();
  await expect.poll(async () => (await (await request.get(`/api/chorus/v2/sessions/${run.id}`)).json()).status).toBe("killed");
  await page.reload();
  await expect(page.getByText("Experiment killed. The repository and recorded activity are preserved.")).toBeVisible();
  const summaries = page.waitForResponse((response) =>
    response.url().includes(`/sessions/${run.id}/records?kind=summary&`) && response.ok(),
  );
  await page.getByRole("region", { name: "Live agents" }).getByRole("button", { name: /General agent/ }).click();
  expect((await (await summaries).json()).records).toEqual([]);
  await expect(inspector.getByRole("tab")).toHaveText(["Tasks", "Profile"]);
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "SPEC.md", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Task Distribution", exact: true })).toBeVisible();
  await expect(page.getByText("Jump to tasks or history", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Export SPEC.md" })).toBeVisible();
  expect((await (await request.get(`/api/chorus/v2/sessions/${run.id}`)).json()).experiment.frozen).toBeNull();
});

test("live agent badges follow the phase and timestamps age beside usage totals", async ({ page, request }) => {
  const ids = ["frontend-engineer", "backend-engineer", "qa-engineer"];
  const response = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ids, model: "qwen3.5:4b-mlx" },
  });
  expect(response.status()).toBe(201);
  const run = await response.json();
  const now = new Date();
  const createdAt = now.toISOString();
  run.status = "running";
  run.experiment.planningCompletions = [{ agentId: ids[0], specRevision: 0, createdAt }];
  const endpoint = `**/api/chorus/v2/sessions/${run.id}`;
  const usage = await (await request.get(`/api/chorus/v2/sessions/${run.id}/usage`)).json();
  Object.assign(usage.agents[ids[0]], {
    inputTokens: 1200, outputTokens: 42, callCount: 3, estimatedCostUSD: 0.00045,
  });
  await page.clock.install({ time: now });
  await page.route(endpoint, (route) => route.fulfill({ json: run }));
  await page.route(`${endpoint}/usage`, (route) => route.fulfill({ json: usage }));
  await page.route(`${endpoint}/events?*`, (route) => route.fulfill({
    contentType: "text/event-stream", body: ": keepalive\n\n",
  }));
  await page.route(`${endpoint}/records?kind=board&*`, (route) => route.fulfill({ json: {
    records: [{ id: "board:test", kind: "board", sequence: 1, agentId: ids[0], turn: 1, createdAt,
      data: { text: "Planning is underway." } }],
    cursor: 1, highWater: 1, hasMore: false,
  } }));

  await page.goto(`/?session=${run.id}`);
  const roster = page.getByRole("region", { name: "Live agents" });
  const frontend = roster.getByRole("button", { name: /Front-end engineer/ });
  const backend = roster.getByRole("button", { name: /Back-end engineer/ });
  await expect(frontend.getByRole("img", { name: "Finished planning" })).toBeVisible();
  await expect(frontend).toContainText("1,200 in · 42 out");
  await expect(frontend).toContainText("3 calls · $0.000450 est.");
  const timestamp = page.getByRole("region", { name: "Message board" }).locator("time");
  await expect(timestamp).toContainText("(Just now)");
  await page.clock.fastForward(5 * 60 * 1000);
  await expect(timestamp).toContainText("(5 minutes ago)");

  run.experiment.phase = "build";
  run.workers[0].state = "running";
  run.workers[1].state = "finished";
  run.workers[1].remainingTasks = [
    { task: "Export tasks", reason: "Export format is pending." },
    { task: "Sync offline", reason: "Offline storage is still missing." },
  ];
  run.workers[2].state = "failed";
  await page.route(`${endpoint}/agents/${ids[1]}/tasks`, (route) => route.fulfill({
    json: {
      revision: run.canvasVersion,
      markdown: "- [x] Add search\n- [x] Add filters\n- [ ] Export tasks\n- [ ] Sync offline",
      completed: 2,
      total: 4,
    },
  }));
  await page.reload();
  await expect(backend.getByRole("img", { name: "Finished building" })).toBeVisible();
  await expect(roster.getByRole("img", { name: "Finished planning" })).toHaveCount(0);
  await expect(roster.getByRole("img", { name: "Finished building" })).toHaveCount(1);
  await backend.click();
  const tasks = page.getByRole("tabpanel", { name: "Tasks", exact: true });
  await expect(tasks.getByRole("status")).toHaveText("2 of 4 complete");
  await expect(tasks.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(tasks.getByText(/Export format is pending/)).toBeVisible();
  await page.getByRole("dialog", { name: "Back-end engineer details" }).getByRole("button", { name: "Close", exact: true }).click();

  run.experiment.phase = "judge";
  run.status = "reviewing";
  await page.reload();
  await expect(roster.getByRole("img", { name: "Finished building" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Experiment phase" }).getByText("Judge")).toHaveAttribute("aria-current", "step");
});
