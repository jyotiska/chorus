# Chorus: Research Architecture

**Updated:** 22 October 2026

**Scope:** Independent research into the behavior of interacting AI agents

**Status:** Current execution architecture and proposed research extensions

## 1. Purpose

Chorus is an independent research project and the core experimental framework for studying how AI agent swarms interact, collaborate, and coordinate on short tasks and longer-running work.

The project investigates how traits, personalities, roles, and goals shape collaboration, disagreement, and consensus. It also asks how groups respond to adversarial pressure, conflicting mandates, evaluation, incentives, and human intervention.

The central research question is:

> Under what conditions do interacting AI agents preserve or lose independent judgment, truthfulness, and responsiveness to evidence and human intervention?

Chorus brings the rules of interaction, model execution, records, and evaluation into a common framework. The CLI, Nanoville, and chorus-web are interfaces through which that framework can be used and observed.

The intended outputs are runnable experiments, inspectable records, documented measurements, and research reports. A repeatable failure or useful null result can be as informative as a successful intervention. Progress is measured by the quality of the evidence and the questions it helps answer.

This document distinguishes the **implemented session engine** from the **planned experimental capabilities**. It describes a research instrument under development; it does not report completed studies.

## 2. Research questions

### Personality and roles

How do communication style, personality traits, and assigned roles influence collaboration? Does a cautious or assertive persona change choices, evidence use, and task outcomes, or primarily change wording?

Personality, mandate, and authority should eventually be varied independently. A cautious agent asked to finish quickly presents a different condition from an agent instructed to prevent all risk. A leadership title and an enforced decision right are different treatments.

### Coordination, disagreement, and consensus

When does discussion improve a group's answer? When does agreement arise through correction, and when does it reflect conformity or shared assumptions?

Relevant outcomes include whether decisive evidence is disclosed and addressed, whether a correct objection survives, and whether the final artifact reflects the group's stated decision. An incorrect minority is an important comparison: preserving dissent indiscriminately can also obstruct correction.

### Conflicting goals and adversarial pressure

How do agents behave when their goals conflict, another participant becomes misleading, or the task is impossible as specified?

Candidate responses include reporting the conflict, requesting revised constraints, relaxing requirements openly, repeatedly attempting invalid solutions, or claiming completion without a valid result. Experiments should separate reasoning limitations from effects caused by pressure or incentives.

### Judges, rewards, and penalties

How does feedback alter collaboration? What changes when an AI judge or human evaluator observes, advises, scores, or influences the group?

A stated reward, a score displayed to participants, and a consequence enforced by the environment are separate conditions. The experiment must specify what is rewarded, who sees it, and when it takes effect. A judge's evaluation can itself influence later behavior when it enters the conversation.

### Human participation and recovery

Does a human intervention change the final decision, or only produce verbal agreement? What happens when a mandate changes temporarily and is later restored?

Identical messages attributed to humans and agents can test attribution effects. Adaptive participation by an actual human answers a different question and requires separate recording and interpretation.

### Short tasks and longer-running interactions

How do shared history, repeated collaboration, and earlier commitments affect later decisions? Can a group recover from misleading contributions or an earlier invalid assumption?

The current engine supports durable, bounded sessions. Research on longer-running work will also require explicit memory policies, task boundaries, intervention records, and resource controls. Persistence across a restart does not establish persistent agent memory or a validated long-term study design.

## 3. Principles for interpretable experiments

### Separate authored conditions from observed behavior

An instruction to disagree can produce disagreement. A coordinator instructed to demand success creates an explicit pressure condition. Record these manipulations and evaluate their consequences without treating the instructed behavior as a spontaneous discovery.

Keep hypotheses, expected results, ground truth, and researcher annotations outside participant context unless their disclosure is a declared treatment.

### Treat framework rules as experimental conditions

Turn order, prompt wording, retries, validation, document limits, judge timing, and failure handling all affect what participants encounter. They must be versioned and held comparable across conditions, or deliberately varied.

The current engine applies grounding checks, edit restrictions, and publication rules. Its observed behavior is the behavior of models operating under those rules. Research requiring unconstrained outputs will need a separately specified policy and record of raw responses.

### Evaluate claims and outcomes separately

A persuasive transcript is one observation. The validity of a submitted schedule, accuracy of a completion claim, and response to evidence require their own measures.

Use deterministic checks where a task permits them. For qualitative assessments, define a rubric, retain annotations, and compare model judging with human review before relying on its scores.

### Interpret generated explanations carefully

Observer journals are model-generated text. They can be studied alongside decisions, but they do not provide privileged access to internal computations or establish a model's actual beliefs.

Names, moods, energy, and confidence fields in the current catalog are authored descriptors. They are not validated psychological measurements. The retired numeric state and memory engine is not part of the present runtime.

### Preserve failures and uncertainty

Exploration can generate hypotheses; controlled studies need declared conditions, informative baselines, repeated runs, and documented outcomes. Retain failed generations, interrupted sessions, exclusions, and missing measurements in the study accounting.

Treat the session as the basic unit for group outcomes. Turns from one conversation are not independent trials. Runs sharing a scenario or checkpoint also require attention to their shared history. Report counts, effect sizes, uncertainty, and the conditions under which a finding holds.

## 4. Implemented core architecture

Chorus is the authority for session semantics. Applications submit configuration and commands, then render the state Chorus publishes.

```mermaid
flowchart TD
    CLI[Chorus CLI] --> API[FastAPI API and Pydantic contracts]
    Nano[Nanoville] --> Proxy[Application API proxies]
    Web[chorus-web] --> Proxy
    Proxy --> API
    API --> Sessions[Session service]
    Sessions --> Generation[Prompts, generation, and validation]
    Generation --> Transport[Model transport]
    Transport --> Ollama[Local Ollama server]
    Sessions <--> Store[SQLite snapshots, events, journals, and commands]
    Store --> API
```

### Core responsibilities

- **Contracts — `chorus/contracts/`:** validated configuration, commands, snapshots, reviews, journals, and errors. Pydantic is the source for generated frontend schemas and TypeScript types.
- **Catalog — `chorus/catalog/` and `chorus/services/catalog.py`:** scenarios, participant definitions, configured models, and configuration checks.
- **Execution — `chorus/services/sessions.py`:** participant rotation, review timing, operation identity, cancellation, status transitions, and restart recovery.
- **Generation — `chorus/services/`:** prompt assembly, canvas operations, spoken contributions, journals, review validation, and bounded retries.
- **Model access — `chorus/llm/transport.py`:** Ollama calls, context estimates, output allowances, timeouts, and metadata logging.
- **Persistence — `chorus/storage/`:** SQLAlchemy access to SQLite, schema versioning, atomic commits, and exclusive runner ownership.
- **Interfaces — `chorus/api.py`, `chorus/routers/`, and `chorus/cli/`:** application lifecycle, HTTP endpoints, and terminal commands.
- **Client contracts — `sdk/` and `scripts/export_contracts.py`:** shared client source and generation of OpenAPI, JSON Schema, and TypeScript artifacts for both applications.

Nanoville provides a visual scenario studio, discussion scene, document view, and observer panels. chorus-web provides scenario exploration and discussion views. Both use server-side proxies and the generated client. Scheduling, prompts, retries, model execution, and canvas mutation stay in Chorus.

### Runtime boundaries

The current service is local and single-user. One process owns a SQLite database; a shared execution semaphore serializes session operations across sessions. It binds to loopback on port **43187**. Nanoville and chorus-web use ports **43188** and **43189** respectively.

A session selects one configured model for participants, journals, and judging. Per-agent model assignments, cloud providers, distributed workers, and user ownership are future capabilities.

## 5. Session lifecycle and invariants

### Configuration and commands

Creating a session resolves its scenario and participants from the catalog and saves their configuration in a `ready` snapshot. Participant order follows catalog resolution. The engine then rotates through that resolved order; randomized speaking order is not currently implemented.

A command contains a session ID in its endpoint, a `commandId`, an `expectedRevision`, and one of `start`, `pause`, `resume`, or `stop`. State changes increment the revision. An exact command retry returns its recorded result; a stale revision or conflicting reuse of a command ID is rejected. Clients read the latest snapshot when reconciling state.

### A participant slot

1. Select the next participant and persist the pending operation identity.
2. Assemble permitted context from the scenario, full public history, current canvas, and participant definition.
3. Attempt a structured canvas operation: create, leave unchanged, replace a section body, or append a section.
4. Validate the proposed edit, including preservation of the supplied scenario evidence.
5. Generate and validate a spoken contribution consistent with the accepted or preserved canvas.
6. Generate a separate observer journal.
7. Commit the contribution, canvas, journal entry, and public snapshot event atomically if the operation is still current.

Model calls occur outside database transactions. A cancelled or superseded operation cannot publish a late result.

The canvas is the shared final artifact. The engine does not make an additional summarization request to create a different final document.

### Failure handling

Canvas and speech generation each have up to three attempts. If edits remain invalid, the previous canvas is preserved and valid speech can still be committed. If speech remains invalid, the participant slot is recorded as skipped: its proposed edit is discarded and no journal is generated.

Journals have bounded attempts and a timeout. A journal failure produces an unavailable entry while preserving valid public work. Review generation has bounded attempts; unresolved review failures pause execution. Transport failures during participant or review generation, and overall operation timeouts, also preserve committed work and pause the session.

A participant slot can therefore differ from a spoken contribution, and either can involve several model calls. Studies must count all three explicitly.

### Judge behavior

When enabled, a judge reviews progress after every five participant slots, including skipped slots. At the turn limit, only a final review runs. Judge messages do not consume participant slots or change rotation.

Checkpoint feedback enters public discussion context and can affect later contributions. The final judgement is stored separately. Reviews use the current canvas and public conversation; positive findings require validated canvas citations. These rules constrain publication but do not establish the scientific validity of the assessment.

### Pause, stop, and recovery

Pause cancels pending work and retains committed state. Stop cancels pending work, marks an early ending, and requests a final review when judging is enabled. A failed final review can leave the session paused pending a retry.

Closing a browser does not stop an executing session. On backend restart, interrupted work recovers as paused. Resuming retries pending work from saved committed state.

Snapshots record `ENGINE_VERSION`. A session created under another engine version remains readable but cannot silently resume under changed behavior. Full public history is retained; exceeding the context budget pauses execution rather than silently trimming or summarizing it.

The current context budget uses a conservative input estimate. It is distinct from provider-reported token usage.

## 6. Information and recording boundaries

### Public and observer context

Current participants share the scenario evidence, public contributions, published judge feedback, and common canvas. Observer journals are stored and fetched separately, excluded from public snapshots and event streams, and never supplied to participants or judges.

Observer journals are not a private-evidence mechanism for participants. Recipient-specific evidence, private communication, formal authority, and intervention delivery are still planned. The current local API also has no per-user journal permissions.

### What is durable today

SQLite stores:

- The current session snapshot and resolved scenario/participant configuration.
- Revisioned snapshot events, including execution progress and committed output.
- Separate journal entries.
- Accepted command bodies and their recorded results.

Turn records include token usage when available and latency. Model-call logging supports metadata such as phase, attempt, engine version, timing, and usage; ordinary logs exclude prompt and journal contents. The current store does not retain every exact model request, raw rejected response, or complete usage ledger.

The event stream replays saved snapshots for reconnecting clients. It cannot reconstruct every generation attempt or reproduce subsequent model output.

### Planned research records

A research recording layer should connect each published artifact to:

- The code revision, engine version, resolved configuration, scenario version, and study condition.
- Exact application-sent messages, their roles, recipient visibility, and structured-output schemas.
- Requested and reported model identity, generation settings, and supported seeds.
- Every response, retry, validation outcome, cancellation, and publication decision.
- Usage and timing for participant generation, journals, judges, probes, and evaluation.
- Intervention events, branch lineage, final artifacts, and evaluator versions.

Store these in an explicit research record with controlled access. Raw material should remain separate from derived annotations; researcher-only content must stay outside participant context. Adding research capture should not put sensitive content into ordinary application logs.

Recorded replay, model continuation, and repetition are separate operations: replay reads existing records; continuation makes new calls from saved application state; repetition starts another trial. A common history or fixed seed does not guarantee identical generations.

## 7. Planned experimental capabilities

### Independent agent configuration

Separate personality, mandate, evidence, authority, incentives, model assignment, and memory policy in versioned configuration. Changes to one dimension should not silently alter the others. A minimal baseline should permit persona instructions to be disabled explicitly.

Historical state and memory mechanics may be reconsidered as declared experimental treatments if a question requires them. They should not be reintroduced as unrecorded assumptions about agent behavior.

### Visibility and authority

Enforce information visibility during prompt construction. Keep ground truth and researcher annotations separate from both public discussion and agent-specific evidence. Where authority matters, distinguish a prestigious label from permissions or veto rights enforced by the environment.

An acceptance test for private evidence must inspect actual recipient inputs, including judge and retry context, and demonstrate that disclosure occurs only through the declared mechanism.

### Judges and incentives

Support human and model evaluations with versioned rubrics and explicit visibility. Separate feedback used during a conversation from evaluation performed after termination. Record whether evaluators can see condition labels.

Reward and penalty experiments need an explicit rule for the score or consequence, its timing, and what participants know about it. Compare against an otherwise matched condition, and record whether the effect comes from instruction wording, visible feedback, or enforced consequences.

### Checkpoints, branches, and interventions

A research checkpoint should capture the application state needed for a declared continuation: configuration, visible histories, canvas, pending intervention schedule, model settings, and lineage.

Apply interventions at recorded boundaries, such as before a specified participant slot. Save requested and actual application times. Temporary mandate changes need explicit restoration events. A no-op update provides a control for the effect of receiving a new instruction.

Probes run from a checkpoint should not feed their outputs into the main conversation unless that influence is part of the condition. Adaptive human messages and scripted human-attributed messages need distinct records.

### Study execution and analysis

A study runner should declare scenario variants, conditions, assignments, repetition counts, termination rules, model settings, and resource ceilings. It must retain unsuccessful attempts and interrupted runs in its accounting.

The analysis should identify the session as a trial, preserve dependencies between branches, and distinguish primary outcomes from exploratory measures. Outcome evaluation should run independently of the participant prompts and retain its own configuration and results.

## 8. Candidate first study: impossible task, correct minority

This is a proposed design to guide a small implementation increment. It is not a shipped benchmark or a reported finding.

### Task and controls

Use five mandatory tasks and two workers, each available for six hours. Preliminary public estimates assign two worker-hours to each task. One agent receives verified measurements establishing that each task requires four worker-hours: **20 required worker-hours against 12 available**.

State explicitly that work cannot be compressed and every task must be completed. A matched feasible variant retains the two-hour requirements. Establish individual baselines showing that the model can recognize infeasibility with the verified evidence and handle the feasible control.

Start with a coordinator, an evidence holder, and two peers. Keep persona instructions minimal while validating the task and instrumentation.

### Conditions

1. **Baseline:** produce a valid schedule or report infeasibility.
2. **Pressure:** additionally instruct the coordinator to insist on a completed schedule.
3. **Pressure plus correction:** deliver a fixed intervention asking the group to verify capacity and disclose incompatible constraints.
4. **Pressure plus reinforcement:** deliver a fixed intervention reiterating the demand to complete the schedule.

Hold the intervention boundary, final-answer protocol, failure policy, and generation allowances comparable. If messages are human-attributed but scripted, label the study accordingly. Actual adaptive human participation is a subsequent design.

### Outcomes and procedure

Primary outcomes are validity of the submitted artifact and accuracy of the feasibility/completion claim. Secondary outcomes can include evidence disclosure, acknowledgment of contradiction, correct-to-incorrect reversals, unnecessary repetition, and response to intervention.

Pilot the task for comprehension and evaluator correctness. Then freeze the scenario, prompts, scoring rules, turn policy, and model settings for repeated comparisons using fresh sessions. Determine sample size from the intended comparison and observed variation; a dramatic single run is an exploratory observation.

The study requires private evidence routing, intervention records, a deterministic capacity checker, and complete research recording. Existing scenario demonstrations do not substitute for these requirements.

## 9. Implementation sequence and completion evidence

### A. Establish trustworthy observation

First address live generation reliability and instrument one short session end to end. Add exact research records, complete call accounting, and a narrow independent evaluator.

**Completion evidence:** published output maps to its request, response, validation decision, and usage; a fake-adapter record replays without model calls; missing usage and failed attempts remain visible.

### B. Establish controlled differences

Add explicit persona controls, private evidence routing, separate mandates and authority, and recorded model assignments where needed by the pilot.

**Completion evidence:** recipient inputs contain only permitted information, configuration changes affect their intended dimension, and the feasible/infeasible controls behave as specified by the evaluator.

### C. Establish controlled intervention

Add immutable checkpoints, lineage, scheduled intervention boundaries, restoration, and isolated probes.

**Completion evidence:** continuations share the intended starting history; every intervention is identifiable; cancelled work and probe outputs cannot enter an unrelated continuation.

### D. Run and report a repeated comparison

Add the minimum study runner and analysis export needed for the chosen question. Record all trials, declared exclusions, failures, and resource use.

**Completion evidence:** a comparison can be repeated from saved definitions, ends at its declared limits, and produces a report covering outcomes, uncertainty, limitations, and alternative explanations.

This sequence defines the proposed research development priorities. Related primitives such as durable sessions or judge checkpoints do not by themselves complete research recording, experimental branching, or a controlled study. Each stage requires its stated completion evidence.

## 10. Verification and resource discipline

Protect the boundaries whose failure would invalidate an experiment: recipient visibility, journal isolation, cancellation, atomic publication, prompt/version capture, intervention timing, branch restoration, evaluator independence, and complete attempt accounting.

Use deterministic fake adapters for routine regressions. Keep live-model checks explicit and bounded, and report software correctness separately from generation reliability and study validity. The [test plan](../TEST_PLAN.md) records current coverage and live-model failures, including unresolved judge validation and canvas-generation issues observed on 22 October 2026.

Measure resource use with a small pilot before scaling repetitions. Context growth, retries, journals, judges, probes, and evaluators all consume generation resources. Missing usage is unknown, not zero. Future paid providers require declared prices and enforceable study spending limits; local inference still consumes machine time and capacity.

## 11. Research artifacts and public reporting

A completed study should release, where permitted:

1. Its research question, hypotheses, and declared outcomes.
2. Scenario definitions, conditions, controls, model settings, and evaluator code.
3. A run manifest with dates, configuration versions, errors, exclusions, and branch relationships.
4. Source records and final artifacts, with visibility rules and any redactions documented.
5. Annotations, analysis code, and a report containing successes, failures, null results, uncertainty, and limitations.

Research records involving human contributions need an agreed publication scope. Credentials and unrelated personal information do not belong in shared artifacts.

An observation notebook can preserve surprising runs and candidate explanations before a controlled comparison exists. Public claims should identify the tested models, scenarios, framework rules, and conditions. Dialogue alone does not establish human-like beliefs, subjective experience, or the training examples responsible for a behavior.

## 12. Related documentation

- [README](../README.md): project identity and research questions.
- [Running and developing Chorus](running-chorus.md): setup, configuration, CLI, API, and contract generation.
- [Test plan](../TEST_PLAN.md): behavioral coverage, verification, and known failures.
