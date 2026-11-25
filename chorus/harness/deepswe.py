"""Local task profiles and Pier verification for Chorus on DeepSWE."""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import tarfile
import tempfile
import tomllib

from chorus.harness.experiment_git import _git
from chorus.harness.models import DeepSWEResult, DeepSWETask
from chorus.services.errors import ChorusError

TASK_ID = "ts-pattern-match-each"
TASK_TITLE = "TypeScript pattern matching with .each"
TASK_DIR = f"tasks/{TASK_ID}"
PIER_VERSION = "0.3.1"
TEAM_VERSION = "deepswe-v5"
TEAM_PROMPT = "deepswe-v5-submission"
ENGINE_VERSION = "deepswe-v5-fixed-team"
PROMPT_VERSION = "deepswe-v5-fixed-team-submission"
CALL_LIMIT = 120
SOLVING_SECONDS = 30 * 60
VERIFY_SECONDS = 30 * 60
MAX_PATCH_BYTES = 4 * 1024 * 1024
REVISION = re.compile(r"[a-f0-9]{40}")
IMAGE = re.compile(r"[A-Za-z0-9./:_-]+@sha256:[a-f0-9]{64}")
TASK_SLUG = re.compile(r"(?=.{1,56}$)[a-z0-9]+(?:-[a-z0-9]+)*")


def profiles_directory():
    value = os.getenv("CHORUS_DEEPSWE_PROFILES_DIR")
    return Path(value) if value else None


def unavailable(message):
    return ChorusError("WORKSPACE_UNAVAILABLE", message, 503)


def worker_env(platform):
    env = {name: os.environ[name] for name in ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG") if name in os.environ}
    return {**env, "DOCKER_DEFAULT_PLATFORM": platform, "NO_COLOR": "1"}


@dataclass(frozen=True)
class Profile:
    task: DeepSWETask
    statement: str
    dataset: Path
    repository: Path
    pier: Path
    manifest: str
    title: str = TASK_TITLE
    language: str = "TypeScript"

    @classmethod
    def load(cls):
        path = os.getenv("CHORUS_DEEPSWE_PROFILE")
        if not path:
            raise unavailable("Set CHORUS_DEEPSWE_PROFILE to enable the local DeepSWE verifier.")
        return cls.from_file(Path(path))

    @classmethod
    def from_file(cls, path, *, expected_id=None):
        try:
            config = tomllib.loads(path.read_text())
            task_id = config.get("task_id", expected_id or TASK_ID)
            if not TASK_SLUG.fullmatch(task_id) or (expected_id and task_id != expected_id):
                raise ValueError
            dataset, repository, pier = (Path(config[key]) for key in ("dataset", "repository", "pier"))
            if not all(path.is_absolute() for path in (dataset, repository, pier)):
                raise ValueError
            dataset_commit, base_commit = config["dataset_commit"], config["base_commit"]
            if not all(REVISION.fullmatch(pin) for pin in (dataset_commit, base_commit)):
                raise ValueError
            image, verifier_image, platform = config["image"], config["verifier_image"], config["platform"]
            if not all(IMAGE.fullmatch(pin) for pin in (image, verifier_image)) or platform not in {"linux/amd64", "linux/arm64"}:
                raise ValueError
        except (OSError, KeyError, ValueError, TypeError) as error:
            raise unavailable("Check the task ID, absolute paths, commit SHAs, image digests and platform in the DeepSWE profile.") from error

        python = pier.with_name("python")
        docker = shutil.which("docker")
        if not os.access(pier, os.X_OK) or not python.is_file() or not docker:
            raise unavailable("Install Docker and Pier in the verifier's Python virtual environment.")
        try:
            version = subprocess.run(
                [str(python), "-c", "from importlib.metadata import version; print(version('datacurve-pier'))"],
                env=worker_env(platform), capture_output=True, text=True, timeout=5, check=True,
            ).stdout.strip()
        except (OSError, subprocess.SubprocessError, UnicodeError) as error:
            raise unavailable("Could not read the installed Pier version. Check the verifier environment.") from error
        if version != PIER_VERSION:
            raise unavailable(f"Install datacurve-pier=={PIER_VERSION} in the verifier environment.")

        try:
            task_dir = f"tasks/{task_id}"
            statement = _git(dataset, "show", f"{dataset_commit}:{task_dir}/instruction.md").stdout
            manifest = _git(dataset, "show", f"{dataset_commit}:{task_dir}/task.toml").stdout
            base_tree = _git(repository, "rev-parse", "--verify", f"{base_commit}^{{tree}}").stdout.strip()
            parsed = tomllib.loads(manifest)
            if not statement.strip() or "\0" in statement or len(statement.encode("utf-8")) > 12_000:
                raise ValueError
            metadata = parsed.get("metadata", {})
            if (not isinstance(metadata, dict) or metadata.get("task_id", task_id) != task_id
                    or metadata.get("base_commit_hash", metadata.get("base_commit", base_commit)) != base_commit):
                raise ValueError
            title = TASK_TITLE if task_id == TASK_ID else metadata.get("display_title", task_id)
            language = metadata.get("language", "typescript" if task_id == TASK_ID else "")
            if not isinstance(title, str) or not isinstance(language, str):
                raise ValueError
            verifier = parsed["verifier"]
            if not isinstance(verifier, dict) or not verifier.get("collect"):
                raise ValueError
            manifest = pin_environment(manifest, "environment", image)
            manifest = pin_environment(manifest, "verifier.environment", verifier_image, inherited=image)
        except (ChorusError, KeyError, ValueError, TypeError) as error:
            raise unavailable("The pinned task or repository base is unavailable or its task configuration does not match the profile.") from error
        language = {"typescript": "TypeScript", "javascript": "JavaScript"}.get(language, language.title())
        return cls(
            DeepSWETask(id=task_id, datasetCommit=dataset_commit, baseCommit=base_commit, baseTree=base_tree,
                        image=image, verifierImage=verifier_image, platform=platform, pierVersion=version),
            statement, dataset, repository, pier, manifest, title, language,
        )

    def supports_public_checks(self, pin):
        # The original task accepts the installation's existing check profile.
        return pin is not None and (self.task.id == TASK_ID or (
            pin.profile.image == self.task.image and pin.profile.platform == self.task.platform
        ))

    def validate_public_checks(self, pin):
        if pin and not self.supports_public_checks(pin):
            raise ChorusError("VERSION_MISMATCH", "The public check profile does not match the selected DeepSWE task.", 409)

    def check_docker(self):
        try:
            result = subprocess.run(["docker", "info", "--format", "{{.OSType}}"], env=worker_env(self.task.platform),
                                    capture_output=True, text=True, timeout=5, check=True)
            if result.stdout.strip() != "linux":
                raise ValueError
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            raise unavailable("Start a Linux Docker daemon and give the local DeepSWE worker access to it.") from error

    def copy_task(self, destination):
        task_dir = f"tasks/{self.task.id}"
        archive = _git(self.dataset, "archive", self.task.datasetCommit, "--", task_dir, binary=True).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as contents:
            for member in contents:
                relative = Path(member.name)
                if relative.is_absolute() or ".." in relative.parts or not (member.isdir() or member.isfile()):
                    raise unavailable("The pinned DeepSWE task contains unsupported files.")
                target = destination / relative
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with contents.extractfile(member) as source, target.open("wb") as output:
                        shutil.copyfileobj(source, output)
                    target.chmod(member.mode & 0o777)
        task = destination / task_dir
        if not tomllib.loads(self.manifest)["verifier"].get("environment", {}).get("docker_image"):
            # Pier skips test uploads for a separate verifier. Build the upstream
            # tests/Dockerfile so the verifier image contains its official tests.
            pin_verifier_base(task / "tests" / "Dockerfile", self.task.verifierImage)
        (task / "task.toml").write_text(self.manifest)
        return task

    async def grade(self, patch, tree, *, control=None, show_logs=False):
        with tempfile.TemporaryDirectory(prefix="chorus-pier-") as temporary:
            root = Path(temporary)
            task = self.copy_task(root)
            if control is None:
                install_replay(task, patch, self.task.baseCommit, tree)
            jobs = root / "jobs"
            try:
                process = await asyncio.create_subprocess_exec(
                    str(self.pier), "run", "-p", str(task), "--agent", control or "oracle", "--env", "docker",
                    "--jobs-dir", str(jobs), "--job-name", "verify", cwd=root,
                    env=worker_env(self.task.platform), stdin=subprocess.DEVNULL,
                    stdout=None if show_logs else subprocess.DEVNULL, stderr=None if show_logs else subprocess.DEVNULL,
                    start_new_session=True,
                )
            except OSError as error:
                raise unavailable("Pier could not start. Check the local verifier environment.") from error
            try:
                await asyncio.wait_for(process.wait(), VERIFY_SECONDS)
            except (TimeoutError, asyncio.CancelledError) as error:
                await stop_process(process)
                if isinstance(error, asyncio.CancelledError):
                    raise
                raise unavailable("Pier timed out. Check the Docker worker and retry verification.") from error
            if process.returncode:
                raise unavailable("Pier did not finish. Check Docker and run the calibration on the verifier host.")
            replay = (self.repository, self.task.baseCommit, tree) if control is None else None
            return read_result(jobs / "verify", replay=replay)


def default_and_profiles():
    default, reason = None, None
    try:
        default = Profile.load()
    except ChorusError as error:
        reason = str(error)
    profiles = {default.task.id: default} if default else {}
    directory = profiles_directory()
    if directory:
        for path in sorted(directory.glob("*.toml")):
            if path.stem in profiles or not TASK_SLUG.fullmatch(path.stem):
                continue
            try:
                profiles[path.stem] = Profile.from_file(path, expected_id=path.stem)
            except ChorusError as error:
                reason = str(error)
    if not os.getenv("CHORUS_DEEPSWE_PROFILE") and default is None:
        default = next(iter(profiles.values()), None)
    return default, list(profiles.values()), reason


def resolve_profile(task=None):
    if task is None:
        if os.getenv("CHORUS_DEEPSWE_PROFILE"):
            return Profile.load()
        default, _, reason = default_and_profiles()
        if default is None:
            raise unavailable(reason)
        return default
    default, default_error = None, None
    try:
        default = Profile.load()
    except ChorusError as error:
        default_error = error
    if default and default.task == task:
        return default
    directory = profiles_directory()
    path = directory / f"{task.id}.toml" if directory and TASK_SLUG.fullmatch(task.id) else None
    if path and path.is_file():
        profile = Profile.from_file(path, expected_id=task.id)
        if profile.task == task:
            return profile
    elif default_error:
        raise default_error
    raise ChorusError("VERSION_MISMATCH", "The configured task changed. Restore its pinned profile or select the new revision.", 409)


def pin_verifier_base(dockerfile, image):
    original = image.split("@")[0]
    try:
        lines = dockerfile.read_text().splitlines(keepends=True)
        bases = [i for i, line in enumerate(lines) if line.lstrip().upper().startswith("FROM ")]
        if len(bases) != 1 or lines[bases[0]].strip().split()[1:] not in ([original], [image]):
            raise ValueError
        lines[bases[0]] = f"FROM {image}\n"
        dockerfile.write_text("".join(lines))
    except (OSError, ValueError) as error:
        raise unavailable("The verifier Dockerfile does not match its pinned base image.") from error


def pin_environment(manifest, table, image, *, inherited=None):
    """Use the task's existing image name and pin the digest and offline mode."""
    data = tomllib.loads(manifest)
    section = data
    for name in table.split("."):
        section = section.get(name, {})
        if not isinstance(section, dict):
            raise ValueError("Invalid environment table")
    existing = section.get("docker_image", inherited)
    if not isinstance(existing, str) or existing.split("@")[0] != image.split("@")[0] or ("@" in existing and existing != image):
        raise ValueError("Image mismatch")
    lines = manifest.splitlines(keepends=True)
    start = next((index + 1 for index, line in enumerate(lines) if line.strip() == f"[{table}]"), None)
    if start is None:
        if not inherited or section:
            raise ValueError("Missing environment table")
        lines.append(f"\n[{table}]\n")
        start = len(lines)
    end = next((index for index in range(start, len(lines)) if lines[index].lstrip().startswith("[")), len(lines))
    body = [line for line in lines[start:end] if not re.match(r"\s*(docker_image|allow_internet)\s*=", line)]
    pin = f'docker_image = "{image}"\n' if "docker_image" in section or not inherited else ""
    result = "".join([*lines[:start], pin, "allow_internet = false\n", *body, *lines[end:]])
    tomllib.loads(result)
    return result


def install_replay(task, patch, base_commit, tree):
    if not REVISION.fullmatch(base_commit) or not REVISION.fullmatch(tree) or len(patch) > MAX_PATCH_BYTES:
        raise ValueError("Invalid frozen submission")
    solution = task / "solution"
    if solution.exists():
        shutil.rmtree(solution)
    solution.mkdir()
    (solution / "submission.patch").write_bytes(patch)
    solve = solution / "solve.sh"
    solve.write_text(f"""#!/bin/sh
set -eu
patch=$(cd "$(dirname "$0")" && pwd)/submission.patch
cd /app
g() {{ git -c safe.directory=/app -c core.hooksPath=/dev/null -c commit.gpgSign=false "$@"; }}
test "$(g rev-parse HEAD)" = {shlex.quote(base_commit)}
g read-tree {shlex.quote(base_commit)}
if [ -s "$patch" ]; then
    g apply --cached --whitespace=nowarn "$patch"
fi
test "$(g write-tree)" = {shlex.quote(tree)}
g -c user.name=Chorus -c user.email=chorus@chorus.invalid commit --allow-empty -m "Chorus submission"
test "$(g rev-parse 'HEAD^{{tree}}')" = {shlex.quote(tree)}
""")
    solve.chmod(0o755)


def read_json(path, maximum=512 * 1024):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Invalid verifier report file")
    with path.open("rb") as stream:
        data = stream.read(maximum + 1)
    if len(data) > maximum:
        raise ValueError("Verifier report exceeds the supported size")
    return json.loads(data)


def check_collected_patch(trial, repository, base, expected_tree):
    path = trial / "artifacts" / "model.patch"
    if path.parent.is_symlink() or path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * MAX_PATCH_BYTES:
        raise unavailable("Pier did not collect the submitted patch.")
    with tempfile.TemporaryDirectory(prefix="chorus-collected-tree-") as directory:
        index = Path(directory)
        _git(index, "init", "--template=")
        _git(index, "fetch", "--no-tags", "--no-recurse-submodules", "--depth=1", str(repository), base)
        _git(index, "read-tree", base)
        patch = path.read_bytes()
        if patch:
            _git(index, "apply", "--cached", "--whitespace=nowarn", "-", binary=True, input_bytes=patch)
        if _git(index, "write-tree").stdout.strip() != expected_tree:
            raise unavailable("The collected patch differs from the frozen submission. Retry verification.")


def read_result(job, *, replay=None):
    trials = [path for path in job.glob("*/result.json") if not path.parent.is_symlink()
              and (path.parent / "verifier").is_dir() and not (path.parent / "verifier").is_symlink()]
    try:
        if len(trials) != 1:
            raise ValueError
        trial_dir = trials[0].parent
        if (trial_dir / "agent" / "exit-code.txt").exists():
            raise unavailable("The Pier submission agent failed before collecting the patch. Retry verification.")
        if replay:
            check_collected_patch(trial_dir, *replay)
        trial = read_json(trials[0])
        if trial.get("exception_info") is not None:
            raise ValueError
        verifier = trials[0].parent / "verifier"
        reward = read_json(verifier / "reward.json")["reward"]
        if (type(reward) not in (int, float) or reward not in (0, 1)
                or trial["verifier_result"]["rewards"]["reward"] != reward):
            raise ValueError
    except (OSError, KeyError, ValueError, TypeError, AttributeError) as error:
        raise unavailable("Pier did not return a valid binary reward. Check the verifier and retry.") from error

    summary = {}
    try:
        values = read_json(verifier / "ctrf.json", 5 * 1024 * 1024)["results"]["summary"]
        summary = {key: values[key] for key in ("tests", "passed", "failed")
                   if type(values.get(key)) is int and values[key] >= 0}
    except (OSError, KeyError, ValueError, TypeError, AttributeError):
        pass
    return DeepSWEResult(reward=int(reward), compilationFailure=compilation_failure(verifier) if reward == 0 else None,
                         **summary)


def compilation_failure(verifier):
    path = verifier / "test-stdout.txt"
    if path.is_symlink() or not path.is_file():
        return None
    try:
        with path.open("rb") as stream:
            log = stream.read(256 * 1024).decode("utf-8", errors="replace")
    except OSError:
        return None
    log = re.sub(r"\x1b\[[0-9;]*m", "", log)
    for suite in re.split(r"(?m)^FAIL\s+", log)[1:]:
        report = suite.partition("Test Suites:")[0]
        if "Test suite failed to run" not in report:
            continue
        errors = [line.strip()[:350] for line in report.splitlines() if re.search(r"\berror TS\d+:", line)]
        if errors:
            return f"{report.splitlines()[0][:150]} could not run because TypeScript compilation failed.\n" + "\n".join(errors[:4])
    return None


async def stop_process(process):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if process.returncode is not None:
            return
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), 10)
            return
        except TimeoutError:
            continue


async def calibrate(reference_patch=None, *, profile=None):
    profile = profile or Profile.load()
    profile.check_docker()
    for agent, expected in (("oracle", 1), ("nop", 0)):
        result = await profile.grade(b"", profile.task.baseTree, control=agent, show_logs=True)
        if result.reward != expected:
            raise unavailable(f"Calibration failed for {agent}: expected {expected}, got {result.reward}.")
        print(f"Upstream {agent}: {result.reward}", flush=True)

    if reference_patch is None:
        with tempfile.TemporaryDirectory(prefix="chorus-deepswe-control-") as temporary:
            source = profile.copy_task(Path(temporary)) / "solution" / "solution.patch"
            reference_patch = source.read_bytes()
    incorrect = b"diff --git a/.chorus-control b/.chorus-control\nnew file mode 100644\n--- /dev/null\n+++ b/.chorus-control\n@@ -0,0 +1 @@\n+Calibration control\n"
    with tempfile.TemporaryDirectory(prefix="chorus-deepswe-index-") as temporary:
        repo = Path(temporary)
        _git(repo, "init", "--template=")
        _git(repo, "fetch", "--no-tags", "--no-recurse-submodules", "--depth=1", str(profile.repository), profile.task.baseCommit)
        for label, patch, expected in (("reference", reference_patch, 1), ("empty", b"", 0), ("incorrect", incorrect, 0)):
            _git(repo, "read-tree", profile.task.baseCommit)
            if patch:
                _git(repo, "apply", "--cached", "--whitespace=nowarn", "-", binary=True, input_bytes=patch)
            tree = _git(repo, "write-tree").stdout.strip()
            result = await profile.grade(patch, tree, show_logs=True)
            if result.reward != expected:
                raise unavailable(f"Replay calibration failed for {label}: expected {expected}, got {result.reward}.")
            print(f"Replay {label}: {result.reward}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Calibrate the local DeepSWE verifier.")
    parser.add_argument("--profile", type=Path, help="Calibrate this task profile instead of the configured default.")
    parser.add_argument("--reference-patch", type=Path, help="Override the reference patch from the pinned task checkout.")
    args = parser.parse_args()
    try:
        profile = Profile.from_file(args.profile) if args.profile else None
        asyncio.run(calibrate(args.reference_patch.read_bytes() if args.reference_patch else None, profile=profile))
    except (ChorusError, OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
