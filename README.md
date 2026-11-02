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
- **chorus-web:** the primary interface for selecting problems and agents, running experiments, and inspecting their records and evaluation.
- **Nanoville:** the same experiment workspace with an animated scene for up to fifty participants.

Both applications are built on Chorus. The CLI provides another way to use the same core. Interface changes should preserve the execution rules and records needed to interpret a session.

### Independent agent harness

The default harness has 50 first-name personas, five objectively checked problems, and GPT-6-Luna as its default model. Selecting a problem chooses five relevant agents; edit that roster before starting. Each agent has an independent turn cap and works through a flat, concise message board and a locked shared canvas.

Each technology, science, or business persona has a background introduction, personality, traits, strengths, weaknesses, and an original portrait. These details form part of its system prompt. A session supports 2–50 selected agents and 1–100 turns per agent, defaulting to ten. Agents run independently; provider request capacity limits simultaneous model calls without imposing a speaking order.

Board posts are one or two sentences, at most 60 words and 400 characters. Agents can address another selected participant with @Name. A canvas edit requires an exclusive expiring lockfile lease and produces an attributed version/diff. Energy and confidence are removed from new runs.

SQLite stores session configuration, persona snapshots, conversations, structured reasoning summaries, tool traces, board messages, canvas history, model requests/outputs, per-call accounting, and final evaluation. Summaries describe stated decisions and assumptions; they do not expose private internal reasoning. The final judge can read new summaries; peers cannot. Historical observer journals retain their original visibility.

Every model call records input/output/cached tokens, cache use and utilization, latency, outcome, and reported or estimated cost. Aggregates come from the unique call ledger and distinguish unknown metadata from zero. The final judge starts after all participants stop. Deterministic checks establish answer correctness; the judge separately grades board collaboration and each agent's observable work.

### Five verifiable problems

- `deployment-schedule`: schedule jobs under dependency and worker constraints, reaching the optimal completion time.
- `transaction-ledger`: deduplicate transactions and reconcile account balances and net receipts.
- `reservoir-mixture`: solve volume, ratio, and concentration constraints for three reservoirs.
- `production-mix`: find an optimal integer production plan within resource and demand limits.
- `process-inference`: calculate evidence probability and a Bayesian posterior from supplied observations.

Each problem supplies its answer schema. The final canvas must contain exactly one fenced `solution` block holding the JSON answer. The checker evaluates format, constraints, and outcome independently of the narrative judge.

## Run Chorus

Use Python 3.11+ and Node 24 for the frontends. From this repository:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp -n .env.example .env
```

Preserve any existing `.env`. Configure `CHORUS_API_KEY` for Luna, `OPENROUTER_API_KEY` for OpenRouter, or `OLLAMA_HOST` for installed local models, then start the backend:

```bash
chorus serve
```

Keep credentials in Chorus's backend environment. Missing Luna access requires an explicit alternative selection. Ollama is needed only for local models.

The local API runs at **http://127.0.0.1:43187**. chorus-web runs at **43189** and Nanoville at **43188**. Both home pages use the new harness; Nanoville includes 50 custom animated sprites and a zoomable large-cast scene.

In either sibling frontend, copy `.env.example` to `.env.local` if needed, run `npm ci`, then `npm run dev`. The server-side `CHORUS_API_URL` points to the backend. For production mode, run `npm run build` followed by `npm run start`. The backend health endpoint is `/health`, and interactive API documentation is at `/docs`.

```bash
chorus catalog scenarios
chorus catalog agents
chorus catalog models
chorus run production-mix --turns-per-agent 3
chorus run transaction-ledger --participants quinn,reese,blair --turns-per-agent 2
chorus inspect SESSION_ID --records summary --agent quinn
chorus control SESSION_ID pause
chorus control SESSION_ID resume
chorus export SESSION_ID session.json --format json
chorus export SESSION_ID solution.md --format markdown
```

The default CLI run uses the problem's relevant agents, Luna, and final judging. Use `--no-judge` to disable narrative grading while retaining deterministic verification, or `--model` to choose another configured model. `--turns` is rejected with a migration hint.

## Session controls, records, and limits

Pause cancels pending work and keeps committed posts, edits, summaries, and consumed budgets. Resume continues within those budgets. Stop ends participant work early and evaluates the saved result. Closing the browser leaves execution running; Back to setup pauses active work. Reload or `?session=SESSION_ID` restores a saved session. Stop the backend with Ctrl-C in its terminal; interrupted active sessions recover as paused on the next start.

By default, each participant cycle permits eight model calls, sixteen tool actions, three board posts, and one accepted canvas edit. The canvas lock lease lasts thirty seconds, with a two-minute maximum hold. Failed or cancelled calls remain in accounting, and published work survives later cycle failures. Context overflow pauses the session while preserving its history.

The judge reads the final canvas, board, changelog, and structured reasoning summaries after participant work finishes. It scores conversation and individual performance across five dimensions, each from zero to four, with source references. Failed or incomplete evaluation stays visible and can be resumed within its saved budget. The judge cannot edit participant work or override deterministic correctness.

The default database is `~/.local/share/chorus/sessions.sqlite3`; set `CHORUS_DB` to use another path. Run one backend per database. SQLite records UTC timestamps and ordered sequences, including the problem and selected persona snapshots, final solution, all committed contributions, tool traces, and call accounting. JSON exports contain the complete session record, including reasoning summaries and stored model requests/outputs; Markdown exports contain the canvas.

Set `CHORUS_CLOUD_CONCURRENCY` or `CHORUS_LOCAL_CONCURRENCY` to change provider request capacity (defaults: four and one). `CHORUS_RATES_JSON` configures exact-route cost estimates. Cached tokens are part of input tokens; aggregate cache utilization is token-weighted over calls with known metadata. Provider-call latency excludes capacity/lock waits. Reported charges, estimates, unknown values, and session wall time remain distinct.

### Observed model limits

The [live pilot](docs/live-harness-pilot-2026-11-02.json) records two-agent checks, not reliability at fifty paid agents. Luna and DeepSeek completed their runs and final reports; Luna's production answer failed deterministic verification, while DeepSeek's passed. Local Qwen 0.8B produced no board/canvas contributions and paused on invalid judge output. Its selector includes that compatibility caveat. The harness preserves failures and does not substitute models automatically.

## Architecture and development

The new API is `/api/v2`; its implementation is in `chorus/harness/`. Model execution, tool authorization, scheduling, accounting, and persistence remain backend responsibilities. A single Chorus process owns SQLite; model requests run outside database transactions. Concurrent workers serialize short commits and acquire the document lock only for canvas work.

The canonical shared UI/client lives under `sdk/harness-*`; `scripts/export_contracts.py` regenerates contracts and copies shared files into both frontends. Modify the source, never generated frontend copies. Install Nanoville's locked dependencies first: the exporter uses its `json-schema-to-typescript` package and Node 24. From this repository, regenerate with:

```bash
.venv/bin/python scripts/export_contracts.py
.venv/bin/python scripts/generate_harness_art.py
```

The artwork generator creates the original portraits and sixteen-frame sprite sheets from stable persona identities.

Historical sessions remain accessible through `/archive`, `?session=SESSION_ID`, and `/api/v1` read/export endpoints. V1 writes are disabled in production. Old catalogs, generation code, and components remain solely for archive decoding and explicit regression compatibility; they are not selectable on the new home pages. Migration 3 adds harness tables without rewriting old session snapshots.

Run `.venv/bin/python -m pytest` for backend verification, then `npm run check` in each frontend using Node 24. Browser suites run sequentially with fake providers and isolated databases. Do not run tests against saved user sessions.

See [running Chorus](docs/running-chorus.md), [implementation plan](docs/real-world-harness-plan.md), [release notes](docs/harness-release-notes.md), and [research architecture](docs/chorus-architecture.md).
