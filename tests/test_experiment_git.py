from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess

import pytest

from chorus.harness.experiment_git import ExperimentGit
from chorus.services.errors import ChorusError


def git(path, *args):
    return subprocess.check_output(["git", "-C", str(path), *args], text=True).strip()


@pytest.fixture
def experiment(tmp_path):
    starter = tmp_path / "starter"
    for part in ("frontend", "backend"):
        root = starter / part
        root.mkdir(parents=True)
        (root / "package.json").write_text("{}\n")
        (root / "package-lock.json").write_text("{}\n")
        (root / "AGENTS.md").write_text(f"{part} instructions\n")
        for generated in ("node_modules", ".next", ".git"):
            (root / generated).mkdir()
            (root / generated / "artifact").touch()
    (starter / "backend" / "data.sqlite").write_text("Runtime data\n")
    (starter / "frontend" / "index.js").write_text("baseline\n")
    harness = ExperimentGit(tmp_path / "runs", starter)
    view = harness.initialize("run-one", ["designer", "qa-engineer"])
    paths = {item["agentId"]: Path(item["path"]) for item in view["worktrees"]}
    return harness, starter, view, paths


def test_baseline_scaffold_and_worktrees(experiment):
    harness, starter, view, paths = experiment
    main = Path(view["path"])
    metadata = Path(view["metadataPath"])
    assert metadata.is_dir() and not metadata.is_relative_to(main)
    assert git(main, "branch", "--show-current") == "main"
    assert git(main, "rev-list", "--count", "HEAD") == "1"
    assert harness.main_commit("run-one") == view["baselineCommit"] == view["mainCommit"]
    assert set(git(main, "ls-files").splitlines()) == {
        "frontend/package.json", "frontend/package-lock.json", "frontend/AGENTS.md", "frontend/index.js",
        "backend/package.json", "backend/package-lock.json", "backend/AGENTS.md",
    }
    for actor, path in paths.items():
        assert git(path, "branch", "--show-current") == f"agents/{actor}"
        assert Path(git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")) == main / ".git"
        assert (path / "frontend" / "index.js").read_text() == "baseline\n"
        assert not (path / "backend" / "data.sqlite").exists()
        assert not (path / "frontend" / ".next").exists()
    assert (starter / "frontend" / ".next" / "artifact").exists()
    assert (starter / "backend" / "data.sqlite").read_text() == "Runtime data\n"


def test_repository_browser_reads_only_committed_objects_on_selected_branch(experiment):
    harness, _, view, paths = experiment
    main = harness.browse_tree("run-one", "main")
    assert main.revision == view["baselineCommit"]
    assert {entry.path: entry.kind for entry in main.entries}["frontend"] == "directory"
    work = paths["designer"] / "frontend"
    (work / "index.js").write_text("changed\n")
    (work / "binary.dat").write_bytes(b"\0\xff")
    (work / "large.txt").write_bytes(b"a" * (128 * 1024 + 1))
    private = work.parent.parent / "private.txt"
    private.write_text("outside the repository\n")
    (work / "link").symlink_to(private)
    commit = harness.commit("run-one", "designer", "Add repository samples")["commit"]
    (work / "uncommitted.txt").write_text("work in progress\n")

    branch = harness.browse_tree("run-one", "agents/designer")
    assert branch.revision == commit
    assert {entry.path: entry.kind for entry in branch.entries}["frontend/link"] == "link"
    assert harness.browse_file("run-one", "main", main.revision, "frontend/index.js").content == "baseline\n"
    read = lambda path: harness.browse_file("run-one", "agents/designer", commit, path)
    assert read("frontend/index.js").content == "changed\n"
    assert read("frontend/binary.dat").status == "binary"
    assert read("frontend/large.txt").status == "too_large"
    assert read("frontend/link").content == str(private)
    with pytest.raises(ChorusError, match="not found"):
        read("frontend/uncommitted.txt")
    with pytest.raises(ChorusError, match="Choose a file"):
        read("../private.txt")
    with pytest.raises(ChorusError, match="not on the selected branch"):
        harness.browse_file("run-one", "main", commit, "frontend/index.js")


def test_commit_sync_restores_only_its_own_stash_and_judge_uses_frozen_copy(experiment):
    harness, _, view, paths = experiment
    designer, qa = paths.values()
    (designer / "frontend" / "design.js").write_text("design\n")
    design = harness.commit("run-one", "designer", "Design interaction")
    design_pr = harness.open_pr("run-one", "designer", "Build interaction", ["design-flow"])
    assert design_pr["sourceCommit"] == design["commit"]
    assert design_pr["targetCommit"] == view["baselineCommit"]
    assert design_pr["taskIds"] == ["design-flow"]
    assert "+design" in design_pr["diff"]
    merged = harness.merge_pr("run-one", "designer", design_pr)
    assert merged["mergedBy"] == "designer"
    assert merged["mergedCommit"] == design["commit"]
    assert harness.merge_pr("run-one", "designer", design_pr) == merged

    (designer / "unrelated").write_text("Save work in a different worktree.\n")
    git(designer, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "stash", "push", "-u", "-m", "unrelated")
    unrelated = git(designer, "stash", "list", "--format=%H")
    (qa / "frontend" / "index.js").write_text("staged\n")
    git(qa, "add", "frontend/index.js")
    (qa / "frontend" / "index.js").write_text("unstaged\n")
    (qa / "backend" / "checks.js").write_text("untracked\n")
    (qa / "SPEC.md").write_text("Ignored copy\n")
    qa_commit = harness.commit("run-one", "qa-engineer", "Add verification")
    assert git(qa, "log", "-1", "--format=%an") == "qa-engineer"
    assert git(qa, "rev-parse", "HEAD^") == design["commit"]
    assert git(qa, "show", "HEAD:frontend/index.js") == "unstaged"
    assert git(qa, "show", "HEAD:backend/checks.js") == "untracked"
    assert git(qa, "stash", "list", "--format=%H") == unrelated
    assert git(qa, "ls-files", "SPEC.md") == ""

    qa_pr = harness.open_pr("run-one", "qa-engineer", "Deliver checks", [])
    harness.merge_pr("run-one", "qa-engineer", qa_pr)
    assert harness.main_commit("run-one") == qa_commit["commit"]
    checkout = harness.judge_checkout("run-one", design["commit"])
    assert git(checkout, "rev-parse", "HEAD") == design["commit"]
    assert not (checkout / "backend" / "checks.js").exists()
    assert not (checkout / ".git" / "objects" / "info" / "alternates").exists()
    (checkout / "frontend" / "design.js").write_text("judge generated\n")
    assert (Path(view["path"]) / "frontend" / "design.js").read_text() == "design\n"
    assert harness.judge_checkout("run-one", design["commit"]) != checkout


def test_concurrent_merges_reject_outdated_target_without_overwriting_main(experiment):
    harness, _, view, paths = experiment
    prs = []
    for actor, path in paths.items():
        (path / "frontend" / "index.js").write_text(f"{actor}\n")
        harness.commit("run-one", actor, f"Changes by {actor}")
        prs.append(harness.open_pr("run-one", actor, "Feature", []))

    def integrate(pr):
        try:
            return harness.merge_pr("run-one", pr["agentId"], pr)
        except ChorusError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(integrate, prs))
    assert results.count("PR_STALE_TARGET") == 1
    winner = next(result for result in results if isinstance(result, dict))
    loser = next(pr for pr in prs if pr["id"] != winner["id"])
    assert harness.main_commit("run-one") == winner["sourceCommit"]
    assert git(Path(view["path"]), "status", "--porcelain") == ""
    assert git(paths[loser["agentId"]], "rev-parse", "HEAD") == loser["sourceCommit"]


def test_moved_source_and_reserved_spec_cannot_merge(experiment):
    harness, _, view, paths = experiment
    designer = paths["designer"]
    (designer / "design.md").write_text("notes\n")
    harness.commit("run-one", "designer", "Add design notes")
    pr = harness.open_pr("run-one", "designer", "Design notes", [])
    (designer / "design.md").write_text("updated\n")
    harness.commit("run-one", "designer", "Update design notes")
    with pytest.raises(ChorusError) as stale:
        harness.merge_pr("run-one", "designer", pr)
    assert stale.value.code == "PR_STALE_SOURCE"

    (designer / "SPEC.md").write_text("not authoritative\n")
    git(designer, "add", "-f", "SPEC.md")
    with pytest.raises(ChorusError) as reserved:
        harness.commit("run-one", "designer", "Commit a stale branch copy")
    assert reserved.value.code == "SPEC_RESERVED"
    git(designer, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-m", "Bypass managed commit")
    with pytest.raises(ChorusError) as reserved_pr:
        harness.open_pr("run-one", "designer", "Merge a stale branch copy", [])
    assert reserved_pr.value.code == "SPEC_RESERVED"
    assert harness.main_commit("run-one") == view["baselineCommit"]


def test_stash_conflict_keeps_exact_recovery_object(experiment):
    harness, _, _, paths = experiment
    designer, qa = paths.values()
    (designer / "frontend" / "index.js").write_text("design\n")
    harness.commit("run-one", "designer", "Update shared file")
    pr = harness.open_pr("run-one", "designer", "Design", [])
    harness.merge_pr("run-one", "designer", pr)
    (qa / "frontend" / "index.js").write_text("qa draft\n")
    with pytest.raises(ChorusError) as conflict:
        harness.commit("run-one", "qa-engineer", "Update checks")
    assert conflict.value.code == "GIT_CONFLICT"
    stash = git(qa, "stash", "list", "--format=%H")
    assert stash in str(conflict.value)
    assert git(qa, "show", f"{stash}:frontend/index.js") == "qa draft"
    assert harness.main_commit("run-one") == pr["sourceCommit"]

    with pytest.raises(ChorusError) as unresolved:
        harness.commit("run-one", "qa-engineer", "Update checks", resolve_conflicts=True)
    assert unresolved.value.code == "GIT_CONFLICT"
    (qa / "frontend" / "index.js").write_text("design and qa\n")
    change = harness.commit("run-one", "qa-engineer", "Update checks", resolve_conflicts=True)
    assert git(qa, "show", f"{change['commit']}:frontend/index.js") == "design and qa"
    assert git(qa, "show", f"{stash}:frontend/index.js") == "qa draft"


def test_reconcile_branch_conflict_then_restore_pending_stash(experiment):
    harness, _, _, paths = experiment
    designer, qa = paths.values()
    (qa / "frontend" / "index.js").write_text("qa\n")
    qa_base = harness.commit("run-one", "qa-engineer", "Add QA behavior")
    (designer / "frontend" / "index.js").write_text("design\n")
    design = harness.commit("run-one", "designer", "Add design behavior")
    pr = harness.open_pr("run-one", "designer", "Design", [])
    harness.merge_pr("run-one", "designer", pr)
    (qa / "frontend" / "pending.js").write_text("pending\n")
    with pytest.raises(ChorusError) as conflict:
        harness.commit("run-one", "qa-engineer", "Complete checks")
    assert conflict.value.code == "GIT_CONFLICT"
    assert not (qa / "frontend" / "pending.js").exists()
    (qa / "frontend" / "index.js").write_text("qa and design\n")
    qa_done = harness.commit("run-one", "qa-engineer", "Complete checks", resolve_conflicts=True)
    assert git(qa, "show", "HEAD:frontend/pending.js") == "pending"
    assert git(qa, "show", "HEAD:frontend/index.js") == "qa and design"
    assert git(qa, "rev-parse", "HEAD^^1") == qa_base["commit"]
    assert git(qa, "rev-parse", "HEAD^^2") == design["commit"]
    assert qa_done["commit"] == git(qa, "rev-parse", "HEAD")
    assert git(qa, "stash", "list") == ""


def test_commit_operation_retry_returns_original_commit(experiment):
    harness, _, _, paths = experiment
    designer = paths["designer"]
    (designer / "frontend" / "index.js").write_text("first\n")
    first = harness.commit("run-one", "designer", "First update", operation_id="cycle:1:commit")
    (designer / "frontend" / "index.js").write_text("second\n")
    assert harness.commit("run-one", "designer", "First update", operation_id="cycle:1:commit") == first
    assert git(designer, "show", "HEAD:frontend/index.js") == "first"
    assert (designer / "frontend" / "index.js").read_text() == "second\n"


def test_sync_only_merge_updates_a_diverged_branch(experiment):
    harness, _, _, paths = experiment
    designer, qa = paths.values()
    (designer / "frontend" / "design.js").write_text("design\n")
    design = harness.commit("run-one", "designer", "Add design")
    (qa / "backend" / "checks.js").write_text("checks\n")
    checks = harness.commit("run-one", "qa-engineer", "Add checks")
    design_pr = harness.open_pr("run-one", "designer", "Design", [])
    harness.merge_pr("run-one", "designer", design_pr)

    sync = harness.commit("run-one", "qa-engineer", "Reconcile with main", operation_id="reconcile")
    assert git(qa, "rev-parse", "HEAD^1") == checks["commit"]
    assert git(qa, "rev-parse", "HEAD^2") == design["commit"]
    assert harness.commit("run-one", "qa-engineer", "Reconcile with main", operation_id="reconcile") == sync
    checks_pr = harness.open_pr("run-one", "qa-engineer", "Checks", [])
    assert checks_pr["sourceCommit"] == sync["commit"]
    assert checks_pr["targetCommit"] == design["commit"]
    assert "+checks" in checks_pr["diff"] and "+design" not in checks_pr["diff"]
