"""Server-authorized tools; models never receive filesystem or database access."""
from __future__ import annotations
import difflib
import fcntl
import hashlib
import json
import os
import re
import tempfile
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from chorus.harness.models import Record, LeaseView
from chorus.harness.verification import validate
from chorus.services.canvas import apply_edit
from chorus.services.errors import ChorusError
from chorus.storage import now


def parameters(**props):
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


S, I = {"type": "string"}, {"type": "integer"}
CURSOR = {"type": "integer", "minimum": 0}
LIMIT = {"type": "integer", "minimum": 1, "maximum": 50}
DEFINITIONS = {
    "board_read": ("Read one flat chronological board page, at most 50 records. Advance after using the returned cursor.", parameters(after=CURSOR, limit=LIMIT)),
    "board_write": ("Append one or two concise sentences; at most 60 words and 400 characters. Mention selected peers with @FirstName. No threads.", parameters(text=S)),
    "canvas_read": ("Read current canvas (version 0) or a historical version, with canonical section paths.", parameters(version=I)),
    "canvas_acquire_lock": ("Acquire the exclusive canvas lockfile lease; a busy result means retry later or do other work.", parameters()),
    "canvas_apply_edit": ("With your lease token and current baseVersion, apply operationJson: CREATE_DOCUMENT/document, REPLACE_SECTION/path/body, APPEND_SECTION/parentPath/heading/body, or UNCHANGED. Preserve scenario evidence. Supply a brief reason.", parameters(token=S, baseVersion=I, operationJson=S, reason=S)),
    "canvas_release_lock": ("Release your exclusive canvas lease immediately after editing or abandoning an edit.", parameters(token=S)),
    "changelog_read": ("Read attributed canvas changes and diffs in sequence order, at most 50 records.", parameters(after=CURSOR, limit=LIMIT)),
    "summary_read": ("Read your own structured reasoning summaries, at most 50 records. Peers cannot access these summaries.", parameters(after=CURSOR, limit=LIMIT)),
    "agent_finish": ("Stop contributing to this session early; this does not stop other agents.", parameters(reason=S)),
    "evaluation_read": ("Read frozen board, summary, or change records, at most 50 records, including every agent's summaries. Judge only.", parameters(kind={"type": "string", "enum": ["board", "summary", "change"]}, after=CURSOR, limit=LIMIT)),
    "verification_read": ("Read the frozen final deterministic verification result. Judge only.", parameters()),
}
PARTICIPANT_TOOLS = set(DEFINITIONS) - {"evaluation_read", "verification_read"}
JUDGE_TOOLS = {"board_read", "canvas_read", "changelog_read", "evaluation_read", "verification_read"}


def definitions(judge=False):
    allowed = JUDGE_TOOLS if judge else PARTICIPANT_TOOLS
    return [{"type": "function", "function": {"name": name, "description": DEFINITIONS[name][0], "parameters": DEFINITIONS[name][1]}} for name in sorted(allowed)]


def board_text(text: str, agents, *, use_ids=False) -> tuple[str, list[str]]:
    text = " ".join(text.split())
    if not text or len(text) > 400 or len(text.split()) > 60:
        raise ValueError("Use one or two sentences, at most 60 words and 400 characters.")
    counted = re.sub(r"(?<=\d)\.(?=\d)", "~", text)
    counted = re.sub(r"\b(?:Dr|Mr|Ms|Prof|vs|etc)\.", "abbr", counted, flags=re.I)
    counted = re.sub(r"\b(?:e\.g\.|i\.e\.)", "example", counted, flags=re.I)
    ends = re.findall(r"[.!?]+[\"”’')\]]*(?=\s|$)", counted)
    if not 1 <= len(ends) <= 2 or not re.search(r"[.!?][\"”’')\]]*$", counted):
        raise ValueError("Write one or two complete sentences ending in punctuation.")
    roster = {(agent.id if use_ids else agent.name).lower(): agent for agent in agents}
    mentioned = []
    def replace(match):
        agent = roster.get(match[1].lower())
        if agent is None:
            identity = "identifier" if use_ids else "first name"
            raise ValueError(f"Unknown participant @{match[1]}. Use a selected participant's {identity}.")
        mentioned.append(agent.id)
        return "@" + (agent.id if use_ids else agent.name)
    pattern = r"(?<![\w@])@([A-Za-z][A-Za-z0-9-]*)" if use_ids else r"(?<![\w@])@([A-Za-z]+)"
    text = re.sub(pattern, replace, text)
    return text, list(dict.fromkeys(mentioned))


class ToolRuntime:
    def __init__(self, repository):
        self.repo = repository
        self.temporary = tempfile.TemporaryDirectory(prefix="chorus-locks-") if repository.store.lock is None else None
        self.directory = Path(self.temporary.name) if self.temporary else Path(repository.store.lock.name).parent / "canvas-locks"
        self.directory.mkdir(mode=0o700, exist_ok=True)
        self.files = {}
        self.waiters = defaultdict(deque)

    def worker(self, state, actor):
        return next(w for w in state.workers if w.agentId == actor)

    def authorized(self, sid, actor, generation):
        state = self.repo.get(sid)
        if state.generation != generation or state.status not in {"running", "reviewing"}:
            raise ChorusError("CANCELLED", "This operation no longer has publication authority.", 409)
        if actor != "judge" and (state.status != "running" or self.worker(state, actor).state in {"finished", "capped", "paused"}):
            raise ChorusError("FORBIDDEN", "This agent cannot contribute now.", 403)
        if actor == "judge" and state.status != "reviewing":
            raise ChorusError("FORBIDDEN", "The judge can only read frozen evaluation work.", 403)
        return state

    def clear(self, sid):
        old = self.repo.lease(sid)
        old.update(token="", agentId="", expiresAt=now())
        if sid in self.files:
            handle = self.files.pop(sid)
            handle.seek(0); handle.truncate(); handle.write(json.dumps({"releasedAt": now()})); handle.flush()
            fcntl.flock(handle, fcntl.LOCK_UN)
            handle.close()
        self.repo.change(sid, lambda s: setattr(s, "lease", None), lease=old)

    def cleanup_actor(self, sid, actor):
        self.waiters[sid] = deque(x for x in self.waiters[sid] if x != actor)
        if self.repo.lease(sid).get("agentId") == actor:
            self.clear(sid)

    def tick(self, sid, renew=False):
        lease = self.repo.lease(sid)
        if not lease.get("token"):
            return
        state = self.repo.get(sid)
        current = datetime.now(timezone.utc)
        if state.status != "running" or state.generation != lease["generation"] or current >= datetime.fromisoformat(lease["expiresAt"]) or current >= datetime.fromisoformat(lease["holdUntil"]):
            self.clear(sid)
        elif renew:
            expires = min(current + timedelta(seconds=state.config.leaseSeconds), datetime.fromisoformat(lease["holdUntil"]))
            lease["expiresAt"] = expires.isoformat()
            self.repo.change(sid, lambda s: setattr(s, "lease", LeaseView(agentId=lease["agentId"], expiresAt=lease["expiresAt"], fencing=lease["fencing"])), lease=lease)
            self._write_file(sid, lease)

    def _write_file(self, sid, lease):
        handle = self.files[sid]
        handle.seek(0); handle.truncate(); handle.write(json.dumps(lease)); handle.flush()

    def acquire(self, state, actor):
        sid = state.id
        self.tick(sid)
        lease = self.repo.lease(sid)
        if lease.get("agentId") == actor and lease.get("token"):
            return lease
        queue = self.waiters[sid]
        if actor not in queue:
            queue.append(actor)
        if lease.get("token") or queue[0] != actor:
            self.repo.change(sid, lambda s: setattr(self.worker(s, actor), "state", "waiting_lock"), generation=state.generation)
            return {"busy": True, "holder": lease.get("agentId"), "retryAfterMs": 300}
        filename = self.directory / f"{sid}.canvas.lock"
        handle = os.fdopen(os.open(filename, os.O_RDWR | os.O_CREAT, 0o600), "r+")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            return {"busy": True, "retryAfterMs": 300}
        self.files[sid] = handle
        current = datetime.now(timezone.utc)
        data = {"token": str(uuid4()), "agentId": actor, "generation": state.generation, "fencing": lease.get("fencing", 0) + 1, "expiresAt": (current + timedelta(seconds=state.config.leaseSeconds)).isoformat(), "holdUntil": (current + timedelta(seconds=state.config.maxLeaseHoldSeconds)).isoformat()}
        def changed(s):
            s.lease = LeaseView(agentId=actor, expiresAt=data["expiresAt"], fencing=data["fencing"])
            self.worker(s, actor).state = "running"
        try:
            self.repo.change(sid, changed, generation=state.generation, lease=data)
            self._write_file(sid, data)
            queue.popleft()
            return data
        except BaseException:
            fcntl.flock(handle, fcntl.LOCK_UN); handle.close(); self.files.pop(sid, None)
            raise

    def require_lease(self, state, actor, token):
        self.tick(state.id)
        lease = self.repo.lease(state.id)
        if not token or lease.get("token") != token or lease.get("agentId") != actor or lease.get("generation") != state.generation:
            raise ValueError("Missing, expired, or stale canvas lease; acquire a new lock and reread the current canvas.")
        return lease

    async def execute(self, sid, actor, generation, call_id, name, args, model_call_id=None):
        state = self.authorized(sid, actor, generation)
        # Provider tool IDs are scoped to a response, not guaranteed unique
        # across every response from every agent in a session.
        action_id = hashlib.sha256(f"{actor}:{model_call_id}:{call_id}".encode()).hexdigest() if model_call_id else call_id
        key = "tool:" + action_id
        previous = self.repo.record(sid, key)
        if previous:
            return previous.data["result"]
        # The action and its public effect commit atomically; a process may
        # stop before the separate tool-result transcript row is written.
        published = self.repo.record(sid, ("board:" if name == "board_write" else "change:") + action_id) if name in {"board_write", "canvas_apply_edit"} else None
        if published:
            if published.agentId != actor:
                raise ChorusError("FORBIDDEN", "Action belongs to another participant.", 403)
            return {"id": published.id, "sequence": published.sequence, "text": published.data["text"]} if name == "board_write" else {"version": published.data["afterVersion"], "changeId": published.id}
        allowed = JUDGE_TOOLS if actor == "judge" else PARTICIPANT_TOOLS
        if name not in allowed:
            raise ChorusError("FORBIDDEN", "This actor has no permission for that tool.", 403)
        if actor != "judge":
            worker = self.worker(state, actor)
            if worker.toolsUsed >= state.config.maxToolsPerTurn:
                raise ValueError("The tool-action budget for this turn is exhausted.")
            self.repo.change(sid, lambda s: setattr(self.worker(s, actor), "toolsUsed", self.worker(s, actor).toolsUsed + 1), generation=generation)
        validate(args, DEFINITIONS[name][1], "arguments")
        result = self._dispatch(state, actor, action_id, name, args, model_call_id)
        if model_call_id and (result.get("id") or result.get("changeId")):
            call = self.repo.record(sid, model_call_id)
            if call:
                data = dict(call.data)
                data["acceptedActionIds"] = list(dict.fromkeys(data.get("acceptedActionIds", []) + [result.get("changeId") or result["id"]]))
                self.repo.update_record(sid, model_call_id, data)
        self.repo.append(sid, "tool", actor, 0 if actor == "judge" else self.worker(state, actor).currentTurnIndex, {"name": name, "arguments": args, "result": result, "modelCallId": model_call_id, "nativeToolCallId": call_id}, generation=generation, record_id=key)
        return result

    def _dispatch(self, state, actor, action_id, name, args, model_call_id=None):
        sid, generation = state.id, state.generation
        worker = None if actor == "judge" else self.worker(self.repo.get(sid), actor)
        turn = worker.currentTurnIndex if worker else 0
        through = state.frozenSequence if actor == "judge" else None
        if name in {"board_read", "changelog_read", "summary_read", "evaluation_read"}:
            kind = {"board_read": "board", "changelog_read": "change", "summary_read": "summary"}.get(name, args.get("kind"))
            if kind not in {"board", "change", "summary"}:
                raise ValueError("Read kind must be board, change, or summary.")
            if args["after"] < 0 or not 1 <= args["limit"] <= 50:
                raise ValueError("Use a nonnegative cursor and a page size from 1 to 50.")
            page = self.repo.page(sid, kind, args["after"], args["limit"], actor if name == "summary_read" else None, through)
            if name == "board_read" and worker:
                self.repo.change(sid, lambda s: setattr(self.worker(s, actor), "boardCursor", max(self.worker(s, actor).boardCursor, page.cursor)), generation=generation)
            return page.model_dump(mode="json")
        if name == "verification_read":
            return state.verification.model_dump(mode="json") if state.verification else {"status": "unavailable"}
        if name == "canvas_read":
            canvas, version = state.canvas, state.canvasVersion
            if args["version"]:
                versions = self.repo.all(sid, "version", through=through)
                found = next((v for v in versions if v.data["version"] == args["version"]), None)
                if not found:
                    raise ValueError("Canvas version not found.")
                canvas, version = found.data["canvas"], found.data["version"]
            from chorus.services.canvas import heading_paths
            return {"canvas": canvas, "version": version, "paths": heading_paths(canvas, state.problem.statement)}
        if name == "board_write":
            if worker.postsUsed >= state.config.maxPostsPerTurn:
                raise ValueError("At most three board posts per agent turn.")
            text, mentions = board_text(args["text"], state.agents)
            record = Record(id="board:" + action_id, sequence=0, kind="board", agentId=actor, turn=turn, createdAt=now(), data={"text": text, "mentionedAgentIds": mentions, "actionId": action_id, "modelCallId": model_call_id})
            def change(s):
                s.boardCount += 1
                self.worker(s, actor).postsUsed += 1
            self.repo.change(sid, change, records=[record], generation=generation)
            return {"id": record.id, "sequence": record.sequence, "text": text}
        if name == "canvas_acquire_lock":
            return self.acquire(state, actor)
        if name == "canvas_release_lock":
            self.require_lease(state, actor, args["token"])
            self.clear(sid)
            return {"released": True}
        if name == "canvas_apply_edit":
            lease = self.require_lease(state, actor, args["token"])
            state = self.repo.get(sid)
            if args["baseVersion"] != state.canvasVersion:
                raise ValueError(f"Stale canvas version. Reread version {state.canvasVersion} before editing.")
            if worker.editsUsed >= 1:
                raise ValueError("At most one accepted canvas edit per agent turn.")
            if not 1 <= len(args["reason"].strip()) <= 400:
                raise ValueError("Supply a brief change reason, at most 400 characters.")
            operation = json.loads(args["operationJson"])
            canvas, _ = apply_edit(state.canvas, state.problem.statement, operation)
            if len(canvas) > 20000:
                raise ValueError("The canvas exceeds 20,000 characters.")
            if canvas == state.canvas:
                self.clear(sid)
                return {"unchanged": True, "version": state.canvasVersion}
            version = state.canvasVersion + 1
            change = Record(id="change:" + action_id, sequence=0, kind="change", agentId=actor, turn=turn, createdAt=now(), data={"beforeVersion": state.canvasVersion, "afterVersion": version, "beforeHash": hashlib.sha256(state.canvas.encode()).hexdigest(), "afterHash": hashlib.sha256(canvas.encode()).hexdigest(), "operation": operation, "reason": args["reason"], "diff": "".join(difflib.unified_diff(state.canvas.splitlines(True), canvas.splitlines(True))), "actionId": action_id, "modelCallId": model_call_id})
            saved = Record(id="version:" + action_id, sequence=0, kind="version", agentId=actor, turn=turn, createdAt=now(), data={"version": version, "canvas": canvas})
            def change_state(s):
                s.canvas, s.canvasVersion = canvas, version
                s.changeCount += 1
                self.worker(s, actor).editsUsed += 1
            self.repo.change(sid, change_state, records=[change, saved], generation=generation, required_lease=lease)
            self.clear(sid)
            return {"version": version, "changeId": change.id}
        if name == "agent_finish":
            if not 1 <= len(args["reason"].strip()) <= 400:
                raise ValueError("Supply a brief finish reason.")
            def finish(s):
                w = self.worker(s, actor)
                w.state, w.reason = "finished", args["reason"]
            self.repo.change(sid, finish, generation=generation)
            self.cleanup_actor(sid, actor)
            return {"finished": True}
        raise ValueError("Unknown tool.")

    def close(self):
        for sid in list(self.files):
            self.clear(sid)
        if self.temporary:
            self.temporary.cleanup()
