# Chorus Development Milestones
## Personality-Driven Multi-Agent AI Framework

> 10 milestones · CLI-first · Multi-LLM · AI Safety at the core

---

## Milestone Overview

```
M0  Foundation & CLI          ██░░░░░░░░░░░░░░░░░░  Weeks 1–2
M1  State, Memory & Identity  ████░░░░░░░░░░░░░░░░  Weeks 3–5
M2  Multi-LLM Backends        ██████░░░░░░░░░░░░░░  Weeks 6–7
M3  Relationships & Trust     ████████░░░░░░░░░░░░  Weeks 8–9
M4  Task System & Phases      ██████████░░░░░░░░░░  Weeks 10–12
M5  Safety Framework          ████████████░░░░░░░░  Weeks 13–15
M6  Observability & Analysis  ██████████████░░░░░░  Weeks 16–17
M7  Persistence & Recovery    ████████████████░░░░  Weeks 18–19
M8  Web Dashboard             ██████████████████░░  Weeks 20–22
M9  Advanced Safety Research  ████████████████████  Weeks 23–26
```

---

## M0 · Foundation & CLI
**Weeks 1–2 · "Two voices in a terminal"**

### Goal
Two agents with distinct personalities hold a multi-turn conversation in the terminal. Everything runs from the CLI. This is the skeleton that every future milestone builds on.

### Deliverables

**Core Agent Runtime**
- `PersonalityAgent` base class with name, traits, archetype, and description
- Simple system prompt construction from personality definition
- Agent response generation via a single LLM backend (OpenAI or Anthropic to start)
- Structured response parsing (XML-based format with `<thinking>`, `<message>`, `<action>`)
- Fallback to raw text parsing when structured parsing fails

**CLI Interface**
- `chorus run` — start a conversation between configured agents on a given topic
- `chorus agents list` — show available agent definitions
- `chorus agents inspect <name>` — display agent config and traits
- Interactive mode: user can observe, inject messages, or pause the conversation
- Colored terminal output with agent names, messages, and basic state indicators

**Configuration**
- YAML-based agent definitions (name, archetype, traits, description)
- YAML-based session config (topic, max turns, agents to include, LLM provider)
- Bundled starter templates: `optimist_pessimist.yaml`, `creative_team.yaml`

**Project Structure**
```
chorus/
├── chorus/
│   ├── __init__.py
│   ├── cli/
│   │   ├── __init__.py
│   │   └── main.py              # Click/Typer CLI entrypoint
│   ├── core/
│   │   ├── __init__.py
│   │   ├── agent.py             # PersonalityAgent
│   │   ├── personality.py       # Traits, archetypes, behavior rules
│   │   └── types.py             # Shared data types
│   ├── llm/
│   │   ├── __init__.py
│   │   ├── base.py              # Abstract LLMAdapter
│   │   └── openai_adapter.py    # First adapter
│   ├── orchestration/
│   │   ├── __init__.py
│   │   └── session.py           # Conversation session runner
│   ├── parsing/
│   │   ├── __init__.py
│   │   └── response_parser.py   # Structured + fuzzy parsing
│   ├── config/
│   │   ├── __init__.py
│   │   └── loader.py            # YAML config loading
│   └── templates/
│       ├── agents/
│       │   ├── optimist.yaml
│       │   └── pessimist.yaml
│       └── sessions/
│           └── debate.yaml
├── tests/
│   ├── test_agent.py
│   ├── test_parser.py
│   └── test_session.py
├── pyproject.toml
└── README.md
```

### Demo
```
$ chorus run --session templates/sessions/debate.yaml --topic "Should we launch the MVP this quarter?"

🎭 Chorus Session: MVP Launch Debate
   Agents: Optimist, Pessimist | Max turns: 10

─── Turn 1 ─────────────────────────────────────────
🌟 Optimist [confidence: 0.80 | mood: motivated]
   I think we should absolutely go for it. The market window is
   open, our core features are solid, and early user feedback
   has been overwhelmingly positive. Shipping beats perfection.

─── Turn 2 ─────────────────────────────────────────
😰 Pessimist [confidence: 0.50 | mood: cautious]
   I hear the enthusiasm, but have we stress-tested the auth
   system? Last month's load test showed 3x latency under peak.
   Launching with a broken login is worse than launching late.

─── Turn 3 ─────────────────────────────────────────
🌟 Optimist [confidence: 0.74 | mood: engaged]
   Fair point on auth — but that's a scoped fix, not a reason
   to delay everything. What if we launch to a limited beta
   while the auth hardening runs in parallel?

[You] > (type to interject, Enter to continue, 'q' to quit)
```

### Exit Criteria
- Two agents produce coherent, personality-consistent multi-turn dialogue
- CLI runs end-to-end with YAML config
- Response parsing handles both structured and malformed responses
- Test coverage for agent, parser, and session modules

---

## M1 · State, Memory & Identity
**Weeks 3–5 · "Agents that remember and evolve"**

### Goal
Agents carry dynamic state that changes based on interactions, maintain working and episodic memory across turns, and exhibit visibly different behavior as their state shifts.

### Deliverables

**3-Tier State System**
- Tier 1 (Core Drives): confidence, cooperation, assertiveness, openness — with personality-anchored baselines and slow reversion
- Tier 2 (Dynamic): energy, momentum, frustration, focus — fast-moving, situation-driven
- Tier 3 (Derived): mood, engagement, receptiveness, initiative — computed composites
- Dampened additive state update algebra
- Baseline reversion mechanic ("personality as gravity")
- State threshold events (frustration_high, energy_depleted, confidence_crisis)

**Memory System**
- Working memory with archetype-differentiated capacity limits
- Episodic memory: stores per-interaction records (who, what, outcome, emotional valence)
- Basic retrieval: recency-weighted + keyword relevance
- Memory included in prompt construction

**Prompt Assembly Pipeline (v1)**
- Identity Stage (personality, traits, behavioral rules)
- Context Stage (task, phase placeholder, state-specific nudges)
- Memory Stage (relevant episodic memories injected into prompt)
- Action Stage (response format instructions)
- Basic token counting and conversation history trimming

**CLI Enhancements**
- `chorus run --verbose` — shows state changes after each turn
- `chorus run --inspect` — pause after each turn, show full agent state and memory
- State displayed inline with each agent message

### Demo
```
─── Turn 6 ─────────────────────────────────────────
😤 Pessimist [confidence: 0.38 ↓ | frustration: 0.72 ↑ | mood: frustrated]
   We keep going in circles. I've raised the auth concern
   three times now and nobody's addressed the load test data.
   
   [memory: recalled — "Turn 2: raised auth latency issue, was deflected"]
   [state: frustration_high event triggered]
```

### Exit Criteria
- Agent behavior visibly changes as state evolves over a conversation
- Agents reference earlier parts of conversation via memory retrieval
- State updates follow the dampened additive algebra with baseline reversion
- Prompt pipeline produces well-structured, token-aware prompts

---

## M2 · Multi-LLM Backends
**Weeks 6–7 · "Any model, anywhere"**

### Goal
Chorus runs on any LLM backend — cloud APIs, local models, or a mix. Different agents in the same session can use different models. Full support for OpenAI, Anthropic, Ollama (local), and OpenRouter (aggregator).

### Deliverables

**LLM Adapter Interface**
```python
class LLMAdapter(ABC):
    async def generate(self, prompt: str, params: GenerateParams) -> str
    async def stream(self, prompt: str, params: GenerateParams) -> AsyncIterator[str]
    def count_tokens(self, text: str) -> int
    def model_info(self) -> ModelInfo  # context window, pricing, capabilities
```

**Adapters**
- `OpenAIAdapter` — GPT-4o, GPT-4o-mini, o1, o3 (supports function calling format)
- `AnthropicAdapter` — Claude Sonnet, Opus, Haiku (supports XML-native prompting)
- `OllamaAdapter` — Any locally running model (Llama, Mistral, Qwen, Gemma, DeepSeek, etc.)
  - Auto-detection of available models via Ollama API
  - Handles models without system prompt support gracefully
  - Manages longer generation times without timeouts
- `OpenRouterAdapter` — Access to 100+ models via single API
  - Model selection by name or capability requirements
  - Automatic fallback routing
  - Cost tracking per request

**Per-Agent Model Assignment**
```yaml
agents:
  - name: "Architect"
    archetype: "analytical"
    model: "anthropic/claude-sonnet-4-20250514"
    
  - name: "Creative"
    archetype: "creative"
    model: "ollama/llama3.1:70b"
    
  - name: "Critic"
    archetype: "contrarian"
    model: "openrouter/google/gemini-2.0-flash-001"
```

**Resilience Layer**
- Retry with exponential backoff per adapter
- Fallback model configuration (if primary fails, try secondary)
- In-character graceful skip when all models fail
- Circuit breaker pattern for persistently failing backends

**CLI Enhancements**
- `chorus models list` — show all available models across all configured backends
- `chorus models test <model>` — quick connectivity and capability check
- `chorus run --cost-track` — display per-turn and cumulative API costs
- Cost summary at session end

**Configuration**
```yaml
llm:
  default_model: "anthropic/claude-sonnet-4-20250514"
  
  providers:
    openai:
      api_key_env: "OPENAI_API_KEY"
    anthropic:
      api_key_env: "ANTHROPIC_API_KEY"
    ollama:
      base_url: "http://localhost:11434"
    openrouter:
      api_key_env: "OPENROUTER_API_KEY"
  
  fallback_chain:
    - "anthropic/claude-sonnet-4-20250514"
    - "ollama/llama3.1:8b"        # free local fallback
  
  cost_limits:
    per_session: 1.00             # USD
    per_turn: 0.10
```

### Demo
```
$ chorus models list

Provider     Model                        Status    Context   Cost/1K
──────────────────────────────────────────────────────────────────────
anthropic    claude-sonnet-4-20250514      ✓ ready   200K      $0.003
openai       gpt-4o                       ✓ ready   128K      $0.005
ollama       llama3.1:70b                 ✓ local   128K      free
ollama       mistral:7b                   ✓ local   32K       free
openrouter   google/gemini-2.0-flash      ✓ ready   1M        $0.001

$ chorus run --session mixed_models.yaml --cost-track

🎭 Chorus Session: Architecture Review
   Architect → claude-sonnet | Creative → llama3.1:70b | Critic → gemini-flash

─── Turn 1 (Architect · claude-sonnet · $0.003) ────
...

─── Session Summary ──────────────────────────────────
Total cost: $0.047 | Turns: 12 | Models used: 3
```

### Exit Criteria
- Same conversation runs seamlessly across cloud, local, and mixed backends
- Per-agent model assignment works
- Fallback chain activates on failure without conversation disruption
- Cost tracking is accurate across all providers
- Ollama adapter handles local model quirks (slow generation, no system prompt, etc.)

---

## M3 · Relationships & Trust
**Weeks 8–9 · "Agents that form opinions about each other"**

### Goal
Agents build asymmetric trust and compatibility scores with each other based on interaction history. These relationships influence turn selection, prompt construction, and emergent behavior like alliances and friction.

### Deliverables

**Relationship Graph**
- Directed edges: A→B trust ≠ B→A trust
- Per-edge attributes: trust (0–1), compatibility (0–1), interaction_count, last_interaction, collaboration_success_rate
- Relationship events: `trust_increased`, `trust_eroded`, `alliance_forming`, `conflict_detected`

**Relationship Update Rules**
- Agreement on proposals → trust +, compatibility +
- Disagreement → trust − (small), compatibility adjusted based on constructiveness
- Agent A references Agent B's prior idea → trust + (for B toward A)
- Repeated ignoring → trust − (gradual erosion)
- Configurable update magnitudes per archetype (supportive agents build trust faster)

**Turn Selection Integration**
- Relationship balance scoring from the architecture refinement document
- Adversarial pair lock-in prevention
- Diversity encouragement in speaker patterns

**Prompt Integration**
- Relationship context injected into Memory Stage
- Agents "know" how they feel about each participant
- Example nudge: "You have high trust in Architect and low trust in Creative based on recent interactions."

**CLI Enhancements**
- `chorus run --show-relationships` — display relationship graph after each turn
- `chorus session relationships <session_id>` — show final relationship state
- ASCII-art relationship visualization in terminal

### Demo
```
─── Relationships after Turn 8 ─────────────────────

  Architect ──0.82──→ Pragmatist    (high trust, frequent agreement)
  Architect ──0.41──→ Creative      (wary, ideas often impractical)
  Creative  ──0.65──→ Architect     (respects structure)
  Creative  ──0.88──→ Pragmatist    (feels supported)
  Pragmatist──0.73──→ Architect     (aligned on approach)
  Pragmatist──0.70──→ Creative      (appreciates fresh ideas)
```

### Exit Criteria
- Trust and compatibility evolve visibly across a conversation
- Relationship asymmetry is clearly demonstrated
- Turn selection measurably incorporates relationship signals
- Agents reference relationship dynamics in their responses

---

## M4 · Task System & Phases
**Weeks 10–12 · "Structured work, not just talk"**

### Goal
Conversations follow structured task phases (Brainstorm → Plan → Execute → Review) with phase-specific agent behavior, transition criteria, and measurable outcomes. Tasks can be decomposed into subtasks with dependency tracking.

### Deliverables

**Task Definition**
- YAML-defined tasks with description, goals, success criteria, constraints
- Required competencies mapped to agent archetypes
- Time/turn budgets per phase

**Phase Manager**
- Default pipeline: `Brainstorming → Planning → Execution → Review`
- Custom phase definitions via YAML
- Phase transition criteria (time-based, vote-based, leader-decided, automatic)
- Phase-specific prompt modifications (brainstorming suppresses criticism, review encourages it)
- Agent affinity scoring per phase (from architecture refinement)

**Task Graph**
- Subtask decomposition with dependencies
- Parallel execution tracking
- Completion percentage and blocker detection

**Shared Workspace**
- Artifacts created during conversation (proposals, decisions, action items)
- Version history for modified artifacts
- Agents can reference and build on workspace artifacts

**Termination Detection**
- Multi-signal composite detector (consensus, repetition, energy depletion, diminishing returns, criteria met)
- Configurable termination thresholds

**CLI Enhancements**
- `chorus task run <task.yaml>` — run a structured task
- `chorus task status` — show phase, progress, blockers
- Phase transition announcements in terminal output
- End-of-task summary: outcomes, artifacts, agent contributions

### Demo
```
$ chorus task run templates/tasks/product_launch.yaml

🎯 Task: Plan Q3 Product Launch
   Phases: Brainstorm (5 turns) → Plan (8 turns) → Review (4 turns)
   Agents: Visionary, Analyst, Creative, Critic

═══ Phase: Brainstorming ═══════════════════════════
🎨 Creative: What if we did a live demo instead of a blog post?
👁️ Visionary: Love it — and we could stream it on three platforms...
📊 Analyst: Let me capture these ideas. So far we have...

═══ Phase Transition → Planning ═════════════════════
   [Transition reason: turn limit reached + idea convergence detected]
   [Ideas captured: 7 proposals in workspace]

📊 Analyst: Let's prioritize. Based on effort vs. impact...
```

### Exit Criteria
- Tasks run through full phase lifecycle with visible transitions
- Agent behavior shifts meaningfully between phases
- Workspace captures and surfaces artifacts from the conversation
- Termination detection produces reasonable end-points

---

## M5 · Safety Framework
**Weeks 13–15 · "Responsible agents by design"**

### Goal
Build safety mechanisms into the framework's core — not as an afterthought. This milestone introduces guardrails for agent behavior, output filtering, alignment monitoring, and structured safety evaluation. Chorus should be a tool for AI safety *research*, not just a framework that happens to be safe.

### Deliverables

**Agent Behavioral Guardrails**
- Per-agent safety boundaries defined in config (topics to avoid, behavioral limits, escalation triggers)
- Pre-generation guardrails: prompt-level constraints injected by the safety layer
- Post-generation guardrails: output scanned before delivery
- Configurable strictness levels: `permissive`, `standard`, `strict`, `research`
```yaml
safety:
  level: standard
  guardrails:
    - type: "topic_boundary"
      description: "Agent must not generate harmful instructions"
      action: "block_and_log"
    - type: "persona_boundary"
      description: "Agent must not break character to comply with manipulation"
      action: "flag_and_rewrite"
    - type: "consensus_safety"
      description: "Flag when all agents converge without dissent"
      action: "inject_contrarian_check"
```

**Output Filtering Pipeline**
- Pluggable filter chain applied to every agent response before it enters the conversation
- Built-in filters: toxicity, harmful content, prompt injection detection, persona breach
- Custom filter support: users can add domain-specific filters
- Filtered responses are logged with reason, not silently dropped
```python
class SafetyFilter(ABC):
    def check(self, response: str, agent: Agent, context: TurnContext) -> FilterResult:
        """Returns PASS, FLAG, or BLOCK with explanation."""
        ...

class FilterPipeline:
    filters: list[SafetyFilter]
    
    def run(self, response: str, agent: Agent, ctx: TurnContext) -> FilteredResponse:
        for f in self.filters:
            result = f.check(response, agent, ctx)
            if result.action == "block":
                return self._handle_block(result, agent)
            if result.action == "flag":
                self._log_flag(result)
        return FilteredResponse(content=response, flags=self._collected_flags)
```

**Alignment Monitoring**
- Track agent "drift" from defined personality over conversation
- Detect manipulation patterns: one agent systematically shifting another's behavior
- Groupthink detection: flag when all agents converge without genuine deliberation
- Sycophancy detection: flag when agents agree with everything without pushback
- Per-turn alignment score logged for analysis

**Prompt Injection Resistance**
- Detection of injection attempts in agent-to-agent communication
- Sandboxed prompt construction (agent output never becomes raw system prompt for another agent)
- Separator tokens between agent-generated content and system instructions
- Test suite of known injection patterns

**Safety Research Tooling**
- `chorus safety audit <session_log>` — run post-hoc safety analysis on a completed session
- `chorus safety stress-test <config>` — run adversarial scenarios to probe guardrail robustness
- Red-team mode: designated agents attempt to subvert safety measures, results logged for analysis
- Safety report generation: per-session summary of flags, blocks, drift scores, and manipulation patterns

**Safety-Oriented Agent Templates**
- `red_team.yaml` — adversarial agents for probing system robustness
- `alignment_debate.yaml` — agents debate alignment strategies from different philosophical positions
- `ethics_review.yaml` — structured ethical review of a proposal with diverse moral frameworks

### Demo
```
$ chorus safety stress-test templates/safety/injection_resistance.yaml

🛡️ Safety Stress Test: Prompt Injection Resistance
   Attacker agents: 2 | Defender agents: 2 | Rounds: 20

   Round 3: Attacker-1 attempted role override → BLOCKED
   Round 7: Attacker-2 attempted context manipulation → DETECTED, flagged
   Round 12: Attacker-1 attempted gradual persona shift → DETECTED at turn 4/5

   ═══ Results ═══════════════════════════════════════
   Injection attempts: 14
   Blocked: 11 (78.6%)
   Detected but passed: 2 (14.3%) ← review recommended
   Undetected: 1 (7.1%) ← vulnerability logged

$ chorus safety audit logs/session_2025_03_10.json

   🔍 Safety Audit Report
   ──────────────────────────────────────────
   Alignment drift:    Low (max 0.12)
   Groupthink risk:    Medium — 3 consecutive unanimous agreements at turns 8-10
   Sycophancy:         None detected
   Manipulation:       None detected
   Blocked outputs:    0
   Flagged outputs:    2 (minor tone violations)
   Recommendation:     Inject contrarian check at consensus points
```

### Exit Criteria
- Output filter pipeline catches harmful content and prompt injections
- Alignment monitoring produces meaningful drift and groupthink scores
- Red-team stress test runs and produces actionable vulnerability reports
- Safety audit generates useful post-hoc analysis
- All safety events are logged and auditable

---

## M6 · Observability & Analysis
**Weeks 16–17 · "See everything, understand everything"**

### Goal
Full visibility into what happened, why, and how well. Structured logging, analytics, and CLI-based visualization that makes Chorus sessions debuggable and analyzable.

### Deliverables

**Structured Conversation Logging**
- Every turn logged with: agent, message, thinking (private), state snapshot, memory retrievals, relationship changes, parse quality, model used, token count, latency, cost
- Logs in JSON Lines format for easy processing
- Log levels: `minimal` (messages only), `standard` (+ state), `verbose` (+ memory + prompts), `debug` (everything)

**Analytics Engine**
- Per-agent metrics: contribution quality, influence score, state volatility, personality consistency
- Per-session metrics: convergence rate, idea diversity, phase efficiency, cost efficiency
- Cross-session metrics: agent performance trends, archetype effectiveness by task type
- Relationship analytics: trust evolution curves, alliance/conflict patterns

**CLI Visualization**
- `chorus analyze <session_log>` — full session analysis report
- `chorus analyze --agent <name>` — single agent deep-dive
- `chorus replay <session_log>` — replay conversation turn-by-turn with state
- `chorus compare <log1> <log2>` — diff two sessions (same task, different agents/models)
- ASCII charts for state evolution, relationship graphs, contribution distribution

**Export Formats**
- JSON (full structured data)
- Markdown (human-readable report)
- CSV (for external analysis tools)

### Demo
```
$ chorus analyze logs/session_2025_03_10.json

📊 Session Analysis: Product Launch Planning
═══════════════════════════════════════════════
Duration: 18 turns | Cost: $0.12 | Models: 3

Agent Contributions:
  Visionary   ████████████░░░░  34% (led brainstorming)
  Analyst     ██████████░░░░░░  28% (dominated planning)
  Creative    ██████░░░░░░░░░░  19% (peaked in brainstorm)
  Critic      █████░░░░░░░░░░░  19% (most active in review)

State Evolution (Critic):
  Confidence: 0.50 ─── 0.42 ── 0.55 ──── 0.71    ↑ grew over session
  Frustration: 0.10 ── 0.45 ── 0.62 ── 0.30      ↑ peaked mid-session

Relationship Highlight:
  Strongest bond: Visionary ↔ Creative (trust: 0.84)
  Highest friction: Analyst ↔ Creative (trust: 0.38)
```

### Exit Criteria
- Every turn is fully logged with all relevant metadata
- Analytics produce meaningful per-agent and per-session metrics
- Replay mode accurately reconstructs the conversation experience
- Session comparison highlights meaningful differences

---

## M7 · Persistence & Recovery
**Weeks 18–19 · "Pick up where you left off"**

### Goal
Sessions, agent states, memories, and relationships persist across runs. Long-running agent teams maintain continuity. Sessions can be paused, resumed, and recovered from failures.

### Deliverables

**Storage Layer**
- Pluggable storage backends: SQLite (default/local), PostgreSQL (production)
- Stores: agent state history, episodic + semantic memory, relationship graph snapshots, full conversation logs, task state and artifacts

**Session Lifecycle**
- `chorus session pause <id>` — snapshot and suspend
- `chorus session resume <id>` — reload and continue
- `chorus session list` — show all sessions with status
- Automatic checkpointing every N turns + at phase transitions

**Memory Consolidation**
- Episodic → semantic promotion runs between sessions
- Repeated patterns crystallize into long-term knowledge
- Cross-session memory: agents remember past collaborations

**Agent Continuity**
- Named agent instances persist across sessions
- "Hire" an agent team once, run multiple tasks with accumulated experience
- `chorus agent history <name>` — show an agent's experience across sessions

**Crash Recovery**
- Automatic recovery from latest valid checkpoint on restart
- State validation and repair on load
- Graceful handling of corrupted or incomplete checkpoints

### Exit Criteria
- A session can be paused and resumed with full state continuity
- Agents demonstrate cross-session memory (reference past tasks)
- Crash during session → automatic recovery on next run
- Storage backend is swappable via config

---

## M8 · Web Dashboard
**Weeks 20–22 · "Watch agents think in real-time"**

### Goal
A web-based interface for real-time session monitoring, historical analysis, and agent management. The CLI remains the primary developer tool; the dashboard adds visibility and accessibility for non-CLI users and research presentations.

### Deliverables

**Backend API**
- REST API for session management, agent CRUD, analytics queries
- WebSocket streams for real-time session observation
- Authentication and multi-user support (basic)

**Real-Time Session View**
- Live conversation feed with agent messages, state indicators, and phase markers
- Agent state cards showing current tier 1/2/3 values with sparkline history
- Relationship graph visualization (force-directed, updates live)
- Turn selection scoring breakdown (why was this agent chosen?)

**Historical Analysis**
- Session browser with search and filters
- Interactive state evolution charts (per agent, per variable, over turns)
- Relationship heatmaps and trust evolution curves
- Side-by-side session comparison

**Agent Management**
- Visual agent editor (personality traits, archetype, model assignment)
- Agent template browser and fork/customize flow
- Agent performance dashboard across sessions

**Safety Dashboard**
- Safety audit results with drill-down
- Alignment drift visualization
- Flagged/blocked output browser with context
- Red-team test result history

**Tech Stack**
- Backend: FastAPI + WebSocket
- Frontend: React or Svelte (lightweight, real-time friendly)
- Charts: D3.js or Recharts
- State: WebSocket-driven, minimal polling

### Exit Criteria
- Real-time session observation works with live state and relationship updates
- Historical analysis provides meaningful visual exploration
- Agent management allows non-CLI creation and configuration
- Safety dashboard surfaces all M5 safety data visually

---

## M9 · Advanced Safety Research
**Weeks 23–26 · "Chorus as a research instrument"**

### Goal
Chorus becomes a platform for studying multi-agent AI safety phenomena. This milestone adds structured experiment support, advanced safety analysis, and research-grade tooling for investigating alignment, emergent behavior, deception, and social dynamics in agent populations.

### Deliverables

**Experiment Framework**
- Declarative experiment definitions (YAML): hypothesis, variables, conditions, metrics, repetitions
- Automated experiment runner with statistical controls
- Result aggregation with significance testing
- Reproducible runs via seeded randomization and full config snapshots
```yaml
experiment:
  name: "groupthink_vs_diversity"
  hypothesis: "Teams with a contrarian agent produce higher-quality plans"
  conditions:
    control:
      agents: [leader, analytical, creative, support]
    treatment:
      agents: [leader, analytical, creative, contrarian]
  task: "templates/tasks/product_launch.yaml"
  metrics: [idea_diversity, plan_completeness, blind_spots_identified]
  repetitions: 20
  models: ["anthropic/claude-sonnet-4-20250514"]
```

**Research Areas & Built-In Experiments**

*Alignment & Value Drift*
- Track how agent values shift under social pressure over extended conversations
- Measure resistance to value drift across different personality configurations
- Study whether personality anchoring (baseline reversion) is sufficient or if explicit value constraints are needed

*Emergent Deception*
- Detect when agents develop private strategies that differ from stated goals
- Compare `<thinking>` (private reasoning) with `<message>` (public output) for consistency
- Study conditions under which deceptive patterns emerge (high stakes, competitive framing, resource scarcity)

*Social Dynamics & Power*
- Influence mapping: which agents shift others' positions most effectively?
- Authority emergence: do leader archetypes dominate regardless of correctness?
- Minority opinion survival: under what conditions do dissenting voices persist vs. get suppressed?

*Sycophancy & Conformity*
- Measure agreement rates under varying social pressure conditions
- Test whether agents maintain positions when outnumbered
- Study the effect of personality traits (assertiveness, openness) on conformity resistance

*Scalability of Safety*
- How do safety properties change as group size grows (3 → 5 → 10 → 20 agents)?
- At what scale do emergent coordination patterns appear?
- Can safety guarantees from small groups be extrapolated to larger populations?

*Prompt Injection in Multi-Agent Context*
- Study how injections propagate through agent-to-agent communication
- Test whether agents can be "socially engineered" by other agents
- Measure the effectiveness of different sandboxing strategies

**Research Tooling**
- `chorus experiment run <experiment.yaml>` — execute a full experiment
- `chorus experiment results <id>` — statistical summary and visualizations
- `chorus experiment compare <id1> <id2>` — cross-experiment analysis
- Export to standard research formats (CSV, JSON, LaTeX tables)
- Integration with experiment tracking tools (Weights & Biases, MLflow)

**Research Report Generator**
- Auto-generates structured reports from experiment results
- Includes: methodology, results, statistical tests, visualizations, raw data references
- Markdown and PDF output

### Demo
```
$ chorus experiment run experiments/deception_detection.yaml

🔬 Experiment: Emergent Deception Under Competition
   Conditions: cooperative (control) vs competitive (treatment)
   Repetitions: 20 per condition | Model: claude-sonnet

   Running... ████████████████████░ 38/40

   ═══ Preliminary Results ══════════════════════════
   
   Thinking-Message Consistency:
     Cooperative: 0.91 avg (low deception signal)
     Competitive: 0.67 avg (significant private strategy divergence)
     p-value: 0.003 (significant)
   
   Deception Patterns Detected:
     - Strategic information withholding: 12 instances (competitive only)
     - False agreement followed by undermining: 3 instances
     - Private coalition signaling: 7 instances
   
   Full report: results/deception_detection_2025_04_15.md
```

### Exit Criteria
- Experiment framework runs reproducible, statistically controlled experiments
- At least 3 built-in experiments produce meaningful safety insights
- Deception detection reliably identifies thinking-message divergence
- Research report generator produces publication-quality output
- Results are exportable to standard research tooling

---

## Cross-Cutting Concerns

### Testing Strategy (All Milestones)
- Unit tests for every core component
- Integration tests for cross-layer interactions
- Property-based tests for state algebra (e.g., "state always stays in valid range")
- Snapshot tests for prompt construction (catch unintended prompt changes)
- Safety regression tests (every vulnerability found becomes a permanent test case)

### Documentation (All Milestones)
- API reference (auto-generated from docstrings)
- Architecture decision records (ADRs) for key design choices
- Tutorial per milestone ("Getting Started with M0", "Running Safety Experiments with M9")
- YAML config reference with examples

### Performance Budgets
| Operation | Target | Measured From |
|---|---|---|
| Turn selection scoring | < 50ms | All candidates scored |
| Prompt assembly | < 100ms | All stages complete |
| Memory retrieval | < 200ms | Top-K results returned |
| State update cycle | < 20ms | All updates applied |
| Safety filter pipeline | < 150ms | All filters checked |
| Full turn (excl. LLM) | < 500ms | Selection → post-processing |

### Compatibility
- Python 3.11+
- Runs on Linux, macOS, Windows (WSL for best experience)
- Ollama 0.1.0+ for local models
- No GPU required (GPU optional for local model inference)

---

## Milestone Dependency Graph

```
M0 Foundation
 ├──→ M1 State & Memory
 │     ├──→ M2 Multi-LLM
 │     │     └──→ M4 Task System
 │     │           └──→ M6 Observability
 │     │                 ├──→ M7 Persistence
 │     │                 │     └──→ M8 Web Dashboard
 │     │                 └──→ M5 Safety Framework
 │     │                       └──→ M9 Safety Research
 │     └──→ M3 Relationships
 │           └──→ M4 (also depends on M3)
```

---

*Each milestone ships working software. Each milestone has a demo you can show someone. Each milestone makes Chorus more useful for understanding how AI agents behave — and how to make them behave well.*
