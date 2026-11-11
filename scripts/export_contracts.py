"""Regenerate Chorus contracts/UI; optionally export to a separate Nanoville checkout."""
import argparse
import json
from pathlib import Path
import subprocess

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
    schema = Contracts.model_json_schema(mode="serialization")
    (ROOT / "sdk/contracts.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
    (ROOT / "sdk/openapi.json").write_text(json.dumps(create_app().openapi(), indent=2) + "\n")
    subprocess.run([
        "node", "-e",
        "const fs=require('fs');const {compile}=require(process.argv[1]);"
        "compile(JSON.parse(fs.readFileSync(process.argv[2])), 'Contracts', "
        "{ignoreMinAndMaxItems:true,bannerComment:'/** Generated from Chorus Pydantic contracts. Do not edit by hand. */'})"
        ".then(s=>fs.writeFileSync(process.argv[3],s)).catch(e=>{console.error(e);process.exit(1)});",
        str(compiler), str(ROOT / "sdk/contracts.schema.json"), str(ROOT / "sdk/contracts.generated.ts"),
    ], check=True)
    for target in targets:
        target.mkdir(parents=True, exist_ok=True)
        for name in SHARED_FILES:
            (target / name).write_bytes((ROOT / "sdk" / name).read_bytes())
        print(f"Updated {target}")


if __name__ == "__main__":
    main()
