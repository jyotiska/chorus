"""Supervise the local API and web UI without coupling their implementations."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import webbrowser

import httpx


class LaunchError(Exception):
    """An actionable local startup or service failure."""


def check_ports(*ports: int) -> None:
    if len(set(ports)) != len(ports):
        raise LaunchError("The engine and interface need different ports.")
    for port in ports:
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                raise LaunchError(
                    f"Port {port} is already in use. Stop that service or choose "
                    "--api-port and --web-port. Existing services were left running."
                ) from None


def check_children(children: list[tuple[str, subprocess.Popen]]) -> None:
    for name, child in children:
        code = child.poll()
        if code is not None:
            raise LaunchError(f"{name} exited (status {code}). See its output above.")


def wait_ready(url: str, children: list[tuple[str, subprocess.Popen]], timeout: float = 120) -> None:
    deadline = time.monotonic() + timeout
    with httpx.Client(timeout=1, trust_env=False) as client:
        while time.monotonic() < deadline:
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


def launch_application(*, api_port: int, web_port: int, browser: bool, production: bool) -> None:
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

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    api_url = f"http://127.0.0.1:{api_port}"
    web_url = f"http://127.0.0.1:{web_port}"
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous_handlers[sig] = signal.signal(sig, interrupt)
        print(f"Starting Chorus engine at {api_url}", flush=True)
        children.append(("Chorus engine", subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "chorus.api:app", "--host", "127.0.0.1", "--port", str(api_port), "--workers", "1"],
            cwd=root, start_new_session=True,
        )))
        wait_ready(f"{api_url}/health", children)
        print(f"Starting Chorus interface at {web_url}", flush=True)
        children.append(("Chorus interface", subprocess.Popen(
            [node, str(next_cli), "start" if production else "dev", "--hostname", "127.0.0.1", "--port", str(web_port)],
            cwd=web, env={**os.environ, "CHORUS_API_URL": api_url}, start_new_session=True,
        )))
        wait_ready(web_url, children)
        print(f"Chorus is ready: {web_url}\nPress Ctrl-C to stop the interface and engine.", flush=True)
        if browser:
            try:
                webbrowser.open(web_url)
            except webbrowser.Error:
                print(f"Open {web_url} in your browser.", flush=True)
        while True:
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
            stop_children(children)
        finally:
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)
