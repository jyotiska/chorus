# Running and developing Chorus

Chorus owns independent agent execution, local records, and the shared contracts used by chorus-web and Nanoville. Run one backend process per SQLite database.

## Setup

Use Python 3.11 or newer and Node 24 for frontend development. From the Chorus directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp -n .env.example .env
nvm use  # or activate Node 24 with your preferred manager
npm ci --prefix web
chorus launch
```

Preserve an existing `.env`. Set `CHORUS_API_KEY` there to use the default GPT-6-Luna model. OpenRouter uses `OPENROUTER_API_KEY`; local models use `OLLAMA_HOST`. No credentials belong in a browser environment. Luna is never silently replaced when unavailable.

The launcher starts the engine (43187) and interface (43189), waits for readiness, and opens the browser. Ctrl-C or termination stops both, including frontend workers. Use `--no-browser` to skip opening a tab and `--api-port` / `--web-port` to change ports. Occupied ports cause an error without stopping existing services. The launcher always starts its own engine; use `chorus serve` and `npm run dev --prefix web` separately to connect to an already-running engine.

For production, run `npm run build --prefix web`, then `chorus launch --production`. Rebuild after interface changes. Launching requires a source checkout installed in editable mode and Node 24. API-only installations still support `chorus serve`. The launcher sets server-side `CHORUS_API_URL` for the interface automatically and reads the backend configuration from the checkout’s `.env`. Existing records stay in the configured SQLite database.

Nanoville remains a separate repository on port 43188. Configure its server-side `CHORUS_API_URL` if the engine uses a nondefault port, then use its own `npm ci` and `npm run dev`.

## Start an experiment

Select one of five problems. The interface automatically checks its five relevant participants. Add or remove agents from the catalog before starting, within a 2–50 roster. Choose a per-agent turn cap and model; final judging is enabled by default.

Agents run independently, with bounded provider request capacity. A cycle permits at most eight model calls, sixteen tool actions, three board posts, and one accepted canvas edit. Every board message is one or two sentences, at most sixty words/four hundred characters. @Name mentions keep responses in a flat feed.

Canvas editing requires an expiring exclusive lockfile lease. The backend validates lease ownership and document version at commit. Board posts and canvas edits are independently durable; a later failure does not roll them back. Pause cancels active work, Resume retains consumed budgets, and Stop freezes an early result for evaluation. Browser closure leaves execution running.

The final canvas contains one fenced `solution` block holding JSON matching the displayed problem's answer schema. Deterministic verification checks the submitted answer. The final judge separately assesses collaboration and each participant's contributions using the board, structured reasoning summaries, and changelog. It has read-only tools.

## CLI

```bash
chorus catalog scenarios
chorus catalog agents
chorus catalog models
chorus run production-mix --turns-per-agent 3
chorus run transaction-ledger --participants quinn,reese,blair --turns-per-agent 2
chorus run process-inference --model qwen3.5:4b-mlx --no-judge
chorus sessions
chorus inspect SESSION_ID
chorus inspect SESSION_ID --records summary --agent quinn
chorus inspect SESSION_ID --records call --agent quinn
chorus control SESSION_ID pause
chorus control SESSION_ID resume
chorus export SESSION_ID session.json --format json
chorus export SESSION_ID solution.md --format markdown
```

The CLI defaults to Luna, the problem's relevant roster, ten turns per agent, and final judging. `--adversaries` accepts comma-separated selected IDs; assignments are observer-visible and hidden from peers/judge. `--turns` is deliberately rejected. Ctrl-C pauses a watched run. `--archive` on inspect/control selects the legacy API; production archives permit reads and exports only.

## API and records

The active API is `/api/v2`:

- `GET /catalog` returns the 50 personas, five problems, model availability, and Luna default.
- `POST /sessions` accepts `problemId`, `participantIds`, `model`, `maxTurnsPerAgent`, `judgeEnabled`, optional `adversaryIds`, and bounded execution settings.
- `GET /sessions` lists new sessions; `GET /sessions/{id}` returns authoritative state.
- `POST /sessions/{id}/commands` accepts a unique command ID, expected revision, and start/pause/resume/stop action.
- `GET /sessions/{id}/events` streams revisioned snapshots; reconnect retrieves the latest state.
- `GET /sessions/{id}/records?kind=board&after=0&limit=100` reads an ordered record page. Kinds also include summary, conversation, change, version, call, request, output, tool, activity, diagnostic, and assessment. An `agent` filter narrows inspection.
- `GET /sessions/{id}/records/{recordId}` retrieves a cited record.
- `GET /sessions/{id}/usage` returns ledger-derived agent, participant, judge, and session totals.
- `GET /sessions/{id}/export?format=json` exports the complete local record; `format=markdown` exports the final canvas.
- `GET /assets/{agentId}/portrait.svg` and `/assets/{agentId}/sprite.svg` serve packaged artwork.

Board/canvas tools are server-authorized model capabilities, not browser mutation endpoints. Actor identity and session context come from the host, never model-supplied arguments. Participants can read only their own reasoning summaries. The observer and final judge can inspect all new summaries; provider-private reasoning is not recorded. Logs remain metadata-only.

SQLite migration 3 creates harness tables alongside historical sessions. UTC timestamps accompany monotonic sequences; sequences define ordering. The store's existing process lock prevents multiple owners, while separate per-canvas lockfiles protect edits. Restart pauses interrupted sessions and invalidates prior publication authority.

## Accounting and configuration

Every dispatched attempt records tokens, cache use/utilization, provider-call latency, outcome, and cost independently of publication. Unknown values stay unknown. Cache percentages use token-weighted covered input; cached tokens are included in input. Provider-reported cost takes precedence over estimates. The Luna rate snapshot is effective 2 November 2026, Standard short-context, from its official model page. Exact-route overrides use `CHORUS_RATES_JSON` with input/output/cached/cacheWrite USD per million token rates plus date/source. Each call retains the rate basis. Local API charge is zero; hardware cost is unmeasured.

`CHORUS_CLOUD_CONCURRENCY` defaults to four; `CHORUS_LOCAL_CONCURRENCY` to one. These limit active provider requests, not agent turn order. `CHORUS_OPENAI_CACHE_MODE` retains implicit/explicit/disabled controls. `CHORUS_DB` changes the database path. Old `CHORUS_CATALOG` applies only to the archive engine; the harness uses its packaged versioned catalog.

## Development and verification

Run `.venv/bin/python -m pytest` in Chorus. Run `scripts/export_contracts.py` after contracts, client, or shared UI changes, using Node 24 and the dependencies installed in `web/`. The default export updates only Chorus Web; pass `--nanoville /path/to/nanoville` to intentionally update that separate checkout. Shared files under each frontend's API directory are generated copies. Artwork is regenerated with `scripts/generate_harness_art.py`.

Each frontend's `npm run check` runs lint, types, a production build, and browser verification; Nanoville also runs its unit/component suite. Browser tests use separate temporary databases and fake Ollama. Run browser suites sequentially: Nanoville reserves 3100/43190/11435; chorus-web 3111/43191/11436. Their explicit legacy test switches preserve historical regression coverage; leave these switches unset for normal use.

Historical work is readable through `/archive`, a `?session=` URL, v1 read endpoints, or automatic archive fallback during CLI export. New runs cannot resume under legacy semantics. The new harness does not compact or silently drop history; context exhaustion pauses with committed work intact.

See [release notes](harness-release-notes.md), [implementation plan](real-world-harness-plan.md), and [test record](../TEST_PLAN.md).
