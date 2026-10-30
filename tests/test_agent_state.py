import copy

import pytest
from pydantic import ValidationError

from chorus.contracts import Agent, Personality, SessionConfig, Snapshot, Turn
from chorus.services.agent_state import apply_turn_state, directed_feedback
from chorus.services.prompts import canvas_messages, spoken_messages, journal_messages, judge_messages
from chorus.services.sessions import SessionService
from chorus.services.catalog import load_catalog
from chorus.storage import Store
from tests.conftest import CONFIG
from tests.test_platform import command, settle


def turn(speaker, text="A focused proposal.", updated=False, kind="agent"):
    return Turn(kind=kind, turnNumber=1, speakerId=speaker.id, speakerName=speaker.name,
                text=text, actions=["updated"] if updated else [])


def test_introverts_spend_more_speaking_and_editing_and_recover_while_listening(snapshot):
    intro, extro = snapshot.agents
    intro.personality.socialStyle = "introverted"
    extro.personality.socialStyle = "extroverted"
    before = copy.deepcopy(snapshot.agents)
    changes = apply_turn_state(snapshot.agents, turn(intro, updated=True))
    assert (intro.energy, intro.confidence) == (before[0].energy - 9, before[0].confidence + 3)
    assert extro.energy == before[1].energy + 1
    assert changes[0].energy == -9
    changes = apply_turn_state(snapshot.agents, turn(extro, updated=True))
    assert changes[0].energy == 4 and changes[1].energy == -4


@pytest.mark.parametrize("text,expected", [
    ("I disagree with Riley's proposal.", "challenged"),
    ("Riley, I disagree with that approach.", "challenged"),
    ("I don't agree with Riley's plan.", "challenged"),
    ("We should reject Riley's idea.", "rejected"),
    ("Riley's proposal was not chosen.", "rejected"),
    ("Let's go with Riley Chen's approach.", "adopted"),
    ("Riley's idea was accepted.", "adopted"),
    ("I agree with Riley, but I disagree with Jordan.", "supported"),
    ("I support Riley's idea. We should reject Riley's approach.", "rejected"),
    ("I disagree with Jordan. Riley has a proposal.", None),
    ("I don't reject Riley's idea.", None),
    ("If we reject Riley's idea, we need a fallback.", None),
    ("I agree with Rileyson.", None),
    ("We discussed Riley's proposal.", None),
])
def test_feedback_is_explicit_and_directed(snapshot, text, expected):
    assert directed_feedback(text, snapshot.agents[0], snapshot.agents) == expected


def test_ambiguous_first_names_are_not_attributed(snapshot):
    target = snapshot.agents[0]
    other = target.model_copy(update={"id": "another", "name": "Riley Smith"})
    assert directed_feedback("I reject Riley's proposal.", target, [target, other]) is None
    assert directed_feedback("I reject Riley Chen's proposal.", target, [target, other]) == "rejected"


def test_sensitive_agents_lose_more_confidence_and_gain_more_when_adopted(snapshot):
    target, speaker = snapshot.agents
    target.personality.challengeResponse = "sensitive"
    assert apply_turn_state(snapshot.agents, turn(speaker, "I disagree with Riley's idea."))[0].confidence == -7
    assert apply_turn_state(snapshot.agents, turn(speaker, "We reject Riley's idea."))[0].confidence == -10
    assert apply_turn_state(snapshot.agents, turn(speaker, "We adopt Riley's idea."))[0].confidence == 7
    target.personality.challengeResponse = "resilient"
    assert apply_turn_state(snapshot.agents, turn(speaker, "I disagree with Riley's idea."))[0].confidence == -2


def test_state_clamps_and_records_actual_delta(snapshot):
    speaker, peer = snapshot.agents
    speaker.energy, speaker.confidence = 1, 99
    peer.energy, peer.confidence = 100, 1
    changes = apply_turn_state(snapshot.agents, turn(speaker, "We reject Jordan's idea.", updated=True))
    assert (speaker.energy, speaker.confidence) == (0, 100)
    assert (peer.energy, peer.confidence) == (100, 0)
    assert (changes[0].energy, changes[0].confidence) == (-1, 1)
    assert (changes[1].energy, changes[1].confidence) == (0, -1)


@pytest.mark.parametrize("kind", ["skipped", "judge"])
def test_skips_and_judge_reviews_do_not_change_stats(snapshot, kind):
    before = copy.deepcopy(snapshot.agents)
    assert apply_turn_state(snapshot.agents, turn(snapshot.agents[0], kind=kind)) == []
    assert snapshot.agents == before


def test_old_snapshots_get_safe_defaults_and_external_values_are_validated(snapshot):
    data = snapshot.model_dump()
    for agent in data["agents"]:
        agent.pop("personality")
    data["turns"] = [turn(snapshot.agents[0]).model_dump(exclude={"statChanges"})]
    restored = Snapshot.model_validate(data)
    assert restored.agents[0].personality == Personality()
    assert restored.turns[0].statChanges == []
    for invalid in (-1, 101, 1.5, "80"):
        with pytest.raises(ValidationError):
            Agent.model_validate({**data["agents"][0], "energy": invalid})
    with pytest.raises(ValidationError):
        Personality(socialStyle="unknown")


def test_low_state_changes_generation_instructions_without_leaking_peers(snapshot):
    agent = snapshot.agents[0]
    agent.energy, agent.confidence = 10, 20
    systems = [canvas_messages(snapshot, agent)[0]["content"], spoken_messages(snapshot, agent, "", False)[0]["content"]]
    for system in systems:
        assert "Current energy: 10/100; confidence: 20/100" in system
        assert "Conserve energy" in system and "tentative phrasing" in system
        assert "never factual certainty" in system
    assert "Current energy:" not in str(judge_messages(snapshot, False))


@pytest.mark.parametrize("updated,cost,gain", [(False, 6, 1), (True, 9, 3)])
def test_inner_thoughts_use_post_turn_state_and_optional_background_awareness(snapshot, updated, cost, gain):
    agent = snapshot.agents[0]
    agent.energy, agent.confidence = 10, 20
    before = snapshot.model_dump()
    messages = journal_messages(snapshot, agent, "", "A focused proposal.", updated=updated)
    system, context = (message["content"] for message in messages)
    assert f"Current energy: {10 - cost}/100; confidence: {20 + gain}/100" in system
    assert "background awareness" in system
    assert "do not need to mention" in system and "should not recite numeric stats" in system
    assert "Conserve energy" not in system and "tentative phrasing" not in system
    assert f"energy 10 -> {10 - cost}/100 (-{cost})" in context
    assert f"confidence 20 -> {20 + gain}/100 (+{gain})" in context
    assert ("Canvas contribution" in context) == updated
    assert snapshot.model_dump() == before


def test_inner_thoughts_remember_peer_reactions_since_last_contribution(snapshot):
    agent, peer = snapshot.agents
    own = turn(agent)
    own.statChanges = apply_turn_state(snapshot.agents, own)
    snapshot.turns.append(own)
    for number, text in enumerate(["I disagree with Riley's idea.", "We reject Riley's proposal."], 2):
        reaction = turn(peer, text)
        reaction.turnNumber = number
        reaction.statChanges = apply_turn_state(snapshot.agents, reaction)
        snapshot.turns.append(reaction)
    messages = journal_messages(snapshot, agent, "", "A focused proposal.")
    context = messages[1]["content"]
    assert "challenged their idea" in context and "rejected their idea" in context
    assert context.index("Turn 2:") < context.index("Turn 3:")
    assert "Listening recovery (extroverted)" not in context


async def test_generated_inner_thoughts_match_committed_stats_without_double_spending(svc, model):
    session = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 1}))
    command(svc, session.id, "start")
    result = await settle(svc, session.id)
    journal_messages_sent = next(messages for messages, options in model.calls if options["phase"] == "journal")
    agent = result.agents[0]
    assert f"Current energy: {agent.energy}/100; confidence: {agent.confidence}/100" in journal_messages_sent[0]["content"]
    assert result.turns[0].statChanges[0].energy == -9
    assert agent.energy == session.agents[0].energy - 9
    await svc.close()


async def test_state_is_committed_with_turns_survives_restart_and_leaves_catalog_unchanged(tmp_path, model):
    catalog = load_catalog()
    before = catalog.model_dump()
    db_path = str(tmp_path / "stats.sqlite3")
    store = Store(db_path)
    service = SessionService(store, catalog, model, pacing=0)
    session = service.create(SessionConfig(**{**CONFIG, "maxTurns": 2}))
    command(service, session.id, "start")
    result = await settle(service, session.id)
    assert all(len(t.statChanges) == 2 for t in result.turns)
    assert result.agents != session.agents
    assert catalog.model_dump() == before
    for event in store.events(session.id, -1):
        for index, agent in enumerate(event.agents):
            assert agent.energy == session.agents[index].energy + sum(c.energy for t in event.turns for c in t.statChanges if c.agentId == agent.id)
    await service.close()
    store.close()
    restored = Store(db_path)
    assert restored.get(session.id).agents == result.agents
    assert restored.get(session.id).turns == result.turns
    restored.close()


async def test_cancelled_and_skipped_turns_do_not_spend_energy(svc, snapshot, model):
    import asyncio
    original = copy.deepcopy(snapshot.agents)
    model.delay = 0.1
    command(svc, snapshot.id, "start")
    await asyncio.sleep(0.02)
    command(svc, snapshot.id, "pause")
    await asyncio.sleep(0.12)
    assert svc.store.get(snapshot.id).agents == original
    model.delay = 0
    model.invalid_speech = True
    command(svc, snapshot.id, "resume")
    result = await settle(svc, snapshot.id)
    assert result.agents == original
    assert all(t.kind == "skipped" and t.statChanges == [] for t in result.turns)
    await svc.close()
