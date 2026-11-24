"""Exercise launcher supervision with a real API and a lightweight stand-in UI."""
from __future__ import annotations

import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

import httpx
import pytest
from typer.testing import CliRunner

from chorus.cli import launcher
from chorus.cli.launcher import LaunchError, check_ports
from chorus.cli.main import app


def free_ports():
    with socket.socket() as first, socket.socket() as second:
        first.bind(("127.0.0.1", 0))
        second.bind(("127.0.0.1", 0))
        return first.getsockname()[1], second.getsockname()[1]


@pytest.mark.parametrize("host", ["127.0.0.1", "0.0.0.0"])
def test_port_conflict_preserves_existing_listener(host):
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((host, 0))
        listener.listen()
        port = listener.getsockname()[1]
        with pytest.raises(LaunchError, match="already in use"):
            check_ports(port)
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass
    with pytest.raises(LaunchError, match="different ports"):
        check_ports(43187, 43187)


def test_port_check_allows_restart_after_an_established_connection_closes():
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        listener.listen()
        with socket.create_connection(("127.0.0.1", port), timeout=1) as peer:
            accepted, _ = listener.accept()
            accepted.close()
            assert peer.recv(1) == b""
    check_ports(port)


def test_launch_cli_reports_actionable_error(monkeypatch):
    monkeypatch.setattr("chorus.cli.launcher.shutil.which", lambda _: None)
    result = CliRunner().invoke(app, ["launch", "--no-browser"])
    assert result.exit_code == 1
    assert "Node 24 is required" in result.output


def test_stop_cli_targets_the_configured_compose_services(tmp_path, monkeypatch):
    monkeypatch.setattr(launcher, "__file__", str(tmp_path / "chorus/cli/launcher.py"))
    monkeypatch.setattr(launcher.shutil, "which", lambda _: "/fake/docker")
    (tmp_path / "compose.yaml").touch()
    calls = []
    running = True

    def compose(args, **kwargs):
        nonlocal running
        calls.append(args)
        assert kwargs["cwd"] == tmp_path
        if "ps" in args:
            return subprocess.CompletedProcess(args, 0, stdout="chorus\ncontroller\n" if running else "")
        running = False
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(launcher.subprocess, "run", compose)
    cli = CliRunner()
    for message in ("Chorus stopped.", "Chorus is already stopped."):
        result = cli.invoke(app, ["stop", "--project-name", "chorus-test"])
        assert result.exit_code == 0, result.output
        assert message in result.output
    command = ["/fake/docker", "compose", "-f", str(tmp_path / "compose.yaml"), "--project-name", "chorus-test"]
    inspect = [*command, "ps", "--status", "running", "--services", "chorus", "controller"]
    assert calls == [inspect, [*command, "stop", "chorus", "controller"], inspect]


@pytest.mark.skipif(os.name != "posix", reason="Local launcher integration uses a POSIX executable fixture")
@pytest.mark.parametrize("ending", ["interrupt", "terminate", "cli_stop", "web_failure", "startup_failure"])
def test_launch_supervises_both_services(tmp_path, ending):
    root = tmp_path / "checkout"
    web = root / "web"
    next_cli = web / "node_modules/next/dist/bin/next"
    next_cli.parent.mkdir(parents=True)
    next_cli.touch()
    (web / "package.json").write_text('{}')
    binaries = tmp_path / "bin"
    binaries.mkdir()
    node = binaries / "node"
    node.write_text(f"#!{sys.executable}\n" + '''
import os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
if sys.argv[1:] == ['--version']:
    print('v24.0.0')
    sys.exit(0)
if os.environ.get('TEST_STARTUP_FAILURE') == '1':
    sys.exit(9)
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ready')
        if self.path == '/crash':
            self.wfile.flush()
            os._exit(7)
HTTPServer(('127.0.0.1', int(sys.argv[-1])), Handler).serve_forever()
''')
    node.chmod(0o755)
    api_port, web_port = free_ports()
    api_url, web_url = f"http://127.0.0.1:{api_port}/health", f"http://127.0.0.1:{web_port}"
    code = (
        "from chorus.cli import launcher\n"
        f"launcher.__file__ = {str(root / 'chorus/cli/launcher.py')!r}\n"
        f"launcher.launch_application(api_port={api_port}, web_port={web_port}, browser=False, production=False)\n"
    )
    env = {
        **os.environ, "PATH": str(binaries) + os.pathsep + os.environ["PATH"],
        "CHORUS_DB": str(tmp_path / "sessions.sqlite3"),
        "CHORUS_API_KEY": "", "OPENROUTER_API_KEY": "",
        "TEST_STARTUP_FAILURE": "1" if ending == "startup_failure" else "0",
    }
    log_path = tmp_path / "launcher.log"
    with log_path.open("w") as log, httpx.Client(timeout=.5, trust_env=False) as client:
        process = subprocess.Popen([sys.executable, "-u", "-c", code], cwd=tmp_path, env=env, stdout=log, stderr=log)
        try:
            if ending != "startup_failure":
                deadline = time.monotonic() + 25
                while "Chorus is ready:" not in log_path.read_text():
                    assert process.poll() is None, log_path.read_text()
                    assert time.monotonic() < deadline, log_path.read_text()
                    time.sleep(.1)
                assert client.get(api_url).status_code == 200
                assert client.get(web_url).status_code == 200
                if ending == "web_failure":
                    assert client.get(web_url + "/crash").status_code == 200
                elif ending == "cli_stop":
                    stop_code = (
                        "from chorus.cli import launcher\n"
                        f"launcher.__file__ = {str(root / 'chorus/cli/launcher.py')!r}\n"
                        "from chorus.cli.main import app\n"
                        "app(['stop'])\n"
                    )
                    for message in ("Chorus stopped.", "Chorus is already stopped."):
                        result = subprocess.run([sys.executable, "-c", stop_code], cwd=tmp_path, env=env,
                                                capture_output=True, text=True, timeout=25, check=True)
                        assert message in result.stdout
                else:
                    process.send_signal(signal.SIGINT if ending == "interrupt" else signal.SIGTERM)
            exit_code = process.wait(timeout=25)
            assert (exit_code == 0) == (ending in {"interrupt", "terminate", "cli_stop"}), log_path.read_text()
            if ending in {"web_failure", "startup_failure"}:
                assert "Chorus interface exited" in log_path.read_text()
            for url in (api_url, web_url):
                with pytest.raises(httpx.TransportError):
                    client.get(url)
            if ending == "cli_stop":
                log.seek(0)
                log.truncate()
                process = subprocess.Popen([sys.executable, "-u", "-c", code], cwd=tmp_path, env=env,
                                           stdout=log, stderr=log)
                children = [("Relaunched Chorus", process)]
                launcher.wait_ready(api_url, children, timeout=15)
                launcher.wait_ready(web_url, children, timeout=15)
                result = subprocess.run([sys.executable, "-c", stop_code], cwd=tmp_path, env=env,
                                        capture_output=True, text=True, timeout=25, check=True)
                assert "Chorus stopped." in result.stdout
                assert process.wait(timeout=25) == 0, log_path.read_text()
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=20)
