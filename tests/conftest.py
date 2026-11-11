from __future__ import annotations
import json
import os

# Disable .env loading before importing the API; tests supply their own settings.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"
import asyncio
import pytest
from chorus.contracts import SessionConfig
from chorus.services.catalog import load_catalog
from chorus.services.sessions import SessionService
from chorus.storage import Store

CONFIG = {"scenarioId": "ai-feature-launch", "participantIds": ["software-engineer", "product-manager"], "model": "qwen3.5:4b-mlx", "maxTurns": 20, "judgeEnabled": False}


class FakeModel:
    def __init__(self) -> None:
        self.calls = []
        self.invalid_canvas = False
        self.invalid_speech = False
        self.fail_journal = False
        self.delay = 0
        self.oversized = False

    async def __call__(self, model, messages, **options):
        from chorus.services.errors import ChorusError
        self.calls.append((messages, options))
        phase = options["phase"]
        if phase == "canvas":
            await asyncio.sleep(self.delay)
            empty = "Complete shared canvas before your turn:\n(empty)" in messages[1]["content"]
            content = json.dumps({"op": "REPLACE_SECTION", "path": ["Missing"], "body": "Rejected draft."} if self.invalid_canvas else {"op": "CREATE_DOCUMENT", "document": "# Launch brief\n\n## Proposal\nProposed safeguards require human review."} if empty else {"op": "UNCHANGED"})
        elif phase == "spoken":
            content = "" if self.invalid_speech else f"I propose safeguard number {len(self.calls)} for this trial."
        elif phase == "journal":
            if self.fail_journal:
                raise ChorusError("TIMEOUT", "Journal failed.")
            content = "PRIVATE-JOURNAL I feel cautiously hopeful about this trial."
        else:
            review = {"summary": "The team proposed a narrow trial.", "strengths": ["The canvas proposes [human review]."], "improvements": ["Validate the proposed measures."], "nextPriorities": ["Test the proposed safeguards."]}
            if phase == "final":
                review.update(verdict="Partially meets requirements", feedbackResponse="The team considered available feedback.", requirements={key: {"status": "Partially met", "evidence": "The canvas proposes [human review]."} for key in options["format"]["properties"]["requirements"]["properties"]})
            content = json.dumps(review)
        return {"message": {"content": content}, "done_reason": "stop", "prompt_eval_count": 20, "eval_count": 10}


@pytest.fixture
def model():
    return FakeModel()


@pytest.fixture
def store(tmp_path):
    store = Store(str(tmp_path / "test.sqlite3"))
    yield store
    store.close()


@pytest.fixture
def svc(store, model):
    return SessionService(store, load_catalog(), model, pacing=0)


@pytest.fixture
def snapshot(svc):
    return svc.create(SessionConfig(**CONFIG))


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for name in list(os.environ):
        if name.startswith(("CHORUS_", "OPENROUTER_")) or name == "OLLAMA_HOST":
            monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")


@pytest.fixture(autouse=True)
def no_external_network(monkeypatch):
    """Fake transports and local test servers work; paid/network requests fail."""
    import socket

    original = socket.socket.connect
    original_ex = socket.socket.connect_ex

    def guarded(method):
        def connect(sock, address):
            if sock.family in (socket.AF_INET, socket.AF_INET6):
                if address[0] not in {"127.0.0.1", "::1", "localhost"}:
                    raise AssertionError("External network access is disabled in tests")
            return method(sock, address)
        return connect

    monkeypatch.setattr(socket.socket, "connect", guarded(original))
    monkeypatch.setattr(socket.socket, "connect_ex", guarded(original_ex))
