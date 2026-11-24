from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from chorus.harness.models import WorkspaceAction
from chorus.runtime.service import RuntimeService
from chorus.services.errors import ChorusError


def harness_state(frozen=None, main="a" * 40):
    return SimpleNamespace(experiment=SimpleNamespace(repository=SimpleNamespace(mainCommit=main), frozen=frozen, deepswe=None))


async def test_runtime_uses_frozen_pin_and_preserves_an_existing_scratch_copy():
    snapshot = Mock(return_value=b"archive")
    repo = Mock()
    repo.get.return_value = harness_state(frozen=SimpleNamespace(mainCommit="b" * 40))
    harness = SimpleNamespace(repo=repo, experiments=SimpleNamespace(git=SimpleNamespace(runtime_snapshot=snapshot)))
    runtime = RuntimeService(harness)
    calls = []
    existing = {}

    def controller(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/prepare"):
            assert request.headers["X-Chorus-Revision"] == "b" * 40
            assert request.content == b"archive"
            existing["revision"] = "b" * 40
        if request.url.path.endswith("/run"):
            return httpx.Response(200, json={**existing, "state": "starting"})
        return httpx.Response(200, json=existing)

    runtime.controller = httpx.AsyncClient(base_url="http://localhost", transport=httpx.MockTransport(controller))
    try:
        result = await runtime.action("exp", WorkspaceAction(action="run"))
        assert result.revision == result.availableRevision == "b" * 40
        repo.get.return_value = harness_state(main="c" * 40)
        result = await runtime.action("exp", WorkspaceAction(action="run"))
        assert result.revision == "b" * 40 and result.availableRevision == "c" * 40
        snapshot.assert_called_once_with("exp", "b" * 40)
        assert calls.count("/workspaces/exp/prepare") == 1
    finally:
        await runtime.close()


async def test_source_install_and_sessions_without_repositories_have_no_runtime():
    repo = Mock()
    repo.get.return_value = harness_state()
    runtime = RuntimeService(SimpleNamespace(repo=repo))
    assert not (await runtime.status("experiment")).enabled
    with pytest.raises(ChorusError, match="Docker Compose"):
        await runtime.action("experiment", WorkspaceAction(action="run"))
    repo.get.return_value = SimpleNamespace(experiment=None)
    with pytest.raises(ChorusError, match="no application repository"):
        await runtime.status("benchmark")
