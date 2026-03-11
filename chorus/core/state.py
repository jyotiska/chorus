from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable


class UpdateSource(Enum):
    INTERACTION_SUCCESS = "interaction_success"
    INTERACTION_FAILURE = "interaction_failure"
    TASK_PROGRESS = "task_progress"
    TASK_SETBACK = "task_setback"
    TIME_DECAY = "time_decay"
    PERSONALITY_REVERSION = "personality_reversion"
    EXTERNAL_EVENT = "external_event"


@dataclass
class StateUpdate:
    variable: str
    delta: float
    source: UpdateSource
    decay: float = 1.0


@dataclass
class StateEvent:
    name: str
    variable: str
    value: float
    agent_name: str


# Thresholds that emit events when crossed
STATE_THRESHOLDS: dict[str, list[tuple[float, str]]] = {
    "frustration": [
        (0.7, "frustration_high"),
        (0.9, "frustration_critical"),
    ],
    "energy": [
        (0.2, "energy_low"),
        (0.05, "energy_depleted"),
    ],
    "confidence": [
        (0.2, "confidence_crisis"),
        (0.9, "confidence_peak"),
    ],
}

# Valid ranges for each state variable
STATE_RANGES: dict[str, tuple[float, float]] = {
    "confidence": (0.0, 1.0),
    "cooperation": (0.0, 1.0),
    "assertiveness": (0.0, 1.0),
    "openness": (0.0, 1.0),
    "energy": (0.0, 1.0),
    "momentum": (-1.0, 1.0),
    "frustration": (0.0, 1.0),
    "focus": (0.0, 1.0),
}


@dataclass
class AgentState:
    # Tier 1 — Core Drives (slow, personality-anchored)
    confidence: float = 0.6
    cooperation: float = 0.6
    assertiveness: float = 0.5
    openness: float = 0.6

    # Tier 2 — Dynamic State (fast, situation-driven)
    energy: float = 0.8
    momentum: float = 0.0
    frustration: float = 0.0
    focus: float = 0.8

    def snapshot(self) -> dict[str, float]:
        return {
            "confidence": self.confidence,
            "cooperation": self.cooperation,
            "assertiveness": self.assertiveness,
            "openness": self.openness,
            "energy": self.energy,
            "momentum": self.momentum,
            "frustration": self.frustration,
            "focus": self.focus,
            "mood": self.mood,
            "engagement": self.engagement,
            "receptiveness": self.receptiveness,
            "initiative": self.initiative,
        }

    # Tier 3 — Derived (computed, not stored)
    @property
    def mood(self) -> str:
        score = (self.energy + self.momentum + (1 - self.frustration)) / 3
        if score > 0.75:
            return "motivated"
        if score > 0.5:
            return "engaged"
        if score > 0.3:
            return "neutral"
        if self.frustration > 0.6:
            return "frustrated"
        return "disengaged"

    @property
    def engagement(self) -> float:
        return self.energy * self.focus

    @property
    def receptiveness(self) -> float:
        return self.openness * self.cooperation * (1 - self.frustration)

    @property
    def initiative(self) -> float:
        return self.confidence * self.assertiveness * self.energy


def compose_updates(updates: list[StateUpdate]) -> float:
    """Combines multiple deltas with diminishing returns."""
    total = 0.0
    for update in sorted(updates, key=lambda u: abs(u.delta), reverse=True):
        effective_delta = update.delta * (1.0 / (1.0 + abs(total)))
        total += effective_delta
    return total


def apply_baseline_reversion(
    current: float, baseline: float, rate: float = 0.05
) -> float:
    """Gently pulls current value toward personality baseline each turn."""
    return current + (baseline - current) * rate


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class StateGuard:
    def validate(self, state: AgentState, agent_name: str) -> list[StateEvent]:
        """Validates ranges, fixes inconsistencies, emits threshold events."""
        events: list[StateEvent] = []

        for var_name, (low, high) in STATE_RANGES.items():
            value = getattr(state, var_name)
            clamped = clamp(value, low, high)
            if clamped != value:
                setattr(state, var_name, clamped)

        # Consistency: can't have high momentum with near-zero energy
        if state.energy <= 0.05 and state.momentum > 0.5:
            state.momentum = 0.1

        # Emit threshold events
        for var_name, thresholds in STATE_THRESHOLDS.items():
            value = getattr(state, var_name)
            for threshold, event_name in thresholds:
                if var_name in ("energy",):
                    # Low-end threshold: fire when value drops below
                    if value <= threshold:
                        events.append(StateEvent(event_name, var_name, value, agent_name))
                else:
                    # High-end threshold: fire when value exceeds
                    if value >= threshold:
                        events.append(StateEvent(event_name, var_name, value, agent_name))

        return events


def apply_updates(
    state: AgentState,
    updates: list[StateUpdate],
    baselines: dict[str, float],
    agent_name: str,
    guard: StateGuard,
) -> list[StateEvent]:
    """Applies a batch of updates, then runs baseline reversion and validation."""
    # Group updates by variable
    by_variable: dict[str, list[StateUpdate]] = {}
    for update in updates:
        by_variable.setdefault(update.variable, []).append(update)

    # Apply composed delta to each variable
    for var_name, var_updates in by_variable.items():
        if var_name not in STATE_RANGES:
            continue
        current = getattr(state, var_name)
        delta = compose_updates(var_updates)
        setattr(state, var_name, current + delta)

    # Baseline reversion for Tier 1 variables only
    for var_name in ("confidence", "cooperation", "assertiveness", "openness"):
        if var_name in baselines:
            current = getattr(state, var_name)
            reverted = apply_baseline_reversion(current, baselines[var_name])
            setattr(state, var_name, reverted)

    return guard.validate(state, agent_name)
