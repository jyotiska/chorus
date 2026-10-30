"""Deterministic game state from committed public turns, never observer journals."""
from __future__ import annotations

import re
from typing import Literal

from chorus.contracts import Agent, StatChange, Turn

Feedback = Literal["rejected", "challenged", "adopted", "supported"]


def directed_feedback(text: str, target: Agent, agents: list[Agent]) -> Feedback | None:
    """Conservative phrase matching: a named peer and explicit feedback in one clause.

    This is a game mechanic, not a semantic assessment of whether an idea won.
    Unmentioned proposals, silence, judge reviews and private feelings are not signals.
    """
    aliases = [target.name]
    first = target.name.split()[0]
    if sum(a.name.split()[0].casefold() == first.casefold() for a in agents) == 1:
        aliases.append(first)
    name = r"(?:" + "|".join(re.escape(n) for n in aliases) + r")\b"
    proposal = name + r"(?:['’]s)?(?:\s+(?:idea|proposal|approach|plan|suggestion))?"
    lead = r"^(?:(?:i|we)\s+(?:(?:would|should|will|can)\s+)?|let['’]s\s+)?"
    patterns: list[tuple[Feedback, str]] = [
        ("rejected", lead + r"(?:reject|drop|set aside|pass on|cannot use|can't use|won't use)\s+" + proposal),
        ("rejected", r"^" + proposal + r"\s+(?:(?:is|was|has been)\s+)?(?:rejected|not chosen|not selected|ruled out)\b"),
        ("challenged", lead + r"(?:disagree with|challenge|question|don't agree with|do not agree with)\s+" + proposal),
        ("challenged", r"^" + name + r",\s*(?:i|we)\s+(?:disagree|have concerns|am concerned|are concerned)\b"),
        ("adopted", lead + r"(?:adopt|choose|use|go with|select)\s+" + proposal),
        ("adopted", r"^" + proposal + r"\s+(?:(?:is|was|has been)\s+)(?:adopted|chosen|selected|accepted)\b"),
        ("supported", lead + r"(?:agree with|support|back|like)\s+" + proposal),
        ("supported", r"^" + name + r",\s*(?:i|we)\s+agree\b"),
    ]
    found: set[Feedback] = set()
    for clause in re.split(r"[.!?;\n]|\bbut\b", text, flags=re.I):
        for signal, pattern in patterns:
            if re.search(pattern, clause.strip(), re.I):
                found.add(signal)
    # One reaction per peer per turn; explicit rejection takes precedence.
    return next((signal for signal in ("rejected", "challenged", "adopted", "supported") if signal in found), None)


def apply_turn_state(agents: list[Agent], turn: Turn) -> list[StatChange]:
    if turn.kind != "agent":
        return []
    changes = []
    for agent in agents:
        style = agent.personality.socialStyle
        response = agent.personality.challengeResponse
        reasons = []
        confidence = 0
        if agent.id == turn.speakerId:
            energy = -{"introverted": 6, "ambiverted": 4, "extroverted": 2}[style]
            confidence = 1
            reasons.append(f"Speaking ({style}): {energy} energy, +1 confidence")
            if "updated" in turn.actions:
                cost = 3 if style == "introverted" else 2
                energy -= cost
                confidence += 2
                reasons.append(f"Canvas contribution: -{cost} energy, +2 confidence")
        else:
            energy = {"introverted": 4, "ambiverted": 2, "extroverted": 1}[style]
            reasons.append(f"Listening recovery ({style}): +{energy} energy")
            signal = directed_feedback(turn.text, agent, agents)
            if signal:
                confidence = {
                    "rejected": {"sensitive": -10, "balanced": -6, "resilient": -3},
                    "challenged": {"sensitive": -7, "balanced": -4, "resilient": -2},
                    "adopted": {"sensitive": 7, "balanced": 5, "resilient": 4},
                    "supported": {"sensitive": 4, "balanced": 3, "resilient": 2},
                }[signal][response]
                reasons.append(f"{turn.speakerName} {signal} their idea ({response}): {confidence:+} confidence")
        previous_energy, previous_confidence = agent.energy, agent.confidence
        agent.energy = max(0, min(100, agent.energy + energy))
        agent.confidence = max(0, min(100, agent.confidence + confidence))
        changes.append(StatChange(agentId=agent.id, energy=agent.energy - previous_energy,
                                  confidence=agent.confidence - previous_confidence, reasons=reasons))
    return changes


def state_instruction(agent: Agent, *, reflection: bool = False) -> str:
    """Describe the agent's own state for public action or private reflection."""
    state = (f"Current energy: {agent.energy}/100; confidence: {agent.confidence}/100. "
             f"Social style: {agent.personality.socialStyle}; response to challenge: {agent.personality.challengeResponse}. ")
    if reflection:
        return (state + "Treat your energy, confidence, and recent changes as background awareness when reflecting on the conversation. "
                "You do not need to mention these feelings or changes in every entry, and should not recite numeric stats. "
                "Let them subtly inform your perspective when relevant; otherwise reflect naturally on the task or your peers.")
    energy = "Conserve energy: speak briefly and prefer one focused canvas edit or UNCHANGED when no useful edit is needed." if agent.energy <= 30 else "You have energy to contribute actively; keep edits focused."
    confidence = "Use tentative phrasing and ask for validation when uncertain, while still stating evidence-based concerns." if agent.confidence <= 35 else "State your reasoning directly and remain open to correction."
    return (state +
            f"{energy} {confidence} These simulated states influence tone and effort, never factual certainty, safety, or your obligation to contribute. "
            "Respond naturally; do not narrate the numeric stats.")
