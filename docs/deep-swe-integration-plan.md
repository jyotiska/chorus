# Run DeepSWE with Chorus

The source launcher supports locally pinned tasks, configurable participant slots, and repeated campaigns on a selected task. The six-agent setup is the default. An empty-body API request selects the default task and fixed team. Configured runs use `deepswe-v5` with saved guidance and per-worker model selections. Campaign manifests, trial links, and grades persist in SQLite.

## What the researcher sees

1. Choose **DeepSWE** as the problem source on the Chorus home screen. Select a registered task to see its public instructions, an editable roster, model choices, and the run limits. The existing app and **Other** briefs are available from the default source.
2. Start the run and follow **Plan → Build → Verify** in the existing session workspace. The board, shared plan, worktrees, and local PRs show how the team worked. Reopen the same session from its URL or the archive.
3. Open **Results** to see **Passed**, **Failed**, or **Ungraded**, the frozen patch, test totals when available, and agent usage. A verifier error includes a retry action that uses the same saved patch.

## Calibrate the grader

Use a pinned DeepSWE checkout, the TypeScript task's pinned repository base and image digest, and a pinned Pier installation. A trusted operator configures these locally on a Docker-capable host. Use a compatible Linux host if the task image cannot run locally.

Run the upstream reference and empty controls without model calls. Run the patch replay adapter against the reference, empty, and incorrect submissions. Require rewards of **1**, **0**, and **0** respectively, and verify the replayed Git tree. Exercise the error path for verifier failures and missing or invalid rewards. Only a valid binary verifier reward can produce a pass or fail. [Datacurve run guide](https://deepswe.datacurve.ai/run) · [Task configuration](https://github.com/datacurve-ai/deep-swe/blob/main/tasks/ts-pattern-match-each/task.toml)

## Reproduce a trial

Chorus records the task revision, image and base pins, effective models and team, call and time limits, submitted Git tree and patch digest, and grading result. Each trial starts from a fresh copy of the pinned base. The agents edit through Chorus tools, and Pier grades the frozen patch in an isolated verifier. Keep hidden tests and reference patches outside agent worktrees. [Integration architecture](chorus-architecture.md)

Reaching the shared call limit stops new calls. Calls already admitted may publish before the solving deadline. Chorus freezes the integrated `main` commit for grading. Retrying a verifier failure grades the same patch with the saved task and verifier pins. Keep the matching profile installed for retries. [Grading adapter](../chorus/harness/deepswe.py)

## Configure and compare campaigns

The empty-body create endpoint uses the original roster, default model, 120-call limit, and 30-minute solving window. A configured request can select a task, participant slots, a default model, per-worker model overrides, and shared limits. Each worker has a separate worktree and can use neutral guidance, a role alone, or a full profile. [API reference](chorus-manual.md#8-cli-http-api-and-sdk-reference)

The saved campaign manifest identifies the task and verifier pins, conditions, repeat count, and ordering seed. Trials run in seeded repeat blocks. Closing the browser leaves the campaign running. Reopen it from **Saved campaigns** to inspect the results, repeat the campaign, or export the report. [Campaign walkthrough](chorus-manual.md#6-run-and-compare-deepswe-trials)

The resolution rate is the share of graded trials with a passing reward. A missing reward, infrastructure failure, or cancellation is ungraded. Paired comparisons use repeats graded in both conditions with compatible task and verifier revisions. Review matched coverage, elapsed time, and actual cost alongside resolution rate. Equal call limits can produce different costs.

## Local verifier setup

Use a source installation of Chorus with access to a Linux Docker daemon. Check out the DeepSWE release and fetch each matching repository base into a separate local Git repository. Resolve the image references from each pinned task manifest to immutable digests for your worker's platform. If `tests/Dockerfile` uses the task image as its base, set both pins to that digest. The worker pins the `FROM` line and builds the separate verifier with the official test files. Install `datacurve-pier==0.3.1` in a separate Python 3.12 virtual environment. Keep the checkouts and profiles outside the Chorus repository.

```toml
task_id = "ts-pattern-match-each"
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
export CHORUS_DEEPSWE_PROFILES_DIR=/absolute/path/to/profiles
.venv/bin/python -m chorus.harness.deepswe --profile "$CHORUS_DEEPSWE_PROFILES_DIR/task-id.toml"
.venv/bin/chorus launch
```

Name each additional file `<task-id>.toml` and set `task_id` to match. Legacy default profiles that omit `task_id` select `ts-pattern-match-each`. Set `CHORUS_DEEPSWE_PROFILE` to choose the default task. With only a profile directory configured, the first valid task in filename order is the default.

DeepSWE sessions use their own execution and prompt versions. Existing app and checked-answer snapshots retain their current readers. The DeepSWE patch lives in the session's experiment directory alongside its Git repository.
