# DeepSWE integration plan for Chorus

Run a DeepSWE task with a named Chorus roster, see whether the final patch passes, and inspect what each agent contributed. Run a batch with the same task IDs across configurations and compare the percentage resolved at the same total budget. Start with one TypeScript task and use the same execution path for single tasks, batches, and repeats.

## What a run looks like

The first interface is the Chorus Runs CLI and its existing browser viewer. The commands below show the proposed interface and run from the `chorus-runs` checkout with the Chorus engine running.

```sh
# Discover supported tasks in the pinned DeepSWE release.
python3 runs.py deepswe list --language typescript

# Run one task once with a named roster and explicit limits.
python3 runs.py deepswe run --id match-each-smoke --task ts-pattern-match-each \
  --roster coding-team --max-calls 60 --timeout-minutes 30

# Preview, then run a saved task × configuration × repeat matrix.
python3 runs.py plan examples/deepswe-pilot.json --dry-run
python3 runs.py batch examples/deepswe-pilot.json
python3 runs.py status deepswe-pilot
python3 runs.py view
```

`coding-team` is a named roster in the run configuration. Dry-run shows the exact task IDs, roster and model for each condition, trial count, and maximum calls before dispatch. A batch can list task IDs explicitly or use a language filter and fixed sample seed, then save the resolved task list. A one-task run creates a one-trial campaign so it can be inspected, resumed, and exported through the same interface. The command prints the outcome, test counts, and session link when the trial finishes.

## Where the integration belongs

- **Chorus engine** owns task selection and validation, workspace preparation, roles and tools, budget enforcement, the frozen patch, and the recorded grade. Add a repository experiment type alongside app experiments. Reuse the Plan and Build phases, per-agent Git worktrees and local pull requests, and frozen evidence. Current app prompts assume a Next.js and Express starter, and the write tool restricts edits to `frontend/` and `backend/`. Give repository experiments their own task prompt and repository-relative file permissions. [Experiment runtime](../chorus/harness/experiment.py) · [Workspace tools](../chorus/harness/experiment_tools.py)
- **Pier** runs the official DeepSWE task and verifier. Use the pinned custom-agent interface for a small patch submission adapter. Chorus generates the patch, and the adapter applies and commits it in the pristine task environment. Pier's collection hook then hands the committed diff to the separate verifier. [DeepSWE task and result format](https://github.com/datacurve-ai/deep-swe#task-format) · [Pier custom-agent option](https://github.com/datacurve-ai/pier/blob/main/src/pier/cli/jobs.py)
- **Chorus Runs** owns the campaign manifest, sequential queue, repeat scheduling, report, and comparisons. Add a repository-task path to the current runner and viewer. Reuse their trial linking and export mechanisms. Persist source refs, grades and artifact digests in the run records and keep bulk patches and logs in the ignored or external artifact store configured for the study. [Chorus Runs workflow](../../chorus-runs/README.md) · [Campaign runner](../../chorus-runs/campaign.py)

## Milestones

### 1. Prove the grading path on one task

1. Pin a DeepSWE revision, a compatible Pier release, and the image digest and platform. Start with `ts-pattern-match-each`, which has a pinned base commit, a clearly specified TypeScript API, and a separate verifier. The task config collects the diff from the base commit to `HEAD`, so patch replay needs to commit the changes. [Task brief](https://github.com/datacurve-ai/deep-swe/blob/main/tasks/ts-pattern-match-each/instruction.md) · [Task configuration](https://github.com/datacurve-ai/deep-swe/blob/main/tasks/ts-pattern-match-each/task.toml)
2. Run the reference and empty-patch controls without model calls. Then send those same patches through the replay adapter. Use a deliberately incorrect patch to check that verifier failure details reach the run report. Confirm that local Docker supports the pinned image on the development machine. Use a compatible Linux runner if the image fails on Apple Silicon.
3. Read `reward.json` and keep the structured test report and verifier output. Accept an official `reward` of `1` or `0`. Verify the pinned task's error contract, including its `-1` crash sentinel. A replay failure that shows the adapter changed the patch or started from the wrong tree is an integration error. A patch the official verifier rejects on the correct base is an unresolved trial. [Reference grader](https://github.com/datacurve-ai/deep-swe/blob/main/tasks/ts-pattern-match-each/tests/grader.py)

**Ready when** the reference scores 1, the empty and incorrect candidates score 0, a verifier crash is recorded as an error, and the same patch can be regraded without contacting a model.

### 2. Run one DeepSWE task through Chorus

1. Add a task registry for the pinned local checkout. Store the task ID, brief, language, repository URL, base commit, image digest and platform, and verifier version. Create sessions from registered task IDs. Materialize the verified task checkout with repository paths preserved. Use a clean Git history for Chorus and confirm its baseline tree matches the replay environment. Keep the shared Chorus plan outside the task's Git tree so a repository-owned `SPEC.md` stays available as ordinary source. The benchmark inputs visible to agents are the brief and worktree. Keep reference solutions, grader code, hidden tests, external remotes, and credentials outside the tools agents can access. Inspect the prepared workspace during preflight.
2. Reuse Chorus's shared plan, board, worktrees, and PR flow. Give solo and team conditions the same task prompt and repo capabilities. In the first wiring test agents can inspect and edit files. Before the comparison pilot, add a Build tool for named public checks such as compile or unit tests. The engine chooses each command from task configuration and runs it against the agent's worktree snapshot in a disposable copy of the benchmark environment, with bounded output and runtime. Log the check result with the agent and candidate revision. The final verifier stays outside the agent loop.
3. Enforce the total model-call cap and deadline inside Chorus. Count dispatched requests and retries against the shared cap across planning, coding and integration. Reserve calls before dispatch, stop new work when the limit is reached, and freeze the latest integrated commit under the existing cancellation fence. Persist the budget across restarts and record tokens, latency and cost using the existing usage ledger. Grading runs under its own timeout.
4. Record the final commit, evidence cursor and a binary-safe base-to-final Git diff with its digest. Keep Chorus planning metadata out of the patch. Submit exactly that artifact to Pier. Expose the verifier state, official reward and test counts in the session result, alongside links to the patch and evidence. Keep the repository-run process review optional and outside the score. Recovery resumes the pending stage from persisted state and retries grading against the same patch digest. A retry can reuse a valid saved grade without rerunning participants.

**Ready when** a fake provider drives an end-to-end repo edit through local PR merge, freeze, real verification and result display. Reopening the session shows the same commit, score and trace, and app experiments and saved sessions still pass their existing checks.

### 3. Run batches and compare teams

1. Extend the Chorus Runs manifest with the pinned benchmark version, task list, participant/model configurations, seed, repeats, total model calls per trial and timeout. Queue the expanded task × configuration × repeat matrix sequentially first. Use a durable trial key and idempotent session creation so an interrupted create request reconnects to the same session. Record trial, grade attempt and Chorus session IDs. Resume pending work without repeating completed model calls or silently resetting limits.
2. Show one headline **resolution rate** per configuration and the percentage-point difference from the solo baseline. The browser report also shows per-task outcomes and repeat counts, new and regression test results, duration, calls, tokens, spend coverage and terminal reason. Link each trial to the frozen patch and Chorus session. Use valid outcomes from the same task/repeat slots for a provisional comparison and show coverage. Mark the comparison complete once all planned slots have a valid result.
3. Show each agent's merged PRs, reviews and cited changes, public checks run, usage, and open tasks. Offer an optional evidence-based review of task ownership, material review findings and follow-through, with links to the relevant records. The task grade belongs to the team submission. Changes in a particular agent or role can be tested in a named roster condition with the rest of the experiment held fixed.
4. Add a DeepSWE task picker to Chorus Web after the CLI path and report are stable. Let the user choose one or several tasks, a saved roster or comparison, limits and repeat count. Start browser requests through the same Chorus Runs queue as CLI requests. The results view opens the campaign report and each trial's PRs, checks and final grade.

**Ready when** a two-task batch can run, be interrupted and resumed, and produce the same report after reloading. Each trial exposes exactly one final patch and one authoritative grade. The user can launch and inspect a single trial and a multi-task batch, and can identify which agents' work reached the final commit.

## Scoring rules and first pilot

- **Trial.** Use the official binary reward for the one submitted patch. A time or call limit can still yield a passing final patch. An empty final patch at the limit is evaluated as an empty submission. A verifier crash, environment error, or researcher cancellation without a submitted patch is ungraded and visible in coverage. Retry transient verifier failures on the frozen patch at most once by default. Use the grader's new-test and regression-test counts as diagnostics. [DeepSWE output contract](https://github.com/datacurve-ai/deep-swe#task-format)
- **Campaign.** Average the binary results across repeats within a task, then average across tasks and multiply by 100. Each task has equal weight. For example, two tasks with repeat records of `2/3` and `1/3` produce a 50% resolution rate. Fix task IDs, model, tools, budget and grader across the conditions. Once several trials exist, show the paired change by task so the headline score can be traced back to specific wins and losses.
- **Pilot.** First run one TypeScript task as a solo and team smoke check. Then freeze 10 tasks spanning focused fixes and cross-module changes. Compare one general agent with a three-agent Chorus roster, with three repeats per task and the same total call and time limits per trial. That is 60 trials. Interleave conditions within task and repeat blocks. Review smoke usage before setting pilot limits, report observed token and spend differences, and keep tuning tasks in a separate development set. Add a same-size independent-agent condition with a fixed selection procedure if the next question is whether communication adds value beyond multiple independent attempts.

## Verification before the pilot

- Cover task metadata and path validation, the workspace baseline, binary diff replay, isolation of hidden files, and all supported grade and error states. Confirm the adapter neither changes the official verifier nor exposes verifier output to participants.
- Exercise cancellation during a model call and during verification, restart after the patch freezes, interrupted session creation, and replay after a grader error. Verify that calls and trials are counted once and late results cannot override a cancelled or superseded attempt.
- Test single-task and batch flows with fake participants and a small fixture. Run the real task's reference and empty controls separately from routine tests. Check both CLI and browser against the same reports and confirm ordinary app and checked-answer benchmark sessions remain readable.
