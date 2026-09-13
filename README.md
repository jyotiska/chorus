# Chorus

A personality-driven multi-agent AI framework. Give agents distinct personalities, let them talk, watch emergent behaviour unfold.

## Research direction

Chorus is evolving into an independent research environment for studying agent behavior under social pressure, conflicting mandates, private information, and human intervention. The [research direction](docs/chorus-architecture.md) sets out the research questions, proposed experiments, AI safety relevance, budget, and implementation priorities. It guides future work; the capabilities described below reflect the current implementation.

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

# Show agent state changes after every turn
chorus run --session chorus/templates/sessions/debate.yaml --verbose

# Pause after each turn with full state and memory view
chorus run --session chorus/templates/sessions/apollo13.yaml --inspect

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
chorus run --session <path>                  # run a session
chorus run --session <path> --interactive    # pause after each turn for user input
chorus run --session <path> --verbose        # show state changes after each turn
chorus run --session <path> --inspect        # full state + memory view after each turn
chorus run --session <path> --topic "..."    # override topic from config

# Agents
chorus agents list                           # list all agent definitions
chorus agents inspect <name>                 # show an agent's config and traits

# Models
chorus models list                           # list locally available Ollama models
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
context: |
  Optional background context injected into every agent's opening prompt.
  Describe the situation, constraints, and relevant facts here.
expectations:
  - What the discussion should produce
  - Specific questions that must be answered
max_turns: 10
agents:
  - architect
  - creative
  - critic
provider: anthropic
model: claude-sonnet-4-6   # optional
```

The `agents` list references YAML filenames (without `.yaml`) in the agents directory.

## Agent State

Every agent carries live state that evolves across the conversation.

**Tier 1 — Core Drives** (slow, personality-anchored, revert to baseline):
`confidence` · `cooperation` · `assertiveness` · `openness`

**Tier 2 — Dynamic State** (fast, situation-driven):
`energy` · `momentum` · `frustration` · `focus`

**Tier 3 — Derived** (computed on the fly):
`mood` · `engagement` · `receptiveness` · `initiative`

State updates use dampened additive composition to prevent wild swings. Personality acts as gravity — agents slowly recover to their archetype's baseline values. Run with `--verbose` to watch state evolve turn by turn, or `--inspect` for the full picture including memory.

## Scenario Library

Chorus ships with 12 ready-to-run scenarios:

| Scenario | Session file |
|---|---|
| Fermi Estimation Chamber | `sessions/fermi_estimation.yaml` |
| Murder Mystery | `sessions/murder_mystery.yaml` |
| Apollo 13 Mission Control | `sessions/apollo13.yaml` |
| Startup Founders' Divorce | `sessions/startup_founders_divorce.yaml` |
| AI Alignment Summit | `sessions/ai_alignment_summit.yaml` |
| The Heist Planning Room | `sessions/heist_planning.yaml` |
| Trolley Problem Factory | `sessions/trolley_problem_factory.yaml` |
| Red Team vs Blue Team | `sessions/red_team_vs_blue_team.yaml` |
| Constitutional Convention | `sessions/constitutional_convention.yaml` |
| Agents Reviewing Their Own Architecture | `sessions/architecture_review.yaml` |
| The Infinite Novel | `sessions/infinite_novel.yaml` |
| The AI Senate | `sessions/ai_senate.yaml` |

All scenarios use `qwen3:0.6b` via Ollama by default. Change `provider` and `model` in the session YAML to use Anthropic or OpenAI.

## Project Structure

```
chorus/
├── chorus/
│   ├── cli/              # Typer CLI entrypoint
│   ├── core/             # Agent, personality, state, memory, types
│   ├── llm/              # LLM adapters (Anthropic, OpenAI, Ollama)
│   ├── orchestration/    # Session runner and turn management
│   ├── parsing/          # Structured + fuzzy XML response parsing
│   ├── prompts/          # 4-stage prompt pipeline and token budget
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

The next stages focus on controlled, reproducible research:

- R0: Establish reproducible baselines and optional behavioral mechanics.
- R1: Record exact inputs, outputs, token usage, and costs.
- R2: Separate private information, mandates, authority, and model assignments.
- R3: Add checkpoints, branching, and mid-conversation interventions.
- R4: Implement checkable scenarios and outcome evaluation.
- R5: Run repeated experiments with explicit budgets and failure accounting.
- R6: Complete and report the first controlled study.
- R7: Extend into adaptive human participation and recovery experiments.

These stages are planned. See the [research direction](docs/chorus-architecture.md) for the scientific scope and the [technical milestone plan](docs/chorus-milestones.md) for implementation details and acceptance criteria.

## License

MIT
