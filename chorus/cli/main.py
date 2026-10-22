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

app = typer.Typer(help="Chorus simulation platform. Start the service with chorus serve.")
console = Console()


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
    console.print_json(data=request("GET", "/" + kind))


@app.command()
def sessions() -> None:
    console.print_json(data=request("GET", "/sessions"))


@app.command()
def inspect(session_id: str, journals: bool = False) -> None:
    console.print_json(data=request("GET", f"/sessions/{session_id}" + ("/journals" if journals else "")))


def send_command(session_id: str, action: str) -> object:
    snapshot = request("GET", f"/sessions/{session_id}")
    return request("POST", f"/sessions/{session_id}/commands", {"commandId": str(uuid4()), "expectedRevision": snapshot["revision"], "action": action})


@app.command()
def control(session_id: str, action: str) -> None:
    """Pause, resume, start or stop a session."""
    console.print_json(data=send_command(session_id, action))


@app.command()
def run(scenario: str, participants: str = typer.Option(..., "--participants", help="Comma-separated participant IDs."), model: str = "qwen3.5:4b-mlx", turns: int = 20, judge: bool = False) -> None:
    """Run a session using comma-separated participant IDs. Ctrl-C pauses it."""
    config = SessionConfig(scenarioId=scenario, participantIds=participants.split(","), model=model, maxTurns=turns, judgeEnabled=judge)
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


@app.command()
def export(session_id: str, output: Path, format: str = "markdown", journals: bool = False) -> None:
    with client() as http:
        response = http.get(f"/api/v1/sessions/{session_id}/export", params={"format": format, "includeJournals": str(journals).lower()})
        response.raise_for_status()
        output.write_text(response.text)
    console.print(str(output))
