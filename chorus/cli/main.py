from __future__ import annotations
import json
import os
from pathlib import Path
import time
from uuid import uuid4
import httpx
import typer
from rich.console import Console
from chorus.contracts import SessionConfig
from chorus.harness.models import HarnessConfig

app = typer.Typer(help="Chorus simulation platform. Open the application with chorus launch.")
console = Console()


@app.command()
def doctor() -> None:
    """Check local setup without model calls or changes to saved work."""
    from dotenv import load_dotenv
    from chorus.cli.doctor import inspect_setup

    load_dotenv()
    checks = inspect_setup()
    for passed, description in checks:
        console.print(f"{'OK' if passed else 'FAIL'}: {description}")
    console.print("Model access is not tested. Configure a provider before starting an experiment; tests need no keys.")
    if not all(passed for passed, _ in checks):
        raise typer.Exit(1)


def client() -> httpx.Client:
    return httpx.Client(base_url=os.getenv("CHORUS_API_URL", "http://127.0.0.1:43187"), timeout=15)


def request(method: str, path: str, body: object = None) -> object:
    try:
        with client() as http:
            response = http.request(method, "/api/v1" + path, **({"json": body} if body is not None else {}))
        if response.is_error:
            console.print(response.json().get("error", response.text), style="red")
            raise typer.Exit(1)
        return response.json()
    except httpx.HTTPError as error:
        console.print(f"Cannot reach Chorus: {error}. Start chorus serve first.", style="red")
        raise typer.Exit(1) from None


def harness_request(method: str, path: str, body: object = None) -> object:
    try:
        with client() as http:
            response = http.request(method, "/api/v2" + path, **({"json": body} if body is not None else {}))
        if response.is_error:
            console.print(response.json().get("error", "Harness request failed."), style="red")
            raise typer.Exit(1)
        return response.json()
    except httpx.HTTPError as error:
        console.print(f"Cannot reach Chorus: {error}. Start chorus serve first.", style="red")
        raise typer.Exit(1) from None


@app.command()
def launch(
    api_port: int = typer.Option(43187, min=1, max=65535),
    web_port: int = typer.Option(43189, min=1, max=65535),
    browser: bool = typer.Option(True, "--browser/--no-browser"),
    production: bool = typer.Option(False, "--production", help="Use the prebuilt web interface instead of development mode."),
) -> None:
    """Start the engine and web interface together; Ctrl-C stops both."""
    from chorus.cli.launcher import LaunchError, launch_application
    try:
        launch_application(api_port=api_port, web_port=web_port, browser=browser, production=production)
    except LaunchError as error:
        console.print(str(error), style="red", markup=False)
        raise typer.Exit(1) from None


@app.command()
def serve(port: int = 43187) -> None:
    """Run the local API; one process owns the SQLite runner."""
    import uvicorn
    uvicorn.run("chorus.api:app", host="127.0.0.1", port=port, workers=1)


@app.command()
def catalog(kind: str = "scenarios") -> None:
    """List scenarios, agents, or configured/installed models."""
    if kind not in {"scenarios", "agents", "models"}:
        raise typer.BadParameter("Choose scenarios, agents, or models")
    value = harness_request("GET", "/catalog")
    console.print_json(data=value["problems" if kind == "scenarios" else kind])


@app.command()
def sessions() -> None:
    console.print_json(data=harness_request("GET", "/sessions"))


@app.command()
def inspect(session_id: str, records: str = "", agent: str = "", archive: bool = False, journals: bool = False) -> None:
    if archive:
        console.print_json(data=request("GET", f"/sessions/{session_id}" + ("/journals" if journals else "")))
    else:
        from urllib.parse import urlencode
        suffix = "/records?" + urlencode({"kind": records, **({"agent": agent} if agent else {})}) if records else ""
        console.print_json(data=harness_request("GET", f"/sessions/{session_id}" + suffix))


def send_command(session_id: str, action: str) -> object:
    snapshot = request("GET", f"/sessions/{session_id}")
    return request("POST", f"/sessions/{session_id}/commands", {"commandId": str(uuid4()), "expectedRevision": snapshot["revision"], "action": action})


@app.command()
def control(session_id: str, action: str, archive: bool = False) -> None:
    """Pause, resume, start or stop a session."""
    if archive:
        console.print_json(data=send_command(session_id, action))
    else:
        snapshot = harness_request("GET", f"/sessions/{session_id}")
        console.print_json(data=harness_request("POST", f"/sessions/{session_id}/commands", {"commandId": str(uuid4()), "expectedRevision": snapshot["revision"], "action": action}))


@app.command("legacy-run", hidden=True)
def run(scenario: str, participants: str = typer.Option(..., "--participants", help="Comma-separated participant IDs."), model: str = "qwen3.5:4b-mlx", turns: int = 20, judge: bool = False, adversaries: str = typer.Option("", "--adversaries", help="Comma-separated adversary IDs, chosen from the participants.")) -> None:
    """Run a session using comma-separated participant IDs. Ctrl-C pauses it."""
    config = SessionConfig(scenarioId=scenario, participantIds=participants.split(","), adversaryIds=adversaries.split(",") if adversaries else [], model=model, maxTurns=turns, judgeEnabled=judge)
    snapshot = request("POST", "/sessions", config.model_dump())
    session_id = snapshot["id"]
    console.print(f"Session: {session_id}")
    send_command(session_id, "start")
    shown = 0
    try:
        while True:
            snapshot = request("GET", f"/sessions/{session_id}")
            for turn in snapshot["turns"][shown:]:
                console.print(f"{turn['speakerName']}: {turn['text'] or '(slot skipped)'}")
            shown = len(snapshot["turns"])
            if snapshot["status"] in {"completed", "stopped", "paused"}:
                if snapshot["error"]:
                    console.print(snapshot["error"], style="red")
                console.print(snapshot["canvas"])
                if snapshot["finalJudgement"]:
                    console.print_json(data=snapshot["finalJudgement"])
                break
            time.sleep(0.3)
    except KeyboardInterrupt:
        send_command(session_id, "pause")
        console.print(f"Paused. Resume with chorus control {session_id} resume")


@app.command("run")
def harness_run(problem: str, participants: str = typer.Option("", "--participants", help="Comma-separated IDs; defaults to this problem's relevant five."), model: str = "gpt-6-luna", turns_per_agent: int = typer.Option(10, "--turns-per-agent", min=1, max=100), judge: bool = True, adversaries: str = "", turns: int | None = typer.Option(None, "--turns", hidden=True)) -> None:
    """Run independent agents with a per-agent turn cap and a final judge."""
    if turns is not None:
        raise typer.BadParameter("Use --turns-per-agent. A global --turns cap is not supported by the new engine.")
    catalog = harness_request("GET", "/catalog")
    selected = next((p for p in catalog["problems"] if p["id"] == problem), None)
    if selected is None:
        raise typer.BadParameter("Choose a problem from chorus catalog scenarios.")
    config = HarnessConfig(problemId=problem, participantIds=[p.strip() for p in participants.split(",")] if participants else selected["participantIds"], model=model, maxTurnsPerAgent=turns_per_agent, judgeEnabled=judge, adversaryIds=[p.strip() for p in adversaries.split(",")] if adversaries else [])
    snapshot = harness_request("POST", "/sessions", config.model_dump())
    sid, cursor = snapshot["id"], 0
    console.print(f"Session: {sid} · {len(config.participantIds)} agents · {turns_per_agent} turns per agent")
    harness_request("POST", f"/sessions/{sid}/commands", {"commandId": str(uuid4()), "expectedRevision": snapshot["revision"], "action": "start"})
    try:
        while True:
            snapshot = harness_request("GET", f"/sessions/{sid}")
            page = harness_request("GET", f"/sessions/{sid}/records?kind=board&after={cursor}&limit=100")
            for entry in page["records"]:
                console.print(f"{entry['agentId']} [{entry['turn']}/{turns_per_agent}]: {entry['data']['text']}")
            cursor = page["cursor"]
            if snapshot["status"] in {"completed", "stopped", "paused"}:
                console.print(snapshot["error"] or snapshot["canvas"])
                console.print_json(data={"verification": snapshot["verification"], "report": snapshot["report"], "usage": harness_request("GET", f"/sessions/{sid}/usage")})
                break
            time.sleep(.3)
    except KeyboardInterrupt:
        current = harness_request("GET", f"/sessions/{sid}")
        harness_request("POST", f"/sessions/{sid}/commands", {"commandId": str(uuid4()), "expectedRevision": current["revision"], "action": "pause"})
        console.print(f"Paused. Resume with chorus control {sid} resume")


@app.command()
def export(session_id: str, output: Path, format: str = "markdown", journals: bool = False) -> None:
    with client() as http:
        response = http.get(f"/api/v2/sessions/{session_id}/export", params={"format": format})
        if response.status_code == 404:
            response = http.get(f"/api/v1/sessions/{session_id}/export", params={"format": format, "includeJournals": str(journals).lower()})
        response.raise_for_status()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(response.text)
    console.print(str(output))
