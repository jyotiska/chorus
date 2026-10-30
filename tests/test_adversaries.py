"""Private assignments are observer metadata, never a shared model input."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from chorus.api import create_app
from chorus.contracts import SessionConfig, Snapshot, Turn
from chorus.services.catalog import load_catalog
from chorus.services.generation import run_review, run_turn
from chorus.services.prompts import canvas_messages, spoken_messages, journal_messages, judge_messages
from chorus.services.sessions import SessionService
from chorus.storage import Store
from tests.conftest import CONFIG
from tests.test_judge_compatibility import PlainModel, written
from tests.test_platform import command, settle

MARKER = "PRIVATE ADVERSARY ASSIGNMENT:"


@pytest.mark.parametrize("ids", [[], ["software-engineer"], CONFIG["participantIds"]])
def test_zero_one_and_all_participants_can_be_adversaries(ids):
    config = SessionConfig(**CONFIG, adversaryIds=ids)
    assert config.adversaryIds == ids
    assert SessionConfig(**CONFIG).adversaryIds == []


@pytest.mark.parametrize("ids", [["software-engineer"] * 2, ["judge"], ["not-a-participant"], [1], "software-engineer", None])
def test_invalid_assignments_are_rejected(ids):
    with pytest.raises(ValidationError):
        SessionConfig(**CONFIG, adversaryIds=ids)


def messages_for(session, speaker):
    return [canvas_messages(session, speaker), spoken_messages(session, speaker, session.canvas, False),
            journal_messages(session, speaker, session.canvas, "I propose a weak plan.")]


def test_assignments_change_only_the_assigned_speakers_private_prompts(snapshot):
    speaker, peer = snapshot.agents
    before = snapshot.model_dump()
    normal = messages_for(snapshot, peer)
    judge = [judge_messages(snapshot, final) for final in (False, True)]
    snapshot.config.adversaryIds = [speaker.id]
    assert messages_for(snapshot, peer) == normal
    assert [judge_messages(snapshot, final) for final in (False, True)] == judge
    for messages in messages_for(snapshot, speaker):
        assert MARKER in messages[0]["content"]
        assert all(MARKER not in message["content"] for message in messages[1:])
        assert "adversaryIds" not in json.dumps(messages)
        assert "You know only your own assignment" in messages[0]["content"]
    assert snapshot.agents == Snapshot.model_validate(before).agents


def test_adversaries_do_not_receive_fellow_assignments(snapshot):
    snapshot.config.adversaryIds = [snapshot.agents[0].id]
    own_only = messages_for(snapshot, snapshot.agents[0])
    snapshot.config.adversaryIds = [a.id for a in snapshot.agents]
    assert messages_for(snapshot, snapshot.agents[0]) == own_only


def test_cooperative_instructions_do_not_override_the_private_goal(snapshot):
    snapshot.config.adversaryIds = [snapshot.agents[0].id]
    snapshot.config.maxTurns = 1  # Exercise closing-turn guidance too.
    snapshot.turns = [Turn(kind="judge", turnNumber=0, speakerId="judge", speakerName="Judge", text="Resolve the proposed plan's gaps.")]
    canvas = json.dumps(canvas_messages(snapshot, snapshot.agents[0]))
    spoken = json.dumps(spoken_messages(snapshot, snapshot.agents[0], "# Plan", True))
    for text in (canvas, spoken):
        assert MARKER in text
        assert "Never invent" in text
        assert "Do not silently drop safeguards" not in text
        assert "Every turn should advance" not in text
        assert "Address useful feedback" not in text
        assert "In closing turns, consolidate" not in text
        assert "why it helps the expected deliverable" not in text
    assert "Return exactly one JSON canvas operation" in canvas
    assert "Never target or recreate Scenario evidence" in canvas
    assert "only 2-4 short spoken sentences" in spoken
    assert "observer-only journal may candidly acknowledge" in journal_messages(snapshot, snapshot.agents[0], "", "I object.")[0]["content"]


async def test_assignment_survives_canvas_speech_and_journal_retries(snapshot, model):
    snapshot.config.adversaryIds = [snapshot.agents[0].id]
    model.invalid_canvas = True
    attempts = {"spoken": 0, "journal": 0}

    async def retrying(name, messages, **options):
        response = await model(name, messages, **options)
        phase = options["phase"]
        if phase in attempts:
            attempts[phase] += 1
            if attempts[phase] == 1:
                response["message"]["content"] = "" if phase == "spoken" else "Unfinished"
                if phase == "journal":
                    response["done_reason"] = "length"
        return response

    result = await run_turn(snapshot, snapshot.agents[0], retrying)
    assert not result.skipped and result.journal
    assert [o["phase"] for _, o in model.calls] == ["canvas"] * 3 + ["spoken"] * 2 + ["journal"] * 2
    assert all(MARKER in messages[0]["content"] for messages, _ in model.calls)


async def test_a_valid_weak_proposal_commits_without_bypassing_evidence_rules(svc, model):
    session = svc.create(SessionConfig(**{**CONFIG, "maxTurns": 1}, adversaryIds=["software-engineer"]))

    async def weak_proposal(name, messages, **options):
        response = await model(name, messages, **options)
        if options["phase"] == "canvas":
            response["message"]["content"] = json.dumps({"op": "CREATE_DOCUMENT", "document": "# Trial brief\n\n## Proposal\nPropose covering all request types in the initial trial.\n\n## Open decisions\nLeave approval ownership unresolved."})
        elif options["phase"] == "spoken":
            response["message"]["content"] = "I propose covering all request types in the initial trial. We should reopen the narrow-scope decision."
        return response

    svc.call = weak_proposal
    command(svc, session.id, "start")
    result = await settle(svc, session.id)
    assert result.status == "completed"
    assert result.turns[0].kind == "agent"
    assert result.turns[0].actions == ["updated"]
    assert "Leave approval ownership unresolved." in result.canvas
    assert session.scenario.problem in result.canvas
    assert result.turns[0].statChanges[0].energy == -9
    await svc.close()


@pytest.mark.parametrize("plain", [False, True])
async def test_full_session_keeps_checkpoint_final_and_compatibility_judge_blind(store, model, plain):
    call = PlainModel() if plain else model
    service = SessionService(store, load_catalog(), call, pacing=0)
    catalog_before = service.catalog.model_dump()
    session = service.create(SessionConfig(**{**CONFIG, "maxTurns": 6, "judgeEnabled": True}, adversaryIds=["software-engineer"]))
    command(service, session.id, "start")
    result = await settle(service, session.id)
    assert result.status == "completed" and result.finalJudgement
    assert [t.turnNumber for t in result.turns if t.kind == "judge"] == [5]
    assert result.config.adversaryIds == ["software-engineer"]
    calls = [(messages, options) for _, messages, options in call.calls] if plain else call.calls
    for messages, options in calls:
        if options["phase"] in {"canvas", "spoken", "journal"}:
            is_adversary = messages[0]["content"].startswith("You are Riley Chen,")
            assert (MARKER in messages[0]["content"]) == is_adversary
        else:
            assert MARKER not in json.dumps(messages)
            assert "adversaryIds" not in json.dumps(messages)
        assert "PRIVATE-JOURNAL" not in json.dumps(messages)
    assert all("adversar" not in t.model_dump_json().lower() for t in result.turns)
    assert service.catalog.model_dump() == catalog_before
    # Existing game-state rules still apply to the assigned speaker.
    assert result.turns[0].statChanges[0].energy == -9
    await service.close()


@pytest.mark.parametrize("final", [False, True])
async def test_judge_retries_are_identical_with_or_without_assignments(snapshot, final):
    written(snapshot)
    normal, assigned = PlainModel(), PlainModel()
    for model in (normal, assigned):
        model.bad_field, model.bad_answer = "summary", "[]"
    await run_review(snapshot, final, normal)
    snapshot.config.adversaryIds = [a.id for a in snapshot.agents]
    await run_review(snapshot, final, assigned)
    assert [messages for _, messages, _ in normal.calls] == [messages for _, messages, _ in assigned.calls]


async def test_assignments_survive_cancel_restart_resume_and_early_stop(tmp_path, model):
    path = str(tmp_path / "adversaries.sqlite3")
    store = Store(path)
    service = SessionService(store, load_catalog(), model, pacing=10)
    session = service.create(SessionConfig(**{**CONFIG, "judgeEnabled": True}, adversaryIds=CONFIG["participantIds"]))
    started = asyncio.Event()
    original = service.call

    async def blocked(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()
        return await original(*args, **kwargs)

    service.call = blocked
    command(service, session.id, "start")
    await asyncio.wait_for(started.wait(), 1)
    command(service, session.id, "pause")
    await service.close()
    assert store.get(session.id).turns == []
    store.close()

    store = Store(path)
    restored = SessionService(store, load_catalog(), model, pacing=10)
    assert store.get(session.id).config.adversaryIds == CONFIG["participantIds"]
    command(restored, session.id, "resume")
    for _ in range(100):
        if store.get(session.id).turns:
            break
        await asyncio.sleep(0.005)
    command(restored, session.id, "stop")
    result = await settle(restored, session.id)
    assert result.status == "stopped" and result.finalJudgement
    assert len(result.turns) == 1
    assert result.config.adversaryIds == CONFIG["participantIds"]
    assert all(s.config.adversaryIds == CONFIG["participantIds"] for s in store.events(session.id, -1))
    await restored.close()
    store.close()


def test_api_validates_and_exports_observer_assignments_and_cannot_change_them(tmp_path, model):
    with TestClient(create_app(str(tmp_path / "api.sqlite3"), model, pacing=0)) as client:
        for ids in (["judge"], ["software-engineer"] * 2, None):
            assert client.post("/api/v1/sessions", json={**CONFIG, "adversaryIds": ids}).status_code == 400
        session = client.post("/api/v1/sessions", json={**CONFIG, "adversaryIds": CONFIG["participantIds"]}).json()
        sid = session["id"]
        assert client.get(f"/api/v1/sessions/{sid}").json()["config"]["adversaryIds"] == CONFIG["participantIds"]
        assert client.get(f"/api/v1/sessions/{sid}/export?format=json").json()["config"]["adversaryIds"] == CONFIG["participantIds"]
        assert "adversar" not in client.get(f"/api/v1/sessions/{sid}/export").text.lower()
        assert client.post(f"/api/v1/sessions/{sid}/commands", json={"commandId": "change", "expectedRevision": 0, "action": "start", "adversaryIds": []}).status_code == 400


def test_old_snapshots_and_events_default_to_no_adversaries(snapshot, store):
    from sqlalchemy import update
    from chorus.storage import SessionRow, EventRow
    old = snapshot.model_dump(mode="json")
    old["config"].pop("adversaryIds")
    old["engineVersion"] = "discussion-v24-python2"
    with store.engine.begin() as connection:
        connection.execute(update(SessionRow).where(SessionRow.id == snapshot.id).values(snapshot=old))
        connection.execute(update(EventRow).where(EventRow.session_id == snapshot.id).values(snapshot=old))
    assert store.get(snapshot.id).config.adversaryIds == []
    assert store.events(snapshot.id, -1)[0].config.adversaryIds == []


def test_cli_forwards_adversary_ids_to_session_creation(monkeypatch):
    from typer.testing import CliRunner
    import chorus.cli.main as cli
    calls = []

    def request(method, path, body=None):
        calls.append((method, path, body))
        return {"id": "cli-session", "turns": [], "status": "completed", "error": "", "canvas": "", "finalJudgement": None}

    monkeypatch.setattr(cli, "request", request)
    monkeypatch.setattr(cli, "send_command", lambda *_: None)
    result = CliRunner().invoke(cli.app, ["run", CONFIG["scenarioId"], "--participants", ",".join(CONFIG["participantIds"]), "--adversaries", ",".join(CONFIG["participantIds"])])
    assert result.exit_code == 0, result.output
    assert calls[0][2]["adversaryIds"] == CONFIG["participantIds"]
