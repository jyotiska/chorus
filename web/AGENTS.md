<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Chorus web guidance

Follow the root `../AGENTS.md` and `../CONTRIBUTING.md`. Use Node 24. The home page creates app experiments (four briefs, ten roles, six initially selected, Plan → Build → Judge). Benchmarks and archive sessions keep their own views and semantics. Do not add benchmark turn caps or optional judging to the app setup screen.

All model calls, prompts, tool authorization, execution, persistence, accounting and verification belong in Python. Keep the proxy transport-only and credentials in the engine.

`lib/api/chorus/` contains generated copies of contracts and shared UI/client sources from `../sdk/`. Edit the canonical source and regenerate with `../.venv/bin/python ../scripts/export_contracts.py`. Do not export to Nanoville without an explicit request.

Keep user-edited team/model choices across rerenders. Render backend usage without inventing missing counts or charges. Preserve distinct reported/estimated/unknown values, live-update cleanup, stale-revision rejection and readable errors. Historical records stay readable via `/archive` and direct session URLs; production legacy writes are disabled.

Run `npm run check` here and the root full check before committing. Browser suites use fake providers and isolated temporary data on ports 3111/43191/11436; run sequentially. Keep generated test reports, screenshots and recordings out of Git. Do not add CLAUDE.md.
