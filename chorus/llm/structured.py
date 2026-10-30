"""Shared decoding-schema and result-envelope handling for cloud providers."""
from __future__ import annotations
import copy
import json
from typing import Any


def strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Wrap canvas unions in an object and adapt the decoding schema to cloud providers."""
    def adapt(node: Any) -> Any:
        if isinstance(node, list):
            return [adapt(item) for item in node]
        if not isinstance(node, dict):
            return node
        result = {key: copy.deepcopy(value) for key, value in node.items() if key not in {"title", "default", "discriminator"}}
        for key in ("properties", "$defs"):
            if key in result:
                result[key] = {name: adapt(child) for name, child in result[key].items()}
        for key in ("items", "anyOf", "oneOf"):
            if key in result:
                result[key] = adapt(result[key])
        if "oneOf" in result:
            result["anyOf"] = result.pop("oneOf")
        if "const" in result:
            result["enum"] = [result.pop("const")]
        if result.get("type") == "object" or "properties" in result:
            result["additionalProperties"] = False
            result["required"] = list(result.get("properties", {}))
        return result
    return {"type": "object", "properties": {"result": adapt(schema)}, "required": ["result"], "additionalProperties": False}


def unwrap_result(text: str) -> str:
    # Keep malformed/model-authored output for the generation validators and
    # their bounded retries; only unwrap a complete, unambiguous envelope.
    try:
        value = json.loads(text)
    except ValueError:
        return text
    if isinstance(value, dict) and set(value) == {"result"}:
        return json.dumps(value["result"], ensure_ascii=False)
    return text
