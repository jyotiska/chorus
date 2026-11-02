"""The only active catalog for new harness runs. No expected answers here."""
import json
from importlib.resources import files
from chorus.harness.models import HarnessCatalog


def load_catalog() -> HarnessCatalog:
    return HarnessCatalog.model_validate(json.loads(files("chorus.harness").joinpath("catalog.json").read_text()))
