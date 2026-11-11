"""Run the same contributor checks locally and in CI from the repository root."""

import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
FORMATTED = [
    "chorus/error_codes.py",
    "chorus/services/errors.py",
    "chorus/cli/doctor.py",
    "scripts/check_repository.py",
    "scripts/check.py",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python-only", action="store_true", help="Skip web checks and contract generation.")
    args = parser.parse_args()
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("CHORUS_", "OPENROUTER_")) and key != "OLLAMA_HOST"
    }
    env["PYTHON_DOTENV_DISABLED"] = "1"
    commands = [
        ["uv", "lock", "--check"],
        [sys.executable, "scripts/check_repository.py"],
        [sys.executable, "-m", "ruff", "check", "chorus", "tests", "scripts"],
        [sys.executable, "-m", "ruff", "format", "--check", *FORMATTED],
        [sys.executable, "-m", "mypy"],
        [
            sys.executable,
            "-m",
            "pytest",
            "--cov",
            "--cov-report=term-missing",
            "--cov-report=xml:coverage.xml",
        ],
    ]
    if not args.python_only:
        commands += [
            [sys.executable, "scripts/export_contracts.py", "--check"],
            ["npm", "run", "check", "--prefix", "web"],
            ["npm", "audit", "--prefix", "web", "--audit-level=high"],
        ]
    for command in commands:
        print("Checking: " + " ".join(command), flush=True)
        subprocess.run(command, cwd=ROOT, env=env, check=True)


if __name__ == "__main__":
    main()
