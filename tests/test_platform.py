import asyncio
import json
import pytest
from fastapi.testclient import TestClient
from chorus.api import create_app
from chorus.contracts import Command, SessionConfig, Contracts
from chorus.services.errors import ChorusError
from chorus.services.generation import run_turn, bounded
from chorus.services.sessions import next_work, SessionService
from chorus.services.catalog import load_catalog
from chorus.storage import Store
from tests.conftest import CONFIG


def command(svc, session_id, action):
    import uuid
    s = svc.store.get(session_id)
    return svc.command(s.id, Command(commandId=str(uuid.uuid4()), expectedRevision=s.revision, action=action))


async def settle(svc, session_id, statuses=("completed", "paused", "stopped")):
    for _ in range(1000):
        s = svc.store.get(session_id)
        if s.status in statuses:
            return s
        await asyncio.sleep(0.005)
    raise AssertionError("Session did not settle")


async def test_twenty_turns_checkpoints_final_journals_and_isolation(svc):
    snap = svc.create(SessionConfig(**{**CONFIG, "judgeEnabled": True}))
    command(svc, snap.id, "start")
    result = await settle(svc, snap.id)
    assert result.status == "completed"
    assert len([t for t in result.turns if t.kind == "agent"]) == 20
    assert [t.turnNumber for t in result.turns if t.kind == "judge"] == [5, 10, 15]
    assert result.finalJudgement is not None
    assert len(svc.store.journals(snap.id)) == 20
    assert "PRIVATE-JOURNAL" not in result.model_dump_json()
    assert all("PRIVATE-JOURNAL" not in json.dumps(messages) for messages, _ in svc.call.calls)
    assert all("PRIVATE-JOURNAL" not in event.model_dump_json() for event in svc.store.events(snap.id, -1))
    await svc.close()


async def test_invalid_canvas_preserves_empty_canvas_and_continues(snapshot, model):
    model.invalid_canvas = True
    result = await run_turn(snapshot, snapshot.agents[0], model)
    assert not result.skipped and result.canvas == "" and not result.updated
    assert len([o for _, o in model.calls if o["phase"] == "canvas"]) == 3


async def test_invalid_speech_discards_edit_skips_without_journal(snapshot, model):
    model.invalid_speech = True
    result = await run_turn(snapshot, snapshot.agents[0], model)
    assert result.skipped and result.canvas == "" and result.journal is None
    assert not any(o["phase"] == "journal" for _, o in model.calls)


async def test_journal_failure_preserves_public_work(snapshot, model):
    model.fail_journal = True
    result = await run_turn(snapshot, snapshot.agents[0], model)
    assert result.text and result.canvas and result.journal is None
    assert result.usage.input is None


async def test_pause_discards_pending_and_resume_retries_same_slot(svc, snapshot, model):
    model.delay = 0.1
    command(svc, snapshot.id, "start")
    await asyncio.sleep(0.02)
    paused = command(svc, snapshot.id, "pause")
    await asyncio.sleep(0.15)
    assert svc.store.get(snapshot.id).turns == []
    assert not svc.store.journals(snapshot.id)
    model.delay = 0
    command(svc, snapshot.id, "resume")
    result = await settle(svc, snapshot.id)
    assert result.turns[0].speakerId == snapshot.agents[0].id
    await svc.close()


async def test_early_stop_reviews_only_committed_work(svc):
    snap = svc.create(SessionConfig(**{**CONFIG, "judgeEnabled": True}))
    svc.pacing = 1
    command(svc, snap.id, "start")
    for _ in range(100):
        if svc.store.get(snap.id).turns:
            break
        await asyncio.sleep(0.005)
    command(svc, snap.id, "stop")
    result = await settle(svc, snap.id)
    assert result.status == "stopped" and result.finalJudgement
    assert len(result.turns) == 1
    await svc.close()


async def test_command_deduplication_and_revision_conflict(svc, snapshot):
    c = Command(commandId="same-command", action="start", expectedRevision=0)
    first = svc.command(snapshot.id, c)
    assert svc.command(snapshot.id, c) == first
    with pytest.raises(ChorusError, match="different input"):
        svc.command(snapshot.id, c.model_copy(update={"action": "pause"}))
    with pytest.raises(ChorusError) as error:
        svc.command(snapshot.id, Command(commandId="other", action="pause", expectedRevision=0))
    assert error.value.code == "CONFLICT"
    await svc.close()


async def test_restart_recovers_committed_work_without_repeating_slot(tmp_path, model):
    path = str(tmp_path / "recovery.sqlite3")
    store = Store(path)
    svc = SessionService(store, load_catalog(), model, pacing=10)
    snap = svc.create(SessionConfig(**CONFIG))
    command(svc, snap.id, "start")
    for _ in range(100):
        if store.get(snap.id).turns:
            break
        await asyncio.sleep(0.005)
    await svc.close(); store.close()
    store = Store(path)
    restored = SessionService(store, load_catalog(), model, pacing=0)
    assert store.get(snap.id).status == "paused"
    assert len(store.get(snap.id).turns) == 1
    command(restored, snap.id, "resume")
    result = await settle(restored, snap.id)
    assert len(result.turns) == 20
    assert len(store.journals(snap.id)) == 20
    await restored.close(); store.close()


async def test_deadline_bounds_uncooperative_adapter():
    async def late():
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            await asyncio.sleep(0.02)
            return "late"
    with pytest.raises(ChorusError) as error:
        await bounded(late(), 0.005)
    assert error.value.code == "TIMEOUT"
    await asyncio.sleep(0.03)


def test_api_contracts_errors_catalog_persistence_exports(tmp_path, model):
    with TestClient(create_app(str(tmp_path / "api.sqlite3"), model, pacing=0)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/v1/catalog").json()["defaultModel"] == CONFIG["model"]
        assert client.post("/api/v1/sessions", json={}).status_code == 400
        assert client.post("/api/v1/sessions", json={**CONFIG, "participantIds": ["software-engineer"]}).status_code == 400
        assert client.post("/api/v1/sessions", json={**CONFIG, "model": "unknown"}).status_code == 400
        created = client.post("/api/v1/sessions", json=CONFIG)
        assert created.status_code == 201
        snap = created.json(); sid = snap["id"]
        assert client.get(f"/api/v1/sessions/{sid}").json() == snap
        result = client.post(f"/api/v1/sessions/{sid}/commands", json={"commandId": "first", "expectedRevision": 0, "action": "start"})
        assert result.status_code == 200
        import time
        for _ in range(200):
            data = client.get(f"/api/v1/sessions/{sid}").json()
            if data["status"] == "completed":
                break
            time.sleep(0.01)
        assert data["status"] == "completed"
        assert "PRIVATE-JOURNAL" not in client.get(f"/api/v1/sessions/{sid}/export?format=json").text
        assert "PRIVATE-JOURNAL" in client.get(f"/api/v1/sessions/{sid}/export?format=json&includeJournals=true").text
        assert len(client.get(f"/api/v1/sessions/{sid}/journals").json()) == 20
        assert client.get("/api/v1/sessions/missing").status_code == 404
        assert client.post("/api/v1/sessions", json=CONFIG, headers={"Origin": "https://untrusted.test"}).status_code == 403
        assert "/api/v1/sessions/{session_id}/events" in client.get("/openapi.json").json()["paths"]


def test_exclusive_runner_and_ordered_events(store, snapshot):
    with pytest.raises(RuntimeError, match="already has"):
        Store(store.engine.url.database)
    assert [e.revision for e in store.events(snapshot.id, -1)] == [0]
    assert store.events(snapshot.id, 0) == []


def test_atomic_commit_rolls_back_state_and_events_if_journal_write_fails(store, snapshot):
    from chorus.contracts import Journal
    from chorus.storage import now
    from sqlalchemy.exc import IntegrityError
    journal = Journal(agentId=snapshot.agents[0].id, turnNumber=1, text="Private observation.", createdAt=now())
    first = store.save(snapshot, snapshot.revision, journal=journal)
    bad = first.model_copy(update={"canvas": "This draft must not survive."})
    with pytest.raises(IntegrityError):
        store.save(bad, first.revision, journal=journal)
    assert store.get(snapshot.id) == first
    assert len(store.journals(snapshot.id)) == 1
    assert [event.revision for event in store.events(snapshot.id, -1)] == [0, 1]


async def test_uncooperative_late_model_cannot_commit_or_start_next_stage(svc, snapshot, model):
    entered = asyncio.Event()
    async def uncooperative(*args, **kwargs):
        entered.set()
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            await asyncio.sleep(0.02)
        return await model(*args, **kwargs)
    svc.call = uncooperative
    command(svc, snapshot.id, "start")
    await entered.wait()
    command(svc, snapshot.id, "pause")
    await asyncio.sleep(0.06)
    assert svc.store.get(snapshot.id).status == "paused"
    assert svc.store.get(snapshot.id).turns == []
    assert [options["phase"] for _, options in model.calls] == ["canvas"]
    await svc.close()


def test_cli_uses_the_same_http_service_for_run_and_exports(tmp_path, model, monkeypatch):
    import chorus.cli.main as cli
    from typer.testing import CliRunner
    with TestClient(create_app(str(tmp_path / "cli.sqlite3"), model, pacing=0)) as http:
        def request(method, path, body=None):
            response = http.request(method, "/api/v1" + path, **({"json": body} if body is not None else {}))
            assert response.is_success, response.text
            return response.json()
        monkeypatch.setattr(cli, "request", request)
        result = CliRunner().invoke(cli.app, ["run", "ai-feature-launch", "--participants", "software-engineer,product-manager", "--turns", "1"])
        assert result.exit_code == 0, result.output
        assert "Proposed safeguards require human review." in result.output
        assert "PRIVATE-JOURNAL" not in result.output
        sessions = http.get("/api/v1/sessions").json()
        assert len(sessions) == 1 and sessions[0]["status"] == "completed"
        assert http.get(f"/api/v1/sessions/{sessions[0]['id']}/journals").json()[0]["text"].startswith("PRIVATE-JOURNAL")
        from contextlib import contextmanager
        @contextmanager
        def existing_client():
            yield http
        monkeypatch.setattr(cli, "client", existing_client)
        output = tmp_path / "result.json"
        exported = CliRunner().invoke(cli.app, ["export", sessions[0]["id"], str(output), "--format", "json"])
        assert exported.exit_code == 0, exported.output
        assert json.loads(output.read_text())["canvas"] == sessions[0]["canvas"]
        assert "PRIVATE-JOURNAL" not in output.read_text()
