# Checks and test guide

Run the same checks as CI:

```bash
uv sync --locked --extra dev
npm ci --prefix web
cd web && npx playwright install chromium
cd ..
.venv/bin/python scripts/check.py
```

Use `--python-only` for engine work before the final full pass. CI runs the main Linux checks with Python 3.11 and Node 24, plus a separate Linux job for real Docker workspaces in Chromium and WebKit. Both jobs use fake providers and work from the Chorus checkout alone.

The check command prepares public, hash-verified tiktoken encoding data in ignored `.cache/tiktoken/` before tests. The first run needs internet access for this setup download, with a two-minute timeout; it makes no model calls. For direct pytest runs, first run `.venv/bin/python scripts/prepare_tokenizer.py` and set `TIKTOKEN_CACHE_DIR="$PWD/.cache/tiktoken"`. Tests themselves continue to block external connections.

## What is covered

- Engine state, task phases, tool permissions, saved records and recovery.
- Cancellation, duplicate operations, leases and late publication.
- Provider routing, errors, token/cost reporting and unknown values using fake transports.
- Deterministic benchmark answers and frozen model judging.
- Git workspaces, conflicts, starter safety and missing-template API errors.
- Preview source pinning, exact committed file export, supported repository images, and Markdown rendering, raw text and wrapped syntax highlighting.
- Launcher supervision, CLI shutdown, immediate relaunch on the same ports, and active port conflicts.
- Generated contracts, shared-client copies and web behavior through Chromium.
- Repository output policy and the 5 MiB file limit.

Python coverage includes branches and writes `coverage.xml`; it excludes execution in browser/API subprocesses. CI retains reports for seven days, outside Git. Use the latest check output for counts rather than a static passing-test total.

Normal Python tests block external connections. Local test servers are allowed. The test configuration disables .env loading and clears provider settings; individual tests supply synthetic credentials and mock responses. Browser tests use a dedicated fake Ollama server, starter fixtures, temporary databases and workspace directories. Ports 3111, 43191 and 11436 must be free.

## Check real Docker workspaces

Use a dedicated Compose project and the fake provider fixture. Run this suite separately from the other browser tests. Override `CHORUS_WEB_PORT` and `CHORUS_PREVIEW_PORT` if either default is in use.

```bash
docker compose --env-file /dev/null -p chorus-test -f compose.yaml -f tests/fixtures/runtime-compose.yaml up -d --build --wait
cd web
npx playwright install chromium webkit
npx playwright test -c playwright.docker.config.ts
cd ..
docker compose --env-file /dev/null -p chorus-test -f compose.yaml -f tests/fixtures/runtime-compose.yaml down --volumes
```

Chromium and WebKit exercise startup of both bundled services, stop and failed startup, a lockfile install through a fake registry, concurrent previews, a real PTY, temporary workspace isolation, manual port forwarding, HTTP forms and redirects, WebSockets, and iframe history controls. The suite uses its own volume and a fake model provider. The same commands work on Linux and Docker Desktop.

## What is not proven

Passing software tests does not prove that a model reliably solves tasks, that teams outperform single agents, or that generated apps run correctly. Paid-provider studies are separate and must be explicitly requested and bounded. `scripts/smoke_harness.py` makes real calls and writes ignored `results/` output; it is never part of normal checks.

Long-run capacity, browser offline recovery and total experiment resource budgets remain further work. The Docker fixtures cover the bundled Node startup path. Generated apps with other build or runtime requirements can be launched manually when the required tools are available. Native Windows is unsupported; use WSL.

Historical test notes are [archived](docs/archive/test-history.md); their counts and environment assumptions are not today's checks.
