"""Run public project checks in disposable, offline containers."""

import asyncio
from contextlib import suppress
from dataclasses import dataclass
import os
import unicodedata
from uuid import uuid4

from chorus.harness.models import CheckStatus, PublicCheckCommand, PublicCheckProfile
from chorus.runtime.workspace import CONTAINER_ISOLATION


OUTPUT_BYTES = 4096
OUTPUT_PREFIX_BYTES = 1024


@dataclass(frozen=True)
class CheckResult:
    status: CheckStatus
    output: str = ""
    exit_code: int | None = None
    truncated: bool = False


async def docker(*args, data=None):
    env = {key: os.environ[key] for key in ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG")
           if key in os.environ}
    process = await asyncio.create_subprocess_exec(
        "docker", *args, env=env,
        stdin=asyncio.subprocess.PIPE if data is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )

    async def upload():
        if process.stdin is not None:
            try:
                for offset in range(0, len(data), 65536):
                    process.stdin.write(data[offset:offset + 65536])
                    await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                process.stdin.close()

    async def collect():
        prefix = bytearray()
        tail = bytearray()
        tail_limit = OUTPUT_BYTES - OUTPUT_PREFIX_BYTES
        truncated = False
        while block := await process.stdout.read(8192):
            room = OUTPUT_PREFIX_BYTES - len(prefix)
            prefix.extend(block[:room])
            tail.extend(block[room:])
            if len(tail) > tail_limit:
                truncated = True
                del tail[:-tail_limit]
        if truncated:
            marker = b"\n[output truncated]\n"
            return bytes(prefix + marker + tail[len(marker):]), True
        return bytes(prefix + tail), False

    jobs = [asyncio.create_task(coro) for coro in (upload(), collect(), process.wait())]
    try:
        _, (output, truncated), code = await asyncio.gather(*jobs)
    except BaseException:
        with suppress(ProcessLookupError):
            process.kill()
        for job in jobs:
            job.cancel()
        await asyncio.gather(*jobs, return_exceptions=True)
        await process.communicate()
        raise
    return code, output, truncated


def plain_output(output):
    return "".join(char for char in output.decode("utf-8", errors="replace")
                   if char in "\n\t" or unicodedata.category(char)[0] != "C")


async def run_check(profile: PublicCheckProfile, command: PublicCheckCommand, archive: bytes) -> CheckResult:
    name = f"chorus-check-{uuid4().hex}"
    try:
        async with asyncio.timeout(profile.timeoutSeconds):
            code, _, _ = await docker(
                "run", "--rm", "-d", "--pull=never", "--name", name, "--label", "org.chorus.public-check=1",
                "--platform", profile.platform, *CONTAINER_ISOLATION, "--env", "HOME=/tmp",
                "--entrypoint", "/bin/sh", profile.image, "-c", 'exec sleep "$1"', "chorus",
                str(profile.timeoutSeconds + 20),
            )
            if code:
                return CheckResult("unavailable", "The public check image could not start. Check Docker and the pinned image.")
            code, _, _ = await docker("exec", "-i", name, "tar", "-xf", "-", "-C", "/workspace", data=archive)
            if code:
                return CheckResult("unavailable", "The runner could not unpack the committed files.")
            code, output, truncated = await docker("exec", "--workdir", "/workspace", name, *command.argv)
            if code in {125, 126, 127}:
                return CheckResult("unavailable", "The runner could not execute the approved command.")
            if code:
                inspect_code, status, _ = await docker("inspect", "--format", "{{.State.Running}}", name)
                if inspect_code or status.strip() != b"true":
                    return CheckResult("unavailable", "The public check container stopped before reporting a result.")
            return CheckResult("failed" if code else "passed", plain_output(output), code, truncated)
    except TimeoutError:
        return CheckResult("timed_out", "The public check exceeded its time limit.")
    except OSError:
        return CheckResult("unavailable", "The local Docker worker is unavailable.")
    finally:
        # The container also expires on its own if the engine is terminated abruptly.
        with suppress(OSError, TimeoutError):
            await asyncio.wait_for(docker("rm", "-f", name), 5)
