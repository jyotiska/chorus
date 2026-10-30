import asyncio
import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from chorus.api import create_app
from chorus.contracts import SessionConfig
from chorus.llm.openrouter import OpenRouterTransport, normalize_response, REASONING_ALLOWANCE, REASONING_MODELS
from chorus.llm.providers import ProviderRouter
from chorus.services.canvas import edit_adapter
from chorus.services.catalog import load_catalog
from chorus.services.errors import ChorusError
from chorus.services.generation import decoding_schema, run_turn
from chorus.services.sessions import SessionService
from tests.conftest import CONFIG, FakeModel
from tests.test_judge_compatibility import PlainModel
from tests.test_platform import command, settle

MODELS = ["deepseek/deepseek-v4.1-flash-1017", "minimax/minimax-m3.1-flash", "z-ai/glm-5.3-flash"]


def response(text="A complete response.", **overrides):
    return {"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": text}}], "usage": {"prompt_tokens": 20, "completion_tokens": 10}, **overrides}


@pytest.fixture(autouse=True)
def credential(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-router-secret")
    monkeypatch.setenv("CHORUS_API_KEY", "test-openai-secret")


@pytest.mark.parametrize("model", MODELS)
async def test_request_routes_exact_model_and_structured_schema_without_exposing_credentials(model, caplog):
    requests = []
    async def handler(request):
        requests.append(request)
        return httpx.Response(200, json=response('{"result":{"op":"UNCHANGED"}}'))
    transport = OpenRouterTransport(transport=httpx.MockTransport(handler))
    with caplog.at_level(logging.INFO, logger="chorus.model"):
        result = await transport(model, [{"role": "user", "content": "PRIVATE prompt"}], output=2400, format=decoding_schema(edit_adapter.json_schema()))
    assert result == {"message": {"content": '{"op": "UNCHANGED"}'}, "done_reason": "stop", "prompt_eval_count": 20, "eval_count": 10}
    request = requests[0]
    assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer test-router-secret"
    body = json.loads(request.content)
    assert body["model"] == model and "models" not in body
    assert body["max_tokens"] == 2400 + (REASONING_ALLOWANCE if model in REASONING_MODELS else 0) and body["stream"] is False
    assert body["reasoning"] == ({"effort": "low", "exclude": True} if model in REASONING_MODELS else {"enabled": False, "exclude": True})
    assert body["provider"] == {"require_parameters": True}
    schema = body["response_format"]["json_schema"]
    assert schema["strict"] is True and schema["schema"]["type"] == "object"
    assert "anyOf" in schema["schema"]["properties"]["result"]
    assert all(text not in caplog.text for text in ("PRIVATE prompt", "test-router-secret", "test-openai-secret"))


@pytest.mark.parametrize("status,code", [(400, "MODEL_REQUEST_FAILED"), (401, "MODEL_REQUEST_FAILED"), (402, "MODEL_REQUEST_FAILED"), (403, "MODEL_REQUEST_FAILED"), (404, "MODEL_NOT_FOUND"), (408, "TIMEOUT"), (429, "MODEL_REQUEST_FAILED"), (502, "MODEL_UNAVAILABLE"), (503, "MODEL_UNAVAILABLE")])
@pytest.mark.parametrize("http_error", [True, False])
async def test_http_and_embedded_errors_are_safe(status, code, http_error, caplog):
    async def handler(request):
        return httpx.Response(status if http_error else 200, json={"error": {"code": status, "message": "test-router-secret PRIVATE data"}})
    with caplog.at_level(logging.INFO, logger="chorus.model"), pytest.raises(ChorusError) as error:
        await OpenRouterTransport(transport=httpx.MockTransport(handler))(MODELS[0], [])
    assert error.value.code == code
    assert "test-router-secret" not in str(error.value) + caplog.text
    assert "PRIVATE data" not in str(error.value) + caplog.text


@pytest.mark.parametrize("raw", [None, [], {}, response(choices=[]), response(choices=[None]), response(choices=[{"finish_reason": "stop", "message": None}]), response(""), response(usage={"prompt_tokens": True, "completion_tokens": 1}), response(usage=[]), response(choices=[{"finish_reason": "content_filter", "message": {"role": "assistant", "content": "hidden"}}]), response(choices=[{"finish_reason": "stop", "message": {"role": "assistant", "content": "x", "refusal": "no"}}])])
def test_malformed_or_refused_output_is_rejected(raw):
    with pytest.raises(ChorusError) as error:
        normalize_response(raw, False)
    assert error.value.code == "INVALID_MODEL_RESPONSE"


@pytest.mark.parametrize("reason", [[], {}])
def test_malformed_finish_reason_is_a_safe_protocol_error(reason):
    raw = response(choices=[{"finish_reason": reason, "message": {"role": "assistant", "content": "text"}}])
    with pytest.raises(ChorusError) as error:
        normalize_response(raw, False)
    assert error.value.code == "INVALID_MODEL_RESPONSE"


def test_truncation_reasoning_usage_and_malformed_model_json_remain_distinct():
    raw = response(choices=[{"finish_reason": "length", "message": {"role": "assistant", "content": None, "reasoning": "PRIVATE reasoning"}}], usage={"prompt_tokens": 12, "completion_tokens": 300, "completion_tokens_details": {"reasoning_tokens": 300}})
    result = normalize_response(raw, True)
    assert result == {"message": {"content": ""}, "done_reason": "length", "prompt_eval_count": 12, "eval_count": 300}
    for text in ('{"result":', '{"op":"UNCHANGED"}', '{"result":{},"extra":true}'):
        assert normalize_response(response(text, usage=None), True)["message"]["content"] == text
    with pytest.raises(ChorusError) as error:
        normalize_response(response(choices=[{"error": {"code": 402, "message": "private provider details"}}]), False)
    assert "credits" in str(error.value)


async def test_timeout_connection_failure_and_cancellation():
    for failure, code in ((httpx.ReadTimeout("timeout"), "TIMEOUT"), (httpx.ConnectError("offline"), "MODEL_UNAVAILABLE")):
        async def handler(request):
            raise failure
        with pytest.raises(ChorusError) as error:
            await OpenRouterTransport(transport=httpx.MockTransport(handler))(MODELS[0], [])
        assert error.value.code == code
    started, cancelled = asyncio.Event(), asyncio.Event()
    async def delayed(request):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    task = asyncio.create_task(OpenRouterTransport(transport=httpx.MockTransport(delayed))(MODELS[0], []))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()


@pytest.mark.parametrize("model", MODELS)
async def test_all_generation_phases_use_selected_openrouter_model_and_isolate_journals(store, model):
    fake, phases, requested = FakeModel(), [], []
    async def handler(request):
        body = json.loads(request.content)
        schema = body.get("response_format", {}).get("json_schema", {}).get("schema", {}).get("properties", {}).get("result")
        system = body["messages"][0]["content"]
        phase = ("canvas" if "anyOf" in schema else "final" if "verdict" in schema.get("properties", {}) else "checkpoint") if schema else "journal" if "private first-person journal" in system else "spoken"
        phases.append(phase)
        requested.append(body["model"])
        result = await fake(body["model"], body["messages"], phase=phase, format=schema)
        text = result["message"]["content"]
        return httpx.Response(200, json=response(json.dumps({"result": json.loads(text)}) if schema else text))
    router = ProviderRouter(load_catalog(), openrouter=OpenRouterTransport(transport=httpx.MockTransport(handler)))
    svc = SessionService(store, load_catalog(), router, pacing=0)
    snap = svc.create(SessionConfig(**{**CONFIG, "model": model, "maxTurns": 6, "judgeEnabled": True}))
    command(svc, snap.id, "start")
    result = await settle(svc, snap.id)
    assert result.status == "completed" and result.finalJudgement
    assert set(phases) == {"canvas", "spoken", "journal", "checkpoint", "final"}
    assert all(value == model for value in requested)
    assert result.turns[0].tokenUsage.input == 60 and result.turns[0].tokenUsage.output == 30
    assert len(store.journals(snap.id)) == 6 and "PRIVATE-JOURNAL" not in result.model_dump_json()
    assert all("PRIVATE-JOURNAL" not in json.dumps(messages) for messages, _ in fake.calls)
    await svc.close()


def test_openrouter_availability_and_missing_key_do_not_depend_on_other_providers(tmp_path, monkeypatch):
    class OfflineLocal(PlainModel):
        async def models(self):
            raise ChorusError("MODEL_UNAVAILABLE", "offline")
    monkeypatch.delenv("CHORUS_API_KEY")
    router = ProviderRouter(load_catalog(), ollama=OfflineLocal())
    with TestClient(create_app(str(tmp_path / "api.sqlite3"), router)) as client:
        models = client.get("/api/v1/models").json()
        assert [item["available"] for item in models] == [False, False, False, True, True, True]
        assert "test-router-secret" not in json.dumps(models)
        monkeypatch.delenv("OPENROUTER_API_KEY")
        monkeypatch.setenv("CHORUS_API_KEY", "test-openai-secret")
        models = client.get("/api/v1/models").json()
        assert [item["available"] for item in models] == [False, False, True, False, False, False]
        for model in MODELS:
            rejected = client.post("/api/v1/sessions", json={**CONFIG, "model": model})
            assert rejected.json()["code"] == "MODEL_UNAVAILABLE" and "OPENROUTER_API_KEY" in rejected.json()["error"]


async def test_malformed_canvas_retries_preserve_previous_document(snapshot):
    calls, fake = 0, FakeModel()
    async def handler(request):
        nonlocal calls
        body = json.loads(request.content)
        if body.get("response_format"):
            calls += 1
            return httpx.Response(200, json=response('{"result":'))
        phase = "journal" if "private first-person journal" in body["messages"][0]["content"] else "spoken"
        result = await fake(body["model"], body["messages"], phase=phase)
        return httpx.Response(200, json=response(result["message"]["content"]))
    snapshot.config.model = MODELS[0]
    result = await run_turn(snapshot, snapshot.agents[0], OpenRouterTransport(transport=httpx.MockTransport(handler)))
    assert calls == 3 and not result.skipped and not result.updated
    assert result.canvas == snapshot.canvas and result.text and result.journal


async def test_required_reasoning_allowance_is_checked_before_network_io():
    async def unexpected(request):
        pytest.fail("An over-budget request must not reach OpenRouter")
    with pytest.raises(ChorusError) as error:
        await OpenRouterTransport(transport=httpx.MockTransport(unexpected))(MODELS[1], [{"role": "user", "content": "x" * 31000}])
    assert error.value.code == "CONTEXT_LIMIT"
