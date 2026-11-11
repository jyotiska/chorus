# Chorus contributor and agent rules

Use only `AGENTS.md` for coding-agent guidance. This file applies to the repository; `web/AGENTS.md` adds interface rules. Do not add CLAUDE.md files or duplicate instruction files.

## Ownership and setup

Read README.md, CONTRIBUTING.md, TEST_PLAN.md and docs/chorus-architecture.md. Python engine: `chorus/`; integrated web: `web/`; canonical shared client/UI: `sdk/`. Nanoville remains a separate repository. Do not change or export to it unless explicitly requested.

Use Python 3.11+, Node 24 and Git on macOS/Linux (Windows through WSL). Install with `uv sync --locked --extra dev` and `npm ci --prefix web`; run `.venv/bin/chorus doctor`. Bundled app starters live in `chorus/harness/starters/`. No sibling checkout or model credential is needed for normal tests.

## Current behavior

The web home page creates app experiments with ten available roles and six selected by default. Plan, Build and Judge are separate phases. The judge is mandatory and may use a separate model. There is no benchmark-style turn cap in this mode. Agents inspect/write code but cannot execute application commands or browser tests.

CLI/API benchmarks use five checked problems, a separate fifty-persona catalog, independent workers and per-agent budgets. Deterministic verification is authoritative; optional model judging evaluates collaboration. Do not apply benchmark-only rules to app experiments. `/api/v1` is historical and read-only in production; preserve saved-run compatibility.

## Data and execution boundaries

All providers, prompts, tools, scheduling, persistence, accounting and evaluation belong in Python. Keep the web proxy transport-only and model credentials out of the browser. Do not substitute models silently. Stable service/API error codes live in `chorus/error_codes.py`.

Use one API process per SQLite store. Persist through SQLAlchemy repositories, with model calls outside transactions. Serialize commits against current state. Preserve operation/command IDs, expected revisions, cancellation generations and fenced leases; stale or cancelled work cannot publish. Published actions survive later failure.

Benchmark canvas edits require an exclusive fenced lease with an atomic changelog. Benchmark turn/call/tool/repair budgets survive resume. In app experiments, preserve phase/actor authorization, authoritative SPEC state, assigned Git worktrees, local PR history and frozen judge evidence. A model review is not proof that generated code works.

Keep author-only stated summaries and observer-only historical journals out of peers' context. Never request or store provider-private reasoning. Keep private adversary assignments out of judge context. Respect API visibility before and after experiment completion/kill. Do not silently truncate or delete archived history.

Meter dispatched attempts, including failures, retries, cancellations and judging. Unknown usage/cost remains unknown. Distinguish reported and estimated charges; preserve rate snapshots and weighted aggregates. Routine logs contain safe metadata, never credentials, prompts, board text, tool payloads or summaries.

## Source and checks

Pydantic contracts are authoritative. Edit shared UI/client files in `sdk/`, never their copies under `web/lib/api/chorus/`. Run `.venv/bin/python scripts/export_contracts.py`; default export touches only Chorus. Use `--check` to detect drift without writes. Nanoville export requires explicit `--nanoville /path/to/nanoville` and its own checks.

Run `.venv/bin/python scripts/check.py` before committing. Browser suites use isolated databases, fake providers and ports 3111/43191/11436; run sequentially. Add meaningful regressions for changed permissions, concurrency, recovery, verification, accounting or contracts. Expand the scoped Python lint/format/type baseline as modules improve; avoid unrelated mass formatting.

Bump the appropriate engine/prompt versions when execution semantics change and document saved-run compatibility. Starter/default setup changes must not rewrite existing workspaces. Never run paid-provider pilots as routine tests.

## Repository policy

Do not commit real experiment results, session exports, generated app workspaces, databases, model weights, downloaded datasets, recordings or large generated files. Use ignored results/, exports/, artifacts/ or external storage. Keep small synthetic fixtures, generated contracts and intentional documentation images versioned. Never force-add ignored output.

Run `.venv/bin/python scripts/check_repository.py --staged` before committing. The full check and CI enforce a 5 MiB tracked-file limit and reject ignored output or CLAUDE.md files. Any exact-path size exception needs review and a written reason. Preserve local copies when removing tracked results; do not rewrite published Git history without explicit authorization.
