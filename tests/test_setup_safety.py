"""Fresh-install and starter import regressions; no credentials or model calls."""

from pathlib import Path
from typing import get_args

from fastapi.testclient import TestClient
import pytest

from chorus.api import create_app
from chorus.contracts import APIError
from chorus.error_codes import ErrorCode
from chorus.harness.experiment_git import ExperimentGit, _git
from chorus.services.errors import ChorusError


def scaffold(tmp_path):
    root = tmp_path / "starter"
    for name in ("frontend", "backend"):
        (root / name).mkdir(parents=True)
        (root / name / "package.json").write_text('{}\n')
    return root


def test_bundled_starter_creates_an_experiment(tmp_path, model):
    with TestClient(create_app(str(tmp_path / "sessions.sqlite3"), model)) as client:
        response = client.post("/api/v2/experiments", json={"problemId": "todoist", "participantIds": ["general-agent"]})
        assert response.status_code == 201, response.text
        state = response.json()
        assert state["experiment"]["phase"] == "plan"
        assert (tmp_path / "experiments" / state["id"] / "repository/frontend/server.mjs").is_file()
        assert client.get(f'/api/v2/sessions/{state["id"]}/repository/tree').status_code == 200


def test_missing_starter_returns_actionable_contract(tmp_path, monkeypatch, model):
    monkeypatch.setenv("CHORUS_EXPERIMENT_SCAFFOLD", str(tmp_path / "missing"))
    with TestClient(create_app(str(tmp_path / "sessions.sqlite3"), model), raise_server_exceptions=False) as client:
        response = client.post("/api/v2/experiments", json={"problemId": "todoist", "participantIds": ["general-agent"]})
        assert response.status_code == 503
        error = APIError.model_validate(response.json())
        assert error.code == "SCAFFOLD_UNAVAILABLE"
        assert "CHORUS_EXPERIMENT_SCAFFOLD" in error.error
        assert error.requestId
        assert client.get("/api/v2/sessions").json() == []


@pytest.mark.parametrize("code", get_args(ErrorCode))
def test_every_service_error_has_a_serializable_api_response(tmp_path, model, code):
    app = create_app(str(tmp_path / "errors.sqlite3"), model)

    @app.get("/test-error")
    def fail():
        raise ChorusError(code, "Safe error description", 409)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/test-error")
        assert response.status_code == 409
        assert APIError.model_validate(response.json()).code == code


def test_private_starter_files_never_enter_workspace_or_history(tmp_path):
    source = scaffold(tmp_path)
    private = [".env", ".env.production", ".ENV.local", "nested/private.pem", ".aws/credentials", "data.sqlite-wal", ".npmrc"]
    for name in private:
        p = source / "backend" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("SYNTHETIC_SECRET_DO_NOT_COPY")
    (source / "backend/.env.example").write_text("API_KEY=\n")
    result = ExperimentGit(tmp_path / "runs", source).initialize("test-run", ["general-agent"])
    repo = Path(result["path"])
    for name in private:
        assert not (repo / "backend" / name).exists()
        assert (source / "backend" / name).exists()
    assert (repo / "backend/.env.example").is_file()
    assert "SYNTHETIC_SECRET_DO_NOT_COPY" not in _git(repo, "show", "HEAD").stdout
    assert "backend/.env\n" not in _git(repo, "ls-files").stdout


@pytest.mark.parametrize("unsafe", ["link", "large"])
def test_unsafe_starter_rolls_back_partial_workspace(tmp_path, unsafe):
    source = scaffold(tmp_path)
    if unsafe == "link":
        (source / "backend/.env").write_text("synthetic secret")
        (source / "backend/public.txt").symlink_to(".env")
    else:
        with (source / "backend/large.txt").open("wb") as file:
            file.truncate(5 * 1024 * 1024 + 1)
    runtime = ExperimentGit(tmp_path / "runs", source)
    with pytest.raises(ChorusError) as error:
        runtime.initialize("unsafe-run", ["general-agent"])
    assert error.value.code == "INVALID_SCAFFOLD"
    assert not (tmp_path / "runs/unsafe-run").exists()


def test_doctor_reports_missing_tools_without_provider_calls(monkeypatch):
    from typer.testing import CliRunner
    from chorus.cli.main import app

    monkeypatch.setattr("chorus.cli.doctor.shutil.which", lambda name: None)
    result = CliRunner().invoke(app, ["doctor"])
    assert result.exit_code == 1
    assert "FAIL: Git is installed" in result.output
    assert "Model access is not tested" in result.output


def test_every_literal_service_error_is_registered():
    import ast

    root = Path(__file__).resolve().parents[1] / "chorus"
    registered = set(get_args(ErrorCode))
    for path in root.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "ChorusError":
                if node.args and isinstance(node.args[0], ast.Constant):
                    assert node.args[0].value in registered, f"{path}:{node.lineno}"
