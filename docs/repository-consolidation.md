# Chorus repository consolidation

The Chorus engine, CLI, primary web interface, and shared contracts now live in one repository:

- `chorus/`: Python execution engine, API, storage, and CLI.
- `web/`: Next.js interface, transport-only API proxy, and browser tests.
- `sdk/`: canonical shared client and presentation sources, plus generated contracts.
- `scripts/`: contract generation and artwork tooling.

`chorus launch` supervises the API and web processes together. `chorus serve` still runs the API independently. Prompts, provider credentials, scheduling, verification, and persistent records remain engine responsibilities. The frontend continues to use the same HTTP API, and existing database locations and session identities are unchanged.

Nanoville stays in its own repository. Chorus installation, contract generation, and tests no longer require its checkout or dependencies. To update its generated files intentionally:

```bash
.venv/bin/python scripts/export_contracts.py --nanoville ../nanoville
```

The optional argument must point to an existing Nanoville checkout. Run Nanoville’s checks there after exporting, sequentially with Chorus Web’s browser suite.

## Import provenance

The tracked frontend files were imported from `chorus-web` commit `dc08a0d7488f36cebb8422487242226b061585e0` into `web/`. The source checkout was clean. Generated dependencies, build caches, temporary files, and repository metadata were not copied. The original `chorus-web` checkout and its Git history were preserved; it is no longer needed by this repository. Historical plans and test records inside `web/` retain their original project naming.

The migration updates frontend test paths and developer guidance, and moves the contract compiler dependency into `web/package.json`. No execution semantics or API contracts change. Repository experiment starter templates remain in the existing sibling `starter-repos/` location, or at `CHORUS_EXPERIMENT_SCAFFOLD`; that separate experiment input is not bundled by this consolidation.
