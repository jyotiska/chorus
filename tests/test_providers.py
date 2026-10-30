import asyncio
import copy
import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from chorus.api import create_app
from chorus.contracts import SessionConfig
from chorus.llm.openai import OpenAITransport, normalize_response, strict_schema
from chorus.llm.providers import ProviderRouter
from chorus.services.canvas import edit_adapter
from chorus.services.catalog import load_catalog
from chorus.services.errors import ChorusError
from chorus.services.generation import decoding_schema, run_review, run_turn
from chorus.services.sessions import SessionService
from tests.conftest import CONFIG, FakeModel
from tests.test_judge_compatibility import PlainModel, written
from tests.test_platform import command, settle


def response(text="A complete response.", **overrides):
    return {"status": "completed", "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": text}]}], "usage": {"input_tokens": 20, "output_tokens": 10}, **overrides}


@pytest.fixture(autouse=True)
def credential(monkeypatch):
    monkeypatch.setenv("CHORUS_API_KEY", "test-chorus-secret")


async def test_openai_request_normalizes_text_usage_and_strict_canvas_schema(caplog):
    requests = []
    async def handler(request):
        requests.append(request)
        return httpx.Response(200, json=response(json.dumps({"result": {"op": "UNCHANGED"}})))
    transport = OpenAITransport(transport=httpx.MockTransport(handler))
    schema = decoding_schema(edit_adapter.json_schema())
    original = copy.deepcopy(schema)
    with caplog.at_level(logging.INFO, logger="chorus.model"):
        result = await transport("gpt-6-luna", [{"role": "system", "content": "PRIVATE prompt"}], output=2400, format=schema, phase="canvas")
    assert result == {"message": {"content": '{"op": "UNCHANGED"}'}, "done_reason": "stop", "prompt_eval_count": 20, "eval_count": 10}
    request = requests[0]
    assert str(request.url) == "https://api.openai.com/v1/responses"
    assert request.headers["authorization"] == "Bearer test-chorus-secret"
    body = json.loads(request.content)
    assert body["model"] == "gpt-6-luna" and body["store"] is False
    assert body["reasoning"] == {"effort": "none"} and body["max_output_tokens"] == 2400
    assert body["text"]["format"]["strict"] is True
    wrapped = body["text"]["format"]["schema"]
    assert wrapped["type"] == "object" and "anyOf" in wrapped["properties"]["result"]
    assert schema == original
    assert "test-chorus-secret" not in caplog.text and "PRIVATE prompt" not in caplog.text


@pytest.mark.parametrize("status,code", [(401, "MODEL_REQUEST_FAILED"), (403, "MODEL_REQUEST_FAILED"), (404, "MODEL_NOT_FOUND"), (429, "MODEL_REQUEST_FAILED"), (503, "MODEL_UNAVAILABLE"), (400, "MODEL_REQUEST_FAILED")])
async def test_openai_errors_are_sanitized_without_fallback(status, code, caplog):
    async def handler(request):
        return httpx.Response(status, text="test-chorus-secret PRIVATE request echoed by upstream")
    with caplog.at_level(logging.INFO, logger="chorus.model"), pytest.raises(ChorusError) as error:
        await OpenAITransport(transport=httpx.MockTransport(handler))("gpt-6-luna", [])
    assert error.value.code == code
    assert "test-chorus-secret" not in str(error.value) + caplog.text
    assert "PRIVATE" not in str(error.value) + caplog.text


@pytest.mark.parametrize("raw", [None, [], {}, {"status": "failed", "output": []}, response(output=[None]), response(output=[{"type": "message", "role": "assistant", "content": [None]}]), response(usage={"input_tokens": True, "output_tokens": -1}), response(""), response(output=[{"type": "message", "role": "assistant", "content": [{"type": "refusal", "refusal": "No"}]}]), response(status="incomplete", incomplete_details={"reason": "content_filter"})])
def test_openai_rejects_malformed_refused_or_failed_output(raw):
    with pytest.raises(ChorusError) as error:
        normalize_response(raw, False)
    assert error.value.code == "INVALID_MODEL_RESPONSE"


def test_openai_length_and_missing_usage_are_preserved():
    result = normalize_response(response("partial", status="incomplete", incomplete_details={"reason": "max_output_tokens"}, usage=None), True)
    assert result == {"message": {"content": "partial"}, "done_reason": "length"}
    for text in ('{"op":"UNCHANGED"}', '{"result":', '{"result":{},"extra":true}'):
        assert normalize_response(response(text), True)["message"]["content"] == text


@pytest.mark.parametrize("invalid_edits", [1, 3])
async def test_malformed_openai_edit_uses_bounded_validation_retries(snapshot, invalid_edits):
    fake = FakeModel()
    canvas_calls = 0
    async def handler(request):
        nonlocal canvas_calls
        body = json.loads(request.content)
        schema = body.get("text", {}).get("format", {}).get("schema", {}).get("properties", {}).get("result")
        if schema:
            canvas_calls += 1
            if canvas_calls <= invalid_edits:
                return httpx.Response(200, json=response('{"result":'))
            phase = "canvas"
        else:
            phase = "journal" if "private first-person journal" in body["input"][0]["content"] else "spoken"
        result = await fake(body["model"], body["input"], phase=phase, format=schema)
        text = result["message"]["content"]
        return httpx.Response(200, json=response(json.dumps({"result": json.loads(text)}) if schema else text))
    snapshot.config.model = "gpt-6-luna"
    result = await run_turn(snapshot, snapshot.agents[0], OpenAITransport(transport=httpx.MockTransport(handler)))
    assert not result.skipped and result.text and result.journal
    assert canvas_calls == min(invalid_edits + 1, 3)
    assert result.updated is (invalid_edits < 3)
    if invalid_edits == 3:
        assert result.canvas == snapshot.canvas
    assert all('{"result":' not in json.dumps(messages) for messages, _ in fake.calls)


async def test_openai_timeout_and_cancellation_do_not_complete_work(monkeypatch):
    async def timed_out(request):
        raise httpx.ReadTimeout("timed out")
    with pytest.raises(ChorusError) as error:
        await OpenAITransport(transport=httpx.MockTransport(timed_out))("gpt-6-luna", [])
    assert error.value.code == "TIMEOUT"
    started = asyncio.Event()
    cancelled = asyncio.Event()
    async def delayed(request):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    task = asyncio.create_task(OpenAITransport(transport=httpx.MockTransport(delayed))("gpt-6-luna", []))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()


async def test_openai_runs_every_phase_through_responses_with_private_journal_isolation(store):
    fake = FakeModel()
    phases = []
    async def handler(request):
        body = json.loads(request.content)
        schema = body.get("text", {}).get("format", {}).get("schema", {}).get("properties", {}).get("result")
        system = body["input"][0]["content"]
        phase = ("canvas" if "anyOf" in schema else "final" if "verdict" in schema.get("properties", {}) else "checkpoint") if schema else "journal" if "private first-person journal" in system else "spoken"
        phases.append(phase)
        result = await fake(body["model"], body["input"], phase=phase, format=schema)
        text = result["message"]["content"]
        return httpx.Response(200, json=response(json.dumps({"result": json.loads(text)}) if schema else text))
    router = ProviderRouter(load_catalog(), openai=OpenAITransport(transport=httpx.MockTransport(handler)))
    svc = SessionService(store, load_catalog(), router, pacing=0)
    snap = svc.create(SessionConfig(**{**CONFIG, "model": "gpt-6-luna", "maxTurns": 6, "judgeEnabled": True}))
    command(svc, snap.id, "start")
    result = await settle(svc, snap.id)
    assert result.status == "completed" and result.finalJudgement
    assert set(phases) == {"canvas", "spoken", "journal", "checkpoint", "final"}
    assert result.turns[0].tokenUsage.input == 60 and result.turns[0].tokenUsage.output == 30
    assert "PRIVATE-JOURNAL" not in result.model_dump_json()
    assert len(store.journals(snap.id)) == 6
    assert all("PRIVATE-JOURNAL" not in json.dumps(messages) for messages, _ in fake.calls)
    await svc.close()


async def test_router_preserves_mlx_text_review_compatibility(snapshot):
    local = PlainModel()
    router = ProviderRouter(load_catalog(), ollama=local)
    review, _, _ = await run_review(written(snapshot), False, router)
    assert review.summary == "The team has proposed a narrow trial."
    assert local.calls[0][2]["phase"] == "judge_format"
    assert all(not options.get("format") for _, _, options in local.calls[1:])


def test_catalog_reports_independent_provider_availability_and_never_exposes_key(tmp_path, monkeypatch):
    class OfflineLocal(PlainModel):
        async def models(self):
            raise ChorusError("MODEL_UNAVAILABLE", "offline")
    router = ProviderRouter(load_catalog(), ollama=OfflineLocal())
    with TestClient(create_app(str(tmp_path / "api.sqlite3"), router)) as client:
        catalog = client.get("/api/v1/catalog").json()
        assert [item["id"] for item in catalog["models"]] == ["qwen3.5:0.8b-mlx", "qwen3.5:4b-mlx", "gpt-6-luna"]
        assert catalog["defaultModel"] == "qwen3.5:4b-mlx"
        assert [item["available"] for item in catalog["models"]] == [False, False, True]
        assert catalog["models"][-1]["installed"] is None
        assert client.get("/api/v1/models").json() == catalog["models"]
        assert "test-chorus-secret" not in json.dumps(catalog)
        monkeypatch.delenv("CHORUS_API_KEY")
        assert client.get("/api/v1/models").json()[-1]["available"] is False
        rejected = client.post("/api/v1/sessions", json={**CONFIG, "model": "gpt-6-luna"})
        assert rejected.json()["code"] == "MODEL_UNAVAILABLE" and "CHORUS_API_KEY" in rejected.json()["error"]


def test_retired_model_session_stays_readable_and_exportable_but_cannot_resume(tmp_path, model):
    with TestClient(create_app(str(tmp_path / "api.sqlite3"), model)) as client:
        snap = client.post("/api/v1/sessions", json=CONFIG).json()
        svc = client.app.state.service
        legacy = svc.store.get(snap["id"])
        legacy.config.model = "qwen3:4b"
        legacy.status = "paused"
        legacy = svc.store.save(legacy, legacy.revision)
        assert client.get(f"/api/v1/sessions/{legacy.id}").json()["config"]["model"] == "qwen3:4b"
        assert client.get(f"/api/v1/sessions/{legacy.id}/export").status_code == 200
        rejected = client.post(f"/api/v1/sessions/{legacy.id}/commands", json={"commandId": "resume", "expectedRevision": legacy.revision, "action": "resume"})
        assert rejected.status_code == 409 and "retired" in rejected.json()["error"]
        assert svc.store.get(legacy.id).status == "paused" and not model.calls


def test_strict_schema_keeps_property_names_and_requires_nested_fields():
    schema = {"type": "object", "properties": {"optional": {"type": "object", "properties": {key: {"type": "string", "default": ""} for key in ("title", "default", "const", "oneOf")}}}}
    nested = strict_schema(schema)["properties"]["result"]
    assert nested["required"] == ["optional"]
    assert nested["properties"]["optional"]["required"] == ["title", "default", "const", "oneOf"]
