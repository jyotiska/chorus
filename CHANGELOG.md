# Changes

## 24 November 2026 — Docker and repository workspaces

- Docker Compose starts the full Chorus app and keeps experiments in a persistent volume.
- **Run** starts the generated frontend and backend in an isolated workspace and opens the frontend in **Browser**. **Terminal** connects to a shell in that same workspace and can forward ports for manually started servers.
- **Repository** shows read-only, wrapped source with syntax highlighting. Markdown opens in **Preview** with a **Raw** option.
- `chorus stop` shuts down the local launcher or a Compose stack. The source launcher can immediately reuse its ports after shutdown.
- A Docker test job exercises real workspaces in Chromium and WebKit with a fake provider.

## 11 November 2026 — contributor setup and repository quality

- Bundled dependency-free frontend/backend starters replace the external sibling-folder requirement. Existing experiment workspaces are unchanged.
- Starter imports exclude private configuration and generated data, reject links/special files, and enforce file/project size limits.
- Stable experiment error codes now match generated API/client contracts.
- `chorus doctor` checks local setup; locked dependencies and `scripts/check.py` provide a repeatable contribution gate.
- The check command prepares public tokenizer data explicitly before network-blocked tests, avoiding hidden machine-cache dependencies.
- One Linux CI job checks Python and browser behavior, coverage, generated-file drift, dependency findings and repository file policy. Automatic dependency-update PRs are disabled.
- Current architecture diagrams, contributor guidance, Apache 2.0 licensing, citation metadata and security guidance are included. AGENTS.md is the only agent instruction format.
- Real pilot results and generated browser/PDF output are removed from tracking; local copies and published Git history are preserved.
- Next is updated to 16.4.6 and compatible dependency fixes are locked. Low/moderate audit findings remain documented in SECURITY.md.

This update does not change scheduling or judging semantics, run paid studies, execute generated apps, or add overall experiment resource budgets. Nanoville remains separate.
