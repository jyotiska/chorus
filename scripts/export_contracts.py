"""Regenerate Chorus contracts/UI; optionally export to a separate Nanoville checkout."""
import argparse
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

from chorus.api import create_app
from chorus.contracts import Contracts

ROOT = Path(__file__).resolve().parents[1]
SHARED_FILES = (
    "contracts.schema.json", "contracts.generated.ts", "client.ts", "usage-view.tsx",
    "harness-client.ts", "harness-workspace.tsx", "harness-workspace.module.css",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nanoville", type=Path, help="Also update generated files in this existing Nanoville checkout.")
    parser.add_argument("--check", action="store_true", help="Fail on stale generated files without changing them.")
    args = parser.parse_args()
    targets = [ROOT / "web/lib/api/chorus"]
    if args.nanoville is not None:
        checkout = args.nanoville.resolve()
        if not (checkout / "package.json").is_file() or not (checkout / "src/api/chorus").is_dir():
            parser.error("--nanoville must point to an existing Nanoville checkout")
        targets.append(checkout / "src/api/chorus")
    compiler = ROOT / "web/node_modules/json-schema-to-typescript"
    if not compiler.is_dir():
        parser.error("Install the local generator first: npm ci --prefix web")
    with TemporaryDirectory(prefix="chorus-contracts-") as temporary:
        generated = Path(temporary)
        schema = Contracts.model_json_schema(mode="serialization")
        (generated / "contracts.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
        (generated / "openapi.json").write_text(json.dumps(create_app().openapi(), indent=2) + "\n")
        subprocess.run([
            "node", "-e",
            "const fs=require('fs');const {compile}=require(process.argv[1]);"
            "compile(JSON.parse(fs.readFileSync(process.argv[2])), 'Contracts', "
            "{ignoreMinAndMaxItems:true,bannerComment:'/** Generated from Chorus Pydantic contracts. Do not edit by hand. */'})"
            ".then(s=>fs.writeFileSync(process.argv[3],s)).catch(e=>{console.error(e);process.exit(1)});",
            str(compiler), str(generated / "contracts.schema.json"), str(generated / "contracts.generated.ts"),
        ], check=True)
        outputs = {ROOT / "sdk" / name: (generated / name).read_bytes()
                   for name in ("contracts.schema.json", "openapi.json", "contracts.generated.ts")}
        for target in targets:
            for name in SHARED_FILES:
                source = generated / name if (generated / name).exists() else ROOT / "sdk" / name
                outputs[target / name] = source.read_bytes()
        stale = [path for path, content in outputs.items() if not path.is_file() or path.read_bytes() != content]
        if args.check:
            if stale:
                raise SystemExit("Generated files are stale; run scripts/export_contracts.py:\n" + "\n".join(map(str, stale)))
            print("Generated contracts and shared copies are current.")
        else:
            for path, content in outputs.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            for target in targets:
                print(f"Updated {target}")


if __name__ == "__main__":
    main()
