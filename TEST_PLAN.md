# Chorus test plan

## Repository consolidation — 11 November 2026

Chorus Web now lives in `web/`. The engine, HTTP API, shared SDK ownership, session identifiers, and existing database location are unchanged. Nanoville stays in its own repository and is not required by Chorus generation or tests.

- Full Python suite: 299 tests passed, including six new launcher tests. Three subsequently added export boundary tests also passed (302 total across these runs).
- `npm run check --prefix web` with Node 24: lint, type generation/type checking, production build, and all 31 browser journeys passed. Browser tests used fake providers and temporary databases.
- Real `chorus launch --no-browser` smoke checks passed in both development and `--production` modes, from outside the checkout, using alternate ports and an isolated SQLite database. Verified the interface, engine health, the proxied fifty-agent catalog, session reads, and that both listening ports close on interrupt.
- Launcher integration tests cover Ctrl-C, termination, frontend startup failure, and a frontend crash after readiness. Port conflicts leave the original listener running.
- The contract exporter uses `web/` dependencies. Tests verify local-only generation, explicit export to an existing external checkout, and rejection of invalid external paths before writing files. Real generation produced no contract or SDK drift.
- All 121 tracked frontend files were imported. Only frontend guidance, documentation, package metadata/lockfile, and test paths changed; no existing dependency versions changed.
- No live model calls or changes to saved user sessions were needed. Nanoville’s existing uncommitted work and the original Chorus Web checkout were left untouched.

## Independent harness release on 2 November 2026

The default engine is `/api/v2`, implemented in `chorus/harness/`. Verification passed 268 Python tests, plus the complete checks in both frontends: 27 Nanoville unit/component/client tests, 25 chorus-web browser journeys, and 17 Nanoville browser journeys. Lint, generated contracts, strict TypeScript, and both production builds passed. Frontend browser suites ran sequentially against fake providers and isolated databases.

New backend cases cover five positive/negative verifiers, exact catalog fields, sentence/@mention validation, native OpenAI and all three OpenRouter model tool envelopes, independent workers, ledger reconciliation, weighted cache coverage, unknown explicit cache-write charges, idempotent partial publication, lock expiry/fencing, read-only judging, summary isolation, frozen reads, shutdown fencing, CLI defaults, retired production writes, all fifty artwork identities, and a fifty-worker restart stress case. Generated SDK/client/UI copies match their authoritative sources.

Live isolated two-agent, one-turn runs completed final reports through direct Luna and OpenRouter/DeepSeek. The checker rejected Luna's non-optimal answer and accepted DeepSeek's answer. A local Qwen 0.8B run produced no public contributions and paused on invalid judge output; this observed limitation is displayed with that model. See `docs/live-harness-pilot-2026-11-02.json` and `docs/harness-release-notes.md`. These are compatibility observations, not a reliability benchmark.

Before live migration, backed up the SQLite database with restricted permissions. Restarted idle services and confirmed all 22 historical session snapshots were unchanged, the active catalog has fifty agents/five problems with Luna default, and both applications and read-only archives return successfully. V1 write access and old UI interactions below are exercised only in explicit regression mode.

## Historical engine verification

The older records below describe v1 behavior and its regression cases; their energy/confidence, round-robin turns, isolated journals, and checkpoints are not current v2 requirements.

The Python backend is the execution and contract authority. Run deterministic tests without a live model; use an injected model adapter or the fake Ollama server.

## Required coverage

- Contracts: setup bounds, distinct valid participants, supported models, command IDs/revisions, stable errors, OpenAPI/client compatibility.
- Canvas: create/unchanged/replace/append; exact evidence preservation; nested, formatted and Setext headings; ambiguous targets; duplicate siblings; fenced code; HTML rejection; CRLF; untouched source preservation.
- Generation: bounded canvas/speech/journal/review retries; invalid speech skips without committing its edit; unchanged turns count; journal failure preserves public output; journals never enter public model context.
- Reviews: every five slots except the terminal slot; exact criterion coverage; current-canvas citations; complete sentences; empty-canvas handling; early-stop review; failed review resumes without repeating a participant.
- Lifecycle: one active operation per session; late results ignored after cancellation; pause/resume/stop; repeated commands; stale revisions; full-history context overflow.
- Agent state: personality-specific speaking/editing costs and listening recovery; explicit directed support/adoption/challenge/rejection; no ambiguous-name or negated/hypothetical feedback attribution; 0–100 bounds and actual deltas; prompt influence; legacy defaults and invalid external data; atomic persistence/restart; no mutation from cancelled/skipped turns, judge reviews, or private journals.
- Inner thought state awareness: post-turn values match the committed stats, current speaking/editing costs are counted once, recent peer reactions stay chronological and agent-specific, awareness is optional to express, and prompt preparation never mutates session state.
- Persistence: migrations on fresh/existing databases; atomic turn/canvas/journal/event commits; restart pauses interrupted work; completed work and configuration snapshots survive; event IDs replay in order.
- API: catalog/model discovery, create/read/list/control/export, SSE replay, observer journal isolation, malformed input, missing session, local access restrictions.
- CLI: catalogs, run, controls, inspect and exports use the same service as HTTP.

## Execution

Run `python -m pytest` from this directory using the project environment. Add focused regression cases with each ported behavior. After deterministic checks pass, run both applications against Chorus and fake Ollama, then perform a small real Ollama smoke run when the configured model is available. Record unavailable checks honestly.

## Release acceptance

Both frontends and CLI share the same session state; reconnects and duplicate commands do not repeat work; no model execution remains in either frontend; generated contracts match the API; all required deterministic and browser checks pass.

## Latest local verification — 22 October 2026

56 Python tests passed, including CLI/API parity, contract drift checks, cancellation, rollback, and restart recovery. Package build and runtime assets verified. A real one-turn gemma4:e2b-mlx session completed with a saved canvas and observer journal.


## Live built-in browser verification — 22 October 2026

Both applications were started in production mode against the real local Chorus service on port 43187 and installed Ollama models. These results are separate from deterministic tests using fake Ollama.

- chorus-web (43189): Debate with Qwen 2B and Creative Team with Gemma E2B each committed five contributions and a canvas. Pause, reload, and resume preserved the debate session. Final judge generation failed validation and paused safely without losing committed work.
- Nanoville (43188): AI reply helper with Qwen 2B completed five turns, with pause/reload/resume and a saved observer journal verified through the UI. All canvas edit attempts were rejected or unchanged; the final document remained empty. Service outage with Gemma E2B committed five contributions and a 3383-character canvas; the final review failed validation. Reload restored the paused outage run and document.
- Added a regression requiring the judge prompt to state the full response envelope explicitly, and bumped the engine prompt version to discussion-v23-python2. Regenerated both frontend contract copies and reran all three projects' checks successfully. The explicit instructions did not resolve live model review failures; this is still an open issue, not a passing acceptance result.
- Isolated review diagnostics reproduced malformed JSON, missing response fields, and schema metadata returned as content. No failed draft was published and no validation guard was relaxed. The exact local runner/model compatibility cause remains unconfirmed.

Open release issues: reliable structured judge generation with these installed MLX models, and reliable canvas generation with Qwen 2B. Automated green checks alone do not establish real-model acceptance.


## Judge compatibility fix — 23 October 2026

- Reproduced ignored JSON schema and JSON mode on Ollama 0.32.5 with the installed MLX models. A schema-constrained sentinel probe returned unconstrained plain text. The already-installed standard `qwen3:4b` enforced the same schema.
- Fixed decoder regex anchoring, JSON string safety, and citation escaping incompatible with Ollama's grammar converter. Added judge capability metadata, a supported default, and rejection of unsupported judge/model configurations before session creation. Empty canvases cannot receive credit for written requirements.
- 62 backend tests passed. Full `npm run check` passed in both applications using Node 24.22.1: 7 Nanoville unit/component tests, 8 Nanoville browser journeys, and 2 chorus-web browser journeys, plus lint, type checks and production builds.
- Real-model checkpoint and final reviews passed against both recent pricing snapshots, including the empty canvas. A fresh isolated six-slot pricing discussion using `qwen3:4b` completed one checkpoint and its final judgement with a 2759-character saved canvas. The isolated database was removed after verification; existing user sessions were preserved.
- Restarted the local backend and Nanoville. Verified the live studio at `http://localhost:43188` selects `qwen3:4b`, blocks an MLX model with judging enabled, and re-enables starting after choosing the supported model. Old engine sessions remain readable/exportable; start a new session to use the changed engine.

This initial standard-runner restriction was superseded by the all-model compatibility workflow below.


## All-model judge compatibility — 23 October 2026

- Removed model restrictions and the `supportsJudge` flag. All catalog models can create judge-enabled sessions. The selected model is retained throughout; no helper model is substituted.
- Added a cached enforcement probe. Schema-capable runners retain the compact JSON review path. Other runners, or invalid complex responses, use independent short-answer questions with bounded field retries. Chorus resolves judge-selected excerpt IDs into exact canvas citations, validates sentences and ratings, derives the verdict, and serializes the public review. Partial feedback never commits. Private journals and unpublished drafts are excluded from every question.
- 97 backend tests passed, covering every catalog model, capability probing, schema echoes, wrapped choices, invalid/ambiguous answers, citation safety, context limits, token accounting, cancellation and resuming a failed review without repeating participants. Frontend checks passed: lint, types, builds, 7 Nanoville unit/component tests and 10 browser journeys across both applications. The 20-turn MLX journey explicitly exercises three text-path checkpoints and the final review.
- Live reviews passed on saved pricing discussions using all five installed catalog models: `qwen3:4b`, Qwen 3.5 MLX 0.8B/2B/4B, and Gemma 4 E2B MLX. Each installed MLX model passed checkpoint, final and empty-canvas final cases. The standard Qwen model passed checkpoint and final reviews through schema enforcement.
- `gemma4:e4b-mlx` is not installed locally. Its compatibility path is covered by deterministic tests; live generation was not tested for that entry.
- Verified the live studio enables judging for every catalog entry. The engine version is now `discussion-v23-python4`; existing sessions stay readable and exportable, and new runs use the compatibility workflow.

- An isolated copy of the five-slot pricing discussion resumed through a real Qwen 0.8B MLX checkpoint, then committed an early-stop final review that included the published checkpoint feedback. Participant slots and the canvas stayed unchanged; the user database was not modified.


## Private adversaries — 30 October 2026

- Added session-level `adversaryIds` with strict validation, immutable assignments, backward-compatible empty defaults, and CLI support through `--adversaries`. Assignments persist in observer snapshots/events/JSON exports, without changing catalog personas or energy/confidence rules.
- Regression coverage checks zero/one/all assignments; invalid IDs and duplicates; private prompt isolation for each participant; ignorance of fellow adversary assignments; removal of conflicting cooperation guidance; canvas/speech/journal retries; valid weak proposals; unchanged evidence protections; cancellation, restart, resume, and early stop; old stored records; and API/CLI configuration.
- Checkpoint/final judge inputs are identical for the same public work regardless of assignments, including compatibility questions and retries. Other participants' prompts are likewise identical. Private journals remain excluded from model context and ordinary exports.
- Full Python suite passed: 147 tests. Both frontend browser suites passed against real Chorus and fake Ollama after the final prompt changes.
- Live isolated two-turn Qwen 3 4B comparisons covered zero, one, and multiple adversaries. Initial cooperative responses motivated clearer baseline-persona labels, explicit turn-level obstruction, a weak initial-plan example, and placing the private assignment after shared rules. Revised runs produced broad proposals, missing safeguards, and contradictions; a cooperative peer attempted repairs. Compliance and public explanations still vary. These smoke checks do not establish a measured sabotage success rate.
- Refreshed the idle local Chorus and Nanoville services after the existing run finished. Verified all 14 saved sessions were unchanged apart from the new empty configuration field. Existing-engine sessions remain readable/exportable; new sessions use `discussion-v25-adversaries`.


## Model providers — 30 October 2026

- Backend suite: 171 tests passed, including 24 new provider cases. Simulated OpenAI Responses cover structured canvas unions, participant speech, private journals, checkpoints, final reviews, usage, credential/error sanitization, rate limits, timeouts, refusals, invalid responses, and cancellation.
- The router preserves Ollama's MLX structured-output probe and validated text-review compatibility path. Catalog availability remains usable when Ollama is offline. Retired-model sessions remain readable/exportable and cannot resume.
- Live isolated one-turn runs with Qwen 3.5 0.8B MLX and 4B MLX both completed with final reviews and no transport errors. Neither accepted a canvas edit; both retained an empty canvas. These are smoke checks, not evidence of reliable canvas generation.
- CHORUS_API_KEY is absent from the local Chorus environment, so live GPT-6-Luna authentication, account access, and output quality have not been verified. Deterministic tests do not establish live-provider acceptance.
- Refreshed the local backend and verified the three-entry live catalog, with both MLX entries available and OpenAI explicitly unconfigured. Existing user sessions were not changed by the isolated model checks.


### Live OpenAI follow-up — 30 October 2026

After the user configured CHORUS_API_KEY in Chorus's .env, restarted the backend and refreshed Nanoville. The live catalog and UI show GPT-6-Luna available. An isolated one-turn GPT-6-Luna session completed with an accepted participant contribution, a 4,564-character canvas, one private journal, and a validated final judge review. The temporary database was deleted after verification; saved user sessions were not used for the smoke check. This verifies live authentication and the canvas/speech/journal/final-review path for this short run, not general output quality or checkpoint reliability.


### Twenty-turn Luna session with Casey as adversary — 30 October 2026

Session `6afefa20-469b-4bd6-8ff9-c3e4c71dffed` used the first challenge, its five default agents, Casey Patel as the only adversary, the default Corporate meeting room, GPT-6-Luna, 20 turns, and judging enabled. Execution initially paused after four turns when malformed model-authored JSON was rejected by the OpenAI adapter before generation's validation retries. Changed the adapter to unwrap a valid result envelope while leaving malformed or unwrapped model text to the existing validators. Transport-envelope errors and refusals still pause safely. Added retry/exhaustion regressions: all 173 backend tests passed. Restarted Chorus and resumed the same saved session. It completed 20 accepted agent turns, no skipped turns, three checkpoints, and a final review; the saved canvas is 5,663 characters. This is one observed run, not a reliability or adversarial-effectiveness measurement.


## OpenRouter integration — 30 October 2026

- Python suite: 215 tests passed. Added exact OpenRouter model routing, strict schema requests, independent key availability, credit/rate-limit/authentication errors (including errors embedded in HTTP 200), malformed responses, cancellation, token accounting, bounded canvas retries, and required reasoning-budget context checks. Existing OpenAI/MLX behavior remains covered.
- Mocked six-turn sessions exercised all three OpenRouter models through canvas, speech, journals, checkpoints, and final judging; private journals remained absent from participant/judge input and public snapshots.
- Live isolated one-turn sessions completed for `deepseek/deepseek-v4.1-flash-1017`, `minimax/minimax-m3.1-flash`, and `z-ai/glm-5.3-flash`, each with a committed agent contribution, a private journal, and a final review. None accepted a canvas edit; the empty canvas was preserved normally. This confirms live API access and the short execution path, not reliable canvas generation or model quality.
- MiniMax and GLM require reasoning on their current OpenRouter routes. Requests use low effort, exclude reasoning from returned content, and add 2,048 tokens to the bounded total completion allowance. DeepSeek accepts reasoning disabled. Token usage includes provider-charged reasoning tokens.
- User sessions were not used for live checks; temporary smoke databases were deleted afterward. Keys remain in the ignored backend `.env` and are absent from frontend contracts and logs.


## Provider caching and response usage — 1 November 2026

- Backend: 242 tests passed. New coverage distinguishes cache reads, writes, explicit zero and missing/invalid metadata; counts the actual successful speech call separately from retries and observer journals; verifies stable prefixes and cache identities; and checks cancellation, skipped turns, judge capability probes, migration from schema 1, and restart persistence. Structured-output schemas now count toward conservative preflight budgets.
- Shared contracts and usage UI regenerated from Chorus. Nanoville passed lint, types, 25 unit/component/client tests, production build and 14 browser journeys. chorus-web passed lint, types, production build and 22 browser journeys, including cache-hit metadata, mobile horizontal-scroll containment, reload and skipped-turn accounting.
- Isolated paid-provider pilot: direct GPT-6-Luna reported 2,266 cached input tokens out of 2,281 on both follow-up calls. DeepSeek through OpenRouter reported 2,304 cached out of 2,433 on one follow-up; the next call missed despite the same reported provider. See docs/cache-pilot-2026-11-01.json. This verifies cache-read reporting, not a guaranteed hit rate or whole-session savings.
- Initial GPT scoped probes exposed the 64-character prompt_cache_key limit. Shortened opaque keys, added a regression assertion and repeated the successful pilot. Whole-response caching remains disabled on OpenRouter.

### Skipped-turn diagnostics follow-up (1 November 2026)

- Investigated the reported first-turn Analyst skip and a five-slot run with three skips. API requests generated token usage; all three spoken drafts in each skipped slot failed application validation. Earlier records contain no rejection reason or draft text, so the exact failed rules cannot be recovered. Two isolated reproductions passed; these do not establish the original rejection cause or a production improvement rate.
- Brief speech now targets one useful point with space below the unchanged 180-character/30-word hard limits. Retries report actual character and word counts and the specific failed length checks. New canvas/speech validation results are saved separately from publication, without draft text.
- Skipped-turn displays aggregate known cache reads, mark partial counts, and explicitly identify context from the last attempted spoken response. Validated edits discarded with the skipped turn are distinguished from rejected calls. Older validation metadata remains unknown.
- Verification: 243 backend tests; Nanoville lint/types, 27 unit/component tests, production build and 14 browser tests; chorus-web lint/types, production build and 22 browser tests. Browser suites ran sequentially. Restarted the idle local backend and both frontends; saved completed sessions remain available and all three service health checks return 200.
- Restarted the idle local Chorus backend after a restricted-permission SQLite backup. Migration 2 added the metadata-only call ledger; all 20 existing sessions remained readable with unchanged statuses.
- Stage 1 only: the current enforced context cap remains 32,768. Durable per-agent message histories, compaction and broader cost reconciliation remain in the implementation plan.


## PR validation follow-up — 2 November 2026

All 268 Python tests passed again before PR creation. Shared SDK record inspection now scopes asynchronous results to the session, record kind, and agent, preventing conversation records from being rendered as reasoning summaries during tab changes. Optional missing text renders safely. Both generated frontends carry the same fix and browser regression coverage.
