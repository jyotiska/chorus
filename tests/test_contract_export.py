"""Contract generation owns only the integrated UI unless an external export is requested."""
from pathlib import Path
import runpy
import sys

import pytest


@pytest.fixture
def exporter(tmp_path, monkeypatch):
    namespace = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/export_contracts.py"))
    main = namespace["main"]
    root = tmp_path / "chorus"
    (root / "sdk").mkdir(parents=True)
    (root / "web/node_modules/json-schema-to-typescript").mkdir(parents=True)
    for name in namespace["SHARED_FILES"]:
        (root / "sdk" / name).write_text(f"canonical {name}\n")
    main.__globals__["ROOT"] = root

    def compile_contract(command, **kwargs):
        assert str(root / "web/node_modules/json-schema-to-typescript") in command
        Path(command[-1]).write_text("generated types\n")

    monkeypatch.setattr("subprocess.run", compile_contract)
    return main, root, namespace["SHARED_FILES"]


def test_default_export_is_self_contained(exporter, monkeypatch):
    main, root, names = exporter
    monkeypatch.setattr(sys, "argv", ["export_contracts.py"])
    main()
    for name in names:
        assert (root / "sdk" / name).read_bytes() == (root / "web/lib/api/chorus" / name).read_bytes()
    assert not (root.parent / "nanoville").exists()
    assert not (root.parent / "chorus-web").exists()


def test_external_export_requires_explicit_existing_checkout(exporter, monkeypatch):
    main, root, names = exporter
    external = root.parent / "separate-nanoville"
    (external / "src/api/chorus").mkdir(parents=True)
    (external / "package.json").write_text('{"name":"nanoville"}')
    monkeypatch.setattr(sys, "argv", ["export_contracts.py", "--nanoville", str(external)])
    main()
    for name in names:
        assert (root / "sdk" / name).read_bytes() == (external / "src/api/chorus" / name).read_bytes()


def test_invalid_external_target_does_not_create_checkout_or_write_contracts(exporter, monkeypatch):
    main, root, _ = exporter
    missing = root.parent / "typo"
    original = (root / "sdk/contracts.schema.json").read_bytes()
    monkeypatch.setattr(sys, "argv", ["export_contracts.py", "--nanoville", str(missing)])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
    assert not missing.exists()
    assert (root / "sdk/contracts.schema.json").read_bytes() == original
