# Chorus Web

chorus-web is a local interface for Chorus's independent-agent harness. Chorus owns model calls, tool authorization, scheduling, validation, accounting, and SQLite persistence. This application renders committed backend state and sends user controls.

## Run locally

This interface lives in `web/` inside the Chorus repository. Use Node 24 and npm. Follow [Chorus’s setup instructions](../README.md#run-chorus), then run from the repository root:

```bash
chorus launch
```

The launcher starts the engine at **http://127.0.0.1:43187**, starts this interface at **http://127.0.0.1:43189**, and opens the browser. Ctrl-C stops both. Use `--no-browser` to skip opening a tab. For production, run `npm run build --prefix web` and then `chorus launch --production`.

For separate frontend development, run `npm ci` and `npm run dev` from this directory, with `chorus serve` running in another terminal. If needed, copy `.env.example` to `.env.local` without overwriting an existing file and configure server-side `CHORUS_API_URL`. Model credentials belong in the backend environment only. Nanoville remains a separate repository and is not required to install, generate, test, or run Chorus Web.

GPT-6-Luna is the default. If unavailable, the interface explains why and requires an explicit alternative model selection. The five problems automatically select relevant agents from the shared catalog of fifty; edit the roster before starting. The turn cap applies independently to each selected participant. Select 2–50 participants and 1–100 turns per agent; the default is ten. Final judging is off by default. When enabled, it can use its own model, initially matching the participant model.

## Workspace

The dark session rail opens recent runs and the historical archive. Each session opens Board and Canvas side by side when there is room. On a phone, choose Open beside board to split the view, or open the full canvas from a contribution and use Back to board to return to that post. Above the panes, one row shows session-wide turns, elapsed wall time, tokens, calls and costs. A second row shows all agents with live status, turn counts and progress. It scrolls sideways for large teams. Select an agent to open their profile and, in repository experiments, their to-do list from SPEC.md. The Reasoning summaries tab appears when the selected agent has a saved summary available to view. Usage separates participant, judge and whole-session accounting. Results opens verification, evaluation and supporting evidence.

New session includes a searchable problem picker and roster editor. Use Run actions for a copyable session link or Stop and evaluate. Switching sessions in the rail leaves backend work running. Choosing Pause and return to setup waits for the pause to succeed.

The home page provides first-name profiles and original portraits, editable automatic rosters, per-agent progress and call accounting, participant/session totals, a flat board with @Name mentions, an exclusively locked shared canvas, attributed diffs, final evaluation, and complete exports.

Board messages are one or two sentences, no more than sixty words/four hundred characters, and at most three posts per participant cycle. Agents run independently and can agree, disagree, or add evidence by mentioning a selected peer with `@FirstName`; replies remain in the same flat feed. Energy and confidence are removed from new runs. Summaries explain stated decisions and assumptions without exposing private internal reasoning. The final judge reads new summaries; peers cannot.

The five problems cover deployment scheduling, transaction reconciliation, reservoir mixtures, production optimization, and Bayesian inference. Each provides an answer schema. The canvas must contain exactly one fenced `solution` block with the JSON answer for deterministic checking.

Canvas edits require an exclusive expiring backend lock and create an attributed changelog entry. A cycle defaults to eight model calls, sixteen tool actions, three board posts, and one accepted canvas edit. Already published posts and edits survive later failures.

The final report combines deterministic answer correctness, a conversation grade, and individual performance grades. The judge reads the board, canvas, changelog, and summaries only after all participants finish or reach their caps, or after an early Stop. It uses the session's selected model with read-only tools. Conversation and agent grades each total twenty points across five dimensions, with supporting source references. There are no intermediate reviews. Failed or incomplete evaluation stays visible and preserves participant work.

The session header and participant inspector show input/output/cached tokens, cache use and utilization, provider-call latency, and cost. Totals include failed attempts and retries. Reported charges and estimates are labelled separately; missing provider metadata stays unknown. Session wall time is separate from provider-call latency, and cached tokens are included in input tokens.

The large-roster layout stays readable through compact participant rows, search, and a per-agent inspector.

Pause cancels pending work while retaining committed records and consumed turn budgets; Resume continues within those budgets. Stop freezes an early result for final evaluation. Reload restores the saved session; `?session=SESSION_ID` opens a specific session. Closing the browser leaves backend execution running. Back to setup pauses active work. A backend restart recovers interrupted sessions as paused. Context overflow pauses with saved work intact.

Chorus persists timestamped session/problem/persona snapshots, conversations, summaries, board messages, canvas versions/diffs, tool traces, calls, and final evaluation in local SQLite. Export JSON downloads the complete record, including summaries and stored model requests/outputs; Export Markdown downloads the canvas. Historical sessions are read-only through `/archive` and direct session URLs, retaining their original journals and turn counts.

The [live pilot](../docs/live-harness-pilot-2026-11-02.json) found that Luna and DeepSeek could complete two-agent runs and final reports; completing a run does not guarantee a correct answer. Qwen 0.8B produced no contributions and failed final judging in that check; its selector carries this caveat. See [release notes](../docs/harness-release-notes.md) for observed limitations.

## Source ownership

The rail, launcher, live layout, production archive and dark styling live in this application. The local workspace composes the shared live-session presentation with the Chorus client. A historical session and the legacy test-only route retain their original data semantics.

`lib/api/chorus/harness-workspace.tsx`, its CSS Module, `harness-client.ts`, contracts, the legacy client, and usage view are generated from `../sdk/`. Change that source and run `../.venv/bin/python ../scripts/export_contracts.py`; never hand-edit generated copies. The exporter requires Node 24 and this interface’s installed dependencies. Export to Nanoville only when intended, using `--nanoville /path/to/nanoville`. The same-origin `/api/chorus/*` proxy routes v2 traffic to the new engine and retains v1 reads for archives.

All execution rules live in Chorus. The browser never chooses a speaker, acquires the actual lockfile, applies a canvas edit, calculates authoritative usage totals, or calls a model provider. Old components remain solely for explicit legacy regression compatibility.

## Verification

Run `npm run check` with Node 24. This runs lint, types, a production build, and Playwright browser tests. Install Chromium once with `npx playwright install chromium`. Tests use real Chorus, fake models, and isolated temporary databases; the parent repository’s `.venv` must have its development dependencies installed. Live provider credentials and Ollama are not required for verification. Run this browser suite sequentially with the other frontend's suite. Ports: 3111, 43191, 11436.

Current-engine journeys check Luna, editable default rosters, actual tools, concise mentions, summaries, aggregate accounting, judging, reload, fifty-person artwork/layout, and narrow screens. Historical regressions run through test-only archive switches; normal production v1 writes are disabled.

See [Chorus release notes](../docs/harness-release-notes.md) and [the implementation plan](../docs/real-world-harness-plan.md).
