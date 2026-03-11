import pytest
from chorus.core.memory import (
    AgentMemory,
    ConsolidationRule,
    Episode,
    EpisodicMemory,
    SemanticMemory,
    WorkingMemory,
)


def make_episode(turn: int, content: str, agent: str = "Other", outcome: str = "neutral", valence: float = 0.0) -> Episode:
    return Episode(turn=turn, agent_name=agent, content=content, emotional_valence=valence, outcome=outcome)


# WorkingMemory

def test_working_memory_respects_capacity():
    wm = WorkingMemory(capacity=3)
    for i in range(5):
        wm.add(make_episode(i, f"message {i}"))
    assert len(wm.recent()) == 3


def test_working_memory_keeps_most_recent():
    wm = WorkingMemory(capacity=3)
    for i in range(5):
        wm.add(make_episode(i, f"message {i}"))
    recent = wm.recent()
    assert recent[0].turn == 2
    assert recent[-1].turn == 4


def test_working_memory_clear():
    wm = WorkingMemory(capacity=5)
    wm.add(make_episode(1, "hello"))
    wm.clear()
    assert wm.recent() == []


# EpisodicMemory

def test_episodic_retrieve_returns_most_relevant():
    em = EpisodicMemory()
    em.record(make_episode(1, "the cat sat on the mat"))
    em.record(make_episode(2, "dogs are great pets"))
    em.record(make_episode(3, "the cat is a feline"))

    results = em.retrieve("cat feline", limit=2)
    contents = [r.content for r in results]
    assert any("cat" in c for c in contents)


def test_episodic_retrieve_respects_limit():
    em = EpisodicMemory()
    for i in range(10):
        em.record(make_episode(i, f"message about topic {i}"))
    results = em.retrieve("topic", limit=3)
    assert len(results) <= 3


def test_episodic_retrieve_empty():
    em = EpisodicMemory()
    assert em.retrieve("anything") == []


# SemanticMemory

def test_semantic_retrieve_by_keyword():
    sm = SemanticMemory()
    from chorus.core.memory import SemanticFact
    sm.add(SemanticFact(content="trust with Agent B is low"))
    sm.add(SemanticFact(content="Agent A is reliable"))

    results = sm.retrieve("trust Agent B")
    assert len(results) >= 1
    assert "trust" in results[0].content


def test_semantic_retrieve_empty():
    sm = SemanticMemory()
    assert sm.retrieve("anything") == []


# ConsolidationRule

def test_consolidation_triggers_on_pattern():
    rule = ConsolidationRule()
    episodes = [make_episode(i, "conflict", outcome="failure") for i in range(3)]
    assert rule.should_consolidate(episodes) is True


def test_consolidation_triggers_on_high_valence():
    rule = ConsolidationRule()
    episodes = [make_episode(1, "critical event", valence=0.9)]
    assert rule.should_consolidate(episodes) is True


def test_consolidation_does_not_trigger_on_neutral():
    rule = ConsolidationRule()
    episodes = [
        make_episode(1, "message", outcome="neutral"),
        make_episode(2, "message", outcome="success"),
    ]
    assert rule.should_consolidate(episodes) is False


# AgentMemory integration

def test_agent_memory_record_turn_adds_to_all_systems():
    mem = AgentMemory(working_capacity=5)
    ep = make_episode(1, "hello world")
    mem.record_turn(ep)
    assert len(mem.working.recent()) == 1
    assert len(mem.episodic.all()) == 1


def test_agent_memory_consolidates_after_pattern():
    mem = AgentMemory(working_capacity=10)
    for i in range(3):
        mem.record_turn(make_episode(i, f"failure event {i}", outcome="failure"))
    assert len(mem.semantic.all()) >= 1


def test_agent_memory_does_not_duplicate_semantic_facts():
    mem = AgentMemory(working_capacity=10)
    # Trigger consolidation twice with similar data
    for _ in range(2):
        for i in range(3):
            mem.record_turn(make_episode(i, f"repeated failure", outcome="failure"))
    facts = {f.content for f in mem.semantic.all()}
    assert len(facts) == len(mem.semantic.all())  # all unique
