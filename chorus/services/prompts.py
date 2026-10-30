"""Nanoville prompts, rendered in Python from preserved text."""
from __future__ import annotations
import json
import math
from importlib.resources import files
from chorus import ENGINE_VERSION
from chorus.contracts import Snapshot, Agent, Turn
from chorus.services.canvas import heading_paths
from chorus.services.agent_state import apply_turn_state, state_instruction

PROMPT_VERSION = ENGINE_VERSION
TEMPLATES = json.loads(files("chorus").joinpath("services/prompt-templates.json").read_text())
CONSTANTS = json.loads(files("chorus").joinpath("services/prompt-constants.json").read_text())
JUDGE = json.loads(files("chorus").joinpath("catalog/catalog.json").read_text())["judge"]
Message = dict[str, str]


def render(index: int, *values: object) -> str:
    template = TEMPLATES[index]
    if len(values) != len(template["parts"]):
        raise ValueError(f"Prompt template {index}: incorrect argument count")
    return template["text"] + "".join(str(value) + part["text"] for value, part in zip(values, template["parts"]))


def transcript(session: Snapshot, review: bool = False) -> str:
    lines = []
    for turn in session.turns:
        if turn.kind == "skipped":
            lines.append(render(0, turn.speakerName))
        else:
            lines.append(render(17 if review else 1, turn.speakerName, (" (previous judge feedback)" if review else " (judge feedback)") if turn.kind == "judge" else "", turn.text))
    return "\n".join(lines)


def count(session: Snapshot) -> int:
    return sum(t.kind != "judge" for t in session.turns)


def closing(session: Snapshot) -> bool:
    return count(session) >= session.config.maxTurns - min(5, math.ceil(session.config.maxTurns / 3))


def persona(agent: Agent, *, reflection: bool = False) -> list[str]:
    return [agent.name, agent.role, agent.description, ", ".join(agent.traits), f"{agent.mood}. {state_instruction(agent, reflection=reflection)}"]


def participants(session: Snapshot, separator: str = ", ") -> str:
    return separator.join(f"{a.name} ({a.role})" for a in session.agents)


def canvas_messages(session: Snapshot, speaker: Agent, rejection: str | None = None) -> list[Message]:
    scenario = session.scenario
    history = transcript(session) or "No contributions yet. Start the requested deliverable with a concrete draft grounded in the scenario."
    feedback = "\n\nJudge feedback appears in the discussion history. Consider its strengths, concerns, and priorities. Address useful feedback in your canvas contribution; explain reasoned disagreements using available evidence." if any(t.kind == "judge" for t in session.turns) else ""
    instructions = render(3, *persona(speaker), scenario.title, scenario.problem, "\n".join("- " + g for g in scenario.guidelines), scenario.deliverable, count(session) + 1, session.config.maxTurns, participants(session), feedback)
    example = json.dumps({"op": "CREATE_DOCUMENT", "document": "# Trial brief\n\n## Proposal\nPropose a narrow trial with human review.\n\n## Open decisions\nIdentify the approval needed before starting."}, separators=(",", ":"))
    messages = [
        {"role": "system", "content": render(6, instructions, 6000, example)},
        {"role": "user", "content": render(7, render(2, history, session.canvas or "(empty)"), json.dumps(heading_paths(session.canvas, scenario.problem), ensure_ascii=False, separators=(",", ":")), CONSTANTS["focus"]["yes" if closing(session) else "no"])},
    ]
    if rejection:
        extra = "The supplied evidence does not verify a current API, integration, or training capability. For unsupported capabilities write: Unknown — requires Product and Engineering validation. Do not infer standard features or existing training resources from the fact that a product exists." if rejection == "Unsupported capability confirmation." else ""
        messages.append({"role": "user", "content": render(8, rejection, extra)})
    return messages


def spoken_messages(session: Snapshot, speaker: Agent, canvas: str, updated: bool, description: str = "A canvas revision was prepared.") -> list[Message]:
    before = list(dict.fromkeys(line.strip() for line in session.canvas.split("\n") if line.strip()))
    after = list(dict.fromkeys(line.strip() for line in canvas.split("\n") if line.strip()))
    added = "\n".join([line for line in after if line not in before][:3])[:500]
    removed = "\n".join([line for line in before if line not in after][:3])[:500]
    change = render(9, description, removed or "(no unique lines removed)", added or "(existing content reorganized)") if updated else "No changed lines; the document is unchanged."
    final = "This is a closing turn: state a final conditional decision, fallback, or remaining blocker. Do not request another meeting or new external evidence; identify what must be validated outside this session." if closing(session) else "Advance one unresolved requirement using the supplied evidence."
    return [
        {"role": "system", "content": render(10, *persona(speaker), CONSTANTS["contribution"]["yes" if updated else "no"], final)},
        {"role": "user", "content": render(11, session.scenario.deliverable, count(session) + 1, session.config.maxTurns, session.scenario.problem, transcript(session) or "No contributions yet. Start the requested deliverable with a concrete draft grounded in the scenario.", "Your revised shared canvas" if updated else "Unchanged shared canvas", canvas or "(empty)", change, "Briefly explain your completed change" if updated else "State a concrete validation check, tradeoff, or conditional decision that advances the plan without claiming a document edit")},
    ]


def journal_messages(session: Snapshot, speaker: Agent, canvas: str, text: str, *, updated: bool = False) -> list[Message]:
    s = session.scenario
    # Preview the same transition the service will commit. Never mutate live state
    # before journal generation completes: cancellation must discard the whole turn.
    after = speaker.model_copy(deep=True)
    pending_turn = Turn(kind="agent", turnNumber=count(session) + 1, speakerId=speaker.id,
                        speakerName=speaker.name, text=text, actions=["updated"] if updated else [])
    change = apply_turn_state([after], pending_turn)[0]
    recent = []
    for turn in reversed(session.turns):
        if turn.kind == "agent" and turn.speakerId == speaker.id:
            break
        for prior in turn.statChanges:
            if prior.agentId == speaker.id:
                recent.append(f"Turn {turn.turnNumber}: energy {prior.energy:+}, confidence {prior.confidence:+}. " + "; ".join(prior.reasons))
    awareness = (f"Your state after this contribution: energy {speaker.energy} -> {after.energy}/100 "
                 f"({change.energy:+}); confidence {speaker.confidence} -> {after.confidence}/100 ({change.confidence:+}).\n"
                 + "\n".join([*reversed(recent), "This contribution: " + "; ".join(change.reasons)]))
    return [
        {"role": "system", "content": render(12, *persona(after, reflection=True))},
        {"role": "user", "content": render(13, s.title, s.problem, s.deliverable, count(session) + 1, session.config.maxTurns, participants(session), transcript(session) or "(No contributions yet.)", text, canvas or "(empty)") + "\n\nBackground state awareness (not a checklist to mention):\n" + awareness},
    ]


def judge_messages(session: Snapshot, final: bool) -> tuple[list[str], list[Message]]:
    s = session.scenario
    criteria = ["Expected deliverable"] + [f"Guideline {i + 1}" for i in range(len(s.guidelines))]
    instruction = "Give a final judgement of the completed work. Assess every criterion exactly once using its supplied label. Explain how the team responded to previous judge feedback, or state that no previous feedback was given. For an early stop, evaluate the partial work fairly and identify unfinished requirements. Your judgement will appear in a dedicated panel." if final else "Give checkpoint feedback to all agents: assess progress, recognize what went well, identify what to improve, and prioritize concrete actions for their next turns. Your feedback will be shared with all participants in the discussion feed."
    skipped = sum(t.kind == "skipped" for t in session.turns)
    messages = [
        {"role": "system", "content": render(18, JUDGE["name"], JUDGE["description"], instruction)},
        {"role": "user", "content": render(19, s.title, s.problem, s.deliverable, "\n".join(f"Guideline {i + 1}: {g}" for i, g in enumerate(s.guidelines)), participants(session, "\n"), count(session) - skipped, session.config.maxTurns, skipped, count(session), session.config.maxTurns, sum(t.kind == "judge" for t in session.turns), "Final review after an early stop" if final and session.endedEarly else "Final review at the turn limit" if final else "Five-turn checkpoint", transcript(session, True) or "(No contributions yet.)", session.canvas or "(EMPTY: no written deliverable exists. For a final review, mark Expected deliverable as Missing and do not give a Meets requirements verdict.)")},
    ]
    return criteria, messages
