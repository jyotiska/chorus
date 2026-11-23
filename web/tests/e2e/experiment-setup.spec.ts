import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessRecord, HarnessSnapshot } from "../../lib/api/chorus/harness-client";

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
  for (const checked of await team.getByRole("checkbox", { name: /^Select /, checked: true }).all()) await checked.uncheck();
  await team.getByRole("checkbox", { name: "Select General agent" }).check();
  await page.getByRole("button", { name: "Close Edit team" }).click();
  await page.getByRole("combobox", { name: "Agent model", exact: true }).click();
  await page.getByRole("option", { name: "Qwen 3.5 4B MLX", exact: true }).click();
  await page.getByRole("combobox", { name: "Judge model" }).click();
  await page.getByRole("option", { name: "Qwen 3.5 0.8B MLX", exact: true }).click();

  await chooseBrief(/^Other/);
  const input = page.getByRole("textbox", { name: "Problem statement" });
  const start = page.getByRole("button", { name: "Start experiment" });
  await expect(input).toBeFocused();
  await expect(start).toBeDisabled();
  await input.fill("é".repeat(6001));
  await expect(page.getByText("Shorten the problem statement", { exact: false })).toBeVisible();
  await expect(start).toBeDisabled();
  await input.fill(brief);
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
  const row = board.getByRole("article").filter({ hasText: "Task discussion 15 is ready" });
  await row.scrollIntoViewIfNeeded();
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
