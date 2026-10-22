from __future__ import annotations
import unicodedata
import regex as re
from chorus.contracts import Turn


def normalized(text: str) -> str:
    text = re.sub(r"['’]", "", unicodedata.normalize("NFKC", text).lower())
    return " ".join(re.sub(r'[.,!?;:"“”()\[\]{}*_#`]', " ", text).split())


def compact(text: str) -> str:
    sentences: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", " ".join(text.split()))[:4]:
        candidate = " ".join(sentences + [sentence])
        if len(candidate) > 1800 or len(candidate.split()) > 120:
            break
        sentences.append(sentence)
    return " ".join(sentences)


def speech_error(text: str, conversation: list[Turn]) -> str | None:
    if not text:
        return "Give a concrete contribution of at most 120 words and 1800 characters."
    if not re.search(r"[.!?][\"”']?$", text.strip()):
        return "Finish your contribution with a complete sentence."
    def sentences(value: str) -> list[str]:
        return [normalized(s) for s in re.split(r"(?:[.!?]+(?=\s|$)|\n+)", value)]
    current = [s for s in sentences(text) if len(s.split()) >= 4]
    previous = {s for line in conversation for s in sentences(line.text)}
    def phrases(value: str) -> list[str]:
        words = normalized(value).split(" ")
        return [" ".join(words[i:i + 3]) for i in range(len(words) - 2)]
    old_phrases = {p for line in conversation for p in phrases(line.text)}
    new_phrases = phrases(text)
    repeated = len(new_phrases) >= 18 and sum(p in old_phrases for p in new_phrases) > len(new_phrases) * 2 / 3
    if not normalized(text) or any(normalized(t.text) == normalized(text) for t in conversation) or len(set(current)) != len(current) or sum(len(s) for s in current if s in previous) > len(normalized(text)) / 2 or repeated:
        return "Your contribution repeats earlier speech or itself. Give a fresh specific contribution."
    return None


def canvas_body(document: str) -> str:
    lines = [line for line in document.split("\n") if not re.search(r"^\s*#{1,6}(\s|$)", line) and not re.search(r"^\s*\*{0,2}Revision Notes\s*[-–—:(]?\s*Turn\s+\d+\s*\)?\*{0,2}\s*:?\s*$", line, re.I)]
    return " ".join(" ".join(lines).split())


def canvas_error(text: str) -> str | None:
    if not text.strip() or len(text) > 20000 or not canvas_body(text):
        return "Supply a nonempty Markdown document with body content, at most 20000 characters."
    if re.search(r"^```|write_canvas\s*\(|<tool_call>", text):
        return "Write the document without outer fences or tool-call text."
    paragraphs = [normalized(x) for x in re.split(r"\n\s*\n", text) if len(normalized(x)) >= 40]
    if len(set(paragraphs)) != len(paragraphs):
        return "The document repeats paragraphs. Consolidate repeated content."
    return None


def grounding_error(text: str, source: str) -> str | None:
    def norm(value: str) -> str:
        value = re.sub(r"\bdowntime\b", "outage", value.lower())
        value = re.sub(r"[^\p{L}\p{N}]+", " ", value)
        return " ".join(re.sub(r"\b(?:a|an|the|was|were|is|are)\b", " ", value).split())
    evidence = norm(source)
    for line in re.split(r"\n|(?<=[.!?])\s+", text):
        if re.search(r"^\s*#{1,6}\s", line):
            continue
        plain = re.sub(r"^\s*[-#*>]+\s*", "", re.sub(r"\*+|__", "", line)).strip()
        if re.fullmatch(r"(?:confirmed|verified|observed)\s+facts?(?:\s*(?:&|and)\s*(?:open\s+)?hypotheses)?\s*:?", plain, re.I):
            continue
        if not norm(plain) or norm(plain) in evidence:
            continue
        labelled = re.sub(r"^(?:confirmed|verified|observed)(?:\s+facts?)?\s*:\s*", "", plain, flags=re.I)
        if labelled != plain and all(len(norm(p)) >= 4 and norm(p) in evidence for p in re.split(r"[;,]", labelled)):
            continue
        assertion = re.search(r"\b(?:confirmed|verified|measured|observed|demonstrated)\b|\b(?:logs?|records?|tickets?|data|research|tests?)\s+(?:show|shows|confirmed|revealed)\b|\b(?:outage|incident)\s+(?:lasted|affected|cost)\b", line, re.I)
        conditional = re.search(r"\b(?:not|unconfirmed|unknown|pending|proposed|hypothesis|completion check|verification|if|until|before|must|should|require[sd]?|to be|to confirm|to verify)\b", line, re.I)
        prospective = re.search(r"\b(?:will|would|target|goal|milestone|objective|acceptance|secure|obtain)\b", plain, re.I) or (re.search(r"\b(?:Day|Week|Month)\s+\d+\b", plain, re.I) and not re.search(r"\b(?:was|were|had)\b|\b(?:confirmed|verified)\s*:", plain, re.I))
        if assertion and not conditional and not prospective and not re.search(r"\?[\"”']?$", plain):
            if re.search(r"\b(?:api|oauth|integration|capabilities|capability|training materials)\b", plain, re.I):
                return "Unsupported capability confirmation."
            return "An unsupported fact is presented as confirmed. Use verbatim scenario evidence or label details as proposals or unknowns."
    return None
