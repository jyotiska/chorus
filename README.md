# Chorus

A personality-driven multi-agent AI framework. Give agents distinct personalities, let them talk, watch emergent behaviour unfold.

## What it does

Chorus runs structured conversations between AI agents, each with a defined archetype, traits, and description. Agents stay in character, build on each other's ideas, disagree constructively, and produce richer outputs than a single LLM call ever could.

```
─── Turn 1 ─────────────────────────────────────────
Optimist
   I think we should absolutely go for it. The market window is
   open, our core features are solid, and early user feedback
   has been overwhelmingly positive. Shipping beats perfection.

─── Turn 2 ─────────────────────────────────────────
Pessimist
   I hear the enthusiasm, but have we stress-tested the auth
   system? Last month's load test showed 3x latency under peak.
   Launching with a broken login is worse than launching late.
```

## Installation

Requires Python 3.11+.

```bash
git clone https://github.com/jyotiska/chorus.git
cd chorus
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .
```

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

## Quickstart

```bash
# Run a debate between two agents
chorus run --session chorus/templates/sessions/debate.yaml

# Run interactively — inject messages, pause between turns
chorus run --session chorus/templates/sessions/debate.yaml --interactive

# Run a three-agent creative session
chorus run --session chorus/templates/sessions/creative_team.yaml

# Override the topic on the fly
chorus run --session chorus/templates/sessions/debate.yaml --topic "Should we rewrite in Rust?"
```

## LLM Providers

Chorus supports Anthropic, OpenAI, and Ollama (local models). Set the provider in your session YAML.

### Anthropic

```yaml
provider: anthropic
model: claude-sonnet-4-6   # optional, defaults to claude-sonnet-4-6
```

Requires `ANTHROPIC_API_KEY` in your `.env`.

### OpenAI

```yaml
provider: openai
model: gpt-4o   # optional, defaults to gpt-4o
```

Requires `OPENAI_API_KEY` in your `.env`.

### Ollama (local)

Run models locally with [Ollama](https://ollama.com). No API key needed.

```bash
ollama pull qwen3:0.6b
chorus models list   # see what's available
```

```yaml
provider: ollama
model: qwen3:0.6b
```

## CLI Reference

```bash
# Sessions
chorus run --session <path>            # run a session
chorus run --session <path> --interactive  # run with user interjection

# Agents
chorus agents list                     # list all agent definitions
chorus agents inspect <name>           # show an agent's config and traits

# Models
chorus models list                     # list locally available Ollama models
```

## Configuration

### Agent definition (`agents/my_agent.yaml`)

```yaml
name: Architect
archetype: analytical
traits:
  - detail-oriented
  - pragmatic
  - cautious
description: >
  A systems thinker who builds frameworks and evaluates options
  methodically. Prefers evidence over intuition.
```

Available archetypes: `analytical`, `creative`, `leader`, `support`, `contrarian`

Available traits: `optimistic`, `pessimistic`, `cautious`, `bold`, `empathetic`, `pragmatic`, `visionary`, `detail-oriented`, `collaborative`, `independent`

### Session config (`sessions/my_session.yaml`)

```yaml
topic: "What should our product's core differentiator be?"
max_turns: 10
agents:
  - architect
  - creative
  - critic
provider: anthropic
model: claude-sonnet-4-6   # optional
```

The `agents` list references YAML filenames (without `.yaml`) in the agents directory.

## Project Structure

```
chorus/
├── chorus/
│   ├── cli/              # Typer CLI entrypoint
│   ├── core/             # Agent, personality, shared types
│   ├── llm/              # LLM adapters (Anthropic, OpenAI, Ollama)
│   ├── orchestration/    # Session runner and turn management
│   ├── parsing/          # Structured + fuzzy XML response parsing
│   ├── config/           # YAML config loading and validation
│   └── templates/        # Bundled agent and session definitions
├── tests/
├── docs/
└── pyproject.toml
```

## Running Tests

```bash
pip install -e ".[dev]"
pytest tests/ -v
```

## Roadmap

| Milestone | Focus | Status |
|---|---|---|
| M0 · Foundation & CLI | Two agents talking in a terminal | ✅ Done |
| M1 · State, Memory & Identity | Agents that remember and evolve | Planned |
| M2 · Multi-LLM Backends | Per-agent model assignment | Planned |
| M3 · Relationships & Trust | Asymmetric trust graph | Planned |
| M4 · Task System & Phases | Brainstorm → Plan → Execute → Review | Planned |
| M5 · Safety Framework | Guardrails, alignment monitoring | Planned |
| M6 · Observability | Structured logging, session replay | Planned |
| M7 · Persistence & Recovery | Pause/resume sessions | Planned |
| M8 · Web Dashboard | Real-time session visualisation | Planned |
| M9 · Safety Research | Experiment framework, deception detection | Planned |

## License

MIT
