# Running and developing Chorus

This guide covers the current runtime, local setup, CLI, HTTP API, configuration, and contract generation. For the project's purpose and research questions, start with the [Chorus README](../README.md).

Chorus currently runs locally for one person, using Python, FastAPI, SQLite, and Ollama. Nanoville and chorus-web connect to this same core. The current storage implementation uses Unix file locking.

## Quickstart

### 1. Install Chorus

Requirements: Python 3.11 or newer and either a running Ollama-compatible server with a supported model installed, or a configured cloud API key (`CHORUS_API_KEY` for OpenAI or `OPENROUTER_API_KEY` for OpenRouter). The current storage implementation uses Unix file locking.

From the Chorus repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp -n .env.example .env
```

If `.env` already exists, keep it and compare its settings with `.env.example`.

### 2. Start the backend

```bash
chorus serve
```

Default addresses:

- Backend: http://127.0.0.1:43187
- Interactive API documentation: http://127.0.0.1:43187/docs
- OpenAPI specification: http://127.0.0.1:43187/openapi.json
- Health check: http://127.0.0.1:43187/health

Keep this process running. It binds to the local loopback interface and owns the SQLite database. Run one backend process per database.

### 3. Check models and run a session

In another terminal, activate the same environment:

```bash
source .venv/bin/activate
chorus catalog models
chorus catalog scenarios
chorus catalog agents
```

Choose a model reported as installed. For example, if `qwen3.5:4b-mlx` is available:

```bash
chorus run ai-feature-launch \
  --participants software-engineer,product-manager \
  --model qwen3.5:4b-mlx \
  --turns 5
```

Add `--judge` to request checkpoint and final reviews. The CLI prints the session ID, committed contributions, and resulting canvas. Ctrl-C while watching a run pauses the session.

### Private adversaries

Add `--adversaries software-engineer` (or comma-separated participant IDs) to privately assign an opposing goal before the session starts. The HTTP equivalent is `adversaryIds` in the session creation configuration. It defaults to `[]`; IDs must be distinct selected participants. Zero, one, multiple, or all participants can be adversaries. The judge cannot be assigned.

Assignments are immutable for a session and persist in its configuration, snapshots, events, and observer JSON exports. Markdown export contains only the shared canvas. Existing stored records without the field load as no adversaries; no SQLite table migration is needed. Start a new session after the `discussion-v25-adversaries` engine update; sessions from earlier engines remain readable/exportable.

Chorus replaces cooperative guidance with a private opposing goal for the assigned agent's canvas edits, spoken contribution, and observer-only journal, including retries. The agent keeps its name, professional expertise, baseline traits, and deterministic energy/confidence rules. Formatting, evidence protection, bounded retries, cancellation, and atomic commits still apply. Sabotage may weaken proposals or obstruct progress within those constraints.

Only the current agent's own assignment is added to its system prompt. Other participants, other adversaries, and judge checkpoint/final/compatibility prompts receive no assignment metadata or count. Judge criteria remain unchanged. Journals stay observer-only. These are model-input boundaries, not protection against the human observer reading the local API: behavior or model disclosure can reveal an assignment, and a prompted adversary may still cooperate.

## Applications built on Chorus

The three projects run as separate processes:

- **Chorus — port 43187:** model calls, prompts, validation, scheduling, API contracts, and persistence.
- **Nanoville — port 43188:** scenario studio, discussion scene, document display, and observer panels.
- **chorus-web — port 43189:** scenario exploration, discussion controls, and canvas display.

Start the backend first. In each frontend’s `.env.local`, set:

```dotenv
CHORUS_API_URL=http://127.0.0.1:43187
```

Then follow the README in the Nanoville or chorus-web checkout. Both use a server-side, same-origin API proxy to reach Chorus. Model execution and session rules live in Chorus.

## Models and configuration

### Model catalog

The bundled catalog contains these exact model IDs:

- `qwen3.5:0.8b-mlx` — Local MLX
- `qwen3.5:4b-mlx` — Local MLX, default
- `gpt-6-luna` — OpenAI APIs, displayed as GPT-6-Luna
- `deepseek/deepseek-v4.1-flash-1017` — OpenRouter, DeepSeek V4.1 Flash 1017
- `minimax/minimax-m3.1-flash` — OpenRouter, MiniMax M3.1 Flash
- `z-ai/glm-5.3-flash` — OpenRouter, GLM 5.3 Flash

The two local models must already be installed in Ollama. Chorus does not download or silently substitute models. `chorus catalog models`, `GET /api/v1/models`, and `GET /api/v1/catalog` report provider and availability. Local entries expose installation status; OpenAI availability means `CHORUS_API_KEY` is configured, not that account access or quota has been verified. An Ollama outage affects only local entries. OpenRouter availability depends independently on `OPENROUTER_API_KEY`; configuration availability does not verify credits or provider access.

Set `CHORUS_API_KEY` in the backend shell environment or Chorus's `.env`, then restart Chorus to use GPT-6-Luna. Never add it to frontend environment files. Chorus calls `https://api.openai.com/v1/responses` with model `gpt-6-luna`, `store: false`, and reasoning disabled. The chosen model handles canvas edits, participant speech, private observer journals, and judge reviews. OpenAI uses strict structured output with an object wrapper for canvas unions; Chorus validates and unwraps results before publication. Requests retain the existing conservative 32,768-token application budget and bounded output allowances. No provider fallback occurs.

Set `OPENROUTER_API_KEY` in the Chorus backend environment or `.env` and restart Chorus for OpenRouter. Requests go to `https://openrouter.ai/api/v1/chat/completions` with the exact selected model ID. Structured calls request a strict JSON schema and `provider.require_parameters: true` so OpenRouter selects a host that supports the requested format. DeepSeek requests reasoning disabled. MiniMax and GLM routes require reasoning, so Chorus requests low effort and adds 2,048 tokens to the total completion allowance per call, included in context-budget checks. All three exclude reasoning from returned content; only assistant reply text enters the application. Output usage includes any reasoning tokens charged by the provider. The same model handles all generation phases, with the same context budget, validation, usage accounting, cancellation, and canvas-preservation rules. No alternate model is requested. OpenRouter may route among hosts of that same model. Missing keys, insufficient credits, denied access, throttling, and provider failures return sanitized errors without exposing the credential or raw upstream payload.

Missing credentials, authentication failures, denied model access, rate limits, timeouts, refusals, and malformed output produce safe errors. Public-generation failures pause execution and preserve committed work; journals retain their existing optional behavior. Requests can be cancelled without committing late output. Logs contain metadata and usage, not credentials, prompts, or journals.

Sessions using removed models remain readable and exportable but cannot start or resume execution. Start a new session with a current model.
All catalog models support judge reviews, including MLX. Chorus checks whether each model's runner actually enforces JSON schemas and caches that result for the life of the backend. Runners that enforce schemas use the compact structured review. Other runners receive small individual questions: short assessments, numbered canvas excerpts, and requirement ratings. Chorus validates each answer, attaches only the excerpt selected by the judge, derives a consistent verdict, and serializes the same public review contract. Invalid complex reviews also fall back to this path. There is no model substitution.

The compatibility path may make more model calls. Token totals include the capability probe and rejected or retried answers. Complete public history remains available to every question; journals and unpublished drafts never enter these prompts. A failed or cancelled review commits no partial feedback.

Use `CHORUS_CATALOG` to supply a replacement catalog in the format of [chorus/catalog/catalog.json](../chorus/catalog/catalog.json). Session models must appear in that catalog. Each model declares `provider: "ollama"`, `provider: "openai"`, or `provider: "openrouter"`; omitted providers default to Ollama for existing custom catalogs.

### Environment settings

The backend loads `.env` at startup; existing shell environment values take precedence.

- `CHORUS_API_KEY`: OpenAI API credential, required only for OpenAI models.
- `OPENROUTER_API_KEY`: OpenRouter API credential, required only for OpenRouter models.
- `OLLAMA_HOST`: local model server address; default `http://localhost:11434`.
- `CHORUS_DB`: SQLite file; default `~/.local/share/chorus/sessions.sqlite3`.
- `CHORUS_CATALOG`: optional path to a replacement catalog JSON file.
- `CHORUS_PACING`: delay between participant operations in seconds; default `1.8`.
- `CHORUS_ALLOWED_ORIGINS`: comma-separated additional permitted request origins.
- `CHORUS_API_URL`: backend address for CLI clients and frontend proxies; default `http://127.0.0.1:43187`.

CLI clients read `CHORUS_API_URL` from their shell environment. To use a different port, start the service with `chorus serve --port 43217` and export `CHORUS_API_URL=http://127.0.0.1:43217` in the client terminal. Update the frontend configuration too.

## Managing sessions from the CLI

The CLI connects to the running API, so a session can be inspected or controlled from either the terminal or an application.

```bash
chorus sessions
chorus inspect SESSION_ID
chorus inspect SESSION_ID --journals

chorus control SESSION_ID pause
chorus control SESSION_ID resume
chorus control SESSION_ID stop

chorus export SESSION_ID final.md
chorus export SESSION_ID session.json --format json
chorus export SESSION_ID session-with-journals.json --format json --journals
```

Markdown exports contain the shared canvas. JSON exports contain the session snapshot; journals are included only when explicitly requested. Use `chorus --help` or `chorus COMMAND --help` for command options.

## HTTP API

All platform endpoints use the `/api/v1` prefix:

- `GET /catalog`, `/scenarios`, `/agents`, `/models`: discover configuration and model availability. Scenarios and agents accept a `collection` filter.
- `POST /sessions`: create a session in the `ready` state.
- `GET /sessions` and `/sessions/{id}`: list or read saved sessions.
- `POST /sessions/{id}/commands`: start, pause, resume, or stop execution.
- `GET /sessions/{id}/events`: stream versioned snapshots over server-sent events.
- `GET /sessions/{id}/journals`: read observer journals separately.
- `GET /sessions/{id}/export`: export Markdown or JSON.

### Create and start

Create a session using IDs from the catalog:

```bash
curl -sS http://127.0.0.1:43187/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "scenarioId": "ai-feature-launch",
    "participantIds": ["software-engineer", "product-manager"],
    "model": "qwen3.5:4b-mlx",
    "maxTurns": 5,
    "judgeEnabled": false
  }'
```

Use the returned `id` and `revision` in a command. A newly created session has revision `0`; replace `SESSION_ID` below with its ID:

```bash
curl -sS http://127.0.0.1:43187/api/v1/sessions/SESSION_ID/commands \
  -H 'Content-Type: application/json' \
  -d '{"commandId":"start-001","expectedRevision":0,"action":"start"}'
```

For each new command, use a new command ID and the latest snapshot revision. Retrying the exact same command ID and body returns its recorded result. A stale revision or changed body under the same ID returns a `409` conflict.

Reconnect event streams using the `after` query parameter or `Last-Event-ID` header. Event IDs are snapshot revisions. Public snapshots include committed history, canvas, reviews, and execution progress; journals and rejected generation drafts are excluded.

API errors use `{ "error": "…", "code": "…", "requestId": "…" }`. See the interactive API documentation for complete schemas and parameters.

## Execution and recovery

- A participant slot attempts a validated canvas operation, a spoken contribution, and a separate journal. Successful public output and its journal entry commit atomically.
- If canvas edits repeatedly fail validation, Chorus preserves the previous document and continues with valid speech. Repeated invalid speech skips the slot without committing its proposed edit or journal. A journal failure preserves valid public work.
- With judging enabled, every five participant slots trigger a checkpoint, except at the turn limit, which triggers only the final review. Skipped slots count toward the limit; judge feedback does not consume participant slots.
- Pause cancels pending work. Stop cancels pending work and, when enabled, requests a final review of committed work. Late responses cannot commit after cancellation.
- Closing a browser does not stop execution. A backend restart recovers interrupted sessions as paused, keeping committed work intact.
- Sessions record their engine version. Older sessions remain readable, but cannot resume under a different engine version.
- Public history is retained in full. Context overflow pauses the session; Chorus does not silently truncate or summarize history.

Observer journals are separate from public model context, but are available through the local API. They are not protected by per-user permissions in this single-user release.

## Project layout

```text
chorus/
├── api.py                # FastAPI application lifecycle and request handling
├── routers/              # HTTP endpoints
├── contracts/            # Pydantic request, response, and session contracts
├── services/             # Prompts, generation, validation, and orchestration
├── llm/                  # Model transport and context budgets
├── storage/              # SQLite persistence and runner ownership
├── catalog/              # Scenarios, participants, and configured models
├── cli/                  # Terminal interface to the API
└── templates/            # Historical YAML content; not loaded by this engine
sdk/                      # Shared client and generated API/schema/type artifacts
scripts/                  # Contract export tooling
tests/                    # Backend regressions, integration tests, and fixtures
docs/                     # Migration design and research plans
```

### Updating shared contracts

Pydantic models are the contract authority. Edit [sdk/client.ts](../sdk/client.ts) for shared client behavior, then regenerate contracts after changes:

```bash
python scripts/export_contracts.py
```

Generation requires Node.js and Nanoville’s development dependencies installed with `npm ci` in the sibling project. It writes the OpenAPI document, JSON Schema, and TypeScript declarations into `sdk/`, and copies the schema, types, and client into both frontends. Do not hand-edit generated frontend copies. Python remains responsible for semantic validation across fields.

## Testing and current status

Run backend checks from the Chorus repository root with the virtual environment active:

```bash
python -m pytest
```

Run `npm run check` separately in each frontend. Their browser tests use real Chorus with an isolated database and fake Ollama; they do not require installed models. See [TEST_PLAN.md](../TEST_PLAN.md) for coverage, acceptance criteria, and recorded results.

### Known limitations

During live browser testing on **22 October 2026**:

- Final judge responses failed validation with the tested local MLX models in both applications. On 23 October, diagnosed ignored format constraints in the MLX runner and incompatible regex patterns in Chorus. Corrected the decoder patterns and added `qwen3:4b` as the judge-capable default; an initial restriction to the standard runner was subsequently replaced by a validated text-answer compatibility path for all catalog models. Existing sessions remain readable, but the engine-version change requires starting a new session to use the fix.
- Qwen 2B completed Nanoville’s five-turn reply-helper discussion without an accepted canvas edit, leaving an empty final document. Gemma E2B produced saved canvases in the tested scenarios.
- The automated checks passed: 56 backend tests, 6 frontend component/client tests, and 10 browser integration tests across the applications. These results do not establish reliable real-model generation.

Remote access, authentication, multiple users, and multiple backend workers are outside the current release.

## Migration and research

This version replaces the old personality-state, memory, YAML session, and CLI execution formats. Historical templates are retained as reference material; they are not compatible runtime configuration for the current engine.

- [Research direction](chorus-architecture.md): research questions and proposed capabilities.
- [Implementation sequence](chorus-architecture.md#9-implementation-sequence-and-completion-evidence): proposed research development stages and completion criteria.

Research plans describe future work; the features and limitations above describe the implemented platform.
