"""Source-preserving Markdown section operations, ported from Nanoville."""
from __future__ import annotations
from dataclasses import dataclass
import json
import re
from markdown_it import MarkdownIt
from pydantic import TypeAdapter
from chorus.contracts import CanvasEdit, Unchanged, CreateDocument, ReplaceSection

parser = MarkdownIt("commonmark").enable(["table", "strikethrough"])
edit_adapter = TypeAdapter(CanvasEdit)


class CanvasEditError(ValueError):
    pass


@dataclass
class Section:
    depth: int
    path: list[str]
    start: int
    heading_end: int


def normalize(text: str) -> str:
    return " ".join(text.split())


def protected(text: str) -> bool:
    return normalize(text).lower() == "scenario evidence"


def evidence_block(evidence: str) -> str:
    return f"## Scenario evidence\n\n> {evidence}"


def offsets(source: str) -> list[int]:
    result = [0]
    for line in source.splitlines(keepends=True):
        result.append(result[-1] + len(line))
    return result


def inline_text(token: object) -> str:
    children = getattr(token, "children", None) or []
    return "".join(t.content if t.type in {"text", "code_inline", "html_inline"} else inline_text(t) if t.type == "image" else " " if t.type in {"softbreak", "hardbreak"} else "" for t in children)


def sections(source: str) -> list[Section]:
    tokens = parser.parse(source)
    positions = offsets(source)
    ancestors: list[tuple[int, str]] = []
    result: list[Section] = []
    for index, token in enumerate(tokens):
        if token.type != "heading_open" or token.level != 0 or token.map is None:
            continue
        depth = int(token.tag[1:])
        while ancestors and ancestors[-1][0] >= depth:
            ancestors.pop()
        text = normalize(inline_text(tokens[index + 1]))
        ancestors.append((depth, text))
        start, end = positions[token.map[0]], positions[token.map[1]]
        while end > start and source[end - 1] in "\r\n":
            end -= 1
        result.append(Section(depth, [x[1] for x in ancestors], start, end))
    return result


def check_blocks(source: str, allow_headings: bool) -> None:
    positions = offsets(source)
    tokens = parser.parse(source)
    for i, token in enumerate(tokens):
        if token.type in {"html_block", "html_inline"} or any(t.type == "html_inline" for t in token.children or []):
            raise CanvasEditError("Preserve structure: raw HTML is not allowed.")
        if token.type == "heading_open":
            if not allow_headings or protected(inline_text(tokens[i + 1])):
                raise CanvasEditError("Bodies cannot contain headings; scenario evidence is server-owned.")
        if token.type == "fence" and token.map:
            raw = source[positions[token.map[0]]:positions[token.map[1]]].rstrip("\r\n")
            last = raw.splitlines()[-1]
            closing = re.search(r"^(?:[ \t]*>[ \t]*)*[ \t]*(`{3,}|~{3,})[ \t]*$", last)
            if not closing or closing[1][0] != token.markup[0] or len(closing[1]) < len(token.markup) or len(raw.splitlines()) < len(token.content.rstrip("\n").splitlines()) + 2:
                raise CanvasEditError("Bodies must close code fences.")


def heading_paths(canvas: str, evidence: str) -> list[list[str]]:
    prefix = evidence_block(evidence) + "\n\n"
    source = canvas[len(prefix):] if canvas.startswith(prefix) else canvas
    return [s.path for s in sections(source) if not any(protected(x) for x in s.path)]


def apply_edit(canvas: str, evidence: str, raw: object) -> tuple[str, str]:
    edit = edit_adapter.validate_python(raw)
    if isinstance(edit, Unchanged):
        return canvas, "The document is unchanged."
    prefix = evidence_block(evidence) + "\n\n"
    if isinstance(edit, CreateDocument):
        if canvas.strip():
            raise CanvasEditError("Create a document only when the committed canvas is empty.")
        document = edit.document.strip()
        check_blocks(document, True)
        tokens = parser.parse(document)
        if not any(t.type == "inline" and t.content.strip() and (i == 0 or tokens[i - 1].type != "heading_open") or t.type in {"fence", "code_block"} and t.content.strip() for i, t in enumerate(tokens)):
            raise CanvasEditError("Initial creation needs body content below headings.")
        paths = [s.path for s in sections(document)]
        if any(len(path) > 6 or any(not x or len(x) > 200 for x in path) for path in paths):
            raise CanvasEditError("Invalid heading path.")
        if len({tuple(path) for path in paths}) != len(paths):
            raise CanvasEditError("Duplicate heading paths.")
        return prefix + document, "Created the initial proposed plan and open decisions."
    if not canvas.strip():
        raise CanvasEditError("Create a document before editing sections.")
    path = edit.path if isinstance(edit, ReplaceSection) else edit.parentPath
    if any(protected(x) for x in path) or not canvas.startswith(prefix):
        raise CanvasEditError("Scenario evidence is server-owned. Do not alter its section.")
    source = canvas[len(prefix):]
    headings = sections(source)
    matches = [s for s in headings if s.path == path]
    if path and len(matches) != 1:
        raise CanvasEditError("Missing or ambiguous heading path. Copy an exact canonical path.")
    check_blocks(edit.body, False)
    if not edit.body.strip():
        raise CanvasEditError("Bodies must contain useful content.")
    target = matches[0] if matches else None
    newline = "\r\n" if "\r\n" in source else "\n"
    expected = [(s.depth, s.path) for s in headings]
    if isinstance(edit, ReplaceSection):
        assert target is not None
        index = headings.index(target)
        following = headings[index + 1] if index + 1 < len(headings) else None
        candidate = source[:target.heading_end] + newline * 2 + edit.body.strip() + (newline * 2 + source[following.start:] if following else "")
    else:
        depth = target.depth + 1 if target else 1
        heading = normalize(edit.heading)
        if depth > 6 or protected(heading) or not heading or "\n" in edit.heading or "\r" in edit.heading:
            raise CanvasEditError("Invalid new heading.")
        child_path = path + [heading]
        if any(s.path == child_path for s in headings):
            raise CanvasEditError("Duplicate sibling heading.")
        heading_source = "#" * depth + " " + heading
        check_blocks(heading_source, True)
        if not sections(heading_source) or sections(heading_source)[0].path != [heading]:
            raise CanvasEditError("Use a plain-text heading.")
        sibling = next((s for s in headings if target and s.start > target.start and s.depth <= target.depth), None)
        offset = sibling.start if sibling else len(source)
        expected.insert(headings.index(sibling) if sibling else len(headings), (depth, child_path))
        before = source[:offset]
        separator = "" if before.endswith(newline * 2) else newline if before.endswith(newline) else newline * 2
        candidate = before + separator + heading_source + newline * 2 + edit.body.strip() + (newline * 2 + source[offset:] if sibling else "")
    if [(s.depth, s.path) for s in sections(candidate)] != expected:
        raise CanvasEditError("The edit changed surrounding heading structure.")
    description = ("Replaced the direct body of " if isinstance(edit, ReplaceSection) else "Appended a child section under ") + json.dumps(path, ensure_ascii=False, separators=(",", ":"))
    if not isinstance(edit, ReplaceSection):
        description += " named " + json.dumps(edit.heading, ensure_ascii=False)
    return prefix + candidate, description + "."
