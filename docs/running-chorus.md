# Running and developing Chorus

Chorus owns independent agent execution, local records, and the shared contracts used by chorus-web and Nanoville. Run one backend process per SQLite database.

## Start with Docker Compose

Start Docker Desktop on macOS, or Docker Engine with Compose on Linux. Build and start Chorus from the repository root:

```bash
cp -n .env.example .env
docker compose up -d --build --wait
```

`--build` builds the images from the current checkout and reuses cached layers where possible. `--wait` waits for the app and preview controller to pass their health checks. `-d` leaves the stack running in the background. Open [http://127.0.0.1:43189](http://127.0.0.1:43189) after startup. [Compose startup options](https://docs.docker.com/reference/cli/docker/compose/up/)

The web port 43189 and preview port 43192 bind to host loopback. The engine listens on port 43187 inside the app container. Set `CHORUS_WEB_PORT` or `CHORUS_PREVIEW_PORT` in `.env` if either host port is occupied. Set `CHORUS_DOCKER_SOCKET` if your Docker engine uses a different socket.

Add `CHORUS_API_KEY` or `OPENROUTER_API_KEY` to `.env` for hosted models. For Ollama, the container uses `http://host.docker.internal:11434` by default. Docker Desktop can reach the host via that name. On Linux, Ollama needs to listen on a host address reachable from Docker's bridge, and host firewall rules should limit access to your local Docker network. Set `CHORUS_DOCKER_OLLAMA_HOST` if your Ollama API listens elsewhere. [Docker host networking on Desktop](https://docs.docker.com/desktop/features/networking/)

### Everyday Compose commands

- `docker compose up -d --wait` starts the stack using existing images. Add `--build` after changing the source or dependencies.
- `docker compose up --build` starts in the foreground and streams logs. Ctrl-C stops the stack in this mode.
- `docker compose ps -a` shows container state. The `workspace-image` service exits successfully after making the workspace image available.
- `docker compose logs -f chorus controller` follows the app and preview-controller logs. Ctrl-C exits the log viewer.
- `docker compose stop` shuts down the services. `docker compose start` restarts the existing containers.
- `docker compose down` stops and removes the containers and network while keeping saved data. `docker compose down --volumes` also deletes the saved experiments and repositories for the selected project. [Compose teardown options](https://docs.docker.com/reference/cli/docker/compose/down/)

The default project stores SQLite and the committed experiment repositories in the `chorus_work` volume, mounted at `/data`. Keep the same project name and Docker context to reopen those experiments. A different project name gets its own volume. Temporary Browser/Terminal workspace files are discarded when the controller stops.

With the Chorus CLI installed, `chorus stop` stops the default Compose project's app and preview controller when the checkout has no running `chorus launch` processes. To select a custom Compose project explicitly, use `chorus stop --project-name NAME`. Compose retains its containers and saved data. [Docker Compose stop](https://docs.docker.com/reference/cli/docker/compose/stop/)

### Open data from a source installation

Stop the source engine and make a backup of the database and experiment directory together. Existing records and Git worktrees contain absolute paths. Restore the working copy to the same paths inside the container. In a local Compose override, set `CHORUS_DB` and `CHORUS_EXPERIMENT_ROOT` to their original absolute paths and bind a backup copy of the source data directory to its original absolute directory in the container. If the database and experiments use different directories, bind each explicitly. Give the container's app user (UID 1000 by default) read/write access to the copy. If mounting from the original operating-system user is preferable, configure `user` with that user's numeric UID and add group `1000` for the controller socket. Start just one engine against the copy and check that an existing repository and agent branch open before resuming. Keep the original backup for recovery.

## Set up a source installation

Use macOS or Linux (Windows through WSL), Git, Python 3.11 or newer and Node 24. From the Chorus directory:

```bash
python3 -m pip install uv==0.9.8
uv sync --locked --extra dev
source .venv/bin/activate
cp -n .env.example .env
nvm use  # or activate Node 24 with your preferred manager
npm ci --prefix web
chorus launch
```

Preserve an existing `.env`. Set `CHORUS_API_KEY` there to use the default GPT-6-Luna model. OpenRouter uses `OPENROUTER_API_KEY`; local models use `OLLAMA_HOST`. No credentials belong in a browser environment. Luna is never silently replaced when unavailable.

The launcher starts the engine (43187) and interface (43189), waits for readiness, and opens the browser. Ctrl-C or termination stops both, including frontend workers. Use `--no-browser` to skip opening a tab and `--api-port` / `--web-port` to change ports. Occupied ports cause an error without stopping existing services. The launcher always starts its own engine; use `chorus serve` and `npm run dev --prefix web` separately to connect to an already-running engine.

Run `chorus stop` from a second terminal to shut down the engine and frontend started by `chorus launch` in this checkout. The command also works with custom launch ports. If a launcher was started before this command was added, stop it with Ctrl-C once so the new launcher can register for shutdown.

For production, run `npm run build --prefix web`, then `chorus launch --production`. Rebuild after interface changes. Launching requires a source checkout installed in editable mode and Node 24. API-only installations still support `chorus serve`. The launcher sets server-side `CHORUS_API_URL` for the interface automatically and reads the backend configuration from the checkout’s `.env`. Existing records stay in the configured SQLite database.

Nanoville remains a separate repository on port 43188. Configure its server-side `CHORUS_API_URL` if the engine uses a nondefault port, then use its own `npm ci` and `npm run dev`.

## Start an app experiment

The web home page offers four briefs: build an app like Todoist, Linear, Notion, or Typeform. Choose one or more agents from ten roles; six are selected by default. Choose the participant model and the judge model, then select **Start experiment**. These experiments always include a final judge.

Agents first discuss the brief and write a shared plan and task lists in `SPEC.md`. Once every agent finishes planning, they build in separate working copies and combine their changes through local pull requests. The judge then reviews a fixed copy of the final code and records.

Experiments use the bundled `chorus/harness/starters/` projects. For a custom starter, use a reviewed folder with `frontend/` and `backend/` subdirectories. In a source installation, set `CHORUS_EXPERIMENT_SCAFFOLD` to that folder in `.env`. In Compose, mount the folder read-only into the `chorus` service and set `CHORUS_EXPERIMENT_SCAFFOLD` to the in-container path in the service environment. Generated projects are saved in `experiments/` beside the database unless `CHORUS_EXPERIMENT_ROOT` is set.

Use **Kill experiment** to stop work while keeping its files and records. Use **Retry judge** if the final review fails. Switching sessions or closing the browser leaves the experiment running.

The [Chorus Web guide](../web/README.md#follow-the-work) covers the Board, task owners, branch diffs, usage, judge evidence, and reopening saved runs.

Experiment tools let agents write and inspect code. To check the generated app yourself, start Chorus with Compose, open **Browser**, and select **Run**. To run custom commands, use **Terminal**. Both use a temporary copy of the pinned commit. [Run and inspect a generated app](../web/README.md#run-the-generated-app)

## Run a benchmark

The engine also has five smaller problems with checked answers. Use the CLI or API to start these runs. They use fifty agent profiles, with 2–50 agents per run and a separate turn cap for each agent. The CLI enables the final model judge by default; `--no-judge` skips it without disabling the answer checks.

Agents discuss the problem on a shared board and edit a shared answer. Pause keeps saved work, Resume continues the same run, and Stop ends participant work and evaluates the saved answer. Closing the browser does not stop execution.

The final answer must contain one fenced `solution` block with JSON matching the problem’s answer format. Code checks correctness; the model judge separately reviews collaboration. The judge cannot edit the answer or override those checks.

## CLI

```bash
chorus doctor
chorus launch --no-browser
chorus stop
chorus serve --port 43187
chorus catalog --kind scenarios
chorus catalog --kind agents
chorus catalog --kind models
chorus run production-mix --turns-per-agent 3
chorus run transaction-ledger --participants quinn,reese,blair --turns-per-agent 2
chorus run process-inference --model qwen3.5:4b-mlx --no-judge
chorus sessions
chorus inspect SESSION_ID
chorus inspect SESSION_ID --records summary --agent quinn
chorus inspect SESSION_ID --records call --agent quinn
chorus control SESSION_ID pause
chorus control SESSION_ID resume
chorus export SESSION_ID exports/session.json --format json
chorus export SESSION_ID exports/solution.md --format markdown
```

The CLI commands that read or run sessions use the source API endpoint by default. Run `chorus --help` or `chorus COMMAND --help` for the full options. Benchmark runs default to Luna, the problem's relevant roster, ten turns per agent, and final judging. `--adversaries` accepts comma-separated selected IDs. Assignments are observer-visible and hidden from peers and the judge. Ctrl-C pauses a watched run. On `inspect` and `control`, `--archive` selects the legacy API, where production archives permit reads and exports.

## API and records

The active API is `/api/v2`:

- `GET /experiments/catalog` returns the four app briefs and ten agent roles.
- `POST /experiments` creates an app experiment with selected participants and model choices.
- `GET /catalog` returns the 50 personas, five problems, model availability, and Luna default.
- `POST /sessions` accepts `problemId`, `participantIds`, `model`, `maxTurnsPerAgent`, `judgeEnabled`, optional `adversaryIds`, and bounded execution settings.
- `GET /sessions` lists new sessions; `GET /sessions/{id}` returns authoritative state.
- `POST /sessions/{id}/commands` accepts a unique command ID, expected revision, and an action. Benchmark runs use start/pause/resume/stop; app experiments also use kill and retry_judge.
- `GET /sessions/{id}/events` streams revisioned snapshots; reconnect retrieves the latest state.
- `GET /sessions/{id}/records?kind=board&after=0&limit=100` reads an ordered record page. Kinds also include summary, conversation, change, version, call, request, output, tool, activity, diagnostic, and assessment. An `agent` filter narrows inspection.
- `GET /sessions/{id}/records/{recordId}` retrieves a cited record.
- `GET /sessions/{id}/repository/commit-diff?branch=main&revision=COMMIT` previews a committed patch from the selected experiment branch ancestry. The response includes a `truncated` flag when the patch exceeds the preview limit.
- `GET /sessions/{id}/runtime` returns the available and pinned revisions, process state, logs, and forwarded ports for that experiment.
- `POST /sessions/{id}/runtime` starts, stops, or resets a workspace, or forwards a port. `POST /sessions/{id}/runtime/terminal` creates a short-lived, single-use terminal connection for the local Chorus web origin.
- `GET /sessions/{id}/usage` returns ledger-derived agent, participant, judge, and session totals.
- `GET /sessions/{id}/export?format=json` exports the session and currently visible records; `format=markdown` exports the final canvas.
- `GET /assets/{agentId}/portrait.svg` and `/assets/{agentId}/sprite.svg` serve packaged artwork.

Board/canvas tools are server-authorized model capabilities, not browser mutation endpoints. Actor identity and session context come from the host, never model-supplied arguments. Participants can read only their own reasoning summaries. For app experiments, private reflections become visible to the observer after completion or kill; the final judge can read them during review. Benchmark summaries are visible to the observer and final judge; provider-private reasoning is not recorded. Logs remain metadata-only.

SQLite migration 3 creates harness tables alongside historical sessions. UTC timestamps accompany monotonic sequences; sequences define ordering. The store's existing process lock prevents multiple owners, while separate per-canvas lockfiles protect edits. Restart pauses interrupted sessions and invalidates prior publication authority.

## Accounting and configuration

Every dispatched attempt records tokens, cache use/utilization, provider-call latency, outcome, and cost independently of publication. Unknown values stay unknown. Cache percentages use token-weighted covered input; cached tokens are included in input. Provider-reported cost takes precedence over estimates. The Luna rate snapshot is effective 2 November 2026, Standard short-context, from its official model page. Exact-route overrides use `CHORUS_RATES_JSON` with input/output/cached/cacheWrite USD per million token rates plus date/source. Each call retains the rate basis. Local API charge is zero; hardware cost is unmeasured.

`CHORUS_CLOUD_CONCURRENCY` defaults to four; `CHORUS_LOCAL_CONCURRENCY` to one. These limit active provider requests, not agent turn order. `CHORUS_OPENAI_CACHE_MODE` retains implicit/explicit/disabled controls. `CHORUS_DB` changes the database path. Old `CHORUS_CATALOG` applies only to the archive engine; the harness uses its packaged versioned catalog.

## Development and verification

Run `.venv/bin/python scripts/check.py` in Chorus. Run `scripts/export_contracts.py` after contracts, client, or shared UI changes, using Node 24 and the dependencies installed in `web/`. The default export updates only Chorus Web; pass `--nanoville /path/to/nanoville` to intentionally update that separate checkout. Shared files under each frontend's API directory are generated copies. Artwork is regenerated with `scripts/generate_harness_art.py`.

Each frontend's `npm run check` runs lint, types, a production build, and browser verification. Nanoville also runs its unit and component tests. The integrated Chorus browser tests use ports 3111, 43191, and 11436. Nanoville uses ports 3100, 43190, and 11435. Run browser suites sequentially with temporary databases and fake providers, including the separate Docker workspace suite. [Test instructions](../TEST_PLAN.md)

Historical work is readable through `/archive`, a `?session=` URL, v1 read endpoints, or automatic archive fallback during CLI export. New runs cannot resume under legacy semantics. The new harness does not compact or silently drop history; context exhaustion pauses with committed work intact.

See [release notes](harness-release-notes.md), [implementation plan](real-world-harness-plan.md), and [test record](../TEST_PLAN.md).

## Setup checks and supported systems

Use macOS or Linux with Git, Python 3.11+ and Node 24. Native Windows is unsupported; use WSL. `chorus doctor` checks runtimes, integrated web dependencies and starter availability without contacting model providers or printing credentials. Use `uv sync --locked --extra dev` and `npm ci --prefix web` to reproduce dependencies. The complete contributor workflow is in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Backup and restore

Stop the launcher and any separately started engine before copying data. Back up the entire database directory, including SQLite sidecars if present and the sibling `experiments/` directory. If `CHORUS_EXPERIMENT_ROOT` points elsewhere, back up that directory too. Keep the matching source commit and lockfiles. Git repositories alone do not contain the full discussion, usage or run state.

Restore to the same absolute workspace location, or validate stored paths before attempting recovery; a general relocation tool is not provided. Start one engine against the restored database and inspect sessions before resuming. Keep backups and exports outside Git. No history or live data is migrated by source updates.
