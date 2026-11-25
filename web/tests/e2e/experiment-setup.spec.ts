import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessRecord, HarnessSnapshot } from "../../lib/api/chorus/harness-client";

const checkProfile = {
  digest: "b".repeat(64), policy: "agent-requested-v1" as const,
  profile: { name: "Fixture project", image: `fixture/project@sha256:${"a".repeat(64)}`, platform: "linux/amd64" as const,
    timeoutSeconds: 45, maxRuns: 12, commands: [{ id: "unit", argv: ["npm", "test"] }] },
};

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

  await page.getByRole("combobox", { name: "Agent model", exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const judge = page.getByRole("combobox", { name: "Judge model" });
  await judge.click();
  await page.getByRole("listbox").getByRole("option", { name: "Qwen 3.5 0.8B MLX", exact: true }).click();
  await expect(judge).toHaveText("Qwen 3.5 0.8B MLX");
  await page.getByRole("button", { name: "Choose brief: Build a to-do app like Todoist" }).click();
  const problems = page.getByRole("dialog", { name: "Choose a brief" });
  await expect(problems.locator(".problem-list button")).toHaveCount(5);
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

test("Generate replaces the roster using the selected Agent model and starts with the saved profiles", async ({ page, request }) => {
  await page.goto("/?experiment=1");
  await page.getByRole("combobox", { name: "Agent model", exact: true }).click();
  await page.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  const judge = page.getByRole("combobox", { name: "Judge model" });
  await judge.press("Enter");
  await page.getByRole("listbox").getByRole("option", { name: "Qwen 3.5 0.8B MLX", exact: true }).press("Enter");
  await expect(judge).toHaveText("Qwen 3.5 0.8B MLX");
  const generated = page.waitForResponse((response) => response.url().endsWith("/experiments/teams"));
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const response = await generated;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual({ problemId: "todoist", model: "qwen3.5:4b-mlx" });

  const selected = page.getByRole("list", { name: "Selected agents" });
  await expect(selected.getByRole("listitem")).toHaveCount(3);
  await selected.getByRole("button", { name: "View Mira profile" }).click();
  const profile = page.getByRole("dialog", { name: "Mira profile" });
  await expect(profile.getByText("System prompt")).toBeVisible();
  await expect(profile.getByText(/As task workflow designer/)).toBeVisible();
  await profile.getByRole("button", { name: "Close profile" }).click();
  await page.getByRole("button", { name: "Edit team" }).click();
  await page.getByRole("checkbox", { name: "Select General agent" }).check();
  await page.getByRole("button", { name: "Close Edit team" }).click();
  await expect(selected.getByRole("listitem")).toHaveCount(4);
  await expect.poll(() => selected.locator("img").evaluateAll((images) =>
    new Set(images.filter((image) => (image as HTMLImageElement).naturalWidth > 0)
      .map((image) => image.getAttribute("src"))).size,
  )).toBe(4);

  const created = page.waitForResponse((run) => run.url().endsWith("/v2/experiments"));
  await page.getByRole("button", { name: "Start experiment" }).click();
  const runResponse = await created;
  expect(runResponse.status()).toBe(201);
  const run: HarnessSnapshot = await runResponse.json();
  const first = run.agents[0];
  expect(first).toMatchObject({ name: "Mira" });
  const url = `/api/chorus/v2/sessions/${run.id}`;
  await expect.poll(async () => (await (await request.get(url)).json()).status).toBe("completed");
  const saved = await (await request.get(`${url}/export`)).json();
  expect(saved.session.agents).toEqual(run.agents);
  expect(saved.records.commit.some((item: HarnessRecord) => item.agentId === first.id)).toBe(true);
  const workerRequests = saved.records.request.filter((item: HarnessRecord) => item.agentId === first.id);
  expect(workerRequests[0].data.messages[0].content).toContain("Current phase: Plan");
  expect(workerRequests[0].data.messages[1].content).toContain("As task workflow designer");
  expect(workerRequests[0].data.messages[2].content).toContain("Task usability reviewer");
  expect(saved.records.call[0].data).toMatchObject({ model: "qwen3.5:4b-mlx", phase: "team_generation" });
  await page.reload();
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(page.getByRole("region", { name: "Team generation" })).toBeVisible();
});

test("Other generates from the current brief and preserves the roster on failure and stale replies", async ({ page }) => {
  await page.goto("/?experiment=1");
  await page.getByRole("combobox", { name: "Agent model", exact: true }).click();
  await page.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await page.getByRole("button", { name: /Choose brief:/ }).click();
  await page.getByRole("dialog", { name: "Choose a brief" }).getByRole("button", { name: /^Other/ }).click();
  const generate = page.getByRole("button", { name: "Generate", exact: true });
  const brief = page.getByRole("textbox", { name: "Problem statement" });
  const selected = page.getByRole("list", { name: "Selected agents" });
  await expect(generate).toBeDisabled();
  await brief.fill("Reject this fixture.");
  await generate.click();
  await expect(page.getByRole("region", { name: "Experiment team" }).getByRole("alert")).toContainText("did not return a complete team");
  await expect(selected.getByRole("listitem")).toHaveCount(6);

  await brief.fill("Plan a low-walking visit to a museum.");
  let release = () => {};
  let delivered = () => {};
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const finished = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route("**/experiments/teams", async (route) => {
    try {
      const upstream = await route.fetch();
      await wait;
      await route.fulfill({ response: upstream });
    } finally {
      delivered();
    }
  }, { times: 1 });
  await generate.click();
  await expect(page.getByRole("button", { name: "Generating…" })).toBeDisabled();
  await brief.fill("Plan a low-walking visit to a museum with a workshop.");
  release();
  await finished;
  await expect(selected.getByRole("listitem")).toHaveCount(6);

  const generated = page.waitForResponse((response) => response.url().endsWith("/experiments/teams"));
  await generate.click();
  const response = await generated;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ problemId: "other", customStatement: await brief.inputValue() });
  await expect(selected.getByRole("button", { name: "View Rina profile" })).toBeVisible();
  await brief.fill("Plan a different trip.");
  await expect(page.getByRole("button", { name: "Start experiment" })).toBeDisabled();
});

test("Other runs a pasted custom brief and restores its reviewed HTML and Markdown deliverables", async ({ page, request }) => {
  const brief = "Write a workplace sitcom pilot called Printer Jam.\n\nMake the pilot a single HTML file and include character notes.";
  await page.goto("/?experiment=1");
  async function chooseBrief(name: string | RegExp) {
    await page.getByRole("button", { name: /Choose brief:/ }).click();
    const picker = page.getByRole("dialog", { name: "Choose a brief" });
    const option = picker.getByRole("button", { name });
    await option.focus();
    await option.press("Enter");
  }
  await page.getByRole("button", { name: "Edit team" }).click();
  const team = page.getByRole("dialog", { name: "Edit team" });
  const checkedAgents = team.getByRole("checkbox", { name: /^Select /, checked: true });
  while (await checkedAgents.count()) await checkedAgents.first().uncheck();
  await team.getByRole("checkbox", { name: "Select General agent" }).check();
  await page.getByRole("button", { name: "Close Edit team" }).click();
  await page.getByRole("combobox", { name: "Agent model", exact: true }).click();
  await page.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Judge model" }).press("Enter");
  await page.getByRole("listbox").getByRole("option", { name: "Qwen 3.5 0.8B MLX", exact: true }).press("Enter");

  await chooseBrief(/^Other/);
  const input = page.getByRole("textbox", { name: "Problem statement" });
  const start = page.getByRole("button", { name: "Start experiment" });
  await expect(input).toBeFocused();
  await expect(start).toBeDisabled();
  await expect(page.getByText("UTF-8 bytes", { exact: false })).toHaveCount(0);
  await input.fill("é".repeat(6001));
  const limitError = page.getByText("Shorten the problem statement to fit the limit.", { exact: true });
  await expect(limitError).toBeVisible();
  await expect(start).toBeDisabled();
  await input.fill(brief);
  await expect(limitError).toHaveCount(0);
  await chooseBrief(/Build a task-tracking app like Linear/);
  await expect(input).toHaveCount(0);
  await chooseBrief(/^Other/);
  await expect(input).toHaveValue(brief);
  await expect(page.getByRole("list", { name: "Selected agents" }).getByRole("listitem")).toHaveText(["General agent"]);

  const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/v2/experiments"));
  await start.click();
  const launch = await created;
  expect(launch.status()).toBe(201);
  expect(launch.request().postDataJSON()).toEqual({ problemId: "other", customStatement: brief,
    participantIds: ["general-agent"], model: "qwen3.5:4b-mlx", judgeModel: "qwen3.5:0.8b-mlx" });
  const run: HarnessSnapshot = await launch.json();
  await expect.poll(async () => (await (await request.get(`/api/chorus/v2/sessions/${run.id}`)).json()).status).toBe("completed");
  await page.getByRole("button", { name: "Results" }).click();
  await expect(page.getByRole("heading", { name: "Deliverable quality" })).toBeVisible();
  const deliverables = page.getByRole("region", { name: "Deliverables" });
  const files = deliverables.getByRole("listitem");
  await expect(files.first()).toContainText("deliverables/pilot.html");
  await expect(files.nth(1)).toContainText("deliverables/characters.md");
  const pilot = files.first();
  await pilot.getByText("Open", { exact: true }).click();
  await expect(pilot.locator("pre")).toContainText("<!doctype html><h1>Printer Jam</h1>");
  expect(await page.evaluate(() => Object.hasOwn(window, "chorusArtifactRan"))).toBe(false);
  const downloadPromise = page.waitForEvent("download");
  await pilot.getByRole("link", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("pilot.html");
  expect(await readFile((await download.path())!, "utf-8")).toContain("Mira: It only prints on Fridays.");
  const rejected = await request.get(`/api/chorus/v2/sessions/${run.id}/artifacts/download`, { params: { path: "frontend/package.json" } });
  expect(rejected.status()).toBe(404);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Deliverable quality" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Individual contributions" })).toBeVisible();
  await page.getByRole("button", { name: "Run actions" }).click();
  await page.getByRole("menuitem", { name: "View problem statement" }).click();
  await expect(page.getByRole("dialog", { name: "Problem statement" }).locator(".saved-statement")).toHaveJSProperty("textContent", brief);
});

test("the full experiment setup fits on a laptop with all ten agents and an unavailable judge", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?experiment=1");

  const title = page.getByRole("heading", { name: "New experiment", level: 1 });
  const brief = page.getByRole("region", { name: "Brief", exact: true });
  const team = page.getByRole("region", { name: "Experiment team" });
  const model = page.getByRole("combobox", { name: "Agent model", exact: true });
  const judge = page.getByRole("combobox", { name: "Judge model", exact: true });
  const start = page.getByRole("button", { name: "Start experiment", exact: true });
  await expect(page.locator(".experiment-setup")).toHaveCSS("color-scheme", "dark");
  await expect(title).toBeInViewport();
  await expect(start).toBeInViewport({ ratio: 1 });
  await expect(start).toBeDisabled();
  await expect(model).toHaveAccessibleDescription(/Set CHORUS_API_KEY/);
  await expect(judge).toHaveAccessibleDescription(/Set CHORUS_API_KEY/);

  await brief.getByRole("button").click();
  await page.getByRole("button", { name: /Build a form-building app like Typeform/ }).click();
  await expect(brief).toContainText("review submitted responses");
  await team.getByRole("button", { name: "Edit team" }).click();
  const editor = page.getByRole("dialog", { name: "Edit team" });
  await expect(editor.getByRole("checkbox", { name: /^Select /, checked: false })).toHaveCount(4);
  for (const name of ["Full-stack engineer", "Project manager", "Platform engineer", "General agent"]) {
    await editor.getByRole("checkbox", { name: `Select ${name}`, exact: true }).check();
  }
  await editor.getByRole("button", { name: "Close Edit team" }).click();
  await expect(team.getByRole("list", { name: "Selected agents" }).getByRole("listitem")).toHaveCount(10);

  const options = page.getByRole("listbox");
  await model.click();
  await options.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await expect(options).toHaveCount(0);
  await judge.click();
  await options.getByRole("option", { name: "GPT-6-Luna · unavailable", exact: true }).click({ timeout: 5000 });
  await expect(options).toHaveCount(0);
  await expect(judge).toHaveAccessibleDescription(/Set CHORUS_API_KEY/);
  await expect(model).not.toHaveAttribute("aria-invalid", "true");
  await expect(start).toBeDisabled();

  const main = page.getByRole("main");
  for (const height of [720, 800]) {
    await page.setViewportSize({ width: 1280, height });
    for (const element of [title, brief, team, model, judge, start]) {
      await expect(element).toBeInViewport({ ratio: 1 });
    }
    expect(await main.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: "test-results/setup-experiment-warning.png" });

  await judge.click();
  await options.getByRole("option", { name: "Qwen 3.5 0.8B MLX", exact: true }).click();
  await expect(options).toHaveCount(0);
  await expect(start).toBeEnabled();
  await page.screenshot({ path: "test-results/setup-experiment-laptop.png" });
});

test("restores SPEC.md and the repository and preserves them after a kill", async ({ page, request }) => {
  const response = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ["general-agent"], model: "qwen3.5:4b-mlx" },
  });
  expect(response.status()).toBe(201);
  const run = await response.json();
  await page.goto(`/?session=${run.id}`);
  await expect(page.getByRole("group", { name: "Experiment phase" }).getByText("Plan")).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("0 / 1 finished")).toBeVisible();
  await page.getByRole("button", { name: "Repository", exact: true }).click();
  const repository = page.getByRole("region", { name: "Experiment repository" });
  await repository.getByText("Repository details", { exact: true }).click();
  await expect(repository.getByText(run.experiment.repository.path, { exact: true })).toBeVisible();
  await repository.getByText("Repository details", { exact: true }).click();
  const tree = page.getByRole("region", { name: "File tree" });
  await tree.getByText("frontend/", { exact: true }).click();
  await tree.getByRole("button", { name: "package.json", exact: true }).click();
  const preview = page.getByRole("region", { name: "File preview" });
  await expect(preview.getByRole("heading")).toHaveText("frontend/package.json");
  await expect(preview.locator("pre")).toContainText('"name": "test-frontend"');
  await page.getByRole("combobox", { name: "Branch" }).click();
  await page.getByRole("option", { name: "General agent · agents/general-agent", exact: true }).click();
  await expect(tree.getByText("frontend/", { exact: true })).toBeVisible();
  await expect(preview).toContainText("Select a file");

  const participants = page.getByRole("button", { name: /^Participants/ });
  const roster = page.getByRole("dialog", { name: "Participants" });
  await participants.click();
  await roster.getByRole("button", { name: /General agent/ }).click();
  const inspector = page.getByRole("dialog", { name: "General agent details" });
  await expect(inspector.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  await expect(inspector.getByText("No to-do items recorded in SPEC.md.")).toBeVisible();
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await roster.getByRole("button", { name: "Close Participants" }).click();

  await page.getByRole("button", { name: "Start experiment" }).click();
  const actions = page.getByRole("button", { name: "Run actions" });
  const confirmation = page.getByRole("alertdialog", { name: "Kill experiment?" });
  await actions.click();
  await page.getByRole("menuitem", { name: "Kill experiment" }).click();
  await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole("menuitem", { name: "Kill experiment" }).click();
  await confirmation.getByRole("button", { name: "Kill experiment" }).click();
  await expect.poll(async () => (await (await request.get(`/api/chorus/v2/sessions/${run.id}`)).json()).status).toBe("killed");
  await page.reload();
  await expect(page.getByText("Experiment killed. The repository and recorded activity are preserved.")).toBeVisible();
  const summaries = page.waitForResponse((response) =>
    response.url().includes(`/sessions/${run.id}/records?kind=summary&`) && response.ok(),
  );
  await participants.click();
  await roster.getByRole("button", { name: /General agent/ }).click();
  expect((await (await summaries).json()).records).toEqual([]);
  await expect(inspector.getByRole("tab")).toHaveText(["Tasks", "Profile", "Usage"]);
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await roster.getByRole("button", { name: "Close Participants" }).click();
  await page.getByRole("button", { name: "SPEC.md", exact: true }).click();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Task Distribution", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export SPEC.md" })).toBeVisible();
  expect((await (await request.get(`/api/chorus/v2/sessions/${run.id}`)).json()).experiment.frozen).toBeNull();
});

test("the Repository keeps the tree beside committed files and agent diffs", async ({ page, request }) => {
  const response = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ["frontend-engineer", "qa-engineer"], model: "qwen3.5:4b-mlx" },
  });
  expect(response.status()).toBe(201);
  const run: HarnessSnapshot = await response.json();
  const repository = run.experiment!.repository;
  const [frontend, qa] = repository.worktrees;
  const git = (path: string, ...args: string[]) => execFileSync("git", [
    "-C", path, "-c", "core.hooksPath=/dev/null", "-c", "user.name=Chorus Test", "-c", "user.email=test@chorus.invalid",
    ...args,
  ], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();
  async function commit(worktree: typeof frontend, path: string, contents: string, subject: string, sequence: number): Promise<HarnessRecord> {
    await writeFile(join(worktree.path, path), contents);
    git(worktree.path, "add", "--", path);
    git(worktree.path, "commit", "--no-gpg-sign", "-m", subject);
    const revision = git(worktree.path, "rev-parse", "HEAD");
    return {
      id: `commit:${sequence}`, sequence, kind: "commit", agentId: worktree.agentId, turn: 0,
      createdAt: run.createdAt, data: { subject, commit: revision, branch: worktree.branch },
    };
  }
  const taskLabel = 'export const taskLabel = "Today";';
  const validation = 'export const validated = "Task has a title";';
  const uiCommit = await commit(frontend, "frontend/task-label.js", `${taskLabel}\n`, "Add task label", 1);
  const qaCommit = await commit(qa, "backend/check-task.js", `${validation}\n`, "Check task titles", 2);
  const pull: HarnessRecord = {
    id: "pr:opened", sequence: 3, kind: "pr", agentId: frontend.agentId, turn: 0, createdAt: run.createdAt,
    data: {
      id: "aabbccdd", status: "open", branch: frontend.branch, description: "Add the Today label",
      taskIds: ["labels"], sourceCommit: uiCommit.data.commit, targetCommit: repository.baselineCommit,
      diff: git(frontend.path, "diff", "--no-ext-diff", "--no-textconv", repository.baselineCommit, "HEAD", "--"),
    },
  };
  const review: HarnessRecord = {
    id: "pr:reviewed", sequence: 4, kind: "pr", agentId: qa.agentId, turn: 0, createdAt: run.createdAt,
    data: { id: pull.data.id, status: "review", text: "The task label matches the brief." },
  };
  await page.route(`**/api/chorus/v2/sessions/${run.id}/records?*`, (route) => {
    const query = new URL(route.request().url()).searchParams;
    const kind = query.get("kind");
    if (kind !== "commit" && kind !== "pr") return route.continue();
    const after = Number(query.get("after"));
    const records = (kind === "commit" ? [uiCommit, qaCommit] : [pull, review]).filter((record) => record.sequence > after);
    const cursor = records.at(-1)?.sequence ?? after;
    return route.fulfill({ json: { records, cursor, highWater: 4, hasMore: false } });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/?session=${run.id}`);
  const repositoryTab = page.getByRole("button", { name: "Repository", exact: true });
  await repositoryTab.click();
  const branch = page.getByRole("combobox", { name: "Branch" });
  const tree = page.getByRole("region", { name: "File tree" });
  const preview = page.getByRole("region", { name: "File preview" });
  const changes = page.getByRole("button", { name: "Changes", exact: true });
  await expect(changes).toContainText("3");
  await expect(branch).toHaveAttribute("data-slot", "select-trigger");
  await branch.click();
  await page.getByRole("option", { name: /Front-end engineer/ }).click();
  await tree.getByText("frontend/", { exact: true }).click();
  await tree.getByRole("button", { name: "task-label.js", exact: true }).click();
  await expect(preview.locator("pre")).toHaveText(taskLabel);
  await expect(preview.locator(".hljs-keyword").first()).toHaveText("export");
  await expect(preview.getByLabel("Source code")).toHaveCSS("white-space", "pre-wrap");
  expect((await tree.boundingBox())!.x).toBeLessThan((await preview.boundingBox())!.x);
  await expect(page.locator(".live-shell")).toHaveCSS("color-scheme", "dark");
  await page.screenshot({ path: "test-results/repository-files.png" });

  await changes.click();
  const change = page.getByRole("combobox", { name: "Change", exact: true });
  const patch = page.getByRole("region", { name: "Change preview" });
  await expect(change).toHaveText(/PR aabbccdd.*Front-end engineer/);
  await expect(patch.locator('[data-line="added"]')).toContainText(taskLabel);
  await patch.getByText("Pull request details", { exact: true }).click();
  await expect(patch).toContainText("review · QA engineer");
  await expect(patch).toContainText("The task label matches the brief.");
  await patch.getByText("Pull request details", { exact: true }).click();
  expect((await tree.boundingBox())!.x).toBeLessThan((await patch.boundingBox())!.x);
  await page.screenshot({ path: "test-results/repository-diff.png" });
  await change.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(2);
  await page.getByRole("option", { name: /Add task label/ }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(patch.locator('[data-line="added"]')).toContainText(taskLabel);
  await expect(patch).toContainText(frontend.branch);

  await branch.click();
  await page.getByRole("option", { name: /QA engineer/ }).click();
  await expect(change).toHaveText(/QA engineer.*Check task titles/);
  await expect(patch.locator('[data-line="added"]')).toContainText(validation);
  await expect(patch).not.toContainText(taskLabel);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await repositoryTab.click();
  await expect(branch).toHaveText(`QA engineer · ${qa.branch}`);
  await expect(change).toHaveText(/QA engineer.*Check task titles/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await tree.boundingBox())!.y).toBeLessThan((await patch.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("Markdown opens rendered and Raw keeps the original text and soft wraps", async ({ page, request }) => {
  const response = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ["general-agent"], model: "qwen3.5:4b-mlx" },
  });
  expect(response.status()).toBe(201);
  const state: HarnessSnapshot = await response.json();
  const repository = state.experiment!.repository;
  const report = "# Preview title\r\n\r\n| Key | Value |\r\n| --- | --- |\r\n| hello | world |\r\n\r\n" +
    "[Open config](package.json)\r\n\r\n<script>window.repositoryMarkdownRan = true</script>\r\n\r\n" +
    "```text\r\nconsole sample\r\n```\r\n\r\n" + "longword".repeat(130);
  await writeFile(join(repository.path, "frontend/guide.markdown"), report);
  await writeFile(join(repository.path, "frontend/other.md"), "## Other document\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", repository.path, "-c", "user.name=Chorus Test",
    "-c", "user.email=test@chorus.invalid", "-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8" });
  git("add", "--", "frontend/guide.markdown", "frontend/other.md");
  git("commit", "--no-gpg-sign", "-m", "Add viewer fixtures");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?session=${state.id}`);
  await page.getByRole("button", { name: "Repository", exact: true }).click();
  const tree = page.getByRole("region", { name: "File tree" });
  const preview = page.getByRole("region", { name: "File preview" });
  await tree.getByText("frontend/", { exact: true }).click();
  await tree.getByRole("button", { name: "guide.markdown", exact: true }).click();
  await expect(preview.getByRole("button", { name: "Preview", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(preview.getByRole("heading", { name: "Preview title" })).toBeVisible();
  await expect(preview.getByRole("table")).toContainText("world");
  await expect(preview.getByText("console sample")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "repositoryMarkdownRan"))).toBeUndefined();
  await preview.getByRole("button", { name: "Raw", exact: true }).click();
  const source = preview.getByLabel("Source code");
  expect(await source.textContent()).toBe(report);
  await expect(source).toHaveCSS("white-space", "pre-wrap");
  expect(await source.evaluate((element) => element.scrollWidth)).toBe(await source.evaluate((element) => element.clientWidth));
  await tree.getByRole("button", { name: "other.md", exact: true }).click();
  await expect(preview.getByRole("heading", { name: "Other document" })).toBeVisible();
  await tree.getByRole("button", { name: "guide.markdown", exact: true }).click();
  await preview.getByRole("button", { name: "Open config" }).click();
  await expect(preview.getByRole("heading")).toHaveText("frontend/package.json");
});

test("SPEC.md shows task owners and revision diffs while preserving the Board position", async ({ page, request }) => {
  const ids = ["frontend-engineer", "qa-engineer"];
  const response = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ids, model: "qwen3.5:4b-mlx" },
  });
  expect(response.status()).toBe(201);
  const run: HarnessSnapshot = await response.json();
  run.canvasVersion = 3;
  run.changeCount = 2;
  run.boardCount = 30;
  run.canvas = [
    "# SPEC.md", "", "## Product specification", "", "Ship a compact task organizer.", "", "### Keyboard shortcuts",
    "", "- [ ] Keep keyboard shortcuts discoverable by showing them alongside each action in the toolbar and in the settings panel.",
    "", "```markdown", "## Task Distribution", "```", "",
    ...Array.from({ length: 35 }, (_, i) => `- Document requirement ${i + 1}`),
    "", "## Task Distribution",
    "", "### Front-end engineer (frontend-engineer)", "", "- [x] Add keyboard shortcuts", "- [ ] Show due dates",
    "", "### QA engineer (qa-engineer)", "", "- [ ] Test repeated reminders",
    "", "## Change log", "", "### Product specification history", "", "Initial product requirements recorded.",
  ].join("\n");
  const endpoint = `**/api/chorus/v2/sessions/${run.id}`;
  const boardRecords = Array.from({ length: run.boardCount }, (_, index) => ({
    id: `board:spec-${index + 1}`, sequence: index + 1, kind: "board", agentId: ids[0], turn: 1,
    createdAt: run.createdAt, data: { text: `Task discussion ${index + 1} is ready to review.` },
  }));
  const edits = [
    { id: "change:product", sequence: 31, kind: "change", agentId: ids[1], turn: 1, createdAt: run.createdAt,
      data: { beforeVersion: 1, afterVersion: 2, section: "product", diff: "+Ship a compact task organizer." } },
    { id: "change:tasks", sequence: 32, kind: "change", agentId: ids[0], turn: 1, createdAt: run.createdAt,
      data: { beforeVersion: 2, afterVersion: 3, section: "tasks", taskOwnerId: ids[0], reason: "Finished the keyboard shortcuts.",
        verification: "Checked navigation using only the keyboard.", diff: "@@ -1 +1 @@\n- [ ] Add keyboard shortcuts\n+ [x] Add keyboard shortcuts" } },
  ];
  await page.route(endpoint, (route) => route.fulfill({ json: run }));
  await page.route(`${endpoint}/records?*`, (route) => {
    const query = new URL(route.request().url()).searchParams;
    const kind = query.get("kind");
    const source = kind === "board" ? boardRecords : kind === "change" ? edits : [];
    const after = Number(query.get("after"));
    const records = source.filter(({ sequence }) => sequence > after);
    return route.fulfill({ json: { records, cursor: records.at(-1)?.sequence ?? after, highWater: 32, hasMore: false } });
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/?session=${run.id}`);
  const board = page.getByRole("region", { name: "Message board" });
  const spec = page.getByRole("region", { name: "Experiment specification" });
  await expect(spec).toBeVisible();
  expect((await board.boundingBox())!.width).toBeGreaterThan((await spec.boundingBox())!.width);
  await expect(spec).toHaveCSS("color-scheme", "dark");
  await expect(spec.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(spec.getByRole("heading", { name: "Task Distribution" })).toBeHidden();
  await expect(spec.getByRole("link", { name: "Export SPEC.md" })).toBeInViewport();
  const requirement = spec.getByRole("listitem").filter({ hasText: "Keep keyboard shortcuts discoverable" });
  const checkbox = requirement.getByRole("checkbox");
  await expect(checkbox).toBeVisible();
  const { labelLines, boxCenter } = await checkbox.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.parentElement!);
    range.setStartAfter(element);
    const box = element.getBoundingClientRect();
    return {
      labelLines: Array.from(range.getClientRects()).filter(({ width }) => width > 0)
        .map(({ x, y, height }) => ({ x, center: y + height / 2 })),
      boxCenter: box.y + box.height / 2,
    };
  });
  expect(labelLines.length).toBeGreaterThan(1);
  expect(Math.abs(labelLines[0].center - boxCenter)).toBeLessThan(1);
  for (const line of labelLines.slice(1)) expect(line.x).toBeCloseTo(labelLines[0].x, 0);

  const row = board.getByRole("article").filter({ hasText: "Task discussion 15 is ready" });
  await row.scrollIntoViewIfNeeded();
  const avatar = (await row.getByRole("img", { name: "Front-end engineer portrait" }).boundingBox())!;
  const author = (await row.getByRole("button", { name: "Front-end engineer", exact: true }).boundingBox())!;
  const body = (await row.getByText("Task discussion 15 is ready to review.").boundingBox())!;
  expect(author.y + author.height / 2).toBeCloseTo(avatar.y + avatar.height / 2, 0);
  expect(body.x).toBeCloseTo(author.x, 0);
  const boardY = (await row.boundingBox())!.y;
  await spec.getByText("Document requirement 35", { exact: true }).scrollIntoViewIfNeeded();
  await expect(spec.getByRole("link", { name: "Export SPEC.md" })).toBeInViewport();
  expect((await row.boundingBox())!.y).toBeCloseTo(boardY, 0);
  await spec.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(spec.getByRole("heading", { name: /Front-end engineer.*1 of 2 done/ })).toBeVisible();
  await expect(spec.getByRole("checkbox", { checked: true })).toHaveCount(1);
  await expect(spec.getByText("Test repeated reminders")).toBeVisible();
  await page.screenshot({ path: "test-results/spec-workspace.png" });
  const owner = spec.getByRole("combobox", { name: "Task owner" });
  await expect(owner).toHaveAttribute("data-slot", "select-trigger");
  await owner.click();
  await page.getByRole("option", { name: "QA engineer", exact: true }).click();
  await expect(spec.getByText("Test repeated reminders")).toBeVisible();
  await expect(spec.getByText("Show due dates")).toBeHidden();
  await spec.getByRole("button", { name: "Changes", exact: true }).click();
  const latest = spec.locator("details[id]").first();
  await expect(latest).toContainText("Owner Front-end engineer");
  await expect(latest).toContainText("v2 → v3");
  await latest.locator("summary").click();
  await expect(latest.getByText("Checked navigation using only the keyboard.")).toBeVisible();
  await expect(latest.locator('[data-line="added"]')).toHaveText("+ [x] Add keyboard shortcuts");
  expect((await row.boundingBox())!.y).toBeCloseTo(boardY, 0);
  await page.screenshot({ path: "test-results/spec-changes.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  const opener = row.getByRole("button", { name: /Open SPEC.md/ });
  await opener.scrollIntoViewIfNeeded();
  const mobileY = (await row.boundingBox())!.y;
  await opener.click();
  await expect(latest.locator("pre")).toBeVisible();
  await spec.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(owner).toHaveText("QA engineer");
  await page.getByRole("button", { name: "Back to board" }).click();
  await expect(opener).toBeFocused();
  expect((await row.boundingBox())!.y).toBeCloseTo(mobileY, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator("select")).toHaveCount(0);
});

test("the compact live workspace preserves agent details, phase progress, and Board timestamps", async ({ page, request }) => {
  const ids = ["frontend-engineer", "backend-engineer", "qa-engineer", "designer", "technical-architect", "product-manager"];
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

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/?session=${run.id}`);
  const board = page.getByRole("region", { name: "Message board" });
  const firstPost = board.getByRole("article").first();
  await expect(firstPost).toBeVisible();
  expect((await firstPost.boundingBox())!.y).toBeLessThanOrEqual(220);
  await expect(page.locator(".live-shell")).toHaveCSS("color-scheme", "dark");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: run.problem.title })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "New experiment", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close SPEC.md" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(firstPost).toBeVisible();
  expect((await firstPost.boundingBox())!.y).toBeLessThanOrEqual(250);
  await expect(page.getByRole("button", { name: "Open beside board" })).toBeHidden();

  const participants = page.getByRole("button", { name: /^Participants/ });
  const roster = page.getByRole("dialog", { name: "Participants" });
  const closeParticipants = roster.getByRole("button", { name: "Close Participants" });
  await participants.click();
  const frontend = roster.getByRole("button", { name: /Front-end engineer/ });
  const backend = roster.getByRole("button", { name: /Back-end engineer/ });
  await expect(frontend.getByText("Finished planning", { exact: true })).toBeVisible();
  await expect(frontend).toContainText("No tasks assigned");
  await expect(roster.getByRole("button", { name: "All 6", exact: true })).toHaveAttribute("aria-pressed", "true");
  await frontend.click();
  const frontendDetails = page.getByRole("dialog", { name: "Front-end engineer details" });
  await frontendDetails.getByRole("tab", { name: "Tasks" }).press("ArrowRight");
  await expect(frontendDetails.getByRole("tabpanel", { name: "Profile" })).toBeVisible();
  await frontendDetails.getByRole("tab", { name: "Profile" }).press("ArrowRight");
  const agentUsage = frontendDetails.getByRole("tabpanel", { name: "Usage" });
  await agentUsage.getByLabel("Tokens, cache, latency and cost for this agent").press("Enter");
  await expect(agentUsage.getByText("1,200", { exact: true })).toBeVisible();
  await expect(agentUsage.getByText("$0.000450", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(frontend).toBeFocused();
  await closeParticipants.click();
  const timestamp = board.locator("time");
  await expect(timestamp).toHaveText("Just now");
  await expect(timestamp).toHaveAttribute("title", /.+\d.+/);
  await page.clock.fastForward(5 * 60 * 1000);
  await expect(timestamp).toHaveText("5 minutes ago");

  run.experiment.phase = "build";
  run.canvas = run.canvas
    .replace(`### Front-end engineer (${ids[0]})\n`, `### Front-end engineer (${ids[0]})\n\n- [ ] Add offline reminders\n`)
    .replace(`### Back-end engineer (${ids[1]})\n`, `### Back-end engineer (${ids[1]})\n\n- [x] Add search\n- [x] Add filters\n- [ ] **Export tasks**\n- [ ] Sync offline\n`);
  Object.assign(run.workers[0], { state: "running", reportedStatus: "blocked", currentTask: "Add offline reminders", reason: "Waiting for the sync API contract." });
  run.workers[1].state = "finished";
  run.workers[1].remainingTasks = [
    { task: "Export tasks", reason: "Export format is pending." },
    { task: "Sync offline", reason: "Offline storage is still missing." },
  ];
  Object.assign(run.workers[2], { state: "failed", currentTask: "Validate empty task names", reason: "The participant worker stopped after a provider failure." });
  Object.assign(run.workers[3], { state: "running", reportedStatus: "working", currentTask: "Review empty states" });
  run.workers[4].state = "waiting_model";
  await page.route(`${endpoint}/agents/${ids[1]}/tasks`, (route) => route.fulfill({
    json: {
      revision: run.canvasVersion,
      markdown: "- [x] Add search\n- [x] Add filters\n- [ ] Export tasks\n- [ ] Sync offline",
      completed: 2,
      total: 4,
    },
  }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Open beside board" })).toBeVisible();
  await expect(page.getByText("1 agent failed", { exact: true })).toBeVisible();
  await participants.click();
  await expect(roster).toHaveCSS("color-scheme", "dark");
  await expect(frontend.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(frontend).toContainText("Add offline reminders");
  await expect(frontend).toContainText("Waiting for the sync API contract.");
  await expect(frontend).toContainText("0/1 tasks done");
  await expect(backend.getByText("Finished building", { exact: true })).toBeVisible();
  await expect(backend).toContainText("Open task · Export tasks");
  await expect(backend).toContainText("2/4 tasks done");
  await expect(backend).toContainText("2 open");
  await expect(roster.getByRole("button", { name: /Technical architect/ })).toContainText("Waiting for model");
  await page.screenshot({ path: "test-results/participants-desktop.png", animations: "disabled" });
  const attention = roster.getByRole("button", { name: "Needs attention 2", exact: true });
  await attention.click();
  await expect(attention).toHaveAttribute("aria-pressed", "true");
  await expect(backend).toBeHidden();
  await expect(frontend).toBeVisible();
  await expect(roster.getByRole("button", { name: /QA engineer/ })).toContainText("Failed");
  await roster.getByRole("button", { name: "Finished 1", exact: true }).click();
  await expect(frontend).toBeHidden();
  await backend.click();
  const tasks = page.getByRole("tabpanel", { name: "Tasks", exact: true });
  await expect(tasks.getByRole("status")).toHaveText("2 of 4 complete");
  await expect(tasks.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(tasks.getByText(/Export format is pending/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tasks.getByRole("heading", { name: /Assigned tasks/ })).toBeInViewport();
  expect((await page.getByRole("dialog", { name: "Back-end engineer details" }).boundingBox())!.width).toBe(390);
  await page.screenshot({ path: "test-results/participants-tasks-phone.png" });
  await page.getByRole("dialog", { name: "Back-end engineer details" }).getByRole("button", { name: "Close", exact: true }).click();
  await expect(backend).toBeFocused();
  await expect(roster.getByRole("button", { name: "Finished 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await closeParticipants.click();
  await expect(participants).toBeFocused();

  run.experiment.phase = "judge";
  run.status = "reviewing";
  await page.reload();
  await expect(page.getByRole("group", { name: "Experiment phase" }).getByText("Judge")).toHaveAttribute("aria-current", "step");
  await participants.click();
  await expect(backend.getByText("Finished", { exact: true })).toBeVisible();
});


test("shows actionable starter errors through the validated client", async ({ page }) => {
  await page.route("**/api/chorus/v2/experiments", (route) => route.fulfill({
    status: 503,
    json: {
      code: "SCAFFOLD_UNAVAILABLE", requestId: "synthetic-request",
      error: "Starter frontend/backend directories are unavailable. Check CHORUS_EXPERIMENT_SCAFFOLD.",
    },
  }));
  await page.goto("/?experiment=1");
  await page.getByRole("combobox", { name: "Agent model", exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await page.getByRole("button", { name: "Start experiment", exact: true }).click();
  await expect(page.getByText("Starter frontend/backend directories are unavailable. Check CHORUS_EXPERIMENT_SCAFFOLD.", { exact: true })).toBeVisible();
});

test.describe("200 percent desktop reflow", () => {
  test.use({ viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 });

  test("agent details keep long summary history usable at a 200 percent reflow width", async ({ page, request }) => {
    const response = await request.post("/api/chorus/v2/experiments", {
      data: { problemId: "todoist", participantIds: ["general-agent"], model: "qwen3.5:4b-mlx" },
    });
    expect(response.status()).toBe(201);
    const run: HarnessSnapshot = await response.json();
    run.status = "killed";
    run.problem.title = "Build a keyboard-first project planning workspace with long lists and recurring tasks";
    const endpoint = `**/api/chorus/v2/sessions/${run.id}`;
    await page.route(endpoint, (route) => route.fulfill({ json: run }));
    await page.route(`${endpoint}/records?kind=summary&*`, (route) => {
      const after = Number(new URL(route.request().url()).searchParams.get("after"));
      const records = Array.from({ length: 24 }, (_, index) => ({
        id: `summary:history-${index + 1}`, sequence: index + 1, kind: "summary", agentId: "general-agent",
        turn: index + 1, createdAt: run.createdAt, data: { status: "available", decision: `Recorded decision ${index + 1}.` },
      })).filter(({ sequence }) => sequence > after);
      return route.fulfill({ json: { records, cursor: records.at(-1)?.sequence ?? after, highWater: 24, hasMore: false } });
    });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(`/?session=${run.id}`);
    const participants = page.getByRole("button", { name: /^Participants/ });
    await participants.press("Enter");
    const roster = page.getByRole("dialog", { name: "Participants" });
    const row = roster.getByRole("button", { name: /General agent/ });
    await row.press("Enter");
    const inspector = page.getByRole("dialog", { name: "General agent details" });
    const tabs = inspector.getByRole("tablist");
    await expect(tabs.getByRole("tab", { name: "Reasoning summaries" })).toBeVisible();
    await tabs.getByRole("tab", { name: "Tasks" }).press("End");
    const summaries = inspector.getByRole("tabpanel", { name: "Reasoning summaries" });
    await expect(summaries.getByRole("article")).toHaveCount(20);
    await expect(summaries.getByRole("article").first()).toContainText("Recorded decision 24.");
    await summaries.getByRole("button", { name: "Show more summaries" }).press("Enter");
    await expect(summaries.getByRole("article")).toHaveCount(24);
    await expect(summaries.getByRole("article").nth(20)).toBeFocused();
    const search = summaries.getByRole("searchbox");
    await search.fill("decision 1.");
    await expect(summaries.getByRole("article")).toHaveCount(1);
    await expect(summaries.getByText("Recorded decision 1.")).toBeVisible();
    expect(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, scale: devicePixelRatio })))
      .toEqual({ width: 640, scroll: 640, scale: 2 });
    await page.screenshot({ path: "test-results/agent-details.png", animations: "disabled" });
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await tabs.getByRole("tab", { name: "Reasoning summaries" }).press("Escape");
    await expect(row).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(participants).toBeFocused();
    const usageButton = page.getByRole("button", { name: "Usage", exact: true });
    await expect(usageButton).toBeInViewport();
    await usageButton.press("Enter");
    const usage = page.getByRole("dialog", { name: "Usage" });
    await expect(usage.getByText("Session cost", { exact: true })).toBeInViewport();
    await expect(usage.getByRole("region", { name: "Whole session" }).getByText("Input tokens", { exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(usageButton).toBeFocused();
  });
});

test("DeepSWE preserves per-source drafts and previews a matched study while offline", async ({ page }) => {
  await page.goto("/?experiment=1");
  await page.getByRole("button", { name: /Choose brief:/ }).click();
  await page.getByRole("dialog", { name: "Choose a brief" }).getByRole("button", { name: /^Other/ }).click();
  const draft = page.getByRole("textbox", { name: "Problem statement" });
  await draft.fill("Keep this draft when switching sources.");

  const source = page.getByRole("combobox", { name: "Problem source" });
  await source.click();
  await page.getByRole("option", { name: "DeepSWE", exact: true }).click();
  await expect(page.getByText("ts-pattern-match-each", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Default team" }).getByRole("listitem")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Start DeepSWE run" })).toBeDisabled();
  await expect(page.getByText(/Set CHORUS_DEEPSWE_PROFILE/)).toBeVisible();
  await page.getByRole("button", { name: "Use solo vs. team preset" }).click();
  await expect(page.getByText("6 trials · Up to 720 model calls")).toBeVisible();
  await expect(page.getByRole("region", { name: "Solo", exact: true }).getByRole("listitem")).toHaveCount(1);
  const team = page.getByRole("region", { name: "Team of three" });
  await expect(team.getByRole("listitem")).toHaveCount(3);
  await team.getByLabel("Guidance").first().selectOption("role");
  await expect(team.getByRole("combobox", { name: "Profile", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Start campaign" })).toBeDisabled();

  await source.click();
  await page.getByRole("option", { name: "App or open-ended problem" }).click();
  await expect(draft).toHaveValue("Keep this draft when switching sources.");
  await source.click();
  await page.getByRole("option", { name: "DeepSWE", exact: true }).click();
  await expect(team.getByLabel("Guidance").first()).toHaveValue("role");
});

test("saved DeepSWE results display the verifier reward after a reload", async ({ page, request }) => {
  const response = await request.post("/api/chorus/v2/experiments", { data: {
    problemId: "todoist", participantIds: ["frontend-engineer"], model: "qwen3.5:4b-mlx",
  } });
  const saved: HarnessSnapshot = await response.json();
  const experiment = saved.experiment!;
  const commit = experiment.repository.baselineCommit;
  const frozen: HarnessSnapshot = {
    ...saved, revision: 99, status: "completed",
    problem: { ...saved.problem, id: "ts-pattern-match-each", title: "TypeScript pattern matching with .each" },
    experiment: { ...experiment, phase: "verify", rubric: "deepswe-v1", publicCheckProfile: checkProfile,
      frozen: { mainCommit: commit, specRevision: 0, evidenceThrough: 0, artifactChecks: [],
        publicChecks: [{ checkId: "unit", status: "passed", recordId: "check:fixture" }] },
      deepswe: {
        condition: null,
        task: { id: "ts-pattern-match-each", baseCommit: commit, baseTree: commit, datasetCommit: commit,
          image: "fixture/task", verifierImage: "fixture/verifier", platform: "linux/amd64", pierVersion: "0.3.1" },
        callLimit: 120, solvingSeconds: 1800, callsReserved: 13, deadlineAt: null, stopReason: null,
        patchDigest: "a".repeat(64), submittedTree: commit, verificationAttempts: 1,
        result: { reward: 0, tests: 7, passed: 6, failed: 1, compilationFailure: "Feature suite could not run. TS2394: incompatible overload." },
      },
    },
  };
  await page.route(`**/api/chorus/v2/sessions/${saved.id}`, (route) => route.fulfill({ json: frozen }));
  await page.route(`**/api/chorus/v2/sessions/${saved.id}/records?kind=public_check&**`, (route) => route.fulfill({ json: {
    records: [{ id: "check:fixture", sequence: 1, kind: "public_check", agentId: saved.agents[0].id, turn: 0, createdAt: saved.createdAt,
      data: { runId: "fixture", checkId: "unit", commit, status: "passed", output: "Public regression passed." } }],
    cursor: 1, highWater: 1, hasMore: false,
  } }));
  await page.goto(`/?session=${saved.id}`);
  const results = page.getByRole("region", { name: "DeepSWE results" });
  await expect(results.getByText("Failed", { exact: true })).toBeVisible();
  await expect(results.getByText("7 tests · 6 passed · 1 failed")).toBeVisible();
  await expect(results.getByRole("region", { name: "Public checks" })).toContainText("unit · Passed");
  await expect(results.getByText(/TS2394: incompatible overload/)).toBeVisible();
  await expect(results.getByRole("link", { name: "Download patch" })).toHaveAttribute("href", /\/deepswe\/patch$/);
  await expect(page.getByRole("button", { name: "Terminal", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(results.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByText("Verify", { exact: true })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Repository", exact: true }).click();
  await page.getByRole("button", { name: "Checks", exact: true }).click();
  const history = page.getByRole("region", { name: "Public checks" });
  await history.getByText("unit · Passed ·", { exact: false }).click();
  await expect(history.getByText("Public regression passed.")).toBeVisible();
  await expect(history.getByText(/Requested by Front-end engineer/)).toBeVisible();
});

test("DeepSWE launches the previewed campaign and reopens paired scores", async ({ page, request }) => {
  const base = "/api/chorus/v2/deepswe";
  const catalog = await (await request.get(base + "/catalog")).json();
  const pin = "a".repeat(40);
  const task = { id: catalog.problem.id, baseCommit: pin, baseTree: pin, datasetCommit: pin,
    image: "fixture/task", verifierImage: "fixture/grade", platform: "linux/amd64", pierVersion: "0.3.1" };
  const second = { ...task, id: "second-repository-task" };
  const tasks = [{ task, problem: catalog.problem, publicCheckProfile: checkProfile },
    { task: second, problem: { ...catalog.problem, id: second.id, title: "Second task", statement: "Second public instruction." } }];
  const models = catalog.models.map((model: { id: string }) => ({ ...model, available: true, unavailableReason: null }));
  await page.route("**" + base + "/catalog", route => route.fulfill({ json: { ...catalog, models, task, tasks, unavailableReason: null,
    publicCheckProfile: checkProfile } }));
  let report: import("../../lib/api/chorus/harness-client").DeepSWECampaign | undefined;
  await page.route("**" + base + "/campaigns", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: [] });
    const manifest = route.request().postDataJSON();
    expect(manifest.task).toEqual(task);
    expect(manifest.conditions.map((c: { slots: unknown[] }) => c.slots.length)).toEqual([1, 3]);
    expect(manifest.conditions.map((c: { publicChecks?: string }) => c.publicChecks)).toEqual([checkProfile.digest, undefined]);
    expect(manifest.repeats).toBe(3);
    report = { manifest, id: manifest.requestId, callCeiling: 720, status: "finished", error: "",
      engineVersion: "deepswe-v2", promptVersion: "fixture",
      trials: manifest.conditions.flatMap((c: { name: string }, i: number) => [1, 2, 3].map(repeat => ({
        condition: c.name, repeat, sessionId: `trial-${i}-${repeat}`, status: "completed", reward: repeat <= i + 1 ? 1 : 0,
        usage: null, wallTimeMs: null, calls: 6,
      }))),
      scores: [
        { condition: "Solo", passed: 1, graded: 3, planned: 3, ratePercent: 100 / 3, pairedCount: 3, deltaPoints: 0 },
        { condition: "Team of three", passed: 2, graded: 3, planned: 3, ratePercent: 200 / 3, pairedCount: 3, deltaPoints: 100 / 3 },
      ],
    };
    return route.fulfill({ status: 201, json: report });
  });
  await page.route("**" + base + "/campaigns/*", route => route.fulfill({ json: report }));
  await page.goto("/?experiment=1");
  await page.getByRole("combobox", { name: "Problem source" }).click();
  await page.getByRole("option", { name: "DeepSWE", exact: true }).click();
  await page.getByRole("button", { name: "Use solo vs. team preset" }).click();
  const soloChecks = page.getByRole("region", { name: "Solo", exact: true }).getByRole("checkbox", { name: /public checks/ });
  await expect(soloChecks).not.toBeChecked();
  await soloChecks.check();
  const taskPicker = page.getByLabel("DeepSWE task");
  await taskPicker.selectOption(second.id);
  await expect(page.getByText(second.id, { exact: true })).toBeVisible();
  await page.getByText("Problem statement", { exact: true }).click();
  await expect(page.getByText("Second public instruction.")).toBeVisible();
  await expect(soloChecks).toHaveCount(0);
  await expect(page.getByText("6 trials · Up to 720 model calls")).toBeVisible();
  await taskPicker.selectOption(task.id);
  await expect(soloChecks).not.toBeChecked();
  await soloChecks.check();
  await expect(page.getByRole("region", { name: "Team of three" }).getByRole("checkbox", { name: /public checks/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByText("+33.3 pp (3 paired)")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Inspect trial" })).toHaveCount(6);
  await expect(page.getByRole("link", { name: "Export JSON" })).toBeVisible();
});
