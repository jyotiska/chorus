import asyncio
from pathlib import Path
from typing import Optional

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt
from rich.table import Table
from rich.text import Text

from chorus.config.loader import load_agent_config, load_agents_for_session, load_session_config
from chorus.core.agent import PersonalityAgent
from chorus.llm.anthropic_adapter import AnthropicAdapter
from chorus.llm.base import LLMAdapter
from chorus.llm.ollama_adapter import OllamaAdapter, list_available_models
from chorus.llm.openai_adapter import OpenAIAdapter
from chorus.orchestration.session import Session, TurnResult

load_dotenv()

app = typer.Typer(help="Chorus — personality-driven multi-agent AI conversations")
agents_app = typer.Typer(help="Manage agent definitions")
models_app = typer.Typer(help="Manage and inspect LLM models")
app.add_typer(agents_app, name="agents")
app.add_typer(models_app, name="models")

console = Console()

TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
AGENT_COLORS = ["cyan", "magenta", "yellow", "green", "blue", "red"]


OLLAMA_BASE_URL = "http://localhost:11434"


def _get_adapter(provider: str, model: Optional[str]) -> LLMAdapter:
    if provider == "anthropic":
        return AnthropicAdapter(model=model) if model else AnthropicAdapter()
    if provider == "openai":
        return OpenAIAdapter(model=model) if model else OpenAIAdapter()
    if provider == "ollama":
        if not model:
            raise ValueError("Ollama requires a model name. Set 'model' in your session config.")
        return OllamaAdapter(model=model, base_url=OLLAMA_BASE_URL)
    raise ValueError(f"Unknown provider '{provider}'. Choose 'anthropic', 'openai', or 'ollama'.")


def _agent_color(index: int) -> str:
    return AGENT_COLORS[index % len(AGENT_COLORS)]


def _render_turn(result: TurnResult, color: str) -> None:
    header = Text(f"Turn {result.turn} · {result.agent_name}", style=f"bold {color}")
    console.print(Panel(result.response.message, title=header, border_style=color))


def _build_agents(session_config, agents_dir: Path, provider: str, model: Optional[str]) -> list[PersonalityAgent]:
    agent_configs = load_agents_for_session(session_config, agents_dir)
    adapter = _get_adapter(provider, model)
    return [PersonalityAgent(config=cfg, adapter=adapter) for cfg in agent_configs]


@app.command()
def run(
    session: Path = typer.Option(..., "--session", "-s", help="Path to session YAML config"),
    agents_dir: Path = typer.Option(TEMPLATES_DIR / "agents", "--agents-dir", help="Directory containing agent YAML files"),
    interactive: bool = typer.Option(False, "--interactive", "-i", help="Pause after each turn to inject messages"),
    topic: Optional[str] = typer.Option(None, "--topic", "-t", help="Override the topic from the session config"),
) -> None:
    """Start a multi-agent conversation."""
    session_config = load_session_config(session)

    if topic:
        session_config.topic = topic

    agent_list = _build_agents(
        session_config, agents_dir, session_config.provider, session_config.model
    )

    color_map = {agent.name: _agent_color(i) for i, agent in enumerate(agent_list)}

    console.print(Panel(
        f"[bold]Topic:[/bold] {session_config.topic}\n"
        f"[bold]Agents:[/bold] {', '.join(a.name for a in agent_list)}\n"
        f"[bold]Max turns:[/bold] {session_config.max_turns}",
        title="[bold]Chorus Session[/bold]",
        border_style="white",
    ))

    chorus_session = Session(
        topic=session_config.topic,
        agents=agent_list,
        max_turns=session_config.max_turns,
    )

    asyncio.run(_run_session(chorus_session, color_map, interactive))


async def _run_session(
    session: Session,
    color_map: dict[str, str],
    interactive: bool,
) -> None:
    while not session.is_finished():
        with console.status("Thinking...", spinner="dots"):
            result = await session.run_turn()

        _render_turn(result, color_map[result.agent_name])

        if interactive and not session.is_finished():
            user_input = Prompt.ask(
                "[dim]Press Enter to continue, type a message to interject, or 'q' to quit[/dim]",
                default="",
            )
            if user_input.lower() == "q":
                console.print("[dim]Session ended by user.[/dim]")
                break
            if user_input.strip():
                session.inject_message("You", user_input.strip())
                console.print(Panel(user_input.strip(), title="[bold white]You[/bold white]", border_style="white"))

    console.print("[dim]Session complete.[/dim]")


@agents_app.command("list")
def agents_list(
    agents_dir: Path = typer.Option(TEMPLATES_DIR / "agents", "--agents-dir", help="Directory containing agent YAML files"),
) -> None:
    """List all available agent definitions."""
    yaml_files = list(agents_dir.glob("*.yaml"))
    if not yaml_files:
        console.print(f"[yellow]No agent definitions found in {agents_dir}[/yellow]")
        raise typer.Exit()

    table = Table(title="Available Agents", border_style="dim")
    table.add_column("Name", style="cyan bold")
    table.add_column("Archetype", style="magenta")
    table.add_column("Traits")
    table.add_column("File", style="dim")

    for path in sorted(yaml_files):
        try:
            config = load_agent_config(path)
            table.add_row(
                config.name,
                config.archetype.value,
                ", ".join(config.traits),
                path.name,
            )
        except Exception as e:
            table.add_row(path.stem, "[red]error[/red]", str(e), path.name)

    console.print(table)


@agents_app.command("inspect")
def agents_inspect(
    name: str = typer.Argument(..., help="Agent name or filename (without .yaml)"),
    agents_dir: Path = typer.Option(TEMPLATES_DIR / "agents", "--agents-dir", help="Directory containing agent YAML files"),
) -> None:
    """Display full config and traits for a specific agent."""
    path = agents_dir / f"{name.lower()}.yaml"
    if not path.exists():
        console.print(f"[red]Agent '{name}' not found at {path}[/red]")
        raise typer.Exit(code=1)

    config = load_agent_config(path)

    console.print(Panel(
        f"[bold]Name:[/bold] {config.name}\n"
        f"[bold]Archetype:[/bold] {config.archetype.value}\n"
        f"[bold]Traits:[/bold] {', '.join(config.traits)}\n\n"
        f"[bold]Description:[/bold]\n{config.description}",
        title=f"[bold cyan]{config.name}[/bold cyan]",
        border_style="cyan",
    ))


@models_app.command("list")
def models_list(
    base_url: str = typer.Option(OLLAMA_BASE_URL, "--base-url", help="Ollama base URL"),
) -> None:
    """List locally available Ollama models."""
    async def _fetch() -> list[str]:
        return await list_available_models(base_url)

    try:
        models = asyncio.run(_fetch())
    except Exception as e:
        console.print(f"[red]Could not connect to Ollama at {base_url}: {e}[/red]")
        console.print("[dim]Make sure Ollama is running: https://ollama.com[/dim]")
        raise typer.Exit(code=1)

    if not models:
        console.print("[yellow]No models found. Pull one with: ollama pull llama3.2[/yellow]")
        raise typer.Exit()

    table = Table(title=f"Ollama Models ({base_url})", border_style="dim")
    table.add_column("Model", style="cyan")

    for model in sorted(models):
        table.add_row(model)

    console.print(table)


if __name__ == "__main__":
    app()
