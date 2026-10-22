from __future__ import annotations
import json
import os
from importlib.resources import files
from chorus.contracts import Catalog, SessionConfig, Scenario, Agent
from chorus.services.errors import ChorusError


def load_catalog() -> Catalog:
    path = os.getenv("CHORUS_CATALOG")
    raw = json.loads(open(path).read() if path else files("chorus").joinpath("catalog/catalog.json").read_text())
    return Catalog.model_validate({key: raw[key] for key in ("agents", "scenarios", "models", "defaultModel")})


def resolve_config(config: SessionConfig, catalog: Catalog) -> tuple[Scenario, list[Agent]]:
    scenario = next((s for s in catalog.scenarios if s.id == config.scenarioId), None)
    agents = [a for a in catalog.agents if a.id in config.participantIds]
    if scenario is None or len(agents) != len(config.participantIds):
        raise ChorusError("INVALID_REQUEST", "Choose a known scenario and participants.", 400)
    if scenario.collection == "nanoville" and len(agents) > 5:
        raise ChorusError("INVALID_REQUEST", "Nanoville supports at most five participants.", 400)
    if any(a.collection != scenario.collection for a in agents):
        raise ChorusError("INVALID_REQUEST", "Participants must belong to this scenario collection.", 400)
    if config.model not in {m.id for m in catalog.models}:
        raise ChorusError("INVALID_REQUEST", "Choose one of the configured models.", 400)
    return scenario, agents
