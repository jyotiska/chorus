"""Reject tracked output, duplicate agent guidance and oversized Git blobs."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess

LIMIT = 5 * 1024 * 1024
# Add an exact path and a justification only after maintainer review.
SIZE_EXCEPTIONS: dict[str, str] = {}


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args])


def check(staged: bool = False) -> list[str]:
    entries = git("ls-files", "--stage", "-z").split(b"\0")
    changed = (
        set(git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split(b"\0"))
        if staged
        else None
    )
    failures: list[str] = []
    for entry in entries:
        if not entry:
            continue
        metadata, encoded_path = entry.split(b"\t", 1)
        if changed is not None and encoded_path not in changed:
            continue
        path = encoded_path.decode("utf-8", errors="surrogateescape")
        mode, oid, stage = metadata.decode().split()
        if stage != "0":
            failures.append(f"{path}: unresolved merge")
            continue
        if mode == "160000":
            failures.append(f"{path}: submodules are not part of this source-only repository")
            continue
        if Path(path).name == "CLAUDE.md":
            failures.append(f"{path}: use AGENTS.md only")
        ignored = subprocess.run(["git", "check-ignore", "--no-index", "-q", "--", path]).returncode
        if ignored == 0:
            failures.append(f"{path}: ignored output must not be tracked")
        elif ignored != 1:
            raise RuntimeError(f"git check-ignore failed for {path}")
        size = int(git("cat-file", "-s", oid))
        if size > LIMIT and path not in SIZE_EXCEPTIONS:
            failures.append(f"{path}: {size} bytes exceeds the 5 MiB limit")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true", help="Check only staged changes before committing.")
    args = parser.parse_args()
    failures = check(args.staged)
    if failures:
        raise SystemExit("\n".join(failures))
    print("Repository policy passed: no tracked output, oversized files or CLAUDE.md files.")


if __name__ == "__main__":
    main()
