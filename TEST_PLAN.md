# Chorus test plan

The Python backend is the execution and contract authority. Run deterministic tests without a live model; use an injected model adapter or the fake Ollama server.

## Required coverage

- Contracts: setup bounds, distinct valid participants, supported models, command IDs/revisions, stable errors, OpenAPI/client compatibility.
- Canvas: create/unchanged/replace/append; exact evidence preservation; nested, formatted and Setext headings; ambiguous targets; duplicate siblings; fenced code; HTML rejection; CRLF; untouched source preservation.
- Generation: bounded canvas/speech/journal/review retries; invalid speech skips without committing its edit; unchanged turns count; journal failure preserves public output; journals never enter public model context.
- Reviews: every five slots except the terminal slot; exact criterion coverage; current-canvas citations; complete sentences; empty-canvas handling; early-stop review; failed review resumes without repeating a participant.
- Lifecycle: one active operation per session; late results ignored after cancellation; pause/resume/stop; repeated commands; stale revisions; full-history context overflow.
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
