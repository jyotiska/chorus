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

from chorus.cli.launcher import LaunchError, check_ports
from chorus.cli.main import app


def free_ports():
    with socket.socket() as first, socket.socket() as second:
        first.bind(("127.0.0.1", 0))
        second.bind(("127.0.0.1", 0))
        return first.getsockname()[1], second.getsockname()[1]


def test_port_conflict_preserves_existing_listener():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        with pytest.raises(LaunchError, match="already in use"):
            check_ports(port)
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass
    with pytest.raises(LaunchError, match="different ports"):
        check_ports(43187, 43187)


def test_launch_cli_reports_actionable_error(monkeypatch):
    monkeypatch.setattr("chorus.cli.launcher.shutil.which", lambda _: None)
    result = CliRunner().invoke(app, ["launch", "--no-browser"])
    assert result.exit_code == 1
    assert "Node 24 is required" in result.output


@pytest.mark.skipif(os.name != "posix", reason="Local launcher integration uses a POSIX executable fixture")
@pytest.mark.parametrize("ending", ["interrupt", "terminate", "web_failure", "startup_failure"])
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
                else:
                    process.send_signal(signal.SIGINT if ending == "interrupt" else signal.SIGTERM)
            code = process.wait(timeout=25)
            assert (code == 0) == (ending in {"interrupt", "terminate"}), log_path.read_text()
            if ending in {"web_failure", "startup_failure"}:
                assert "Chorus interface exited" in log_path.read_text()
            for url in (api_url, web_url):
                with pytest.raises(httpx.TransportError):
                    client.get(url)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=20)
