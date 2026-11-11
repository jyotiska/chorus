# Independent agent harness

This note describes the benchmark harness introduced before app experiments. It uses `/api/v2` and remains the CLI benchmark engine; the current Chorus Web home page creates app experiments. Nanoville remains a separate API consumer. It has a shared catalog of 50 personas, five checked problems, Luna as the default model, and independent participant workers. Historical `/api/v1` sessions remain readable and exportable; production v1 writes are disabled.

## Session behavior

Choosing a problem automatically selects its five relevant agents. Change the roster before starting, from two to fifty participants. A session's selected model powers both agents and the final judge. Unavailable Luna credentials require explicitly selecting another model.

The turn cap belongs to each agent. A cycle reserves its slot before generation, permits at most eight model calls, sixteen tool actions, three board posts, and one accepted canvas edit. One call is reserved for a structured reasoning summary. Invalid-output repairs are bounded. Pausing, restarting, or retrying cannot reset consumed budgets.

The board is a single chronological feed. Each post contains one or two complete sentences, no more than sixty words or four hundred characters. Selected peers can be addressed as `@FirstName`; mentions link to profiles and do not create threads or additional turns. Energy and confidence are absent from the new engine.

Agents edit through validated tools and an exclusive per-canvas lockfile. The default lease lasts thirty seconds, can be renewed by the host, and has a two-minute maximum hold. Expiry, cancellation generations, fencing numbers, and an atomic lease check at commit reject stale writes. Every accepted edit and its reconstructable changelog entry commit together.

Board posts and canvas edits publish independently. A later failure leaves already committed work visible. Pause and Stop cancel outstanding work and invalidate its authority. Resume restores each worker's current slot and budgets. Closing the browser does not stop execution.

## Records and usage

SQLite migration 3 adds separate harness sessions, ordered records, revision events, and leases alongside historical tables. Sessions retain problem and persona snapshots, worker states, conversations, model requests and outputs, tool traces, summaries, board messages, canvas versions/diffs, call attempts, and evaluation records. Content stays in the local database; routine logs remain metadata-only.

New reasoning summaries are concise statements of approach, assumptions, evidence, decisions, and uncertainty. The author, observer, and final judge can inspect them. Peers cannot read one another's summaries. Historical journals retain their original observer-only policy. Provider-private reasoning streams are excluded.

Every dispatched model attempt records timing, token counts, cached input, cache-read status, cache utilization, outcome, and cost. Failures, retries, cancellations, and interrupted calls remain in the ledger. Reported and estimated cost are distinct; missing values remain unknown. Aggregate cache utilization uses token-weighted sums over covered calls rather than an average of percentages. Call time excludes provider-slot and canvas-lock waits; session wall time is displayed separately.

Luna estimates use an effective-dated Standard short-context rate snapshot from the [official model page](https://developers.openai.com/api/docs/models/gpt-6-luna), checked on 2 November 2026. Provider-reported charges take precedence. Configure exact-route estimates with `CHORUS_RATES_JSON`; the saved call includes its rate basis. Local API charge is zero and hardware cost is unmeasured.

## Evaluation

After every agent finishes or reaches its cap, Chorus freezes the final canvas and source high-water mark. The final canvas must contain exactly one fenced `solution` block containing the problem's schema-checked JSON answer. Each problem has a deterministic checker; narrative judgement cannot override that result.

The final judge assesses the board on evidence, relevance, coordination, disagreement, and synthesis, and each agent on useful contribution, accuracy, collaboration, stated reasoning-summary quality, and correction handling. Each dimension is scored zero through four, giving totals out of twenty. Source IDs identify supporting records. Evidence review proceeds in persisted batches; an incomplete review remains visibly incomplete and can be retried within its saved call budget. There are no intermediate checkpoints.

## Interfaces and artwork

Both applications use the shared generated SDK workspace. It includes editable automatic rosters, profile portraits, independent progress, aggregate and per-agent accounting, a flat board, canvas lock status, diffs, summaries, conversation/call inspection, final evaluation, and complete exports.

Nanoville adds a scrollable, zoomable research commons for up to fifty participants and a synchronized searchable roster. Each of the fifty personas has an original SVG portrait and a sixteen-frame custom sprite sheet with idle, working, posting, and editing frames. The scene derives activity from backend state and supports reduced motion. Generate assets with `scripts/generate_harness_art.py`; the manifest maps every stable persona ID to complete artwork.

## Verification record

Deterministic verification includes all five positive/negative problem fixtures, concurrency, cap enforcement, lock expiry/fencing, idempotence across interrupted publication, per-agent summary boundaries, accounting, shutdown fencing, and a fifty-worker restart stress case. Both frontend suites retain historical regressions under their explicit test-only archive mode and add current-engine browser journeys.

Raw live smoke-check results are retained outside Git. Small successful live checks establish request compatibility and observed usage only; they do not establish reliable problem solving, judge calibration, or performance at fifty paid agents.

After the inspection-loop correction, Luna and DeepSeek completed their two-agent runs and final reports. Luna's production answer failed the deterministic optimum check; DeepSeek's passed. The local Qwen 0.8B check produced no board/canvas contributions and paused on invalid judge output. Its setup option carries this observed compatibility limitation; the harness preserves the failed trace and never substitutes another model.

## Scope

The selected Nanoville redesign is included. The other previously suggested optional extensions are excluded: no automatic context compaction, arbitrary agent code execution, additional model assignments, extra judge models, experimental branches, or additional spending controls. Context overflow pauses while preserving the complete archive. Saved events reconstruct committed work; live model output is not deterministic replay.
