"""Supervise the local API and web UI without coupling their implementations."""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from errno import ECONNREFUSED
from hashlib import sha256
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from uuid import uuid4

import httpx


class LaunchError(Exception):
    """An actionable local startup or service failure."""


def control_directory() -> Path:
    # Use a short path because Unix socket addresses have a platform limit.
    directory = Path(f"/tmp/chorus-{os.getuid()}")
    directory.mkdir(mode=0o700, exist_ok=True)
    stat = directory.lstat()
    if directory.is_symlink() or not directory.is_dir() or stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise LaunchError(f"Cannot use {directory} for local shutdown. It must be a private directory owned by you.")
    return directory


def control_prefix(root: Path) -> str:
    return f"launch-{sha256(os.fsencode(root)).hexdigest()[:20]}-"


@contextmanager
def stop_listener(root: Path):
    path = control_directory() / f"{control_prefix(root)}{uuid4().hex[:12]}.sock"
    with socket.socket(socket.AF_UNIX) as listener:
        listener.bind(str(path))
        try:
            listener.listen()
            listener.setblocking(False)
            yield listener
        finally:
            path.unlink(missing_ok=True)


def check_stop(listener: socket.socket | None) -> None:
    if listener is None:
        return
    try:
        connection, _ = listener.accept()
    except BlockingIOError:
        return
    connection.close()
    raise KeyboardInterrupt


def stop_local(root: Path) -> bool:
    shutting_down = []
    for path in control_directory().glob(f"{control_prefix(root)}*.sock"):
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(2)
            try:
                connection.connect(str(path))
            except (FileNotFoundError, ConnectionRefusedError):
                # A stopped or interrupted launcher can leave a stale socket.
                continue
            shutting_down.append(path)
    deadline = time.monotonic() + 20
    while any(path.exists() for path in shutting_down):
        if time.monotonic() >= deadline:
            raise LaunchError("Timed out waiting for Chorus to stop. Check the launch terminal for details.")
        time.sleep(0.1)
    return bool(shutting_down)


def stop_compose(root: Path, project_name: str | None) -> bool:
    compose_file = root / "compose.yaml"
    docker = shutil.which("docker")
    if not docker or not compose_file.is_file():
        if project_name:
            raise LaunchError("Stopping a Compose project requires Docker Compose and the Chorus checkout.")
        return False
    command = [docker, "compose", "-f", str(compose_file)]
    if project_name:
        command.extend(["--project-name", project_name])
    services = ["chorus", "controller"]
    try:
        running = subprocess.run([*command, "ps", "--status", "running", "--services", *services],
                                 cwd=root, capture_output=True, text=True, check=True, timeout=10)
        if not running.stdout.strip():
            return False
        subprocess.run([*command, "stop", *services], cwd=root, capture_output=True,
                       text=True, check=True, timeout=65)
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        raise LaunchError(f"Could not stop the Chorus Compose project. Check that Docker is running. {detail}".rstrip()) from None
    except subprocess.TimeoutExpired:
        raise LaunchError("Timed out waiting for Docker Compose. Check the state of the Chorus project.") from None
    return True


def stop_application(project_name: str | None = None) -> bool:
    root = Path(__file__).resolve().parents[2]
    try:
        return (project_name is None and stop_local(root)) or stop_compose(root, project_name)
    except OSError as error:
        raise LaunchError(f"Could not stop Chorus: {error}") from None


def check_ports(*ports: int) -> None:
    if len(set(ports)) != len(ports):
        raise LaunchError("The engine and interface need different ports.")
    for port in ports:
        address = ("127.0.0.1", port)
        unavailable = (
            f"Port {port} is already in use. Stop that service or choose "
            "--api-port and --web-port. Existing services were left running."
        )
        with socket.socket() as connection, socket.socket() as probe:
            connection.settimeout(0.25)
            try:
                # On macOS a reusable loopback socket can bind over a wildcard listener.
                if connection.connect_ex(address) != ECONNREFUSED:
                    raise LaunchError(unavailable)
                # Match the servers' ability to reopen a port with connections in TIME_WAIT.
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                probe.bind(address)
                probe.listen()
            except OSError:
                raise LaunchError(unavailable) from None


def check_children(children: list[tuple[str, subprocess.Popen]]) -> None:
    for name, child in children:
        code = child.poll()
        if code is not None:
            raise LaunchError(f"{name} exited (status {code}). See its output above.")


def wait_ready(url: str, children: list[tuple[str, subprocess.Popen]], timeout: float = 120,
               *, listener: socket.socket | None = None) -> None:
    deadline = time.monotonic() + timeout
    with httpx.Client(timeout=1, trust_env=False) as client:
        while time.monotonic() < deadline:
            check_stop(listener)
            check_children(children)
            try:
                if client.get(url).status_code == 200:
                    check_children(children)
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.2)
    raise LaunchError(f"Timed out waiting for {url}. See service output above.")


def signal_child(child: subprocess.Popen, sig: int) -> None:
    try:
        if os.name == "posix":
            # Next can spawn workers; signal the group even if its leader exited.
            os.killpg(child.pid, sig)
        elif child.poll() is None:
            child.terminate() if sig == signal.SIGTERM else child.kill()
    except ProcessLookupError:
        pass


def stop_children(children: list[tuple[str, subprocess.Popen]]) -> None:
    for _, child in reversed(children):
        signal_child(child, signal.SIGTERM)
    deadline = time.monotonic() + 10
    for _, child in reversed(children):
        try:
            child.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            pass
    for _, child in reversed(children):
        signal_child(child, signal.SIGKILL)
        child.wait()


def launch_application(*, api_port: int, web_port: int, browser: bool, production: bool,
                       web_host: str = "127.0.0.1", local_control: bool = True) -> None:
    root = Path(__file__).resolve().parents[2]
    web = root / "web"
    if not (web / "package.json").is_file():
        raise LaunchError("The web interface requires a Chorus checkout. Install with pip install -e . from that checkout, or use chorus serve for the API alone.")
    node = shutil.which("node")
    if node is None:
        raise LaunchError("Node 24 is required. Install it, then run npm ci --prefix web from the Chorus checkout.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if version.split(".")[0] != "v24":
        raise LaunchError(f"Node 24 is required (found {version}). Run nvm use in the Chorus checkout, or put Node 24 on PATH.")
    next_cli = web / "node_modules/next/dist/bin/next"
    if not next_cli.is_file():
        raise LaunchError("Install the web dependencies first: npm ci --prefix web (from the Chorus checkout).")
    if production and not (web / ".next/BUILD_ID").is_file():
        raise LaunchError("Build the production interface first: npm run build --prefix web.")
    check_ports(api_port, web_port)

    children: list[tuple[str, subprocess.Popen]] = []
    previous_handlers = {}
    control = ExitStack()

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    api_url = f"http://127.0.0.1:{api_port}"
    web_url = f"http://127.0.0.1:{web_port}"
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[sig] = signal.signal(sig, interrupt)
        listener = control.enter_context(stop_listener(root)) if local_control else None
        print(f"Starting Chorus engine at {api_url}", flush=True)
        children.append(("Chorus engine", subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "chorus.api:app", "--host", "127.0.0.1", "--port", str(api_port), "--workers", "1"],
            cwd=root, start_new_session=True,
        )))
        wait_ready(f"{api_url}/health", children, listener=listener)
        print(f"Starting Chorus interface at {web_url}", flush=True)
        web_env = {key: value for key, value in os.environ.items()
                   if key not in {"CHORUS_API_KEY", "OPENROUTER_API_KEY"}}
        children.append(("Chorus interface", subprocess.Popen(
            [node, str(next_cli), "start" if production else "dev", "--hostname", web_host, "--port", str(web_port)],
            cwd=web, env={**web_env, "CHORUS_API_URL": api_url}, start_new_session=True,
        )))
        wait_ready(web_url, children, listener=listener)
        print(f"Chorus is ready: {web_url}\nPress Ctrl-C to stop the interface and engine.", flush=True)
        if browser:
            try:
                webbrowser.open(web_url)
            except webbrowser.Error:
                print(f"Open {web_url} in your browser.", flush=True)
        while True:
            check_stop(listener)
            check_children(children)
            time.sleep(0.3)
    except KeyboardInterrupt:
        print("\nStopping Chorus…", flush=True)
    except OSError as error:
        raise LaunchError(f"Could not start Chorus: {error}") from None
    finally:
        # A second interrupt must not abandon children during graceful shutdown.
        for sig in previous_handlers:
            signal.signal(sig, signal.SIG_IGN)
        try:
            with control:
                stop_children(children)
        finally:
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)
