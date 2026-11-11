# Checks and test guide

Run the same checks as CI:

```bash
uv sync --locked --extra dev
npm ci --prefix web
cd web && npx playwright install chromium
cd ..
.venv/bin/python scripts/check.py
```

Use `--python-only` for engine work before the final full pass. CI checks Linux Python 3.11/3.13 and macOS Python 3.11. Full web checks run on Linux with Node 24. No real provider credentials or sibling repositories are required.

## What is covered

- Engine state, task phases, tool permissions, saved records and recovery.
- Cancellation, duplicate operations, leases and late publication.
- Provider routing, errors, token/cost reporting and unknown values using fake transports.
- Deterministic benchmark answers and frozen model judging.
- Git workspaces, conflicts, starter safety and missing-template API errors.
- Launcher supervision and port conflicts.
- Generated contracts, shared-client copies and web behavior through Chromium.
- Repository output policy and the 5 MiB file limit.

Python coverage includes branches and writes `coverage.xml`; it excludes execution in browser/API subprocesses. CI retains reports for seven days, outside Git. Use the latest check output for counts rather than a static passing-test total.

Normal Python tests block external connections. Local test servers are allowed. The test configuration disables .env loading and clears provider settings; individual tests supply synthetic credentials and mock responses. Browser tests use a dedicated fake Ollama server, starter fixtures, temporary databases and workspace directories. Ports 3111, 43191 and 11436 must be free.

## What is not proven

Passing software tests does not prove that a model reliably solves tasks, that teams outperform single agents, or that generated apps run correctly. Paid-provider studies are separate and must be explicitly requested and bounded. `scripts/smoke_harness.py` makes real calls and writes ignored `results/` output; it is never part of normal checks.

Long-run capacity, browser offline/restart recovery, total experiment resource budgets and generated-app execution remain further work. Native Windows is unsupported; use WSL.

Historical test notes are [archived](docs/archive/test-history.md); their counts and environment assumptions are not today's checks.
