from pathlib import Path
import yaml
from pydantic import ValidationError
from chorus.core.types import AgentConfig, SessionConfig


def load_agent_config(path: Path) -> AgentConfig:
    data = _read_yaml(path)
    try:
        return AgentConfig(**data)
    except ValidationError as e:
        raise ValueError(f"Invalid agent config at {path}:\n{e}") from e


def load_session_config(path: Path) -> SessionConfig:
    data = _read_yaml(path)
    try:
        return SessionConfig(**data)
    except ValidationError as e:
        raise ValueError(f"Invalid session config at {path}:\n{e}") from e


def load_agents_for_session(
    session: SessionConfig, agents_dir: Path
) -> list[AgentConfig]:
    configs = []
    for agent_name in session.agents:
        agent_path = agents_dir / f"{agent_name}.yaml"
        if not agent_path.exists():
            raise FileNotFoundError(
                f"Agent config not found: {agent_path}. "
                f"Expected a file named '{agent_name}.yaml' in {agents_dir}."
            )
        configs.append(load_agent_config(agent_path))
    return configs


def _read_yaml(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    with open(path) as f:
        return yaml.safe_load(f) or {}
