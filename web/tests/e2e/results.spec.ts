import { expect, test } from "@playwright/test";
import type { HarnessRecord, HarnessSnapshot } from "../../lib/api/chorus/harness-client";

test("experiment Results show the outcome, scannable scores and supporting records", async ({ page, request }) => {
  const response = await request.post("/api/chorus/v2/experiments", {
    data: { problemId: "todoist", participantIds: ["frontend-engineer", "qa-engineer"], model: "qwen3.5:4b-mlx" },
  });
  expect(response.status()).toBe(201);
  const run: HarnessSnapshot = await response.json();
  const experiment = run.experiment!;
  type Criterion = NonNullable<typeof experiment.report>["application"][number];
  const score = (value: Criterion["score"], explanation: string, evidenceIds: string[] = []): Criterion =>
    ({ score: value, explanation, evidenceIds });
  const boardId = "board:task-check";
  const prId = "pr:new-task";
  const summary = "The team built task creation and completion, with a saved repository and a shared specification. Task priorities remain open.";
  const board: HarnessRecord = {
    id: boardId, sequence: 1, kind: "board", agentId: "qa-engineer", turn: 0, createdAt: run.createdAt,
    data: { text: "The task creation contract includes a title and completion status." },
  };
  const pull: HarnessRecord = {
    id: prId, sequence: 2, kind: "pr", agentId: "frontend-engineer", turn: 0, createdAt: run.createdAt,
    data: {
      description: "Add the new task form.", status: "merged",
      diff: "diff --git a/frontend/tasks.js b/frontend/tasks.js\n--- a/frontend/tasks.js\n+++ b/frontend/tasks.js\n@@ -1 +1 @@\n-return null;\n+return createTaskForm();",
    },
  };
  run.status = "completed";
  experiment.phase = "judge";
  experiment.frozen = { mainCommit: experiment.repository.mainCommit, specRevision: 3, evidenceThrough: 2, artifactChecks: [] };
  experiment.judgeAttempts = 1;
  experiment.report = {
    summary,
    application: [
      score("not_assessable", "Application startup was not observed."),
      score(3, "Task creation and completion are present in the submitted implementation.", [boardId, prId]),
      score(2, "The form labels are clear, though error feedback is limited.", [prId]),
      score("not_applicable", "This brief does not require external integrations."),
      score(4, "The form and request handler have clear responsibilities.", [prId]),
    ],
    collaboration: [
      score(4, "The team recorded the task contract.", [boardId]),
      score(3, "The roles worked on distinct tasks."),
      score(2, "One integration dependency was resolved late."),
      score(0, "The review did not address the open priority control."),
      score("not_assessable", "Insufficient evidence for the final integration."),
    ],
    agents: [
      { agentId: "frontend-engineer", criteria: [
        score(3, "Defined the main interaction."), score(4, "Delivered the form.", [prId]),
        score(3, "Used clear role labels."), score(2, "Documented the handoff."), score(3, "Responded to team feedback.", [boardId]),
      ] },
      { agentId: "qa-engineer", criteria: Array.from({ length: 5 }, () => score("not_assessable", "Insufficient evidence for this criterion.")) },
    ],
    missingWork: ["Task priorities are missing."],
  };

  const session = `**/api/chorus/v2/sessions/${run.id}`;
  await page.route(session, (route) => route.fulfill({ json: run }));
  await page.route(`${session}/events?*`, (route) => route.fulfill({
    contentType: "text/event-stream", body: ": keepalive\n\n",
  }));
  await page.route(`${session}/records/${encodeURIComponent(boardId)}`, (route) => route.fulfill({ json: board }));
  let pullRequests = 0;
  await page.route(`${session}/records/${encodeURIComponent(prId)}`, (route) => {
    if (++pullRequests === 1) {
      return route.fulfill({ status: 404, json: { code: "NOT_FOUND", requestId: "results-retry", error: "The source record could not be loaded." } });
    }
    return route.fulfill({ json: pull });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/?session=${run.id}`);

  const results = page.getByRole("region", { name: "Experiment results" });
  const quality = results.getByRole("region", { name: "Application quality" });
  const judgeSummary = results.getByRole("region", { name: "Judge summary" });
  const collaboration = results.getByRole("region", { name: "Collaboration", exact: true });
  await expect(results.getByText("Completed", { exact: true })).toBeInViewport();
  await expect(judgeSummary).toContainText(summary);
  const qualityBox = await quality.boundingBox();
  expect((await judgeSummary.boundingBox())!.y).toBeLessThan(qualityBox!.y);
  expect(qualityBox!.x).toBeLessThan((await collaboration.boundingBox())!.x);
  await expect(results).toContainText("SPEC.md v3");
  await expect(results).toContainText("Code and records review");
  await expect(results).toContainText("Task priorities are missing.");
  await expect(page.locator(".live-shell")).toHaveCSS("color-scheme", "dark");
  await expect(quality.getByText("9/12", { exact: true })).toBeVisible();
  await expect(quality).toContainText("3 of 5 scored");
  await expect(quality.getByText("Not assessable", { exact: true })).toBeVisible();
  await expect(quality.getByText("Not applicable", { exact: true })).toBeVisible();
  await expect(collaboration.getByText("0/4", { exact: true })).toBeVisible();
  await expect(results.getByText("0 of 5 scored", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/experiment-results.png" });

  const evidence = quality.getByRole("button", { name: "Open evidence for Core functionality (2 sources)", exact: true });
  await evidence.click();
  const dialog = page.getByRole("dialog", { name: "Source evidence" });
  await expect(dialog.getByRole("heading", { name: "Core functionality evidence" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Message board post" })).toBeVisible();
  await expect(dialog).toContainText("QA engineer");
  await expect(dialog).toContainText(board.data.text as string);
  await dialog.getByRole("combobox", { name: "Source" }).click();
  await dialog.getByRole("listbox").getByRole("option", { name: /Local pull request/ }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The source record could not be loaded.");
  await dialog.getByRole("button", { name: "Retry evidence" }).click();
  await expect(dialog.getByRole("heading", { name: "Local pull request" })).toBeVisible();
  await expect(dialog.getByLabel("Unified diff")).toContainText("+return createTaskForm();");
  await expect(dialog).toContainText("Front-end engineer");
  await page.screenshot({ path: "test-results/experiment-evidence.png" });
  await page.keyboard.press("Escape");
  await expect(evidence).toBeFocused();
  await quality.getByText("Core functionality", { exact: true }).click();
  await expect(quality).toContainText("Task creation and completion are present in the submitted implementation.");

  await page.setViewportSize({ width: 320, height: 720 });
  expect((await quality.boundingBox())!.y).toBeLessThan((await collaboration.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

  experiment.report = null;
  run.status = "reviewing";
  await page.reload();
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await expect(results.getByRole("status")).toHaveText("Judge report pending.");
  await expect(judgeSummary).toHaveCount(0);
  await expect(results).toContainText("Frozen main commit");

  run.status = "judge_failed";
  run.error = "Judging was interrupted. Retry using the frozen evidence.";
  await page.reload();
  await expect(results.getByText("Judge failed", { exact: true })).toBeVisible();
  await expect(results.getByRole("alert")).toHaveText(run.error);
  await expect(results.getByText(/Attempts recorded 1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry judge" })).toBeVisible();
});
