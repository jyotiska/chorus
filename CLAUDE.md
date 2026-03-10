# Chorus — Claude Code Instructions

## Project Overview

Chorus is a personality-driven multi-agent AI framework. Agents have dynamic state, memory, and relationships, and converse in structured task phases. CLI-first, Python-based.

## Project Structure

```
chorus/
├── chorus/
│   ├── cli/              # Click/Typer CLI entrypoint
│   ├── core/             # Agent, personality, types
│   ├── llm/              # Abstract LLMAdapter + provider adapters
│   ├── orchestration/    # Session runner, turn selection, phase manager
│   ├── parsing/          # Structured + fuzzy response parsing
│   ├── memory/           # Episodic, semantic, working memory
│   ├── safety/           # Guardrails, filters, alignment monitoring
│   ├── config/           # YAML config loading
│   └── templates/        # Bundled agent and session YAML templates
├── tests/
├── pyproject.toml
└── CLAUDE.md
```

## Global Rules

- Write code that is easy to read.
- Do not leave TODO comments. Write the actual working code.
- Keep functions small. Each function must do only one thing.
- Read the existing code before writing new code.
- Do not duplicate code. Create shared helper functions instead.

## Backend Rules (Python)

- **Strict Typing:** Use Python type hints everywhere. Do not leave types blank.
- **Folder Structure:** Keep CLI commands thin. Put all routing in a `routers` folder. Put all business logic in a `services` folder.
- **Data Validation:** Use Pydantic models for all incoming and outgoing data.
- **Database:** Use SQLAlchemy. Never write raw SQL queries.
- **Heavy Tasks:** Use background tasks for slow operations (LLM calls, audio processing). Do not block the main response.
- **Error Handling:** Use a central exception handler. Always return errors in this exact format: `{"detail": "Error message here", "code": 400}`.
- **Security:** Never hardcode API keys. Always read them from environment variables.

## Web Dashboard Rules (Next.js — M8 onwards)

- **Strict TypeScript:** Use TypeScript for all files. Never use the `any` type.
- **App Router:** Use Next.js App Router conventions. Keep pages inside the `app` folder.
- **Server vs Client:** Default to server components. Only add `"use client"` if you need browser features like buttons or state.
- **Data Fetching:** Fetch data server-side as much as possible.
- **Component Design:** Keep UI pieces in a `components` folder. Build small, reusable pieces.
- **API Calls:** Put all calls to the FastAPI backend in a separate `api` folder. Do not write fetch calls directly inside UI components.
