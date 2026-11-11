from datetime import datetime, timedelta, timezone

import pytest

from chorus.harness.catalog import load_catalog
from chorus.harness.experiment_spec import ExperimentSpec
from chorus.harness.models import HarnessConfig, HarnessSnapshot, Worker
from chorus.harness.storage import Repository
from chorus.services.errors import ChorusError
from chorus.storage import now


@pytest.fixture
def spec(store, tmp_path):
    repo = Repository(store)
    catalog = load_catalog()
    participants = ["alex", "drew"]
    agents = [next(agent for agent in catalog.agents if agent.id == participant) for participant in participants]
    voted = set()

    def authorize(state, actor, write):
        if actor not in state.config.participantIds or write and actor in voted:
            raise ChorusError("FORBIDDEN", "This participant cannot edit now.", 403)

    runtime = ExperimentSpec(repo, authorize)
    root = tmp_path / "experiment"
    document = runtime.initialize(root, agents)
    state = repo.create(HarnessSnapshot(
        id="experiment", status="running", config=HarnessConfig(problemId=catalog.problems[0].id, participantIds=participants),
        problem=catalog.problems[0], agents=agents, workers=[Worker(agentId=actor) for actor in participants],
        canvas=document, createdAt=now(), updatedAt=now(),
    ))
    return runtime, (state.id, root), voted


def edit(runtime, location, lease, action_id, markdown, **kwargs):
    return runtime.edit(
        *location, "alex", 0, action_id=action_id, token=lease["token"], base_version=lease["revision"],
        markdown=markdown, reason="Record the agreed work.", **kwargs,
    )


def test_task_removal_retains_author_and_owner_in_spec_history(spec):
    runtime, location, _ = spec
    sid, root = location
    lease = runtime.acquire(*location, "alex", 0)
    first = edit(runtime, location, lease, "first", "- [ ] Connect the API.", section="tasks", task_owner="drew")
    assert first == {"version": 1, "changeId": "change:first"}
    # Reading stays available to peers while a separate writer owns the lock.
    assert runtime.read(*location, "drew", 0)["tasks"]["drew"] == "- [ ] Connect the API."
    assert runtime.acquire(*location, "drew", 0)["holder"] == "alex"
    with pytest.raises(ChorusError, match="stale SPEC.md lock"):
        runtime.edit(*location, "drew", 0, action_id="foreign", token=lease["token"], base_version=1,
                     section="product", markdown="Foreign write", reason="Record foreign write.")
    renewed = runtime.renew(*location, "alex", 0, lease["token"])
    assert renewed["revision"] == 1
    edit(runtime, location, renewed, "second", "", section="tasks", task_owner="drew")
    runtime.release(*location, "alex", 0, lease["token"])
    projected = runtime.read(*location, "drew", 0)
    assert projected["tasks"]["drew"] == ""
    assert root.joinpath("SPEC.md").read_text() == projected["markdown"]
    assert "#### Drew (drew)" in projected["markdown"]
    assert "**Revision 1** · `alex`" in projected["markdown"]
    assert "+- [ ] Connect the API." in projected["markdown"]
    assert "-- [ ] Connect the API." in projected["markdown"]
    assert runtime.repo.record(sid, "change:second").data["taskOwnerId"] == "drew"
    assert [event.data["specRevision"] for event in runtime.repo.all(sid, "activity")] == [1, 2]
    assert runtime.repo.get(sid).canvasVersion == 2


def test_lock_expiry_and_voted_writer_fence(spec):
    runtime, location, voted = spec
    sid, _ = location
    first = runtime.acquire(*location, "alex", 0)
    expired = dict(runtime.repo.lease(sid), expiresAt=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    runtime.repo.change(sid, lambda _: None, lease=expired)
    with pytest.raises(ChorusError, match="expired"):
        edit(runtime, location, first, "expired", "Rejected.", section="product")
    second = runtime.acquire(*location, "drew", 0)
    assert second["fencing"] == first["fencing"] + 1
    assert second["token"] != first["token"]
    voted.add("drew")
    assert runtime.read(*location, "drew", 0)["revision"] == 0
    with pytest.raises(ChorusError, match="cannot edit"):
        runtime.edit(*location, "drew", 0, action_id="after-vote", token=second["token"], base_version=0,
                     section="product", markdown="Rejected.", reason="Rejected write.")
    assert runtime.repo.all(sid, "activity")[0].data["status"] == "spec_lock_recovered"
    runtime.cleanup(*location, "drew")
    assert runtime.repo.get(sid).lease is None


def test_interrupted_publication_replays_without_a_duplicate_edit(spec, monkeypatch):
    runtime, location, _ = spec
    sid, root = location
    publish = runtime._publish

    def interrupted(root, document):
        if "Acceptance criteria" in document:
            raise OSError("simulated interruption after commit")
        publish(root, document)

    lease = runtime.acquire(*location, "alex", 0)
    with monkeypatch.context() as patch:
        patch.setattr(runtime, "_publish", interrupted)
        with pytest.raises(OSError, match="simulated interruption"):
            edit(runtime, location, lease, "recoverable", "### Acceptance criteria\n\nSave tasks.", section="product")
    record = runtime.repo.record(sid, "change:recoverable")
    assert "Acceptance criteria" not in root.joinpath("SPEC.md").read_text()
    assert "Acceptance criteria" in record.data["markdown"]
    runtime.recover(*location)
    assert root.joinpath("SPEC.md").read_text() == record.data["markdown"]
    assert runtime.repo.get(sid).lease is None
    replay = edit(runtime, location, lease, "recoverable", "### Acceptance criteria\n\nSave tasks.", section="product")
    assert replay == {"version": 1, "changeId": "change:recoverable"}
    assert len(runtime.repo.all(sid, "change")) == 1
    with pytest.raises(ChorusError, match="already been used"):
        edit(runtime, location, lease, "recoverable", "Other content.", section="product")


def test_edit_rejects_structure_replacement_and_cancelled_operation(spec):
    runtime, location, _ = spec
    sid, _ = location
    lease = runtime.acquire(*location, "alex", 0)
    with pytest.raises(ValueError, match="below the section heading"):
        edit(runtime, location, lease, "structure", "## Task Distribution", section="product")
    runtime.repo.change(sid, lambda state: setattr(state, "generation", 1))
    with pytest.raises(ChorusError, match="publication authority"):
        edit(runtime, location, lease, "late", "Late write.", section="product")
    assert runtime.repo.get(sid).canvasVersion == 0
