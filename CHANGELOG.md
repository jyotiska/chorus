# Changes

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
