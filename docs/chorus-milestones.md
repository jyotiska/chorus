# Chorus: Technical Milestones

**Date:** 13 September 2026

**Status:** Proposed implementation plan; all R-series milestones are planned

**Companion:** [Research direction](chorus-architecture.md)

## 1. Objective and scope

Build the foundation for controlled experiments on personality, social pressure, conflicting mandates, private information, mid-conversation interventions, and human participation.

The research direction defines what Chorus will investigate and the limits of its claims. This document defines what needs to be built, in what order, and how completion will be demonstrated.

The initial target is a reproducible study of an impossible scheduling task in which a minority agent holds decisive evidence. The framework must record what each agent knew, support controlled interventions, and evaluate submitted outcomes independently of how convincing the conversation sounds.

The existing implementation is the starting point. These milestones replace the previous M0–M9 roadmap. R-series labels distinguish proposed research work from earlier implementation history. No R milestone is complete merely because a related primitive already exists.

There are no calendar estimates yet. Size the work after establishing the baseline and scoping the first end-to-end increment. CLI commands and field names below are proposed interfaces, not currently available functionality.

## 2. Implementation principles

1. **Preserve experimental evidence.** Store original requests and outputs before interpretation; derived analyses never overwrite source records.
2. **Make application behavior explicit.** Personality, numeric state, memory, truncation, and speaking order are recorded treatments.
3. **Separate information by recipient.** Private evidence cannot enter shared context or another agent's memory until explicitly communicated.
4. **Keep evaluation independent.** Ground truth, hypotheses, scoring rules, and researcher annotations remain outside agent-visible context unless deliberately included by the experiment.
5. **Distinguish replay from generation.** Recorded replay is deterministic; continuing a saved conversation with a hosted model generally is not.
6. **Count every generation.** Turns, probes, finalization, judges, and retries all consume the study budget and appear in records.
7. **Build only what a question requires.** Keep round-robin scheduling and local storage until evidence justifies more complexity.
8. **Preserve CLI usability.** Existing YAML sessions remain supported or receive a clear, tested migration path.

## 3. Sequence and dependencies

- **R0 — Baseline and controls:** reproducible setup and optional behavioral mechanics.
- **R1 — Recording and cost accounting:** exact inputs, outputs, usage, and replay.
- **R2 — Agent isolation:** private evidence, mandates, authority, and model assignment.
- **R3 — Checkpoints and interventions:** branching and precise changes during a session.
- **R4 — Scenarios and evaluation:** checkable tasks and independent outcome measurement.
- **R5 — Experiment runner:** repeated conditions, spending controls, and failure accounting.
- **R6 — First controlled study:** validation of the instrument and a research report.
- **R7 — Human participation and recovery:** extensions informed by initial findings.

R0 precedes R1. R2 builds on R1's records. R3 requires R2's visibility and configuration contracts. R4's pure evaluator can be developed after R0, while its session integration requires R2. R5 joins R1–R4. R6 uses the complete pipeline. R7 follows review of R6 findings.

Bring a narrow example through the milestones. Manually inspect pilot runs before investing in a general-purpose experiment framework.

## 4. R0 — Baseline and configuration controls

### Purpose

Establish current behavior and make framework-induced behavior independently switchable.

### Deliverables

- Document a supported Python environment and install the declared development dependencies.
- Run the existing suite; characterize session, prompt, parser, and memory behavior with deterministic fake adapters.
- Validate all bundled agent and session templates without paid API calls.
- Add explicit settings for personality instructions, numeric state dynamics, memory injection, and conversation retention.
- Retain an explicit compatibility configuration for legacy scenarios. Define a minimal research baseline without persona nudges, numeric state dynamics, or memory consolidation.
- Define one turn as one public agent contribution; track model calls separately.
- Introduce stable agent identifiers independent of display names. Validate empty groups, duplicate identifiers, and unsupported or conflicting settings before generation.

Disabling personality must remove the entire persona-specific instruction layer while preserving mandates and facts. Disabling memory injection must not accidentally remove ordinary conversation history. Record the selected retention policy in both cases.

### Main code areas

`chorus/core/types.py`, `chorus/config/loader.py`, `chorus/core/agent.py`, `chorus/prompts/pipeline.py`, state and memory modules, and tests.

### Acceptance criteria

- Legacy sessions run with fake adapters under the compatibility configuration.
- Each control changes only its intended prompt or state mechanism.
- Fixed fake responses reproduce application events and final artifacts.
- Invalid configurations fail before generation begins.
- Existing state rules are either retained as documented treatments or corrected with a recorded behavior-version change.

New personality taxonomies, learned emotions, and trust graphs are outside this milestone.

## 5. R1 — Run records and usage accounting

### Purpose

Make each session auditable and establish its actual cost.

### Deliverables

Introduce versioned, validated records for manifests, generation requests/results, public messages, state/memory changes, and run outcomes.

Extend the adapter result beyond a string to include raw text, provider response ID when available, requested/reported model, settings, timestamps, latency, completion status, stop reason, reported token usage, and errors.

Preserve provider-specific usage semantics. Do not double count reasoning tokens when already included in output totals. Missing usage is unknown, not zero. Distinguish measured, estimated, and unknown cost.

Record exact application-sent prompts and roles, including retained history, memory selections, and truncation decisions. This captures what Chorus sent, not undisclosed provider instructions.

Start with local run directories containing a manifest, append-only JSONL events, and artifacts. Use atomic snapshot writes. Avoid adding a database until workloads justify it. Never serialize credentials, authorization headers, or entire provider clients.

Save resolved configuration content and hashes, scenario version, code revision and dirty-tree status, dependency versions, dates, and applicable seeds. Store the pricing version and assumptions used for each cost estimate.

### Public/private response boundary

Raw outputs and generated private commentary belong in researcher records. Only validated public contributions enter other agents' contexts.

The current raw fallback can publish an entire unparsed response. Research mode must instead record a parse failure and apply a declared retry, skip, or failure policy. It must not silently broadcast private commentary. Use the same failure policy across compared conditions.

### Proposed CLI

- `chorus run --session <path> --record --output-dir <path>`
- `chorus runs inspect <run-id>`
- `chorus runs replay <run-id>`

Replay makes no model calls.

### Acceptance criteria

- Every public contribution maps to an exact request, raw response, parse result, and agent ID.
- Recorded fake-adapter sessions replay offline.
- Tests cover cache accounting, reasoning-token overlap, missing usage, and retries.
- Interrupted runs preserve interpretable partial records and accurate status.
- Parse failures cannot leak generated private commentary to peers.

## 6. R2 — Private information, mandates, and model assignment

### Purpose

Make differences between agents real and inspectable.

### Deliverables

- Separate public context, agent-private evidence, personality, mandate, and authority in configuration.
- Route messages by explicit visibility and stable recipient IDs.
- Build agent histories and memories exclusively from permitted observations.
- Keep researcher ground truth, hypotheses, annotations, and evaluation outputs separate from prompt assembly.
- Support per-agent providers, models, and settings through an adapter factory, retaining session defaults for compatibility.
- Validate provider capabilities before scheduling. Never silently replace a model or unsupported setting.
- Preserve fixed order and add seeded, recorded order assignment as an experimental option.
- Define a final-decision protocol that distinguishes a designated decision maker, individual choices, and an explicit vote.

An authority title changes a prompt; enforced decision rights change the application. Record these separately. Initial private information can be researcher-assigned evidence; unrestricted private conversations can follow when a question requires them.

### Main code areas

Configuration models, prompt assembly, session routing, memory observation, `chorus/llm/`, and CLI agent construction.

### Acceptance criteria

- Distinctive private facts are absent from unauthorized prompts, histories, and memories.
- Explicitly published evidence becomes visible through the public message.
- Mocked mixed-provider sessions use the configured adapters and settings.
- Evaluation ground truth never enters a request unless deliberately disclosed.
- Display-name changes do not affect attribution or permissions.
- Final artifacts distinguish one agent's recommendation from collective agreement.

## 7. R3 — Checkpoints, branches, and interventions

### Purpose

Compare controlled changes from a common recorded conversational history.

### Deliverables

Define serializable checkpoints containing resolved configuration, prompt-policy versions, public/private histories and visibility, numeric state, memories, counters, speaking-order/random-generator state, applied/pending interventions, finalization status, and budget references.

Record parent run, checkpoint, and branch identifiers. Preserve parent checkpoints immutably. Reconstruct provider clients from configuration and credential references; do not serialize live clients.

Represent interventions with an ID, target, exact boundary, visibility, instruction layer, payload, and optional end boundary. Initial types:

- Change personality or mandate.
- Reveal evidence or deliver a private fact.
- Inject a public/private scripted human message.
- Restore a prior value after a temporary change.
- Apply a no-op update as a control.

Use timing such as "after contribution 8 is recorded and before contribution 9 is generated." Failed generations and skipped calls are counted separately. Apply events exactly once after resume as well as during uninterrupted runs.

For overlapping temporary changes, define a restoration stack or reject the overlap before execution. Restoration must not silently overwrite a later intervention.

Add isolated checkpoint probes whose outputs never enter the main continuation. Charge their generation to the parent study budget.

### Proposed CLI

- `chorus runs branch <run-id> --checkpoint <id> --intervention <path>`
- `chorus runs resume <run-id>`

### Acceptance criteria

- Checkpoint round trips preserve application state using fake adapters.
- Branches cannot mutate each other's histories or memories.
- Interventions and restorations occur exactly once at declared boundaries.
- No-intervention branches match baseline application behavior under deterministic fake generation.
- Probes cannot contaminate main-branch prompts or memories.
- Resume never silently repeats an already recorded completed call.

If a provider accepted a request but its response was not saved before a crash, mark the attempt uncertain. A retry is a new recorded attempt that may incur another charge and produce a different answer.

Checkpoint support guarantees application reconstruction. It does not restore hosted models' hidden state or guarantee identical future generations.

## 8. R4 — Checkable scenarios and evaluation

### Purpose

Connect dialogue behavior to measurable outcomes.

### Deliverables

Introduce versioned scenarios with public facts, private assignments, allowed actions, final-artifact schemas, researcher-only ground truth, and evaluator configuration.

Implement the first scheduling family:

- Five mandatory tasks and two workers.
- Six hours of capacity per worker before the deadline.
- Preliminary estimates of two worker-hours per task.
- A private verified correction to four worker-hours per task in the infeasible variant.
- A matched feasible variant and explicit non-compressible worker-hour requirements.

Define final fields for feasibility, assignments, requested constraint changes, and disclosed violations. Check artifacts independently of prose. Requesting a changed task is distinct from completing the original one.

Implement deterministic checks for capacity, task coverage, deadline, and worker overlap where relevant. The first infeasibility proof is the simple capacity deficit: 20 required worker-hours against 12 available. A general solver is unnecessary initially.

Keep separate outcomes for valid completion, accurate infeasibility, invalid solution, false completion, malformed artifact, and operational failure. Declare how each enters analysis rather than silently dropping missing answers.

Define qualitative rubrics for evidence disclosure, responses to objections, demands to concede, and position changes. Store annotator/evaluator versions and corrections as derived records.

### Acceptance criteria

- Handwritten valid, infeasible, invalid, and malformed examples receive expected classifications.
- Label and order variants preserve ground truth.
- The private correction is decisive and unambiguous.
- Persuasive explanations cannot make invalid schedules pass.
- Final claims are evaluated separately from artifact validity.
- Qualitative labels link to exact supporting messages.

## 9. R5 — Experiment runner and budgets

### Purpose

Repeat conditions without configuration drift or uncontrolled spending.

### Deliverables

Define experiment specifications covering scenario versions, conditions, models, repetitions, randomized assignments, interventions, finalization, primary/secondary outcomes, evaluators, budgets, concurrency, retries, and exploratory versus frozen mode.

Resolve and save every planned run before generation. Hash the study specification. Changes after collection begins create a new version rather than silently changing pending runs.

Resume completed runs idempotently and partial/uncertain runs explicitly. Preserve failures and exclusions. Do not regenerate uninteresting or unsuccessful sessions until a desired result appears.

Implement a study-wide budget ledger shared by branches, probes, finalization, judges, and retries. Reserve a conservative request allowance before dispatch, based on input estimates and enforced output limits; reconcile with actual usage afterward. Concurrent requests must not spend the same remaining allowance.

Use call/token limits alongside monetary limits. Reserve a margin for estimation error and uncertain charges. If an adapter cannot provide a trustworthy bound, reject strict-budget mode or require an explicit conservative fallback policy. The local cap controls dispatch; it cannot guarantee delayed provider billing behavior.

Disable automatic model fallback in controlled studies. An outage produces a recorded failure or versioned reschedule, not a silent change in experimental condition.

### Proposed CLI

- `chorus experiment validate <path>`
- `chorus experiment estimate <path>`
- `chorus experiment run <path>`
- `chorus experiment resume <experiment-id>`
- `chorus experiment export <experiment-id>`

### Acceptance criteria

- Mocked condition matrices produce exact expected assignments and counts.
- Resume does not duplicate completed runs.
- Concurrency cannot bypass shared reservations.
- Failures remain visible in exported denominators.
- Every generation is charged to the study ledger.
- Frozen configuration changes are detected before continuation.
- Estimates state assumptions and are compared with measured pilot usage.

## 10. R6 — First controlled study and report

### Purpose

Demonstrate that Chorus can answer a bounded research question.

### Deliverables

- Pilot the impossible-task/minority scenario and verify individual baselines and feasible controls.
- Manually inspect prompt visibility, intervention timing, outcomes, and costs.
- Freeze the specification, primary outcomes, error policy, and analysis plan.
- Run baseline, pressure, corrective-intervention, and reinforcing-intervention conditions.
- Choose repetitions and models using pilot variability and budget. Twenty repetitions is a planning value, not a guarantee of statistical adequacy.
- Analyze final validity and completion/feasibility claims as primary outcomes. Treat discourse annotations as secondary unless declared otherwise.
- Produce a report with counts, effect estimates, uncertainty, representative cases, failures, and limitations.

Sessions are the unit for group outcomes. Account for shared scenarios and checkpoint ancestry; turns and related branches are not independent trials. Separate exploratory follow-up analyses from frozen comparisons.

Use deterministic scheduling checks. If model judges assist with qualitative labels, validate them against manually labeled examples and withhold treatment labels where practical.

### Acceptance criteria

- Another reader can understand every condition from the saved specification.
- Reported numbers regenerate from records without new model calls.
- A small fresh replication can be launched from saved configuration, subject to model availability.
- Successes, failures, null findings, and ambiguity are represented honestly.
- The report identifies which claims apply only to the tested setup.

Completion requires a reliable instrument and a defensible report, not a positive or surprising effect.

## 11. R7 — Adaptive humans and recovery studies

### Purpose

Extend toward the project's distinctive questions after validating the basics.

### Candidate deliverables

- A participant interface with public/private messages, declared authority, and recorded arrival/application times.
- Identical-message replay with human versus agent attribution.
- Actual adaptive human sessions recorded separately from scripted attribution conditions.
- Temporary mandate changes followed by restoration and repeated continuations from common checkpoints.
- Experiments on whether prior interaction history changes reliance on a changed agent.
- Inspection of the evidence and messages preceding decision changes.

Select one extension based on initial findings. Avoid combining every dimension in the next study.

### Acceptance criteria

- Human delivery follows the same visibility and recording rules as other interventions.
- Pauses cannot silently change turn-based treatments.
- Actual humans and human labels remain distinguishable in exports.
- Recovery analyses include appropriate unchanged controls.
- Transcript handling and compensation are defined before recruiting external participants.

## 12. Technical organization and lifecycle

Keep existing modules as the starting point:

- `core/`: validated types, identity, state, and memory containers.
- `config/`: versioned loading and capability validation.
- `llm/`: adapters, usage normalization, and capability descriptions.
- `prompts/`: recipient-specific assembly and retention policies.
- `orchestration/`: turn lifecycle, routing, checkpoints, and interventions.
- `parsing/`: public/researcher response separation.
- `cli/`: thin command interfaces.

Add `recording/`, `experiments/`, and `evaluation/` when their milestones require them. These names are proposals; avoid empty scaffolding for the entire roadmap.

The intended lifecycle is:

1. Resolve configuration and initialize records and budget.
2. Apply due interventions at the declared boundary.
3. Select the speaker using the recorded policy.
4. Assemble permitted context and record the request.
5. Reserve budget, generate, and record results/usage.
6. Validate the public contribution or apply the declared failure policy.
7. Deliver to permitted observers and update enabled mechanics.
8. Persist events/state and checkpoint at the configured boundary.
9. At termination, obtain declared final artifacts and evaluate them.
10. Finalize status, derived results, and reconciled costs.

## 13. Verification strategy

Protect experimental validity with tests for information isolation, parser privacy, intervention timing, restoration, resume, checkpoint immutability, probe isolation, independent outcome checking, usage accounting, budget concurrency, and faithful provider settings.

Use fake adapters for routine integration tests. Keep live-provider smoke tests bounded, explicitly invoked, and separate from unit tests. Measure usage with a small pilot before substantial batches.

Do not write tests that merely restate implementation details. Test the invariants whose failure would invalidate a research conclusion.

## 14. Deferred work

The initial program does not require a commercial application, hosted accounts, a general task-execution framework, a full dashboard, learned personality models, a universal trust score, persistent agent societies, fine-tuning, activation-level interpretability, distributed infrastructure, or a production database.

Introduce these when a defined question requires them. The most useful eventual visual interface would support pausing, examining agent knowledge, applying an intervention, and comparing continuations; it is not a prerequisite for the first study.

## 15. First implementation increment

Begin with R0 and a narrow R1 slice:

1. Establish the existing test baseline and validate templates.
2. Add research controls and stable IDs while preserving legacy sessions.
3. Introduce structured generation results with usage availability.
4. Record exact requests, raw outputs, public messages, and status.
5. Replay a short fake-adapter session and inspect its records.

This increment makes one conversation trustworthy to inspect. Private evidence, checkpoints, and the first experiment then build on that foundation.
