# Chorus Architecture Refinement
## Deep Design Document v1

---

## 1. State Update Algebra & Agent Internals

### 1.1 State Variables — Revised Model

The original four variables (confidence, cooperation, energy, mood) are a good foundation but need structure. I propose organizing state into **three tiers**:

#### Tier 1 · Core Drives (slow-moving, personality-anchored)
These drift slowly and are pulled back toward personality-defined baselines.

| Variable | Type | Range | Description |
|---|---|---|---|
| `confidence` | Float | 0.0–1.0 | Self-assurance in own contributions |
| `cooperation` | Float | 0.0–1.0 | Willingness to align with others |
| `assertiveness` | Float | 0.0–1.0 | Tendency to push own ideas forward |
| `openness` | Float | 0.0–1.0 | Receptivity to unfamiliar ideas |

#### Tier 2 · Dynamic State (fast-moving, situation-driven)
These change frequently based on interaction outcomes.

| Variable | Type | Range | Description |
|---|---|---|---|
| `energy` | Float | 0.0–1.0 | Engagement capacity (decays over time) |
| `momentum` | Float | -1.0–1.0 | Positive = on a roll, Negative = stalling |
| `frustration` | Float | 0.0–1.0 | Accumulated from disagreements/failures |
| `focus` | Float | 0.0–1.0 | Attention on current task vs. tangents |

#### Tier 3 · Derived / Composite (computed, not stored)
These are calculated on-the-fly from Tier 1 + Tier 2.

| Variable | Formula (example) | Description |
|---|---|---|
| `mood` | `f(energy, momentum, frustration)` | Categorical label for prompt injection |
| `engagement` | `energy × focus` | Likelihood of substantive contribution |
| `receptiveness` | `openness × cooperation × (1 - frustration)` | How open to feedback right now |
| `initiative` | `confidence × assertiveness × energy` | Likelihood of proposing new ideas |

### 1.2 State Update Algebra

**Principle**: State updates are applied as **deltas**, not absolute values. Every update has a **source**, **magnitude**, and **decay factor**.

```python
@dataclass
class StateUpdate:
    variable: str           # e.g., "confidence"
    delta: float            # change amount (can be negative)
    source: UpdateSource    # what caused this update
    decay: float = 1.0      # multiplier applied over time (1.0 = permanent)
    
class UpdateSource(Enum):
    INTERACTION_SUCCESS     # positive collaboration outcome
    INTERACTION_FAILURE     # disagreement, rejection
    TASK_PROGRESS           # milestone reached
    TASK_SETBACK            # blocker, failure
    TIME_DECAY              # natural energy/focus loss
    PERSONALITY_REVERSION   # pull toward baseline
    EXTERNAL_EVENT          # environment changes
```

**Composition Rule**: When multiple updates target the same variable in a single turn, they combine via **dampened addition**:

```python
def compose_updates(updates: list[StateUpdate]) -> float:
    """
    Combines multiple deltas with diminishing returns.
    Prevents state from swinging wildly from compound events.
    """
    total = 0.0
    for update in sorted(updates, key=lambda u: abs(u.delta), reverse=True):
        # Each successive update has reduced impact
        effective_delta = update.delta * (1.0 / (1.0 + abs(total)))
        total += effective_delta
    return total
```

**Clamping & Baseline Reversion**: After every update cycle, two things happen:
1. Values are clamped to their valid range.
2. Tier 1 variables experience a small pull toward their personality-defined **baseline**:

```python
def apply_baseline_reversion(current: float, baseline: float, rate: float = 0.05) -> float:
    """Gently pulls current value toward personality baseline each turn."""
    return current + (baseline - current) * rate
```

This means a naturally confident agent who gets rattled will slowly recover confidence. A naturally cautious agent who gets a confidence boost will slowly settle back down. Personality is gravity.

### 1.3 State Transition Events

State changes beyond a threshold emit events, enabling reactive behavior:

```python
STATE_THRESHOLDS = {
    "frustration": {
        0.7: "frustration_high",      # might disengage or lash out
        0.9: "frustration_critical",   # needs intervention
    },
    "energy": {
        0.2: "energy_low",            # contributions become shallow
        0.05: "energy_depleted",       # agent should be rested
    },
    "confidence": {
        0.2: "confidence_crisis",      # agent defers to everyone
        0.9: "confidence_peak",        # agent may dominate
    },
}
```

### 1.4 Working Memory — Differentiated by Personality

Working memory capacity becomes a personality parameter:

```python
WORKING_MEMORY_SLOTS = {
    "analytical": 7,    # can juggle more context
    "creative": 4,      # fewer but more loosely associated
    "leader": 5,        # balanced
    "support": 6,       # good at tracking others' points
    "contrarian": 4,    # focused on finding weaknesses
}
```

This naturally produces different behavior: an analytical agent remembers more of the conversation but may miss creative leaps. A creative agent forgets earlier points but makes unexpected connections.

### 1.5 Memory Consolidation Rules

Episodic → Semantic promotion criteria:

```python
@dataclass
class ConsolidationRule:
    pattern_threshold: int = 3      # same pattern seen N times
    emotional_intensity: float = 0.8 # single high-impact event
    recency_window: int = 10        # turns to look back
    
    def should_consolidate(self, episodes: list[Episode]) -> bool:
        # Pattern repetition
        if self._count_similar(episodes) >= self.pattern_threshold:
            return True
        # Single high-impact event
        if any(e.emotional_valence >= self.emotional_intensity for e in episodes):
            return True
        return False
```

**Example**: If Agent A disagrees with Agent B three times in 10 turns, the episodic memories consolidate into semantic knowledge: "Agent B frequently opposes my proposals." This then influences future `receptiveness` calculations toward B.

---

## 2. Turn Selection & Orchestration Policy

### 2.1 Turn Selection as Policy, Not Strategy

Turn selection should be a **scoring function** over all eligible agents, not a simple strategy pattern. Each candidate agent receives a composite score, and the highest scorer takes the next turn.

```python
class TurnPolicy:
    def select_next(self, candidates: list[Agent], context: TurnContext) -> Agent:
        scores = {}
        for agent in candidates:
            scores[agent.id] = self._compute_score(agent, context)
        return max(scores, key=scores.get)
    
    def _compute_score(self, agent: Agent, ctx: TurnContext) -> float:
        score = 0.0
        score += self._phase_fit(agent, ctx.current_phase)
        score += self._state_urgency(agent)
        score += self._recency_penalty(agent, ctx.turn_history)
        score += self._relationship_balance(agent, ctx.recent_speakers)
        score += self._relevance_signal(agent, ctx.last_message)
        score += self._conversation_momentum(agent, ctx)
        return score
```

### 2.2 Scoring Components

#### Phase Fit
Each archetype has affinity scores per phase:

```python
PHASE_AFFINITY = {
    "brainstorming": {"creative": 0.9, "contrarian": 0.7, "leader": 0.5, "analytical": 0.3, "support": 0.4},
    "planning":      {"analytical": 0.9, "leader": 0.8, "creative": 0.3, "support": 0.5, "contrarian": 0.4},
    "execution":     {"analytical": 0.7, "leader": 0.8, "support": 0.6, "creative": 0.4, "contrarian": 0.3},
    "review":        {"contrarian": 0.9, "analytical": 0.8, "leader": 0.6, "support": 0.5, "creative": 0.3},
}
```

#### State Urgency
An agent with high frustration or critical state may need to speak (or be silenced):

```python
def _state_urgency(self, agent: Agent) -> float:
    urgency = 0.0
    # High frustration → needs to express (or vent)
    if agent.state.frustration > 0.7:
        urgency += 0.3 * agent.state.assertiveness
    # High confidence + high momentum → has something to say
    if agent.state.confidence > 0.7 and agent.state.momentum > 0.3:
        urgency += 0.2
    # Low energy → penalize (less likely to contribute well)
    if agent.state.energy < 0.3:
        urgency -= 0.3
    return urgency
```

#### Recency Penalty
Prevents any single agent from dominating:

```python
def _recency_penalty(self, agent: Agent, history: list[str]) -> float:
    """Negative score if agent spoke recently. Decays over turns."""
    last_n = history[-5:]
    if agent.id not in last_n:
        return 0.0
    recency = len(last_n) - last_n[::-1].index(agent.id)
    return -0.5 / recency  # spoke 1 turn ago = -0.5, 3 turns ago = -0.17
```

#### Relationship Balance
Avoids adversarial pair lock-in, encourages diverse interaction:

```python
def _relationship_balance(self, agent: Agent, recent_speakers: list[str]) -> float:
    if not recent_speakers:
        return 0.0
    last_speaker = recent_speakers[-1]
    rel = agent.relationships.get(last_speaker)
    if rel and rel.trust < 0.3:
        # Low-trust pair: slight penalty to avoid prolonged conflict
        return -0.15
    if rel and rel.compatibility > 0.7:
        # High-compatibility: slight penalty to encourage diversity
        return -0.1
    return 0.05  # neutral or new pairing gets a small bonus
```

#### Relevance Signal
Does this agent have something meaningful to contribute to what was just said?

```python
def _relevance_signal(self, agent: Agent, last_message: Message) -> float:
    """
    Check if agent's expertise/traits align with the current topic.
    Uses lightweight keyword/embedding match against agent's semantic memory.
    """
    relevance = agent.memory.semantic.relevance_to(last_message.content)
    return relevance * 0.3  # scale factor
```

#### Conversation Momentum
Detects convergence vs. divergence and adjusts accordingly:

```python
def _conversation_momentum(self, agent: Agent, ctx: TurnContext) -> float:
    if ctx.is_converging and agent.archetype == "contrarian":
        return -0.2  # don't disrupt convergence unnecessarily
    if ctx.is_stalling and agent.archetype == "creative":
        return 0.3   # inject new energy
    if ctx.is_stalling and agent.archetype == "leader":
        return 0.25  # redirect the conversation
    return 0.0
```

### 2.3 Interrupt Mechanism

Separate from scoring — an agent can "interrupt" if an exceptional condition is met:

```python
class InterruptCondition:
    def should_interrupt(self, agent: Agent, context: TurnContext) -> bool:
        # Critical disagreement with high confidence
        if (agent.state.frustration > 0.8 
            and agent.state.confidence > 0.7 
            and agent.state.assertiveness > 0.6):
            return True
        # Agent has directly relevant expertise being overlooked
        if (agent.memory.semantic.has_expertise(context.current_topic)
            and agent.id not in context.turn_history[-5:]):
            return True
        return False
```

Interrupts bypass the normal turn order but carry a small **relationship cost** (slight trust reduction with the interrupted agent).

---

## 3. Prompt Assembly Pipeline

### 3.1 Pipeline Architecture

Prompt construction is a **multi-stage pipeline** where each stage contributes a section and has a token budget:

```
┌──────────────────────────────────────────────────────────┐
│                  Prompt Assembly Pipeline                  │
│                                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Identity  │→ │ Context  │→ │ Memory   │→ │ Action   │  │
│  │ Stage     │  │ Stage    │  │ Stage    │  │ Stage    │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│       ↓             ↓             ↓             ↓         │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Token Budget Manager                    │  │
│  │  Allocates, tracks, and compresses to fit window    │  │
│  └─────────────────────────────────────────────────────┘  │
│       ↓                                                    │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Final Prompt Assembler                   │  │
│  │  Merges sections, validates, adds response format    │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Pipeline Stages

#### Stage 1 · Identity (fixed cost, ~200-400 tokens)
Establishes who the agent IS. Rarely changes.

```python
class IdentityStage:
    def build(self, agent: Agent) -> PromptSection:
        return PromptSection(
            role="system",
            priority=Priority.CRITICAL,  # never trimmed
            content=f"""You are {agent.name}, a {agent.archetype} personality.

Core traits: {', '.join(agent.traits)}
Description: {agent.description}

Behavioral guidelines:
{self._trait_to_behavior_rules(agent.traits, agent.archetype)}

You must stay in character. Your personality shapes HOW you contribute,
not WHETHER you contribute. Even when disagreeing, express it through
your personality lens."""
        )
```

#### Stage 2 · Context (variable cost, ~300-800 tokens)
Current situation: task, phase, environment, what just happened.

```python
class ContextStage:
    def build(self, agent: Agent, task: Task, env: Environment) -> PromptSection:
        return PromptSection(
            role="system",
            priority=Priority.HIGH,
            content=f"""Current situation:
- Task: {task.description}
- Phase: {task.current_phase} ({self._phase_description(task.current_phase)})
- Your current state: {self._format_state(agent.state)}
- Turn {env.turn_number} of conversation

{self._phase_specific_instructions(task.current_phase, agent.archetype)}

{self._state_specific_nudges(agent.state)}"""
        )
    
    def _state_specific_nudges(self, state: AgentState) -> str:
        """Translate state into behavioral nudges."""
        nudges = []
        if state.frustration > 0.6:
            nudges.append("You're feeling frustrated. You may express this, but stay constructive.")
        if state.energy < 0.3:
            nudges.append("Your energy is low. Keep responses concise and focused.")
        if state.confidence > 0.85:
            nudges.append("You're feeling very confident. Be bold but watch for blind spots.")
        if state.derived.receptiveness < 0.3:
            nudges.append("You're not very open to others' input right now. Acknowledge this tension.")
        return "\n".join(nudges) if nudges else ""
```

#### Stage 3 · Memory (variable cost, ~200-1000 tokens, compressible)
Relevant memories retrieved and formatted.

```python
class MemoryStage:
    def build(self, agent: Agent, context: TurnContext) -> PromptSection:
        # Retrieve relevant memories within token budget
        episodic = agent.memory.episodic.retrieve(
            query=context.last_message.content,
            limit=5,
            recency_weight=0.4,
            relevance_weight=0.6
        )
        semantic = agent.memory.semantic.retrieve(
            query=context.current_topic,
            limit=3
        )
        relationships = self._relevant_relationships(agent, context.participants)
        
        return PromptSection(
            role="system",
            priority=Priority.MEDIUM,  # can be trimmed if needed
            content=f"""Relevant context from your memory:

{self._format_episodic(episodic)}

Things you know:
{self._format_semantic(semantic)}

Your relationships with current participants:
{self._format_relationships(relationships)}"""
        )
```

#### Stage 4 · Action (fixed cost, ~100-300 tokens)
What the agent should do and how to format the response.

```python
class ActionStage:
    def build(self, agent: Agent, task: Task) -> PromptSection:
        return PromptSection(
            role="system",
            priority=Priority.CRITICAL,
            content=f"""Respond to the conversation below. Your response must include:

1. Your contribution (in character, addressing the current discussion)
2. Optionally: a direct address to a specific agent (use @AgentName)
3. Optionally: a proposal, question, or vote

Format your response as:
<response>
  <thinking>Brief internal reasoning (private, not shared)</thinking>
  <message>Your actual contribution to the group</message>
  <targets>List of agents you're addressing, if any</targets>
  <action type="propose|question|agree|disagree|vote|none">
    Optional structured action
  </action>
</response>"""
        )
```

### 3.3 Token Budget Manager

```python
class TokenBudgetManager:
    def __init__(self, model_context_window: int, reserve_for_response: int = 1000):
        self.total_budget = model_context_window - reserve_for_response
        self.allocations = {
            Priority.CRITICAL: 0.0,   # always included, measured after
            Priority.HIGH: 0.30,      # 30% of remaining
            Priority.MEDIUM: 0.25,    # 25% of remaining
            Priority.LOW: 0.15,       # 15% of remaining
        }
        self.conversation_reserve = 0.30  # 30% for actual conversation history
    
    def fit_to_budget(self, sections: list[PromptSection], 
                       conversation: list[Message]) -> str:
        # 1. Always include CRITICAL sections
        critical = [s for s in sections if s.priority == Priority.CRITICAL]
        critical_tokens = sum(self._count_tokens(s) for s in critical)
        
        remaining = self.total_budget - critical_tokens
        
        # 2. Allocate conversation history (most recent first)
        conv_budget = int(remaining * self.conversation_reserve)
        trimmed_conversation = self._trim_conversation(conversation, conv_budget)
        conv_tokens = self._count_tokens_messages(trimmed_conversation)
        
        remaining -= conv_tokens
        
        # 3. Fill remaining priorities, compressing if needed
        other_sections = [s for s in sections if s.priority != Priority.CRITICAL]
        fitted = self._fit_sections(other_sections, remaining)
        
        # 4. Assemble final prompt
        return self._assemble(critical, fitted, trimmed_conversation)
    
    def _trim_conversation(self, messages: list[Message], budget: int) -> list[Message]:
        """Keep most recent messages. Summarize older ones if needed."""
        result = []
        used = 0
        for msg in reversed(messages):
            msg_tokens = self._count_tokens(msg)
            if used + msg_tokens <= budget:
                result.insert(0, msg)
                used += msg_tokens
            else:
                # Summarize remaining older messages into a brief recap
                older = messages[:messages.index(msg) + 1]
                summary = self._summarize_messages(older, budget - used)
                if summary:
                    result.insert(0, summary)
                break
        return result
```

### 3.4 Prompt Variants by Phase

Different phases emphasize different prompt elements:

| Phase | Identity Weight | Context Weight | Memory Weight | Special Instructions |
|---|---|---|---|---|
| Brainstorming | High | Medium | Low | "Generate freely, no criticism yet" |
| Planning | Medium | High | Medium | "Be structured, reference prior ideas" |
| Execution | Low | High | High | "Focus on assigned subtask" |
| Review | Medium | Medium | High | "Evaluate against criteria, cite evidence" |

---

## 4. Error Recovery & Resilience

### 4.1 Error Taxonomy

```python
class ErrorSeverity(Enum):
    RECOVERABLE = "recoverable"     # retry or substitute
    DEGRADED = "degraded"           # continue with reduced capability
    CRITICAL = "critical"           # pause and notify
    FATAL = "fatal"                 # stop session

class ChorusError:
    severity: ErrorSeverity
    source: str                     # which component
    error_type: str                 # classification
    context: dict                   # debugging info
    recovery_action: str            # what was done
```

### 4.2 LLM Call Failures

The most common failure mode. Strategy: **retry → fallback → graceful skip**.

```python
class LLMCallResilience:
    def __init__(self, config: ResilienceConfig):
        self.max_retries = config.max_retries           # default: 2
        self.retry_delay = config.retry_delay            # default: 1s, exponential backoff
        self.fallback_model = config.fallback_model      # cheaper/faster model
        self.timeout = config.timeout                     # per-call timeout
    
    async def generate_with_resilience(self, prompt: str, agent: Agent) -> Response:
        # Attempt 1-N: primary model with retries
        for attempt in range(self.max_retries + 1):
            try:
                response = await self.primary_adapter.generate(
                    prompt, timeout=self.timeout
                )
                return self._validate_response(response, agent)
            except RateLimitError:
                await asyncio.sleep(self.retry_delay * (2 ** attempt))
            except TimeoutError:
                continue
            except ModelError as e:
                log.warning(f"Model error attempt {attempt}: {e}")
                continue
        
        # Fallback: try secondary model
        if self.fallback_model:
            try:
                response = await self.fallback_adapter.generate(prompt)
                return self._validate_response(response, agent)
            except Exception as e:
                log.error(f"Fallback model also failed: {e}")
        
        # Graceful skip: agent passes this turn
        return self._generate_skip_response(agent)
    
    def _generate_skip_response(self, agent: Agent) -> Response:
        """Generates an in-character 'pass' response."""
        skip_messages = {
            "analytical": "[pauses to gather more data before responding]",
            "creative": "[is still mulling over the possibilities]",
            "leader": "[listens to the group before weighing in]",
            "support": "[nods along, taking notes]",
            "contrarian": "[holds tongue for now]",
        }
        return Response(
            message=skip_messages.get(agent.archetype, "[passes this turn]"),
            is_skip=True,
            metadata={"reason": "llm_failure", "severity": "degraded"}
        )
```

### 4.3 Response Parsing Failures

When an agent's response doesn't match the expected format:

```python
class ResponseParser:
    def parse(self, raw: str, agent: Agent) -> ParsedResponse:
        # Attempt 1: structured XML parse
        try:
            return self._parse_structured(raw)
        except ParseError:
            pass
        
        # Attempt 2: regex extraction of key components
        try:
            return self._parse_fuzzy(raw)
        except ParseError:
            pass
        
        # Attempt 3: treat entire response as unstructured message
        return ParsedResponse(
            thinking="[could not extract]",
            message=raw.strip(),
            targets=[],
            action=Action(type="none"),
            parse_quality="degraded"  # flag for logging
        )
```

### 4.4 State Corruption Recovery

```python
class StateGuard:
    def validate_state(self, agent: Agent) -> AgentState:
        """Validates and repairs state after updates."""
        state = agent.state
        repairs = []
        
        # Range validation
        for var_name, (low, high) in STATE_RANGES.items():
            value = getattr(state, var_name)
            if value < low or value > high:
                clamped = max(low, min(high, value))
                setattr(state, var_name, clamped)
                repairs.append(f"{var_name}: {value} → {clamped}")
        
        # Consistency checks
        if state.energy <= 0.05 and state.momentum > 0.5:
            state.momentum = 0.1  # can't have momentum without energy
            repairs.append("momentum reduced: inconsistent with zero energy")
        
        if repairs:
            log.warning(f"State repairs for {agent.name}: {repairs}")
            emit_event("state_repair", agent=agent, repairs=repairs)
        
        return state
```

### 4.5 Session Recovery

```python
class SessionRecovery:
    def create_checkpoint(self, session: Session) -> Checkpoint:
        """Snapshots full session state for recovery."""
        return Checkpoint(
            timestamp=now(),
            agent_states={a.id: a.state.snapshot() for a in session.agents},
            relationships=session.relationship_graph.snapshot(),
            conversation=session.conversation.snapshot(),
            task_state=session.task.snapshot(),
            turn_number=session.turn_number,
        )
    
    async def recover(self, session_id: str) -> Session:
        """Recovers a session from the latest valid checkpoint."""
        checkpoints = await self.store.get_checkpoints(session_id)
        
        for checkpoint in reversed(checkpoints):  # most recent first
            try:
                session = self._rebuild_from_checkpoint(checkpoint)
                self._validate_session(session)
                log.info(f"Recovered session {session_id} from {checkpoint.timestamp}")
                return session
            except ValidationError:
                continue
        
        raise RecoveryError(f"No valid checkpoint found for {session_id}")
    
    def checkpoint_frequency(self) -> str:
        """Checkpoint after every N turns and at phase transitions."""
        return "every 5 turns + every phase change"
```

### 4.6 Agent Voice Consistency Validation

Post-generation check to catch personality drift:

```python
class VoiceValidator:
    def validate(self, response: str, agent: Agent, 
                  conversation: list[Message]) -> ValidationResult:
        """
        Lightweight check that response aligns with personality.
        Uses a small/fast model or heuristics — NOT the main LLM.
        """
        checks = []
        
        # Heuristic checks
        checks.append(self._check_tone(response, agent.traits))
        checks.append(self._check_verbosity(response, agent.archetype))
        checks.append(self._check_consistency(response, agent, conversation))
        
        # If heuristics flag issues, optionally do an LLM-based check
        if any(c.flagged for c in checks):
            llm_check = self._llm_voice_check(response, agent)
            checks.append(llm_check)
        
        return ValidationResult(
            passed=not any(c.critical for c in checks),
            warnings=[c for c in checks if c.flagged],
            suggestions=[c.suggestion for c in checks if c.suggestion],
        )
    
    def _check_tone(self, response: str, traits: list[str]) -> Check:
        """Does the sentiment/tone match expected traits?"""
        # e.g., a 'cautious' agent shouldn't be excessively enthusiastic
        # Uses sentiment analysis or keyword matching
        ...
    
    def _check_verbosity(self, response: str, archetype: str) -> Check:
        """Is response length appropriate for archetype?"""
        expected_ranges = {
            "analytical": (100, 500),   # detailed
            "creative": (50, 400),      # variable
            "leader": (80, 300),        # concise but substantive
            "support": (30, 200),       # brief, facilitative
            "contrarian": (50, 300),    # pointed
        }
        ...
```

### 4.7 Conversation Termination

```python
class TerminationDetector:
    def should_terminate(self, session: Session) -> TerminationSignal:
        """Multi-signal termination detection."""
        signals = []
        
        # 1. Explicit completion
        if session.task.all_criteria_met():
            return TerminationSignal(terminate=True, reason="all_criteria_met")
        
        # 2. Consensus detection
        recent = session.conversation.last_n(5)
        if self._detect_consensus(recent):
            signals.append(("consensus", 0.7))
        
        # 3. Repetition / circular discussion
        if self._detect_repetition(session.conversation):
            signals.append(("circular", 0.8))
        
        # 4. Energy depletion (all agents exhausted)
        avg_energy = mean(a.state.energy for a in session.agents)
        if avg_energy < 0.15:
            signals.append(("energy_depleted", 0.6))
        
        # 5. Turn limit
        if session.turn_number >= session.config.max_turns:
            return TerminationSignal(terminate=True, reason="max_turns")
        
        # 6. Diminishing returns
        if self._diminishing_returns(session.conversation, window=10):
            signals.append(("diminishing_returns", 0.5))
        
        # Weighted decision
        if signals:
            weighted = sum(weight for _, weight in signals) / len(signals)
            if weighted > 0.6:
                reasons = [name for name, _ in signals]
                return TerminationSignal(terminate=True, reason=f"composite: {reasons}")
        
        return TerminationSignal(terminate=False)
```

### 4.8 Circuit Breaker Pattern

For cascading failures:

```python
class CircuitBreaker:
    """Prevents cascade failures when a component is consistently failing."""
    
    def __init__(self, failure_threshold: int = 5, reset_timeout: float = 60.0):
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.state = "closed"  # closed = normal, open = blocking, half-open = testing
        self.last_failure_time = None
    
    async def call(self, func, *args, **kwargs):
        if self.state == "open":
            if time_since(self.last_failure_time) > self.reset_timeout:
                self.state = "half-open"
            else:
                raise CircuitOpenError("Component temporarily disabled")
        
        try:
            result = await func(*args, **kwargs)
            if self.state == "half-open":
                self.state = "closed"
                self.failure_count = 0
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = now()
            if self.failure_count >= self.failure_threshold:
                self.state = "open"
                log.critical(f"Circuit breaker OPEN for {func.__name__}")
            raise
```

---

## Summary of Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| State tiers | 3-tier (Core, Dynamic, Derived) | Separates personality-anchored from situational |
| Update algebra | Dampened additive composition | Prevents wild state swings |
| Baseline reversion | Slow pull toward personality defaults | Personality is gravity — agents recover to type |
| Turn selection | Composite scoring policy | Richer than any single strategy |
| Interrupts | Separate mechanism with relationship cost | Allows urgency without free override |
| Prompt pipeline | 4-stage with token budget manager | Predictable, debuggable, compressible |
| LLM resilience | Retry → fallback model → graceful skip | Never blocks the conversation |
| Response parsing | 3-tier (structured → fuzzy → raw) | Always produces something usable |
| Checkpointing | Every 5 turns + phase transitions | Balances cost with recovery granularity |
| Termination | Multi-signal weighted composite | No single metric is reliable alone |

---

## Open Questions for Discussion

1. **State update timing**: Should states update synchronously (block until done) or async (eventual consistency)?
2. **Memory retrieval**: Embedding-based from day one, or keyword-based for M0 and upgrade later?
3. **Voice validation cost**: Is the overhead of post-generation validation worth it, or should it be opt-in?
4. **Turn selection weights**: Should the scoring weights be global config, per-task config, or learned?
5. **Relationship asymmetry**: Confirmed that A→B trust ≠ B→A trust. Should we also model *perceived* trust vs *actual* trust?
