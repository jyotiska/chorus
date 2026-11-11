# Contributing to Chorus

Chorus contains the Python engine, the web interface and a shared client. Nanoville is a separate repository. You do not need it to develop Chorus.

## Set up

Use macOS or Linux, Git, Python 3.11 or newer, Node 24 and uv. Windows users should use WSL; native Windows is not supported because the engine uses POSIX file locks.

```bash
python3 -m pip install uv==0.9.8
uv sync --locked --extra dev
npm ci --prefix web
cd web && npx playwright install chromium
cd ..
.venv/bin/chorus doctor
```

The lockfiles are `uv.lock` and `web/package-lock.json`. Normal setup must not rewrite them. Model keys are needed only for real experiments. Built-in starters and test fixtures require no sibling checkout.

## Check your changes

```bash
.venv/bin/python scripts/check.py
```

This checks repository policy, the Python lock, basic Python lint, formatting for the new maintenance modules, gradual Python type checking, Python tests and coverage, generated contracts, web lint/types/build/browser tests, and high/critical npm audit findings. Python formatting and type checking have an explicit initial scope in `scripts/check.py` and `pyproject.toml`; expand it as modules are improved. Existing Python code is not fully type checked.

The check command prepares public, hash-verified tiktoken encoding data in ignored `.cache/tiktoken/` before tests. The first run needs internet access for this setup download, with a two-minute timeout; it makes no model calls. For direct pytest runs, first run `.venv/bin/python scripts/prepare_tokenizer.py` and set `TIKTOKEN_CACHE_DIR="$PWD/.cache/tiktoken"`. Tests themselves continue to block external connections.

For a faster engine-only pass, use `--python-only`. CI runs Python on Linux (3.11 and 3.13) and macOS (3.11), with the full browser suite on Linux. Browser tests use ports 3111, 43191 and 11436. Run them sequentially, separately from Nanoville tests. Test subprocesses use temporary data and disabled .env loading; normal Python tests block non-loopback connections.

Reports go to ignored paths or short-lived CI artifacts. Test reports are not research evidence. See [the test guide](TEST_PLAN.md).

## Find the right source

- Engine and app experiments: `chorus/harness/`.
- Providers: `chorus/llm/`. Never add keys or model calls to the web app.
- HTTP routes: `chorus/harness/routes.py`; stable errors: `chorus/error_codes.py`.
- Web-specific views: `web/components/` and `web/app/`.
- Shared UI/client: `sdk/`. Files copied to `web/lib/api/chorus/` are generated.
- Old sessions: legacy engine modules and `/api/v1`. Keep their saved data readable.

After editing contracts or shared client/UI source:

```bash
.venv/bin/python scripts/export_contracts.py
.venv/bin/python scripts/export_contracts.py --check
```

The default command changes only Chorus. An explicitly requested `--nanoville /path/to/nanoville` export is the only way to update that separate consumer; run its own checks afterwards.

## Common contributions

**Add a benchmark problem:** extend the harness catalog and answer schema, implement its deterministic check in `verification.py`, and add correct, wrong and malformed-answer cases. Do not use judge prose as the correctness check.

**Add a persona or app role:** use the appropriate benchmark or experiment catalog. Keep IDs stable and test selection/visibility. Generate original artwork with the existing script if needed.

**Add a provider:** implement the transport boundary, route explicitly, and test failures, cancellation and usage with mock transports. Do not silently substitute another model or invent unknown costs.

**Add a tool:** define its schema and phase permissions, validate input, and preserve operation identity, cancellation checks and atomic publication. Add regressions for unauthorized and repeated actions.

**Change a screen:** keep engine behavior in Python. Edit shared views in `sdk/` and regenerate; edit app-only views in `web/`. Check keyboard access and errors as well as the happy path.

## Keep the repository small and safe

Do not commit real experiment results, session exports, generated app workspaces, local databases, downloaded datasets, model weights, recordings or other large generated files. Keep them outside the checkout or under ignored `results/`, `exports/` or `artifacts/`. Small synthetic fixtures, generated API contracts and intentional documentation images belong in Git.

Before committing, stage the intended source files and run:

```bash
.venv/bin/python scripts/check_repository.py --staged
```

CI checks the full index, rejects tracked ignored output and files larger than 5 MiB, and permits only exact-path size exceptions reviewed in that script. Never force-add ignored results. Gitignore alone is not a size or secret scanner. Put large research artifacts in a separate storage/release location, reviewed for privacy, and link to them if appropriate.

## Submit a change

Keep each pull request focused. Explain the problem, behavior, checks and compatibility impact. Add meaningful tests for behavior changes. If execution or prompts change, update the appropriate engine/prompt version and document how older runs behave. Use only `AGENTS.md` for agent instructions.

Contributions are under [Apache 2.0](LICENSE). Include the origin and license of any third-party material. See [security](SECURITY.md) for private reporting and [architecture](docs/chorus-architecture.md) for boundaries.
