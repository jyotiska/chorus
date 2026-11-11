# chorus-web test plan

## Dark workspace verification

Run `npm run check` on Node 24. Run the Nanoville suite separately after regenerating the shared SDK. The current harness browser suite uses an isolated real Chorus backend and deterministic model responses. The historical compatibility suite uses its explicit test-only archive switch. The production archive also needs a read-only smoke check because its route differs from that switch.

- **Setup → Edit team.** Check the Luna default, model availability, problem search, roster search, all 50 identities, a profile, manual edits, private adversary selection, a problem switch, the turn cap and the final judge. Retry a failed Start and verify that the same session ID is used.
- **Session rail → live controls.** Switch between saved sessions, reload into the default split view, toggle the split view, copy the session URL, pause, resume, return to setup and stop early. Verify actual backend status after navigation. Check desktop and the phone drawer at 768, 390 and 320 px.
- **Board → Canvas → Back to board.** The real Production mix journey checks visible board posts, mentions, a versioned diff and both download payloads. A controlled long-history fixture checks the exact pixel position of an older post when a new record arrives. On a phone, verify that returning restores focus to that post and that New posts reveals the new contribution.
- **Participants → inspector and Usage.** Check the one-row session totals and horizontally scrolling roster, open an agent directly from the strip, and verify a 50-agent session keeps the board and canvas alongside each other on a tablet. Open a participant's progress, conversation, stated summaries and model calls. Check totals, reported and estimated costs, unknown coverage, and return focus on Escape. Backend accounting tests cover partial and missing counts.
- **Results → supporting record.** Complete a judged run, inspect verification and evidence, reload into Results, and exercise stopped-early and judge-disabled outcomes. Chorus tests cover failed verification, independent workers, fencing, restart recovery, summary permissions and frozen judge reads.
- **Production Archive → historical record.** From the normal archive route open a saved session by its direct URL, read its conversation, download the JSON containing journals, then follow Start a new harness session. Check the dark scheme with the operating system set to light.
- **Visual review.** The suite captures setup, board and canvas, results, phone canvas and the 50-person roster under `test-results/`. Inspect the header while commands change, keyboard focus, reduced motion, recents, long titles and long code lines. The release criterion is that the reader keeps their place while inspecting evidence and the roster size never pushes the board down.

## Independent harness release on 2 November 2026

The default home page uses the shared v2 harness. `npm run check` passed lint, types, production build, and 25 browser journeys. Current-engine cases verify Luna as default, automatic relevant rosters with persistent user edits, exact model selection, the actual tool loop through real Chorus/fake Ollama, concise flat @mentions, source-evidence inspection, structured summaries, per-agent/session accounting, deterministic verification/final grading, complete export, reload recovery, fifty-agent artwork/rosters, reduced motion, and narrow-screen overflow containment.

The remaining legacy journeys run at `/archive` with explicit `CHORUS_LEGACY_TEST_UI` and backend legacy-write switches confined to the test processes. Production archives are read-only. The old assertions below preserve historical compatibility; they do not reintroduce energy/confidence, global turns, or checkpoint judging to the default interface.

Shared UI/client/contracts are generated from Chorus's SDK. Both applications receive the same updates. Browser checks run sequentially with Nanoville; use isolated databases and ports 3111/43191/11436.

## PR validation follow-up — 2 November 2026

Full `npm run check` passed again: lint, type checks, production build, and all 25 browser journeys. The source-evidence selector now follows the evaluation panel's accessible label. The real tool-loop journey explicitly loads conversation records before switching to reasoning summaries and calls, covering the stale-record crash. The shared record loader scopes results to the session, record kind, and agent; absent optional values render safely.

## Historical compatibility cases

chorus-web becomes a Chorus frontend. Verify its own presentation and integration; backend policies belong to Chorus tests.

- Load its scenario/persona collection and supported models from Chorus.
- Start sessions through the shared contract; display authoritative status, speaker, history, canvas and final review.
- Replace raw token/tool streaming with committed results and progress events. Rejected drafts never appear or mutate the canvas.
- Controls call backend commands; no browser model fallback, retry loop, speaker rotation, judge scheduling or canvas editing remains.
- Resume a persisted session after reload without duplicate work.
- Show skipped slots, unavailable models, backend errors and recoverable paused states accurately.
- Verify observer journal loading, unavailable entries, retry, and stale-response isolation. Journals remain outside public discussion, exported canvases, participant inputs, and judge inputs.
- Verify the same-origin proxy preserves errors and event streams.

Run lint, TypeScript checks and production build. Add deterministic client/adapter cases and browser integration smoke tests using real Chorus with an isolated SQLite database and fake Ollama. Verify that both frontends can read/control the same session, and that their application catalogs stay distinct while sharing one engine.

## Latest local verification — 22 October 2026

npm run check passed: lint, TypeScript, production build, and 2 browser integration tests against real Chorus with fake Ollama.


## Live built-in browser verification — 22 October 2026

Started the production application on http://localhost:43189 with real Chorus and Ollama, then exercised:

- Debate, qwen3.5:2b-mlx, five turns, judge enabled: session `35fe7c6c-f5ae-4575-bb8a-fc3db9fd5f0c`. Pause, reload, and resume preserved two committed contributions. Five contributions and a 2756-character canvas were ultimately saved. Final review paused after invalid model replies; retry also paused without data loss.
- Creative Team, gemma4:e2b-mlx, five turns, judge enabled: original session `80c1c360-7129-4680-94f1-3150839f9b0e`; retest after explicit response-contract instructions `02e69c29-59be-4cc4-9b4d-8ebdff635b74`. Retest saved five contributions and a 3255-character canvas, but final review still failed validation and displayed Resume.

Both scenarios passed discussion/canvas display and safe failure handling. Judge completion did not pass real-model acceptance. The prompt clarification has regression coverage, but is not a verified fix for live reviews. The full automated check passed again (two browser tests use fake Ollama).

Screenshots are saved under `output/browser-tests/`, including `creative-team-retest-paused.jpg` and `creative-team-review-status.jpg`.


## Private adversaries — 30 October 2026

- Added per-agent setup assignments, pruning when scenarios change, immutable observer summaries, and restoration from session configuration. The shared Chorus contract carries `adversaryIds`; no prompt policy lives in the browser.
- Full `npm run check` passed: lint, types, production build, and three browser journeys. Browser tests were repeated after the final backend prompt changes. The new journey assigns both agents, completes three checkpoints and a final review, restores assignments on reload, and checks private-assignment isolation on every fake-model call.
- Inspected the setup screenshot in `test-results/adversary-setup.png`. The backend's 147 tests cover validation, persistence/recovery, retries, compatibility judges, old records, and model-input isolation.


## Model providers — 30 October 2026

- `npm run check` passed: lint, type checking, production build, and all five browser integration tests.
- Browser checks assert exactly the two supported MLX models and GPT-6-Luna in provider groups, the Qwen 4B default, OpenAI selection in the submitted session configuration, and missing-key availability without blocking local execution.
- The OpenAI selection test intercepts the session submission; it does not make a paid OpenAI request. Backend transport and all-phase generation coverage live in Chorus's provider tests.


## OpenRouter integration — 30 October 2026

- `npm run check` passed: lint, type checking, production build, and six browser integration tests.
- The six catalog entries render under Local MLX, OpenAI APIs, and OpenRouter. Browser checks verify the DeepSeek selection submits its exact namespaced OpenRouter ID and preserve the existing OpenAI/local journeys.
- Test backend configuration clears OPENROUTER_API_KEY and CHORUS_API_KEY, so browser checks never invoke paid providers.


## Frontend feature parity — 1 November 2026

- Live participant values and profiles use saved session agents, including sessions created in Nanoville. Setup reads its own catalog collection.
- Verify current energy/confidence, personality labels, and latest public reasons; new committed changes animate, while reloads and duplicate events do not replay history.
- Real Chorus/fake-model journeys cover live profiles and journals, reload, pause cancellation, resume, early-stop final reviews, skipped slots, and cross-application sessions.
- Targeted HTTP fixtures cover context-limit/version/retired-model restrictions, journal errors and null entries, delayed responses across session switching, pending-command locks, invalid external data, and duplicate/stale event snapshots.
- Markdown rendering covers headings, lists, tables, skipped raw HTML, unsafe URLs, and generated images without remote fetches. Final judgement uses structured fields and falls back to unknown criterion labels.
- Capture and inspect desktop/mobile screenshots, including an open profile/journal, and check for horizontal overflow at 390px.
- Run the complete `npm run check`. Paid providers are not called; their existing selection and missing-credential checks remain in place.

Validation completed: `npm run check` passed lint, TypeScript, production build, and all 19 browser tests (six existing journeys plus thirteen parity cases). Desktop, mobile, and live profile/journal screenshots were inspected in `test-results/`. No paid provider calls were made. The shared client and generated contracts remain byte-identical to Chorus.


## Latest-first discussion and brief chat — 1 November 2026

- Check newest contributions and checkpoint reviews appear first, retain their original slot numbers, and remain latest-first after reload. The durable backend history stays chronological.
- Agent replies use a two-line preview on desktop and mobile, with full saved text accessible through Read full reply / Show less. Judge feedback stays uncollapsed.
- Chorus applies the brief format only to chorus-web scenarios: one or two sentences, at most 30 words and 180 characters. Oversized drafts retry and cannot silently commit a truncated prefix; exhausted retries preserve the existing skip rules.
- Backend regressions cover boundaries, sentence counts, adversaries, Nanoville prompt compatibility, retries, and discarded pending edits/journals.

Validation: frontend checks passed with all 21 browser tests; Chorus passed all 227 Python tests. The local backend and frontend were reloaded with the changes.


## Response usage display — 1 November 2026

- Full check passed: lint, types, production build and 22 browser journeys.
- Positive cache reads and exact reply counts render separately from turn totals. Mobile checks verify the usage summary wraps, the call table scrolls within its panel, and the page has no horizontal overflow. Reload preserves metrics. Skipped turns retain attempt details without inventing a successful reply.
- The shared display is sourced from Chorus's SDK; its five focused component cases also pass in Nanoville's suite. Backend coverage and the direct OpenAI/OpenRouter cache pilot are recorded in Chorus's TEST_PLAN.md.
