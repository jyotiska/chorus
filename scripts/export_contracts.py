"""Regenerate the OpenAPI document and both frontend runtime/type contracts."""
from pathlib import Path
import json
import subprocess
from chorus.api import create_app
from chorus.contracts import Contracts

ROOT = Path(__file__).resolve().parents[1]
schema = Contracts.model_json_schema(mode="serialization")
(ROOT / 'sdk/contracts.schema.json').write_text(json.dumps(schema, indent=2) + '\n')
(ROOT / 'sdk/openapi.json').write_text(json.dumps(create_app().openapi(), indent=2) + '\n')
subprocess.run(['node', '-e', "const fs=require('fs');const {compile}=require(process.argv[1]);compile(JSON.parse(fs.readFileSync(process.argv[2])), 'Contracts', {ignoreMinAndMaxItems:true,bannerComment:'/** Generated from Chorus Pydantic contracts. Do not edit by hand. */'}).then(s=>fs.writeFileSync(process.argv[3],s));", str(ROOT.parent / 'nanoville/node_modules/json-schema-to-typescript'), str(ROOT / 'sdk/contracts.schema.json'), str(ROOT / 'sdk/contracts.generated.ts')], check=True)
for target in (ROOT.parent / 'nanoville/src/api/chorus', ROOT.parent / 'chorus-web/lib/api/chorus'):
    target.mkdir(parents=True, exist_ok=True)
    for name in ('contracts.schema.json', 'contracts.generated.ts', 'client.ts'):
        (target / name).write_text((ROOT / 'sdk' / name).read_text())
