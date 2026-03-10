import pytest
from chorus.core.types import ActionType
from chorus.parsing.response_parser import parse_response


STRUCTURED_RESPONSE = """
<response>
  <thinking>I should agree but push back slightly.</thinking>
  <message>That's a good point, but have you considered the risks?</message>
  <targets>Optimist</targets>
  <action type="question">What's the fallback plan?</action>
</response>
""".strip()

FUZZY_RESPONSE = """
Some preamble text.
<thinking>Internal thought.</thinking>
<message>Here is my actual message.</message>
<targets>Analyst, Optimist</targets>
<action type="propose">Let's vote on it.</action>
"""

RAW_RESPONSE = "I completely agree with what was said. No structure here."


def test_structured_parse():
    result = parse_response(STRUCTURED_RESPONSE)
    assert result.parse_quality == "structured"
    assert result.message == "That's a good point, but have you considered the risks?"
    assert result.thinking == "I should agree but push back slightly."
    assert result.targets == ["Optimist"]
    assert result.action.type == ActionType.QUESTION
    assert result.action.content == "What's the fallback plan?"


def test_fuzzy_parse():
    result = parse_response(FUZZY_RESPONSE)
    assert result.parse_quality == "fuzzy"
    assert result.message == "Here is my actual message."
    assert result.targets == ["Analyst", "Optimist"]
    assert result.action.type == ActionType.PROPOSE


def test_raw_parse():
    result = parse_response(RAW_RESPONSE)
    assert result.parse_quality == "raw"
    assert result.message == RAW_RESPONSE
    assert result.targets == []
    assert result.action.type == ActionType.NONE


def test_missing_message_falls_through_to_fuzzy():
    malformed = "<response><thinking>Only thinking</thinking></response>"
    result = parse_response(malformed)
    assert result.parse_quality in ("fuzzy", "raw")


def test_empty_targets():
    response = "<response><message>Hello</message><targets></targets></response>"
    result = parse_response(response)
    assert result.targets == []


def test_unknown_action_type_defaults_to_none():
    response = '<response><message>Hi</message><action type="dance">boogie</action></response>'
    result = parse_response(response)
    assert result.action.type == ActionType.NONE
