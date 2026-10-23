from __future__ import annotations
import json
import asyncio
import pytest
from chorus.contracts import SessionConfig
from chorus.services.catalog import load_catalog
from chorus.services.sessions import SessionService
from chorus.storage import Store

CONFIG = {"scenarioId": "ai-feature-launch", "participantIds": ["software-engineer", "product-manager"], "model": "qwen3:4b", "maxTurns": 20, "judgeEnabled": False}


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
