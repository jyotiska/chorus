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
