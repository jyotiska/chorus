import re
import xml.etree.ElementTree as ET
from chorus.core.types import Action, ActionType, ParsedResponse


def parse_response(raw: str) -> ParsedResponse:
    return (
        _parse_structured(raw)
        or _parse_fuzzy(raw)
        or _parse_raw(raw)
    )


def _parse_structured(raw: str) -> ParsedResponse | None:
    try:
        root = ET.fromstring(raw.strip())
        message_el = root.find("message")
        if message_el is None or not message_el.text:
            return None

        thinking_el = root.find("thinking")
        targets_el = root.find("targets")
        action_el = root.find("action")

        targets = _parse_targets(targets_el.text if targets_el is not None else "")
        action = _parse_action_element(action_el)

        return ParsedResponse(
            thinking=thinking_el.text.strip() if thinking_el is not None and thinking_el.text else None,
            message=message_el.text.strip(),
            targets=targets,
            action=action,
            parse_quality="structured",
        )
    except ET.ParseError:
        return None


def _parse_fuzzy(raw: str) -> ParsedResponse | None:
    message_match = re.search(r"<message>(.*?)</message>", raw, re.DOTALL)
    if not message_match:
        return None

    thinking_match = re.search(r"<thinking>(.*?)</thinking>", raw, re.DOTALL)
    targets_match = re.search(r"<targets>(.*?)</targets>", raw, re.DOTALL)
    action_match = re.search(r'<action\s+type="([^"]+)">(.*?)</action>', raw, re.DOTALL)

    targets = _parse_targets(targets_match.group(1) if targets_match else "")

    action = Action(type=ActionType.NONE)
    if action_match:
        action = Action(
            type=_safe_action_type(action_match.group(1)),
            content=action_match.group(2).strip() or None,
        )

    return ParsedResponse(
        thinking=thinking_match.group(1).strip() if thinking_match else None,
        message=message_match.group(1).strip(),
        targets=targets,
        action=action,
        parse_quality="fuzzy",
    )


def _parse_raw(raw: str) -> ParsedResponse:
    return ParsedResponse(
        message=raw.strip(),
        parse_quality="raw",
    )


def _parse_targets(text: str) -> list[str]:
    if not text or not text.strip():
        return []
    return [t.strip() for t in text.split(",") if t.strip()]


def _parse_action_element(element: ET.Element | None) -> Action:
    if element is None:
        return Action(type=ActionType.NONE)
    action_type = _safe_action_type(element.get("type", "none"))
    content = element.text.strip() if element.text else None
    return Action(type=action_type, content=content)


def _safe_action_type(value: str) -> ActionType:
    try:
        return ActionType(value.lower())
    except ValueError:
        return ActionType.NONE
