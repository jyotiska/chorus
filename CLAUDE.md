# Chorus development guidance

Chorus is the Python framework and local FastAPI backend for Nanoville and chorus-web. Nanoville's ported behavior is the standard. The old state/memory engine and YAML runtime have been replaced.

Read README.md and TEST_PLAN.md before changes. Keep HTTP routes in `chorus/routers/` and shared application logic in `chorus/services/`. Keep CLI commands thin. Use typed Python and Pydantic contracts. Persist through SQLAlchemy repositories; do not write raw SQL. Keep model calls outside database transactions.

The SQLite store has exclusive process ownership. Use one API runner process. Session revisions and operation identity protect atomic commits, cancellation, and duplicate commands. Retain full public history; context overflow pauses safely. Skipped speech discards its proposed edit and journal. Journal failures preserve public work. Journals are observer-only and never enter participant/judge prompts or public events.

API errors use `{error: string, code: string, requestId: string}` with stable error codes and appropriate HTTP status. Never expose provider addresses or credentials through client configuration. Default ports: Chorus 43187, Nanoville 43188, chorus-web 43189.

Pydantic models are the contract authority. After changing contracts or `sdk/client.ts`, run `scripts/export_contracts.py` in the project Python environment; commit the generated schema/types/client in both frontends. Never add frontend model execution or session scheduling logic.

Run `.venv/bin/python -m pytest` for applicable changes. Preserve ported behavior and add regression cases for changed invariants. Run frontend verification after contract changes. Document any unavailable checks. Never log prompt or journal contents. Update the prompt version when generation instructions change.

Each snapshot records ENGINE_VERSION. Bump it when prompt instructions, execution settings, or session semantics change. Sessions from another engine version stay readable but cannot silently resume under changed behavior.
