"""Read-only setup checks. Never contact providers or print credentials."""

import os
from pathlib import Path
import shutil
import subprocess
import sys

from chorus.harness.experiment_git import validate_scaffold
from chorus.services.errors import ChorusError


def inspect_setup() -> list[tuple[bool, str]]:
    root = Path(__file__).resolve().parents[2]
    checks = [(sys.version_info >= (3, 11), "Python 3.11 or newer")]
    checks.append((sys.platform in {"darwin", "linux"}, "macOS or Linux (Windows requires WSL)"))
    checks.append((shutil.which("git") is not None, "Git is installed"))
    node = shutil.which("node")
    version = ""
    if node:
        try:
            version = subprocess.check_output([node, "--version"], text=True, timeout=5).strip()
        except (OSError, subprocess.SubprocessError):
            pass
    checks.append((version.startswith("v24."), "Node 24 is selected"))
    checks.append((shutil.which("npm") is not None, "npm is installed"))
    checks.append(((root / "web/package.json").is_file(), "Integrated web source is present"))
    checks.append(
        (
            (root / "web/node_modules/next/package.json").is_file(),
            "Web dependencies installed (npm ci --prefix web)",
        )
    )
    bundled = root / "chorus/harness/starters"
    scaffold = Path(os.environ.get("CHORUS_EXPERIMENT_SCAFFOLD", str(bundled)))
    try:
        validate_scaffold(scaffold)
        checks.append((True, "Frontend and backend starters are available"))
    except ChorusError as error:
        checks.append((False, str(error)))
    return checks
