"""Repository policy checks staged blobs, not just working-tree file sizes."""

from pathlib import Path
import runpy
import subprocess

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/check_repository.py"


@pytest.fixture
def repository(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    monkeypatch.chdir(tmp_path)
    return runpy.run_path(str(SCRIPT))["check"]


def stage(path, content, force=False):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    subprocess.run(["git", "add", *( ["-f"] if force else []), "--", path], check=True)


def test_forced_results_and_duplicate_guidance_fail(repository):
    stage(".gitignore", b"/results/\n")
    stage("results/run.json", b"{}", force=True)
    stage("CLAUDE.md", b"duplicate")
    failures = repository(staged=True)
    assert any("results/run.json" in failure for failure in failures)
    assert any("CLAUDE.md" in failure for failure in failures)


def test_large_staged_blob_cannot_hide_behind_small_working_copy(repository):
    stage("large.txt", b"x" * (5 * 1024 * 1024 + 1))
    Path("large.txt").write_text("small working copy")
    assert any("5 MiB" in failure for failure in repository(staged=True))


def test_small_fixtures_and_documentation_are_allowed(repository):
    stage("tests/fixtures/example.json", b'{"synthetic":true}')
    stage("docs/images/example.svg", b"<svg/>")
    stage("AGENTS.md", b"instructions")
    assert repository() == []
