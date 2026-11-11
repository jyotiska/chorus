"""Local repositories and Git operations for application experiments."""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import NamedTemporaryFile, mkdtemp
from uuid import uuid4

from chorus.harness.models import RepositoryEntry, RepositoryFile, RepositoryTree
from chorus.services.errors import ChorusError


_IDENTIFIER = re.compile(r"[a-z0-9][a-z0-9-]{0,79}")
_OBJECT_ID = re.compile(r"(?:[a-f0-9]{40}|[a-f0-9]{64})")
_SPEC_PATH = ":(top,icase,literal)SPEC.md"
_MAX_PREVIEW = 128 * 1024
_MAX_TREE_ENTRIES = 1000
_GENERATED = {
    ".git", ".DS_Store", ".next", "node_modules", "out", "build", "dist",
    "coverage", "next-env.d.ts", "data.sqlite-shm", "data.sqlite-wal",
}


def _save_journal(path: Path, data: dict) -> None:
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def _identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ChorusError("INVALID_REQUEST", "Invalid workspace identifier.", 400)
    return value


def _git(path: Path, *args: str, actor: str = "chorus", check: bool = True, reflog: str | None = None,
         binary: bool = False):
    # A server invocation must not read the operator's Git configuration or
    # inherit checkout, hook, filter, signing, or repository environment overrides.
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(
        LC_ALL="C", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
        GIT_ATTR_NOSYSTEM="1", GIT_TERMINAL_PROMPT="0", GIT_EDITOR="true",
        GIT_AUTHOR_NAME=actor, GIT_AUTHOR_EMAIL=f"{actor}@chorus.invalid",
        GIT_COMMITTER_NAME=actor, GIT_COMMITTER_EMAIL=f"{actor}@chorus.invalid",
    )
    if reflog:
        env["GIT_REFLOG_ACTION"] = reflog
    try:
        result = subprocess.run(
            ["git", "-c", f"core.hooksPath={os.devnull}", "-c", f"core.attributesFile={os.devnull}",
             "-c", f"core.excludesFile={os.devnull}", "-c", "core.logAllRefUpdates=true",
             "-c", "commit.gpgSign=false", *args],
            cwd=path, env=env, capture_output=True,
            encoding=None if binary else "utf-8", errors=None if binary else "replace", timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ChorusError("GIT_FAILED", "Git could not complete the workspace operation.", 500) from None
    if check and result.returncode:
        raise ChorusError("GIT_FAILED", "Git could not complete the workspace operation.", 409)
    return result


def _copy_scaffold(source: Path, destination: Path) -> None:
    if not source.is_dir() or source.is_symlink():
        raise ChorusError("SCAFFOLD_UNAVAILABLE", f"The {source.name} starter directory is unavailable.", 503)

    def ignore(directory: str, names: list[str]) -> set[str]:
        folder = Path(directory)
        excluded = _GENERATED.intersection(names)
        for name in set(names) - excluded:
            child = folder / name
            if name.endswith(".tsbuildinfo") or child == source / "data.sqlite":
                excluded.add(name)
            elif child.is_symlink():
                if Path(os.readlink(child)).is_absolute() or not child.resolve().is_relative_to(source):
                    raise ChorusError("INVALID_SCAFFOLD", "A starter link points outside its project.", 503)
        return excluded

    shutil.copytree(source, destination, ignore=ignore, symlinks=True)


class ExperimentGit:
    def __init__(self, runs_root: Path, scaffold_root: Path):
        self.runs_root = Path(runs_root).resolve()
        self.scaffold_root = Path(scaffold_root).resolve()

    def _session(self, session_id: str) -> Path:
        return self.runs_root / _identifier(session_id)

    @contextmanager
    def _locked(self, session_id: str):
        session = self._session(session_id)
        metadata, git_dir = session / "metadata", session / "repository" / ".git"
        if not metadata.is_dir() or metadata.resolve() != metadata or not git_dir.is_dir() or git_dir.resolve() != git_dir:
            raise ChorusError("WORKSPACE_UNAVAILABLE", "The experiment repository is unavailable.", 409)
        with (metadata / "git.lock").open("a") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            yield session

    def initialize(self, session_id: str, participant_ids: list[str]) -> dict:
        session = self._session(session_id)
        branches = [(actor, f"agents/{_identifier(actor)}") for actor in participant_ids]
        if len({actor for actor, _ in branches}) != len(branches):
            raise ChorusError("INVALID_REQUEST", "Agent workspaces must be distinct.", 400)
        session.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            session.mkdir(mode=0o700)
        except FileExistsError:
            raise ChorusError("CONFLICT", "This experiment workspace already exists.", 409) from None
        repo = session / "repository"
        metadata = session / "metadata"
        try:
            repo.mkdir()
            for folder in ("frontend", "backend"):
                _copy_scaffold(self.scaffold_root / folder, repo / folder)
            _git(repo, "init", "--template=", "--initial-branch=main")
            info = repo / ".git" / "info"
            info.mkdir(exist_ok=True)
            (info / "exclude").write_text("/SPEC.md\n/backend/data.sqlite\n", encoding="utf-8")
            _git(repo, "add", "--all")
            _git(repo, "commit", "--allow-empty", "-m", "Starter scaffold baseline")
            baseline = self._head(repo, "refs/heads/main")
            (session / "worktrees").mkdir()
            worktrees = []
            for actor, branch in branches:
                path = session / "worktrees" / actor
                _git(repo, "worktree", "add", "-b", branch, str(path), baseline)
                worktrees.append({"agentId": actor, "branch": branch, "path": str(path)})
            metadata.mkdir()
        except BaseException:
            shutil.rmtree(session)
            raise
        return {"path": str(repo), "metadataPath": str(metadata), "baselineCommit": baseline,
                "mainCommit": baseline, "worktrees": worktrees}

    @staticmethod
    def _head(path: Path, ref: str = "HEAD") -> str:
        return _git(path, "rev-parse", "--verify", ref).stdout.strip()

    @staticmethod
    def _branch(session: Path, actor: str) -> tuple[Path, str]:
        actor = _identifier(actor)
        path, branch = session / "worktrees" / actor, f"agents/{actor}"
        if not path.is_dir() or path.resolve() != path or not (path / ".git").is_file() or (path / ".git").is_symlink():
            raise ChorusError("WORKSPACE_UNAVAILABLE", "This agent's worktree is unavailable.", 409)
        common = _git(path, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip()
        if Path(common) != session / "repository" / ".git":
            raise ChorusError("WORKSPACE_UNAVAILABLE", "This worktree does not belong to the experiment repository.", 409)
        actual = _git(path, "symbolic-ref", "--quiet", "--short", "HEAD", check=False)
        if actual.returncode or actual.stdout.strip() != branch:
            raise ChorusError("WRONG_BRANCH", f"Switch the assigned worktree back to {branch} first.", 409)
        return path, branch

    @staticmethod
    def _ancestor(path: Path, older: str, newer: str) -> bool:
        result = _git(path, "merge-base", "--is-ancestor", older, newer, check=False)
        if result.returncode not in (0, 1):
            raise ChorusError("GIT_FAILED", "Git could not compare the requested revisions.", 409)
        return result.returncode == 0

    @staticmethod
    def _stash_entries(path: Path, fmt: str) -> list[list[str]]:
        return [line.split("\0", 1) for line in _git(path, "stash", "list", f"--format=%H%x00{fmt}").stdout.splitlines()]

    @staticmethod
    def _dirty(path: Path) -> bool:
        return bool(_git(path, "status", "--porcelain", "--untracked-files=normal").stdout)

    def _save_work(self, path: Path, actor: str, journal: Path, pending: dict) -> dict:
        marker = pending["marker"]
        matches = [commit for commit, subject in self._stash_entries(path, "%gs") if subject.endswith(f": {marker}")]
        if not matches and self._dirty(path):
            _git(path, "stash", "push", "--include-untracked", "--message", marker, actor=actor)
            matches = [commit for commit, subject in self._stash_entries(path, "%gs") if subject.endswith(f": {marker}")]
        if len(matches) != 1:
            raise ChorusError("GIT_FAILED", f"Find the saved work in the stash list using {marker}.", 409)
        saved = {**pending, "state": "saved", "stash": matches[0]}
        _save_journal(journal, saved)
        return saved

    def _restore_work(self, path: Path, actor: str, journal: Path, pending: dict, resolved: bool) -> dict:
        stash = pending["stash"]
        restoring = {**pending, "state": "restoring"}
        error = f"Resolve the saved changes against current main. Your saved work is stash object {stash}."
        if pending["state"] == "restoring" and self._dirty(path):
            if not resolved:
                raise ChorusError("GIT_CONFLICT", error, 409)
            pending = {**pending, "preserve": True}
        elif pending["state"] in {"saved", "restoring"}:
            _save_journal(journal, restoring)
            if _git(path, "stash", "apply", stash, actor=actor, check=False).returncode:
                raise ChorusError("GIT_CONFLICT", error, 409)
        restored = {**pending, "state": "restored"}
        _save_journal(journal, restored)
        return restored

    def _drop_work(self, path: Path, stash: str, actor: str) -> None:
        for commit, selector in self._stash_entries(path, "%gd"):
            if commit == stash:
                _git(path, "stash", "drop", selector, actor=actor, check=False)
                return

    def _finish_recovery(self, path: Path, actor: str, journal: Path, pending: dict) -> None:
        if not pending.get("preserve"):
            self._drop_work(path, pending["stash"], actor)
        journal.unlink(missing_ok=True)

    @staticmethod
    def _unmerged(path: Path) -> list[str]:
        return [name for name in _git(path, "diff", "--name-only", "--diff-filter=U", "-z").stdout.split("\0") if name]

    @staticmethod
    def _check_resolution(path: Path, unmerged: list[str]) -> None:
        for name in unmerged:
            target = path / name
            if target.resolve() != target or not target.is_file():
                continue
            with target.open("rb") as stream:
                if any(line.startswith((b"<<<<<<< ", b">>>>>>> ", b"||||||| ")) for line in stream):
                    raise ChorusError("GIT_CONFLICT", f"Resolve the conflict markers in {name} before continuing.", 409)

    def commit(self, session_id: str, agent_id: str, message: str, *, resolve_conflicts: bool = False,
               operation_id: str | None = None) -> dict:
        if not message.strip():
            raise ChorusError("INVALID_REQUEST", "A commit message is required.", 400)
        with self._locked(session_id) as session:
            path, branch = self._branch(session, agent_id)
            journal = session / "metadata" / f"sync-{agent_id}.json"
            pending = json.loads(journal.read_text()) if journal.is_file() else None
            action = None
            if operation_id:
                action = "chorus commit " + sha256(operation_id.encode()).hexdigest()
                reflog = _git(path, "reflog", "show", "--format=%H%x00%gs", f"refs/heads/{branch}").stdout.splitlines()
                entries = [line.split("\0", 1) for line in reflog]
                previous_sync = next((head for head, subject in entries if subject.startswith(action + " sync: ")), None)
                for head, subject in entries:
                    if subject.startswith(action + ": "):
                        if pending and pending.get("operation") == operation_id and pending["state"] == "restored":
                            self._finish_recovery(path, agent_id, journal, pending)
                        return self._commit_view(path, branch, agent_id, head, previous_sync)
                if previous_sync and not pending and not self._dirty(path):
                    return self._commit_view(path, branch, agent_id, previous_sync)
            if _git(path, "ls-files", "--", _SPEC_PATH).stdout:
                raise ChorusError("SPEC_RESERVED", "Use the shared specification tools to edit SPEC.md.", 409)
            unmerged = self._unmerged(path)
            merging = _git(path, "rev-parse", "--verify", "MERGE_HEAD", check=False).returncode == 0
            if (unmerged or merging) and not resolve_conflicts:
                raise ChorusError("GIT_CONFLICT", "Resolve conflicts in your worktree, then continue the Git operation.", 409)
            self._check_resolution(path, unmerged)
            sync_commit = None
            if merging:
                _git(path, "add", "--all")
                sync_action = action + " sync" if action and pending else action
                _git(path, "commit", "--no-edit", actor=agent_id, reflog=sync_action)
                sync_commit = self._head(path)
            if pending and pending["state"] == "saving":
                pending = self._save_work(path, agent_id, journal, pending)
            main = self._head(session / "repository", "refs/heads/main")
            branch_head = self._head(path)
            behind = not self._ancestor(path, main, branch_head)
            if pending and pending["state"] != "saved":
                pending = self._restore_work(path, agent_id, journal, pending, resolve_conflicts)
                if behind:
                    # Restage explicit resolutions before saving them on their new base.
                    # Retain the previous stash even if the second save is interrupted.
                    _git(path, "add", "--all")
                    journal.unlink(missing_ok=True)
                    pending = None
            if behind:
                if not pending and self._dirty(path):
                    pending = {"marker": f"chorus-recovery-{agent_id}-{uuid4()}", "state": "saving", "operation": operation_id}
                    _save_journal(journal, pending)
                    pending = self._save_work(path, agent_id, journal, pending)
                saved = f" Your saved work is stash object {pending['stash']}." if pending else ""
                diverged = not self._ancestor(path, branch_head, main)
                sync_action = None
                if diverged and action:
                    sync_action = action + " sync" if pending else action
                if _git(path, "merge", "--no-edit", main, actor=agent_id, check=False, reflog=sync_action).returncode:
                    conflicts = self._unmerged(path)
                    files = f" Conflicting files: {', '.join(conflicts[:8])}." if conflicts else ""
                    raise ChorusError("GIT_CONFLICT", "Resolve the main synchronization in your worktree." + files + saved, 409)
                if diverged:
                    sync_commit = self._head(path)
            if pending and pending["state"] != "restored":
                pending = self._restore_work(path, agent_id, journal, pending, resolve_conflicts)
            _git(path, "add", "--all")
            staged = _git(path, "diff", "--cached", "--quiet", "--", check=False)
            if staged.returncode not in (0, 1):
                raise ChorusError("GIT_FAILED", "Git could not inspect the staged changes.", 409)
            if staged.returncode == 1:
                _git(path, "commit", "-m", message, actor=agent_id, reflog=action)
            if pending:
                self._finish_recovery(path, agent_id, journal, pending)
            if staged.returncode == 0 and not sync_commit:
                raise ChorusError("NO_CHANGES", "There are no new changes to commit.", 409)
            return self._commit_view(path, branch, agent_id, self._head(path), sync_commit)

    @staticmethod
    def _commit_view(path: Path, branch: str, agent: str, head: str, sync_commit: str | None = None) -> dict:
        subject = _git(path, "show", "--no-patch", "--format=%s", head).stdout.rstrip("\n")
        result = {"commit": head, "subject": subject, "branch": branch, "agentId": agent}
        if sync_commit and sync_commit != head:
            result["syncCommit"] = sync_commit
        return result

    @staticmethod
    def _check_spec_history(path: Path, target: str, source: str) -> None:
        if _git(path, "log", "-1", "--format=%H", f"{target}..{source}", "--", _SPEC_PATH).stdout:
            raise ChorusError("SPEC_RESERVED", "An application PR cannot replace the shared SPEC.md.", 409)

    def open_pr(self, session_id: str, agent_id: str, description: str, task_ids: list[str]) -> dict:
        if not description.strip():
            raise ChorusError("INVALID_REQUEST", "A pull request description is required.", 400)
        with self._locked(session_id) as session:
            path, branch = self._branch(session, agent_id)
            source = self._head(path)
            target = self._head(session / "repository", "refs/heads/main")
            if self._ancestor(path, source, target):
                raise ChorusError("NO_CHANGES", "This branch has no commits outside main.", 409)
            self._check_spec_history(path, target, source)
            diff = _git(path, "diff", "--no-ext-diff", "--no-textconv", "--binary", f"{target}...{source}", "--").stdout
            return {"id": str(uuid4()), "agentId": agent_id, "branch": branch, "sourceCommit": source,
                    "targetCommit": target, "description": description, "taskIds": list(task_ids),
                    "diff": diff, "status": "open"}

    def merge_pr(self, session_id: str, agent_id: str, pr: dict) -> dict:
        if pr["agentId"] != agent_id:
            raise ChorusError("FORBIDDEN", "Only the PR owner can merge this contribution.", 403)
        with self._locked(session_id) as session:
            path, branch = self._branch(session, agent_id)
            repo = session / "repository"
            source, target = pr["sourceCommit"], pr["targetCommit"]
            if pr["branch"] != branch or not _OBJECT_ID.fullmatch(source) or not _OBJECT_ID.fullmatch(target):
                raise ChorusError("INVALID_REQUEST", "Invalid pull request revision or branch.", 400)
            merge_action = f"chorus merge {_identifier(pr['id'])} by {agent_id}"
            merged = {**pr, "status": "merged", "mergedCommit": source, "mergedBy": agent_id}
            reflog = _git(repo, "reflog", "show", "--format=%H%x00%gs", "refs/heads/main").stdout.splitlines()
            if f"{source}\0{merge_action}: Fast-forward" in reflog:
                return merged
            if self._head(path) != source:
                raise ChorusError("PR_STALE_SOURCE", "The feature branch moved. Open a PR for its current commit.", 409)
            main = self._head(repo, "refs/heads/main")
            if self._ancestor(repo, source, main):
                raise ChorusError("PR_ALREADY_INTEGRATED", "The PR source is already integrated into main.", 409)
            if not self._ancestor(repo, main, source):
                code = "PR_STALE_TARGET" if main != target else "PR_CONFLICT"
                raise ChorusError(code, "Reconcile your worktree with current main and open a new PR.", 409)
            self._check_spec_history(repo, main, source)
            if _git(repo, "symbolic-ref", "--quiet", "--short", "HEAD").stdout.strip() != "main":
                raise ChorusError("WRONG_BRANCH", "The primary worktree must stay on main.", 409)
            if _git(repo, "status", "--porcelain").stdout:
                raise ChorusError("PR_CONFLICT", "The primary worktree contains uncommitted changes.", 409)
            if _git(repo, "merge", "--ff-only", source, actor=agent_id, reflog=merge_action, check=False).returncode:
                raise ChorusError("PR_CONFLICT", "Git could not integrate this PR cleanly into main.", 409)
            return merged

    def main_commit(self, session_id: str) -> str:
        with self._locked(session_id) as session:
            return self._head(session / "repository", "refs/heads/main")

    def unmerged_commits(self, session_id: str, commits: set[str]) -> set[str]:
        if not commits:
            return set()
        with self._locked(session_id) as session:
            repo = session / "repository"
            main = self._head(repo, "refs/heads/main")
            return {commit for commit in commits if not self._ancestor(repo, commit, main)}

    @staticmethod
    def _browse_head(repo: Path, branch: str) -> str:
        if branch != "main" and not (branch.startswith("agents/") and _IDENTIFIER.fullmatch(branch[7:])):
            raise ChorusError("NOT_FOUND", "Experiment branch not found.", 404)
        return ExperimentGit._head(repo, f"refs/heads/{branch}")

    def browse_tree(self, session_id: str, branch: str) -> RepositoryTree:
        with self._locked(session_id) as session:
            repo = session / "repository"
            revision = self._browse_head(repo, branch)
            output = _git(repo, "ls-tree", "-r", "-t", "-z", revision, binary=True).stdout
        entries = []
        for row in output.rstrip(b"\0").split(b"\0")[:_MAX_TREE_ENTRIES]:
            if not row:
                continue
            metadata, _, path = row.partition(b"\t")
            mode, _, _ = metadata.split()
            kind = {b"040000": "directory", b"120000": "link", b"160000": "submodule"}.get(mode, "file")
            try:
                entries.append(RepositoryEntry(path=path.decode("utf-8"), kind=kind))
            except UnicodeDecodeError:
                continue
        return RepositoryTree(revision=revision, entries=entries, truncated=output.count(b"\0") > _MAX_TREE_ENTRIES)

    def browse_file(self, session_id: str, branch: str, revision: str, path: str) -> RepositoryFile:
        if (not _OBJECT_ID.fullmatch(revision) or not path or len(path) > 1024
                or any(part in {"", ".", ".."} or part.casefold() == ".git" for part in path.split("/"))
                or "\0" in path or "\\" in path):
            raise ChorusError("INVALID_REQUEST", "Choose a file from the repository tree.", 400)
        with self._locked(session_id) as session:
            repo = session / "repository"
            head = self._browse_head(repo, branch)
            if not self._ancestor(repo, revision, head):
                raise ChorusError("NOT_FOUND", "That revision is not on the selected branch.", 404)
            # Read the committed blob directly, including a link's target text.
            # Git never opens the target or reads uncommitted files.
            ref = f"{revision}:{path}"
            if _git(repo, "cat-file", "-t", ref, check=False).stdout.strip() != "blob":
                raise ChorusError("NOT_FOUND", "Repository file not found.", 404)
            size = int(_git(repo, "cat-file", "-s", ref).stdout)
            if size > _MAX_PREVIEW:
                return RepositoryFile(status="too_large", size=size, content=None)
            content = _git(repo, "cat-file", "blob", ref, binary=True).stdout
        try:
            decoded = content.decode("utf-8")
        except UnicodeDecodeError:
            decoded = None
        if decoded is None or "\0" in decoded:
            return RepositoryFile(status="binary", size=size, content=None)
        return RepositoryFile(status="text", size=size, content=decoded)

    def judge_checkout(self, session_id: str, commit: str) -> Path:
        if not _OBJECT_ID.fullmatch(commit):
            raise ChorusError("INVALID_REQUEST", "The frozen commit identifier is invalid.", 400)
        with self._locked(session_id) as session:
            source = session / "repository"
            if not self._ancestor(source, commit, self._head(source, "refs/heads/main")):
                raise ChorusError("INVALID_REQUEST", "The frozen commit must come from main.", 400)
            root = session / "judge"
            root.mkdir(exist_ok=True)
            if root.resolve() != root:
                raise ChorusError("WORKSPACE_UNAVAILABLE", "The judge checkout location is unavailable.", 409)
            checkout = Path(mkdtemp(prefix="attempt-", dir=root))
            try:
                _git(checkout, "init", "--template=")
                _git(checkout, "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--no-recurse-submodules", str(source), commit)
                _git(checkout, "checkout", "--detach", commit)
            except BaseException:
                shutil.rmtree(checkout)
                raise
            return checkout
