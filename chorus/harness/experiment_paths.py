"""Canonical paths for experiment file writes and planned deliverables."""

from pathlib import PurePosixPath


BINARY_OUTPUT_SUFFIXES = frozenset({
    ".avif", ".bmp", ".doc", ".docx", ".epub", ".gif", ".gz", ".ico", ".jpeg", ".jpg", ".mp3", ".mp4",
    ".pdf", ".png", ".ppt", ".pptx", ".tif", ".tiff", ".wav", ".webm", ".webp", ".xls", ".xlsx", ".zip",
})


def experiment_output_path(path: str) -> PurePosixPath:
    parts = path.split("/")
    if (len(parts) < 2 or parts[0] not in {"frontend", "backend", "deliverables"} or len(path) > 500 or "\\" in path
            or any(ord(char) < 32 or ord(char) == 127 for char in path)
            or any(part.casefold() in {"", ".", "..", ".git", "spec.md"} for part in parts)):
        raise ValueError("Use a repository-relative file path inside frontend/, backend/, or deliverables/.")
    return PurePosixPath(path)
