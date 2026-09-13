from __future__ import annotations

from dataclasses import dataclass, field
from collections import deque


@dataclass
class Episode:
    turn: int
    agent_name: str
    content: str
    emotional_valence: float = 0.0   # -1.0 (negative) to 1.0 (positive)
    outcome: str = "neutral"          # "success", "failure", "neutral"


@dataclass
class SemanticFact:
    content: str
    source_turns: list[int] = field(default_factory=list)
    confidence: float = 1.0


class WorkingMemory:
    """Fixed-capacity sliding window of recent messages."""

    def __init__(self, capacity: int) -> None:
        self._capacity = capacity
        self._slots: deque[Episode] = deque(maxlen=capacity)

    def add(self, episode: Episode) -> None:
        self._slots.append(episode)

    def recent(self) -> list[Episode]:
        return list(self._slots)

    def clear(self) -> None:
        self._slots.clear()


class EpisodicMemory:
    """Stores all interactions with retrieval by recency and keyword relevance."""

    def __init__(self) -> None:
        self._episodes: list[Episode] = []

    def record(self, episode: Episode) -> None:
        self._episodes.append(episode)

    def retrieve(
        self,
        query: str,
        limit: int = 5,
        recency_weight: float = 0.4,
        relevance_weight: float = 0.6,
    ) -> list[Episode]:
        if not self._episodes:
            return []

        query_words = set(query.lower().split())
        total = len(self._episodes)
        scored: list[tuple[float, Episode]] = []

        for i, episode in enumerate(self._episodes):
            recency_score = (i + 1) / total
            episode_words = set(episode.content.lower().split())
            overlap = len(query_words & episode_words)
            relevance_score = overlap / max(len(query_words), 1)
            score = recency_weight * recency_score + relevance_weight * relevance_score
            scored.append((score, episode))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [ep for _, ep in scored[:limit]]

    def all(self) -> list[Episode]:
        return list(self._episodes)


class SemanticMemory:
    """Stores consolidated facts promoted from episodic memory."""

    def __init__(self) -> None:
        self._facts: list[SemanticFact] = []

    def add(self, fact: SemanticFact) -> None:
        self._facts.append(fact)

    def retrieve(self, query: str, limit: int = 3) -> list[SemanticFact]:
        if not self._facts:
            return []

        query_words = set(query.lower().split())
        scored: list[tuple[float, SemanticFact]] = []

        for fact in self._facts:
            fact_words = set(fact.content.lower().split())
            overlap = len(query_words & fact_words)
            score = overlap / max(len(query_words), 1)
            scored.append((score, fact))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [f for _, f in scored[:limit]]

    def all(self) -> list[SemanticFact]:
        return list(self._facts)


class ConsolidationRule:
    pattern_threshold: int = 3
    emotional_intensity: float = 0.8
    recency_window: int = 10

    def should_consolidate(self, episodes: list[Episode]) -> bool:
        if self._count_similar(episodes) >= self.pattern_threshold:
            return True
        if any(abs(e.emotional_valence) >= self.emotional_intensity for e in episodes):
            return True
        return False

    def _count_similar(self, episodes: list[Episode]) -> int:
        if len(episodes) < 2:
            return 0
        outcomes = [e.outcome for e in episodes]
        most_common = max(set(outcomes), key=outcomes.count)
        return outcomes.count(most_common)


class AgentMemory:
    """Container combining all memory systems for one agent."""

    def __init__(self, working_capacity: int) -> None:
        self.working = WorkingMemory(capacity=working_capacity)
        self.episodic = EpisodicMemory()
        self.semantic = SemanticMemory()
        self._consolidation = ConsolidationRule()

    def record_turn(self, episode: Episode) -> None:
        self.working.add(episode)
        self.episodic.record(episode)
        self._maybe_consolidate()

    def _maybe_consolidate(self) -> None:
        recent = self.episodic.all()[-self._consolidation.recency_window:]
        if not self._consolidation.should_consolidate(recent):
            return

        # Build a semantic fact from the pattern
        outcomes = [e.outcome for e in recent]
        most_common = max(set(outcomes), key=outcomes.count)
        agents = list({e.agent_name for e in recent if e.agent_name})
        turns = [e.turn for e in recent]

        summary = (
            f"In recent turns, interactions with {', '.join(agents)} "
            f"have frequently resulted in '{most_common}' outcomes."
        )

        existing = {f.content for f in self.semantic.all()}
        if summary not in existing:
            self.semantic.add(SemanticFact(content=summary, source_turns=turns))
