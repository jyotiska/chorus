<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Chorus harness ownership

Use Node 24 and `npm run check`. The default home page uses the independent-agent v2 harness. All model calls, prompts, tool authorization, scheduling, persistence, accounting, and verification belong in Chorus.

`lib/api/chorus/harness-workspace.tsx`, its CSS, client, and contracts are generated from `../sdk/`. Modify the canonical shared source and regenerate with `../.venv/bin/python ../scripts/export_contracts.py`; do not hand-edit copies. Keep the proxy transport-only and credentials in Chorus.

Luna is the default. Problems auto-select relevant editable rosters; rerenders cannot overwrite user selections. Turn caps are per agent. Board posts stay at one level with valid @mentions, one or two sentences, <=60 words/400 characters. Summaries describe stated decisions; peers cannot read them, while the final judge can. Energy/confidence are absent from new sessions. Canvas writes require an exclusive fenced lease and atomic changelog. Published actions survive later failure; late cancelled work cannot publish. The judge runs once after the frozen completion barrier, reads only, and cannot overrule deterministic verification.

Render backend usage without inventing missing counts or charges. Keep reported/estimated cost and covered/unknown values distinct. Historical v1 work remains readable through `/archive` and direct session URLs. Explicit test switches preserve old regression coverage; production legacy writes are disabled. Run browser suites sequentially using their isolated databases and ports 3111/43191/11436.
