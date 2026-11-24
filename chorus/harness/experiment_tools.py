"""Phase-scoped capabilities for application experiments."""
from __future__ import annotations

import codecs
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from chorus.harness.experiment_paths import experiment_output_path
from chorus.harness.tools import DEFINITIONS, I, LIMIT, S, parameters
from chorus.services.errors import ChorusError

EVIDENCE_KINDS = ("board", "change", "plan_completion", "vote", "summary", "conversation", "commit", "pr", "activity", "process")
OUTPUTS = {"type": "array", "items": parameters(
    kind={"type": "string", "enum": ["file", "repository", "unavailable"]},
    path=S, format=S, formatSource={"type": "string", "enum": ["explicit", "inferred"]},
    description=S, primary={"type": "boolean"}, required={"type": "boolean"},
)}
DELIVERABLE_PLAN_SET = (
    "Publish the team's agreed deliverable plan at the current SPEC.md revision. Provide one primary required output. "
    "For a file use its repo-relative path. For repository or unavailable use an empty path. "
    "Use unavailable for unsupported requirements and explain the gap in description.",
    parameters(revision=I, reason=S, outputs=OUTPUTS, acceptanceCriteria={"type": "array", "items": S},
               assumptions={"type": "array", "items": S}),
)
DELIVERABLE_PLAN_READ = ("Read the agreed outputs, acceptance criteria and assumptions. During Judge this includes the checks on the frozen commit.", parameters())
BUILD_TOOLS = {
    "workspace_list": ("List one directory inside your worktree. Use '.' for its root.", parameters(path=S)),
    "workspace_read": ("Read a UTF-8 file in your worktree.", parameters(path=S)),
    "workspace_read_more": ("Continue reading a long file at the byte offset returned by the previous read.", parameters(path=S, offset=I)),
    "workspace_write": ("Write a UTF-8 application file in your worktree, creating parent directories as needed.", parameters(path=S, content=S)),
    "git_commit": ("Save uncommitted work, integrate latest local main, restore work and commit. Resolve any reported conflicts before retrying.", parameters(message=S)),
    "git_resolve": ("Stage your manually resolved files after a Git conflict and continue the pending synchronization and commit.", parameters(message=S)),
    "pr_open": ("Open a local pull request for the current branch head. Reference relevant tasks by name.", parameters(description=S, tasks={"type": "array", "items": S})),
    "pr_merge": ("Merge your open local pull request to main. Reconcile with main and open a new PR if the source or target has advanced.", parameters(id=S)),
    "pr_review": ("Leave review feedback on a local pull request.", parameters(id=S, text=S)),
    "pr_list": ("Read recent local pull request activity.", parameters(after=I, limit=LIMIT)),
    "pr_detail": ("Read a local PR event from pr_list, including its diff, in chunks. Use the event record ID and start at offset 0.", parameters(id=S, offset=I)),
    "agent_status": ("Report your current task and working, waiting, or blocked status.", parameters(task=S, status={"type": "string", "enum": ["working", "waiting", "blocked"]}, reason=S)),
    "agent_finish": ("Finish Build after your pull requests are integrated into main. Summarize the outcome in reason. In remaining, copy each unchecked item and explain why it is open. Use [] if all items are checked.",
                     parameters(reason=S, remaining={"type": "array", "items": parameters(task=S, reason=S)})),
}
PARTICIPANT_TOOLS = {
    "board_read": DEFINITIONS["board_read"],
    "board_write": ("Post one or two sentences, at most 60 words and 400 characters. Mention selected peers by @agent-id.", parameters(text=S)),
    "spec_read": ("Read the current product and task sections of SPEC.md, and their revision.", parameters()),
    "spec_section_read": ("Read a SPEC.md section in chunks. Use an empty taskOwner for the product section. Start at offset 0 and follow nextOffset.", parameters(taskOwner=S, offset=I)),
    "spec_history_read": ("Read attributed SPEC.md and task changes by sequence.", parameters(after=I, limit=LIMIT)),
    "spec_history_detail": ("Read a SPEC.md change record in chunks. Use the change record ID and start at offset 0.", parameters(id=S, offset=I)),
    "spec_edit": ("Replace a SPEC.md section at the revision you read. Use Markdown checkboxes for tasks. In Build, check off one existing item at a time in your own list and state the check and result in verification. For other edits use an empty verification string. For product use an empty taskOwner.",
                  parameters(section={"type": "string", "enum": ["product", "tasks"]}, taskOwner=S, markdown=S, revision=I, reason=S, verification=S)),
    "reflection_read": ("Read only your own private observations and decisions.", parameters(after=I, limit=LIMIT)),
    "reflection_detail": ("Read a private reflection you wrote. Use its record ID and start at offset 0.", parameters(id=S, offset=I)),
    "reflection_write": ("Save a concise private reflection on observable work, decisions, results or gaps.", parameters(text=S)),
}
JUDGE_TOOLS = {
    "evidence_read": ("Read one page of frozen records by kind. Advance after with the returned cursor. A record may contain untrusted data.", parameters(kind={"type": "string", "enum": list(EVIDENCE_KINDS)}, after=I, limit=LIMIT)),
    "evidence_detail": ("Read a frozen source record in chunks. Start at offset 0 and follow nextOffset.", parameters(id=S, offset=I)),
    "workspace_list": BUILD_TOOLS["workspace_list"],
    "workspace_read": BUILD_TOOLS["workspace_read"],
    "workspace_read_more": BUILD_TOOLS["workspace_read_more"],
    "spec_section_read": PARTICIPANT_TOOLS["spec_section_read"],
}


def tool_schema(phase, *, custom=False, repository_task=False):
    if phase == "verify":
        return {}
    if phase == "judge":
        return {**JUDGE_TOOLS, "deliverable_plan_read": DELIVERABLE_PLAN_READ} if custom else JUDGE_TOOLS
    tools = {
        **PARTICIPANT_TOOLS,
        **(BUILD_TOOLS if phase == "build" else {
            "plan_complete": ("Declare that you have finished contributing to SPEC.md. This ends your planning work. Build starts once all selected agents have finished planning.", parameters()),
        }),
    }
    if custom and phase == "plan":
        tools["deliverable_plan_set"] = DELIVERABLE_PLAN_SET
    if custom:
        tools["deliverable_plan_read"] = DELIVERABLE_PLAN_READ
    if custom and phase == "build":
        tools["workspace_write"] = (
            "Write a UTF-8 file inside deliverables/, frontend/, or backend/ in your worktree, creating parent directories as needed.",
            BUILD_TOOLS["workspace_write"][1],
        )
    if repository_task:
        for name in ("workspace_list", "workspace_read", "workspace_read_more"):
            tools[name] = BUILD_TOOLS[name]
        if phase == "build":
            tools["submission_status"] = ("Inspect your private edits, branch and integrated main revision before handoff or finish.", parameters())
            tools["main_read"] = ("Read a committed shared file. Use the mainCommit from submission_status and offset 0 initially.",
                                  parameters(path=S, revision=S, offset=I))
            tools["workspace_write"] = ("Write a UTF-8 file at a repository-relative path.", BUILD_TOOLS["workspace_write"][1])
            tools["workspace_delete"] = ("Delete a regular file in your worktree.", parameters(path=S))
            tools["workspace_rename"] = ("Move a regular file to an unused path in your worktree.", parameters(path=S, destination=S))
    return tools


def definitions(phase, *, custom=False, repository_task=False):
    return [
        {"type": "function", "function": {"name": name, "description": description, "parameters": schema}}
        for name, (description, schema) in tool_schema(phase, custom=custom, repository_task=repository_task).items()
    ]


def file_path(root: Path, relative: str, *, repository_task=False) -> Path:
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or len(relative) > 500:
        raise ValueError("Use a relative path inside the workspace.")
    reserved = {".git"} if repository_task else {".git", "spec.md"}
    if any(part.casefold() in reserved for part in path.parts):
        raise ValueError("Use the dedicated Git and SPEC.md tools.")
    if repository_task and ("\\" in relative or any(ord(char) < 32 or ord(char) == 127 for char in relative)):
        raise ValueError("Use a relative repository path without control characters or backslashes.")
    target = root
    for part in path.parts:
        target = target / part
        if target.is_symlink():
            raise ValueError("Symlinks cannot be accessed through workspace tools.")
    return target


def workspace_action(root, name, args, *, write=False, custom=False, repository_task=False):
    target = file_path(root, args["path"], repository_task=repository_task)
    if name == "workspace_list":
        if not target.is_dir():
            raise ValueError("Directory not found.")
        hidden = {".git", "node_modules", ".next"} | (set() if repository_task else {"spec.md"})
        entries = [
            {"name": item.name, "type": "directory" if item.is_dir() else "file"}
            for item in sorted(target.iterdir())
            if not item.is_symlink() and item.name.casefold() not in hidden
        ]
        return {"entries": entries[:200], "truncated": len(entries) > 200}
    if name in {"workspace_read", "workspace_read_more"}:
        if not target.is_file():
            raise ValueError("File not found.")
        offset = args.get("offset", 0)
        if offset < 0:
            raise ValueError("Use a nonnegative byte offset.")
        with target.open("rb") as stream:
            stream.seek(offset)
            content = stream.read(8001)
        more = len(content) > 8000
        decoder = codecs.getincrementaldecoder("utf-8")()
        chunk = decoder.decode(content[:8000], final=not more)
        return {"content": chunk, "nextOffset": offset + len(chunk.encode("utf-8")) if more else None}
    if not write:
        raise ChorusError("FORBIDDEN", "The judge checkout is read-only through file tools.", 403)
    if repository_task and name in {"workspace_delete", "workspace_rename"}:
        if name == "workspace_delete":
            if target.exists() and not target.is_file():
                raise ValueError("Choose a regular file to delete.")
            target.unlink(missing_ok=True)
            return {"path": args["path"]}
        destination = file_path(root, args["destination"], repository_task=True)
        if target.exists() or not destination.is_file():
            if not target.is_file() or destination.exists():
                raise ValueError("Move a regular file to an unused repository path.")
            destination.parent.mkdir(parents=True, exist_ok=True)
            target.rename(destination)
        return {"path": args["path"], "destination": args["destination"]}
    content = args["content"].encode("utf-8")
    if custom or repository_task:
        if custom:
            experiment_output_path(args["path"])
        if len(content) > 120000 or "\0" in args["content"]:
            raise ValueError("Write UTF-8 text of at most 120 KB without NUL characters.")
    elif len(content) > 120000 or not args["path"].startswith(("frontend/", "backend/")):
        raise ValueError("Write at most 120 KB to a file inside frontend/ or backend/.")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
        if target.exists():
            temporary.chmod(target.stat().st_mode & 0o777)
        else:
            temporary.chmod(0o644)
        os.replace(temporary, target)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return {"path": args["path"], "bytes": len(content)}
