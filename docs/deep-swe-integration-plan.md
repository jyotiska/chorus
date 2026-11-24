# DeepSWE integration plan for Chorus

The research goal is to measure whether a different Chorus team, model, or prompting choice solves more of the same repository tasks at a given budget. The source launcher supports one pinned TypeScript task, configurable participant slots, and repeated campaigns. The six-agent setup is the default. An empty-body API request still selects the fixed default team. Configured runs use `deepswe-v5` with saved guidance and per-worker model selections. Campaign manifests, trial links and grades persist in SQLite. The multi-task registry and Compose verifier deployment in milestone 5 remain future work. First-release participants are Chorus agents and teams.

## What the researcher sees

1. Choose **DeepSWE** as the problem source on the Chorus home screen. The launcher shows the pinned `ts-pattern-match-each` task, its public instructions, an editable roster, team and worker model choices, and the run limits. The existing app and **Other** briefs are available from the default source.
2. Start the run and follow **Plan → Build → Verify** in the existing session workspace. The board, shared plan, worktrees, and local PRs show how the team worked. Reopen the same session from its URL or the archive.
3. Open **Results** to see **Passed**, **Failed**, or **Ungraded**, the frozen patch, test totals when available, and agent usage. A verifier error includes a retry action that uses the same saved patch.

## Milestone 1 · Calibrate the grader

Use a pinned DeepSWE checkout, the TypeScript task's pinned repository base and image digest, and a pinned Pier installation. A trusted operator configures these locally on a Docker-capable host. Use a compatible Linux host if the task image cannot run locally.

Run the upstream reference and empty controls without model calls. Run the patch replay adapter against the reference, empty, and incorrect submissions. Require rewards of **1**, **0**, and **0** respectively, and verify the replayed Git tree. Exercise the error path for verifier failures and missing or invalid rewards. Only a valid binary verifier reward can produce a pass or fail. [Datacurve run guide](https://deepswe.datacurve.ai/run) · [Task configuration](https://github.com/datacurve-ai/deep-swe/blob/main/tasks/ts-pattern-match-each/task.toml)

## Milestone 2 · Ship and verify one default-team run

- Use a versioned repository-benchmark mode in the Python harness and the existing session storage. Save the task revision, image and base pins, selected model and frozen team, call and time limits, submitted Git tree and patch digest, and grading result.
- Reuse the board, planning lease, worktrees and local PRs. Keep the plan and verifier data outside the task repository. Allow repository-relative inspection and edits with the existing path and symlink protections. The agents inspect and edit files through Chorus tools. Pier executes the verifier in its isolated environment.
- Use a shared model-call limit and solving deadline. Reaching the call limit stops new dispatch while admitted calls may publish before the deadline. Freeze integrated main and its evidence before grading. Keep unmerged work inspectable in its worktree.
- Keep model credentials and SQLite in the engine. Start Pier with a restricted environment and a deadline. Retain a frozen patch and provide an actionable setup message when the grader is unavailable. Keep web proxy behavior transport-only.
- Exercise an end-to-end run with the six default agents, a scripted model provider, a real local Git merge, and a verifier fixture. Check browser reload and saved results, grading recovery, and that an ordinary app or custom run can still launch with DeepSWE unavailable. Calibrate with real Docker separately from routine CI.

## Milestone 3 · Make one task configurable

**Start with the existing dropdown.** Today it already offers **App or open-ended problem** and **DeepSWE**. Keep the four preset briefs, **Other** and its editable statement together in the default source. Inside DeepSWE, replace the read-only roster with a condition editor. Switching sources should restore each draft, including an unfinished custom statement. Preserve the five checked-answer problems through their existing CLI/API, and historical sessions through the archive and direct links. Adding a web entry for checked-answer problems can ship independently. [Web launcher](../web/components/harness/setup.tsx) · [Browser regressions](../web/tests/e2e/experiment-setup.spec.ts)

**Extend session creation.** The empty-body create endpoint uses the original roster, default model, 120-call limit and 30-minute solving window. The same endpoint accepts a typed request carrying a registered task revision, participant slots, default model, per-slot model overrides and shared limits. An empty request should still create the current default run. Return eligible models and profiles in the catalog, validate choices in Python, snapshot the effective configuration, and regenerate the SDK. Keep old sessions readable and grading retries bound to their original task and patch. [Routes](../chorus/harness/routes.py) · [State models](../chorus/harness/models.py) · [Client](../sdk/harness-client.ts)

**Separate worker identity from guidance.** Each slot has a unique actor ID and worktree. The user can choose neutral instructions, a role alone, or a full selected profile for each slot. Three neutral workers can therefore run the same prompt with distinct IDs. Today the prompt suppresses traits for the literal ID `general-agent`. Replace that special case on the new execution version, and apply the chosen guidance to both prompts and peer-visible roster descriptions. Resolve the slot's actual model for context sizing, dispatch and accounting. Reuse the current shared call reservation and deadline. Record the effective settings, prompt version and profile snapshot with the trial. [Prompt and worker loop](../chorus/harness/experiment.py) · [Model dispatch and usage](../chorus/harness/accounting.py)

**Acceptance.** Launch one neutral agent, three neutral agents, and a mixed-profile team against the same pinned task. With scripted providers, inspect the actual messages, model IDs, worktrees and call ledger. Verify solo merge and freeze, independent neutral identities, and the same shared ceiling under simultaneous calls. Reopen an older fixed-team run and a custom brief.

## Milestone 4 · Run and compare a campaign

**Smallest useful study.** Choose the calibrated TypeScript task, one neutral agent as baseline, three collaborating neutral agents as the variant, and three fresh attempts each. Hold the model, tools, task revision, total calls and solving deadline fixed. Preview **6 trials** and, using the current default, **at most 720 solving calls**. These are ceilings, not spend predictions. This study measures repeatability on one task. A later study can duplicate the three-agent condition and change only profile guidance or only the model.

**One trial, one session.** Add a Python campaign service under the current engine and additive SQLite campaign/trial records. Store a frozen manifest containing resolved task IDs and pins, named conditions, effective participant settings, tool and engine versions, shared budgets, repeat count and ordering seed. Create one slot per task × condition × repeat, and atomically link the unique slot key to its session. Start every slot from a clean baseline. Interleave conditions in seeded blocks and run one session at a time initially. Reuse the existing session commands, patch endpoint, usage ledger and grade record. The browser can close without stopping the queue. On restart, reconnect by slot key, respect paused/cancelled state and retry a failed grade on its original patch. A new solving attempt gets a new trial ID. [Storage and revisions](../chorus/harness/storage.py) · [Session lifecycle](../chorus/harness/experiment.py)

**One owner for the queue.** Expose preview, launch, status, resume/cancel and comparison through the v2 API. Keep the canonical client in the SDK and regenerate the web copy. The sibling Chorus Runs planner has useful ordering and reporting logic, but currently hard-codes one model, a 2–50-agent roster and checked-answer problems. Reuse those ideas in Chorus, and let that CLI submit or import via the API if needed. A standard web installation should require only Chorus and its configured verifier. [Chorus Runs planner](../../chorus-runs/campaign.py) · [Integration architecture](chorus-architecture.md)

**Score and coverage.** Accept the verifier's binary reward for the integrated patch. Within each task, average rewards across repeats. Average those task rates with equal weight and display the result as a percentage. For example, a solo result of 1/3 and a team result of 2/3 on the same task gives a team advantage of **33.3 percentage points**. This is illustrative arithmetic. A missing reward, infrastructure failure or cancellation is ungraded. Display graded/planned counts, reasons and per-slot outcomes. For a provisional delta, use only task/repeat slots graded in both conditions and show omissions. Mark a result complete when all planned slots have valid grades. Show actual tokens, elapsed time, and cost with its reported, estimated or unknown status. An equal call cap can yield different costs.

**Results and history.** Provide **Repeat campaign** and **Compare with previous** actions. Show which settings changed, matched task coverage, per-task gains/losses/ties, and links to each patch and session. Refuse a paired delta across incompatible task or verifier revisions. Export the resolved manifest and trial outcomes with stable IDs. Label results **Chorus on DeepSWE** because the published leaderboard uses a different agent harness. [Datacurve evaluation protocol](https://deepswe.datacurve.ai/run)

**Acceptance.** Complete and reload the six-slot fixture study, reconcile an interrupted launch, retry an ungraded frozen patch and reproduce the displayed totals from the export. A retry must add neither a solving session nor an extra observation. Exercise a partially graded campaign, and verify that the UI reports its smaller comparison denominator.

## Milestone 5 · Expand to multiple tasks and deployment targets

Replace the single task constant and local profile lookup with a registry indexed by dataset commit and task ID. Register base tree, public instructions, image/verifier digests, platform and Pier version for each eligible task. Resolve verification from the run's saved pins even after the default task changes. Gate eligibility on reference, empty and incorrect replay controls. Allow explicit task lists or a reproducible seeded subset, and show the resolved IDs before launch. A two-task, two-condition, two-repeat fixture should produce eight unique sessions and a task-weighted aggregate. Keep hidden tests and reference patches outside agent worktrees. [Current profile and grading adapter](../chorus/harness/deepswe.py) · [Frozen patches](../chorus/harness/experiment_git.py)

Use the source installation for the initial study. For Compose, put Pier on a dedicated benchmark worker or extend the trusted controller with a narrow grading operation. Keep Docker access off the web/API container and pin the worker platform and images. Test the real reference/empty controls on that deployment before offering it in the picker. Register public build or test tools separately if added, and save their version as a condition variable so historical comparisons expose the tool change. [Current Compose layout](../compose.yaml)

## Local verifier setup

The first implementation uses a source installation of Chorus with access to a Linux Docker daemon. Check out the DeepSWE release and fetch the matching repository base into a separate local Git repository. Resolve the image references from the pinned task manifest to immutable digests for your worker's platform. For the TypeScript pilot, set both pins to the upstream task image digest. The worker pins the FROM line of the official tests/Dockerfile and builds the separate verifier with its test files. Install `datacurve-pier==0.3.1` in a separate Python 3.12 virtual environment. Keep the checkouts and profile outside the Chorus repository.

```toml
dataset = "/absolute/path/to/deep-swe"
dataset_commit = "<full DeepSWE checkout commit>"
repository = "/absolute/path/to/the/task-repository"
base_commit = "<full base commit recorded in task.toml>"
image = "<task environment image including its tag>@sha256:<digest>"
verifier_image = "<verifier environment image including its tag>@sha256:<digest>"
platform = "linux/amd64"
pier = "/absolute/path/to/pier-venv/bin/pier"
```

From the Chorus root, run the controls before starting a model-backed run. The DeepSWE launcher reports a missing profile, unavailable Docker daemon, or unavailable default model.

```bash
export CHORUS_DEEPSWE_PROFILE=/absolute/path/to/deepswe.toml
.venv/bin/python -m chorus.harness.deepswe
.venv/bin/chorus launch
```

DeepSWE sessions use their own execution and prompt versions. Existing app and checked-answer snapshots retain their current readers. The DeepSWE patch lives in the session's experiment directory alongside its Git repository.
