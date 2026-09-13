import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from chorus.core.state import (
    AgentState,
    StateEvent,
    StateGuard,
    StateUpdate,
    UpdateSource,
    apply_updates,
    apply_baseline_reversion,
    clamp,
    compose_updates,
)


BASELINES = {
    "confidence": 0.6,
    "cooperation": 0.6,
    "assertiveness": 0.5,
    "openness": 0.6,
}


def test_compose_updates_single():
    updates = [StateUpdate("confidence", 0.2, UpdateSource.INTERACTION_SUCCESS)]
    assert compose_updates(updates) == pytest.approx(0.2)


def test_compose_updates_dampening():
    updates = [
        StateUpdate("confidence", 0.5, UpdateSource.INTERACTION_SUCCESS),
        StateUpdate("confidence", 0.5, UpdateSource.INTERACTION_SUCCESS),
    ]
    result = compose_updates(updates)
    # Second update is dampened — result should be less than 1.0
    assert result < 1.0
    assert result > 0.5


def test_compose_updates_opposing():
    updates = [
        StateUpdate("confidence", 0.4, UpdateSource.INTERACTION_SUCCESS),
        StateUpdate("confidence", -0.4, UpdateSource.INTERACTION_FAILURE),
    ]
    result = compose_updates(updates)
    assert abs(result) < 0.4


def test_baseline_reversion_pulls_toward_baseline():
    result = apply_baseline_reversion(current=0.9, baseline=0.6, rate=0.05)
    assert result < 0.9
    assert result > 0.6


def test_baseline_reversion_at_baseline_is_stable():
    result = apply_baseline_reversion(current=0.6, baseline=0.6, rate=0.05)
    assert result == pytest.approx(0.6)


def test_clamp_within_range():
    assert clamp(0.5, 0.0, 1.0) == 0.5


def test_clamp_below_min():
    assert clamp(-0.1, 0.0, 1.0) == 0.0


def test_clamp_above_max():
    assert clamp(1.5, 0.0, 1.0) == 1.0


def test_state_guard_clamps_out_of_range():
    state = AgentState(confidence=1.5, energy=-0.1)
    guard = StateGuard()
    guard.validate(state, "TestAgent")
    assert state.confidence == 1.0
    assert state.energy == 0.0


def test_state_guard_fixes_momentum_energy_inconsistency():
    state = AgentState(energy=0.01, momentum=0.8)
    guard = StateGuard()
    guard.validate(state, "TestAgent")
    assert state.momentum <= 0.1


def test_state_guard_emits_frustration_high_event():
    state = AgentState(frustration=0.75)
    guard = StateGuard()
    events = guard.validate(state, "TestAgent")
    event_names = [e.name for e in events]
    assert "frustration_high" in event_names


def test_state_guard_emits_energy_low_event():
    state = AgentState(energy=0.15)
    guard = StateGuard()
    events = guard.validate(state, "TestAgent")
    event_names = [e.name for e in events]
    assert "energy_low" in event_names


def test_apply_updates_changes_state():
    state = AgentState()
    guard = StateGuard()
    updates = [StateUpdate("energy", -0.1, UpdateSource.TIME_DECAY)]
    apply_updates(state, updates, BASELINES, "TestAgent", guard)
    assert state.energy < 0.8


def test_apply_updates_reverts_tier1_to_baseline():
    state = AgentState(confidence=0.9)
    guard = StateGuard()
    apply_updates(state, [], BASELINES, "TestAgent", guard)
    assert state.confidence < 0.9  # pulled toward baseline 0.6


@given(
    confidence=st.floats(min_value=0.0, max_value=1.0),
    energy=st.floats(min_value=0.0, max_value=1.0),
    delta=st.floats(min_value=-1.0, max_value=1.0),
)
@settings(max_examples=200)
def test_state_always_valid_after_updates(confidence, energy, delta):
    state = AgentState(confidence=confidence, energy=energy)
    guard = StateGuard()
    updates = [StateUpdate("confidence", delta, UpdateSource.INTERACTION_SUCCESS)]
    apply_updates(state, updates, BASELINES, "Agent", guard)
    assert 0.0 <= state.confidence <= 1.0
    assert 0.0 <= state.energy <= 1.0
    assert -1.0 <= state.momentum <= 1.0
    assert 0.0 <= state.frustration <= 1.0


def test_derived_mood_motivated():
    state = AgentState(energy=0.9, momentum=0.8, frustration=0.0)
    assert state.mood == "motivated"


def test_derived_mood_frustrated():
    state = AgentState(energy=0.2, momentum=-0.5, frustration=0.8)
    assert state.mood == "frustrated"


def test_derived_engagement():
    state = AgentState(energy=0.8, focus=0.5)
    assert state.engagement == pytest.approx(0.4)


def test_derived_receptiveness():
    state = AgentState(openness=0.8, cooperation=0.5, frustration=0.0)
    assert state.receptiveness == pytest.approx(0.4)


def test_derived_initiative():
    state = AgentState(confidence=0.8, assertiveness=0.5, energy=0.5)
    assert state.initiative == pytest.approx(0.2)
