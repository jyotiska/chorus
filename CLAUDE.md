# Chorus development guidance

Chorus owns the independent-agent harness for chorus-web and Nanoville. Read README.md and TEST_PLAN.md before changes. The default engine is `chorus/harness/`, exposed through `/api/v2`; legacy `/api/v1` records retain their original contracts and are read-only in production.

Keep typed Pydantic contracts authoritative. Regenerate the schema, TypeScript, client, and shared workspace copies using `scripts/export_contracts.py`. Modify shared UI in `sdk/harness-*`, never generated frontend copies. `chorus/harness/catalog.json` is the active catalog; legacy catalogs/templates are compatibility material only. Generate packaged original SVG artwork with `scripts/generate_harness_art.py`.

Use one API process and the existing process-owned SQLite store. Persist through SQLAlchemy repositories; no raw SQL in application code. Keep model calls outside transactions. Concurrent workers mutate current state through serialized commits rather than saving stale snapshots. Per-agent counters, operation IDs, session cancellation generations, command IDs, tool identities, and fenced canvas leases protect publication.

New board posts and canvas edits commit independently. Preserve published work if a later action or summary fails. At most three board posts per turn, each one or two sentences and <=60 words/400 characters; @mentions resolve only selected participants and never create threads or extra turns. Every accepted canvas change requires a valid exclusive lockfile lease and version, with its changelog committed atomically. Agent turns and call/tool/repair budgets are durable and cannot reset on Resume.

Structured reasoning summaries contain stated approach, assumptions, evidence, decisions, and uncertainty. Only the author, observer, and final judge can read them. Peers cannot. Never request or store provider-private reasoning. Legacy journals remain observer-only and excluded from all model context. Hidden adversary assignments enter only their owner's instructions; judge prompts never receive assignment metadata.

The final judge starts after a frozen completion barrier and has read-only tools. Correctness follows the deterministic verifier. Qualitative grades cite valid frozen records; incomplete review remains incomplete. Never silently truncate or compact archived history.

Meter each dispatched attempt, including rejected, retried, failed, cancelled, and judge work. Unknown counts/costs stay unknown; cached input is included in input; aggregate percentages are weighted by covered input. Snapshot rates and distinguish estimates from reported charges. Normal logs contain metadata and safe error categories, never prompts, board text, tool payloads, or summaries.

Use stable error codes and sanitized `{error, code, requestId}` responses. Keep credentials/providers in the backend. Default model is `gpt-6-luna`; never substitute silently. Default ports are Chorus 43187, Nanoville 43188, chorus-web 43189.

Run `.venv/bin/python -m pytest` and both frontends' documented checks for cross-project changes. Browser suites run sequentially using fake providers and isolated databases. Add meaningful regressions for changed concurrency, visibility, recovery, verification, and accounting behavior. Bump `chorus/harness/` engine/prompt versions when execution semantics change; incompatible saved runs remain readable. Legacy engine versions must not be silently upgraded.
