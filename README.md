# Chorus

**A research framework for studying how AI agent swarms collaborate, disagree, and coordinate.**

Chorus is an independent research project and experimental framework for exploring how AI agent swarms interact, collaborate, and coordinate. The work investigates how traits, personalities, roles, and goals shape their behavior: how they share information, handle disagreement, reach consensus, and respond to adversarial pressure.

The research explores collaboration on short tasks and longer-running interactions, including how shared history affects coordination and responses to change. Chorus brings the experimental environment, agent interactions, evaluation, and records into one framework. Its API, CLI, and applications make that work accessible to run and inspect.

The central question is:

> Under what conditions do interacting AI agents preserve or lose independent judgment, truthfulness, and responsiveness to evidence and human intervention?

## Why Chorus exists

A conversation between agents can look collaborative while producing an incorrect decision. Agreement can reflect useful correction, repeated assumptions, or pressure to conform. A convincing explanation can coexist with an invalid final result.

Chorus is being built to investigate those differences. The aim is to connect what agents say to what they decide, what evidence they use, and what they ultimately produce.

The project began with a simple idea: give agents distinct personalities and a shared problem, then observe what happens. The research develops that idea into experiments where conditions can be varied, outcomes checked, and observations examined by others.

Success means useful experiments and defensible findings. Repeatable failures, null results, and the limits of a proposed intervention are all valuable outputs.

## Research questions

### Personality, roles, and collaboration

How do traits, personalities, and assigned roles affect information sharing, disagreement, and coordination? When does changing a persona alter a decision, and when does it change only the way an agent speaks?

### Consensus, conformity, and dissent

When does discussion improve a group's answer? Can a confident majority or an authoritative role cause an agent to abandon a correct objection? What helps useful dissent survive while still allowing mistaken agents to be corrected?

### Conflicting goals and adversarial pressure

How do agents respond when their mandates conflict, a participant becomes misleading, or the task cannot be completed as specified? Do they disclose the conflict, request help, violate constraints, or report success anyway?

### Judges, rewards, and penalties

How does evaluation change collaboration? The project explores AI and human judges, and how reward and penalty systems might influence group behavior. A stated incentive and a consequence enforced by the environment are separate experimental conditions.

### Human intervention and recovery

When a human challenges a conclusion or changes the task, does the group revise its decision and final artifact? How does behavior change after a temporary intervention is removed, particularly as agents accumulate a shared history?

These questions connect the project to AI safety through evidence use, truthful reporting, preservation of dissent, and effective human oversight.

## Chorus is the core

Chorus owns the execution rules, prompts, API contracts, model calls, validation, and persistent session records. Keeping these together gives the research a common foundation across different interfaces and problem settings.

- **Chorus:** the Python framework and execution core, with an HTTP API and CLI.
- **Nanoville:** a visual application for setting up scenarios, observing agent discussions, inspecting journals, and following a shared document.
- **chorus-web:** an application for exploring scenarios, running discussions, and inspecting their outputs.

Both applications are built on Chorus. The CLI provides another way to use the same core. Interface changes should preserve the execution rules and records needed to interpret a session.

### What is implemented today

The current engine incorporates the latest execution logic developed in Nanoville:

- Scenario and participant catalogs, with role descriptions and personality traits.
- Agent discussions with shared public history and turn limits.
- A shared Markdown canvas with validated edits and preservation of supplied scenario evidence.
- Separate observer journals, excluded from participant and judge context.
- Optional judge checkpoints and a final assessment of the written deliverable.
- Durable SQLite sessions, revisioned events, pause/resume/stop controls, and recovery after restart.
- A FastAPI API, generated TypeScript contracts, a shared client, and a terminal CLI.

These are the current building blocks for the research. Saved sessions and API event replay do not yet provide complete experimental reconstruction or deterministic model replay.

### What comes next

Research development is organized around four priorities:

1. **Trustworthy records:** exact model inputs and outputs, resolved configurations, usage accounting, and independent outcome checks.
2. **Controlled differences:** separate mandates, private evidence, authority, incentives, and model assignments for individual agents.
3. **Interventions and branches:** checkpoints, scheduled changes, human participation, and comparisons from a common recorded history.
4. **Repeated studies:** condition assignment, repeated runs, budget controls, analysis exports, and research reports.

Human judging, enforced reward and penalty systems, private evidence assignments, experimental branching, and automated study batches remain planned work. The [research architecture](docs/chorus-architecture.md#9-implementation-sequence-and-completion-evidence) describes the development priorities and completion criteria.

## Run Chorus

Requirements: Python 3.11 or newer, a Unix-like environment for the current file locking, and a running Ollama-compatible server with a configured model installed.

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp -n .env.example .env
chorus serve
```

The local API runs on **http://127.0.0.1:43187**, with interactive documentation at **http://127.0.0.1:43187/docs**.

In another terminal, activate the environment and inspect the available configuration:

```bash
source .venv/bin/activate
chorus catalog scenarios
chorus catalog agents
chorus catalog models
```

If `gemma4:e2b-mlx` is reported as installed, a short exploratory session can be run with:

```bash
chorus run ai-feature-launch \
  --participants software-engineer,product-manager \
  --model gemma4:e2b-mlx \
  --turns 5
```

This example runs an exploratory discussion. The proposed controlled study remains planned work. The default model is `qwen3.5:4b-mlx`; select an installed model explicitly if it is unavailable.

See [Running and developing Chorus](docs/running-chorus.md) for the full model list, configuration, CLI commands, API examples, frontend connections, project layout, and contract generation.

## Explore and contribute

Chorus is being prepared for an open-source release so that others can inspect the framework, challenge the methods, reproduce experiments, and build on the work.

Contributions are especially useful when they improve experimental validity: checkable scenarios, informative controls, independent evaluators, reliable recording, failure analysis, and clear documentation. Reports of surprising behavior are most useful with the scenario, model and settings, relevant session records, and steps to reproduce it.

The intended research outputs are runnable experiments, documented measurements, and reports that distinguish observation from interpretation. The project welcomes interest from people working on AI agents, swarms, coordination, multi-agent systems, and AI safety.
