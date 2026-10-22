import pytest
from pydantic import ValidationError
from chorus.services.canvas import apply_edit, evidence_block, heading_paths, CanvasEditError

EVIDENCE = "Only supplied facts are verified."
PREFIX = evidence_block(EVIDENCE) + "\n\n"
DOCUMENT = "# Brief\n\n## Proposal\nOld content.\n\n### Safeguards\nKeep human review.\n\n## Open decisions\nUnknown measures."


def test_creation_and_protected_evidence():
    canvas, _ = apply_edit("", EVIDENCE, {"op": "CREATE_DOCUMENT", "document": DOCUMENT})
    assert canvas == PREFIX + DOCUMENT
    assert heading_paths(canvas, EVIDENCE) == [["Brief"], ["Brief", "Proposal"], ["Brief", "Proposal", "Safeguards"], ["Brief", "Open decisions"]]


@pytest.mark.parametrize("newline", ["\n", "\r\n"])
def test_replace_preserves_descendants_siblings_and_source(newline):
    canvas = PREFIX + DOCUMENT.replace("\n", newline)
    result, _ = apply_edit(canvas, EVIDENCE, {"op": "REPLACE_SECTION", "path": ["Brief", "Proposal"], "body": "New content."})
    assert result == canvas.replace("Old content.", newline + "New content.")


def test_append_after_descendants_before_siblings():
    canvas = PREFIX + DOCUMENT
    result, _ = apply_edit(canvas, EVIDENCE, {"op": "APPEND_SECTION", "parentPath": ["Brief", "Proposal"], "heading": "Owners", "body": "Proposed owner."})
    assert "Keep human review.\n\n### Owners\n\nProposed owner.\n\n## Open decisions" in result


@pytest.mark.parametrize("edit", [
    {"op": "REPLACE_SECTION", "path": ["Missing"], "body": "Content."},
    {"op": "REPLACE_SECTION", "path": ["Brief", "Proposal"], "body": "## New heading\nContent."},
    {"op": "REPLACE_SECTION", "path": ["Scenario evidence"], "body": "Content."},
    {"op": "REPLACE_SECTION", "path": ["Brief", "Proposal"], "body": "<script>bad</script>"},
    {"op": "REPLACE_SECTION", "path": ["Brief", "Proposal"], "body": "```\nUnclosed code"},
    {"op": "APPEND_SECTION", "parentPath": ["Brief"], "heading": "Proposal", "body": "Content."},
    {"op": "APPEND_SECTION", "parentPath": [], "heading": "Scenario evidence", "body": "Content."},
    {"op": "CREATE_DOCUMENT", "document": "Content."},
    {"op": "REPLACE_SECTION", "path": ["Brief", "Proposal"], "body": " "},
])
def test_invalid_edits(edit):
    with pytest.raises((ValueError, ValidationError)):
        apply_edit(PREFIX + DOCUMENT, EVIDENCE, edit)


@pytest.mark.parametrize("document", ["# Heading only", "# Trial brief ## Proposal All content flattened.", "## Scenario evidence\n\nFake evidence.", "# A\n\nContent.\n\n# A\n\nOther content."])
def test_invalid_creation(document):
    with pytest.raises(ValueError):
        apply_edit("", EVIDENCE, {"op": "CREATE_DOCUMENT", "document": document})


def test_setext_formatted_headings_and_closed_code():
    source = PREFIX + "**Brief**\n=========\n\n## Proposal\nOld.\n\n## Other\nLeave exactly."
    result, _ = apply_edit(source, EVIDENCE, {"op": "REPLACE_SECTION", "path": ["Brief", "Proposal"], "body": "```markdown\n# Not a heading\n```"})
    assert result.endswith("## Other\nLeave exactly.")
    assert heading_paths(result, EVIDENCE) == [["Brief"], ["Brief", "Proposal"], ["Brief", "Other"]]


def test_repeated_names_under_different_parents():
    source = PREFIX + "# A\n\n## Notes\nOne.\n\n# B\n\n## Notes\nTwo."
    result, _ = apply_edit(source, EVIDENCE, {"op": "REPLACE_SECTION", "path": ["B", "Notes"], "body": "Three."})
    assert "One." in result and "Two." not in result


def test_ambiguous_paths_rejected():
    source = PREFIX + "# A\n\nContent.\n\n# A\n\nOther."
    with pytest.raises(CanvasEditError):
        apply_edit(source, EVIDENCE, {"op": "REPLACE_SECTION", "path": ["A"], "body": "Three."})


def test_depth_limit_and_unchanged():
    source = PREFIX + "###### Six\n\nContent."
    assert apply_edit(source, EVIDENCE, {"op": "UNCHANGED"})[0] == source
    with pytest.raises(CanvasEditError):
        apply_edit(source, EVIDENCE, {"op": "APPEND_SECTION", "parentPath": ["Six"], "heading": "Seven", "body": "Content."})


def test_gfm_strikethrough_headings_have_the_same_canonical_path_as_the_renderer():
    canvas = PREFIX + "# ~~Brief~~\n\n## Proposal\n\nOld content."
    assert heading_paths(canvas, EVIDENCE) == [["Brief"], ["Brief", "Proposal"]]
    revised, _ = apply_edit(canvas, EVIDENCE, {"op": "REPLACE_SECTION", "path": ["Brief", "Proposal"], "body": "New content."})
    assert revised == canvas.replace("Old content.", "New content.")
