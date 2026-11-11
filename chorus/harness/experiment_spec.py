"""Shared SPEC.md, fenced leases, and recoverable publication for experiments."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from difflib import unified_diff
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4

from chorus.harness.models import LeaseView, Record
from chorus.services.canvas import check_blocks, normalize, parser, sections
from chorus.services.errors import ChorusError
from chorus.storage import now


PRODUCT = ("SPEC.md", "Product specification")
TASKS = ("SPEC.md", "Task Distribution")
CHANGES = ("SPEC.md", "Change log")
PRODUCT_HISTORY = (*CHANGES, "Product specification history")
TASK_HISTORY = (*CHANGES, "Task history")
CHECKBOX = re.compile(r"^\[([ xX])\][ \t]+(\S.*)$", re.DOTALL)


def checklist(markdown, *, required=False):
    items = []
    tokens = parser.parse(markdown)
    for index, token in enumerate(tokens):
        if required and token.level == 0 and token.type not in {
            "bullet_list_open", "bullet_list_close", "ordered_list_open", "ordered_list_close",
        }:
            raise ValueError("Write deliverables as Markdown checklist items, such as '- [ ] Add task search'.")
        if token.type != "list_item_open":
            continue
        first, second = tokens[index + 1:index + 3]
        match = CHECKBOX.fullmatch(second.content) if first.type == "paragraph_open" and second.type == "inline" else None
        if match:
            items.append((normalize(match[2]), match[1].lower() == "x"))
        elif required:
            raise ValueError("Start every deliverable with a Markdown checkbox ('- [ ]' or '- [x]').")
    if required and (len(items) > 100 or len(dict(items)) != len(items)):
        raise ValueError("Use at most 100 deliverables with distinct descriptions.")
    return items


def _agent_heading(agent):
    return f"{agent.name} ({agent.id})"


def _bounds(document, path, headings=None):
    if headings is None:
        headings = sections(document)
    for index, heading in enumerate(headings):
        if tuple(heading.path) == path:
            following = next((item for item in headings[index + 1:] if item.depth <= heading.depth), None)
            return heading.heading_end, following.start if following else len(document)
    raise ValueError("The requested SPEC.md section does not exist.")


def _body(document, path, headings=None):
    start, end = _bounds(document, path, headings)
    return document[start:end].strip()


def _replace_body(document, path, replacement):
    start, end = _bounds(document, path)
    body = f"\n\n{replacement}" if replacement else ""
    separator = "\n\n" if end < len(document) else "\n"
    return document[:start] + body + separator + document[end:]


def _diff(before, after, path):
    label = " / ".join(path)
    return "\n".join(unified_diff(before.splitlines(), after.splitlines(), f"Previous {label}", f"Updated {label}", lineterm=""))


def _history_entry(revision, actor, reason, diff, at):
    escaped = re.sub(r"([\\`*_{}\[\]<>])", r"\\\1", reason)
    fence = "`" * max(3, max((len(run) + 1 for run in re.findall(r"`+", diff)), default=0))
    return f"**Revision {revision}** · `{actor}` · {at}\n\n> {escaped}\n\n{fence}diff\n{diff}\n{fence}"


class ExperimentSpec:
    def __init__(self, repo, authorize):
        self.repo = repo
        self.authorize = authorize

    def initialize(self, root, agents):
        root = Path(root)
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        headings = ["# SPEC.md", "## Product specification", "## Task Distribution"]
        headings.extend(f"### {_agent_heading(agent)}" for agent in agents)
        headings.extend(["## Change log", "### Product specification history", "### Task history"])
        headings.extend(f"#### {_agent_heading(agent)}" for agent in agents)
        document = "\n\n".join(headings) + "\n"
        with self._lockfile(root) as handle:
            self._publish(root, document)
            self._write_lockfile(handle, {})
        return document

    @staticmethod
    @contextmanager
    def _lockfile(root):
        # The physical mutex serializes publication and lease changes. The
        # durable lease fences the agent across calls, including model waits.
        path = Path(root) / "SPEC.md.lock"
        with os.fdopen(os.open(path, os.O_RDWR | os.O_CREAT, 0o600), "r+") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            yield handle

    @staticmethod
    def _write_lockfile(handle, lease):
        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps(lease) + "\n")
        handle.flush()

    @staticmethod
    def _publish(root, document):
        path = Path(root) / "SPEC.md"
        content = document.encode("utf-8")
        try:
            if path.read_bytes() == content:
                return
        except FileNotFoundError:
            pass
        with NamedTemporaryFile(dir=path.parent, prefix=".SPEC.md.", delete=False) as handle:
            temporary = Path(handle.name)
            try:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)

    @staticmethod
    def _expired(lease):
        return datetime.now(timezone.utc) >= datetime.fromisoformat(lease["expiresAt"])

    @staticmethod
    def _record(kind, actor, data, record_id=None):
        return Record(id=record_id or f"{kind}:{uuid4()}", sequence=0, kind=kind, agentId=actor, turn=0, createdAt=now(), data=data)

    def _clear(self, sid, handle, lease, reason=None, generation=None):
        records = [self._record("activity", lease["agentId"], {"status": "spec_lock_recovered", "reason": reason, "fencing": lease["fencing"], "specRevision": lease["revision"]})] if reason else []
        cleared = {"fencing": lease["fencing"]}

        def change(state):
            if generation is not None:
                self.authorize(state, lease["agentId"], True)
            state.lease = None

        self.repo.change(sid, change, records=records, lease=cleared, generation=generation, required_lease=lease if generation is not None else None)
        self._write_lockfile(handle, cleared)

    def cleanup(self, sid, root, actor=None, reason=None):
        with self._lockfile(root) as handle:
            state = self.repo.get(sid)
            self._publish(root, state.canvas)
            lease = self.repo.lease(sid)
            if lease.get("token") and (actor is None or lease["agentId"] == actor):
                self._clear(sid, handle, lease, reason)
            elif not lease.get("token"):
                self._write_lockfile(handle, lease)

    def recover(self, sid, root):
        """Replay the committed projection and revoke the failed worker's lease."""
        Path(root).mkdir(mode=0o700, parents=True, exist_ok=True)
        self.cleanup(sid, root, reason="Chorus restarted with an outstanding SPEC.md lock.")

    def expire(self, sid, root):
        with self._lockfile(root) as handle:
            lease = self.repo.lease(sid)
            if lease.get("token") and self._expired(lease):
                self._clear(sid, handle, lease, "The SPEC.md lease expired.")

    def read(self, sid, root, actor, generation):
        # A reader never waits for the file lock and reads the canonical
        # committed revision even if a previous file replacement failed.
        state = self.repo.get(sid)
        self.authorize(state, actor, False)
        record = self._record("activity", actor, {"status": "spec_read", "specRevision": state.canvasVersion})
        self.repo.change(sid, lambda current: self.authorize(current, actor, False), records=[record], generation=generation)
        return {"markdown": state.canvas, **self.projection(state)}

    @staticmethod
    def projection(state):
        headings = sections(state.canvas)
        return {
            "revision": state.canvasVersion,
            "product": _body(state.canvas, PRODUCT, headings),
            "tasks": {agent.id: _body(state.canvas, (*TASKS, _agent_heading(agent)), headings) for agent in state.agents},
        }

    @staticmethod
    def agent_tasks(state, agent):
        return _body(state.canvas, (*TASKS, _agent_heading(agent)))

    def acquire(self, sid, root, actor, generation):
        with self._lockfile(root) as handle:
            state = self.repo.get(sid)
            self.authorize(state, actor, True)
            self._check_generation(state, generation)
            self._publish(root, state.canvas)
            lease = self.repo.lease(sid)
            if lease.get("token"):
                if self._expired(lease):
                    self._clear(sid, handle, lease, "The SPEC.md lease expired.")
                elif lease["agentId"] == actor:
                    self._write_lockfile(handle, lease)
                    return self._lease_result(lease)
                else:
                    return {"busy": True, "holder": lease["agentId"], "expiresAt": lease["expiresAt"]}
            new_lease = {
                "agentId": actor,
                "token": str(uuid4()),
                "revision": state.canvasVersion,
                "generation": generation,
                "fencing": lease.get("fencing", 0) + 1,
                "expiresAt": self._new_expiry(state),
            }
            self._save_lease(sid, actor, generation, handle, new_lease)
            return self._lease_result(new_lease)

    @staticmethod
    def _check_generation(state, generation):
        if state.generation != generation:
            raise ChorusError("CANCELLED", "This operation no longer has publication authority.", 409)

    @staticmethod
    def _new_expiry(state):
        return (datetime.now(timezone.utc) + timedelta(seconds=state.config.leaseSeconds)).isoformat()

    @staticmethod
    def _lease_result(lease):
        return {key: lease[key] for key in ("agentId", "token", "revision", "expiresAt", "fencing")}

    def _save_lease(self, sid, actor, generation, handle, lease, required=None):
        def change(state):
            self.authorize(state, actor, True)
            state.lease = LeaseView(agentId=actor, expiresAt=lease["expiresAt"], fencing=lease["fencing"])

        self.repo.change(sid, change, generation=generation, lease=lease, required_lease=required)
        self._write_lockfile(handle, lease)

    def _require_lease(self, sid, actor, generation, token):
        lease = self.repo.lease(sid)
        if not token or lease.get("token") != token or lease.get("agentId") != actor or lease.get("generation") != generation or self._expired(lease):
            raise ChorusError("CONFLICT", "Missing, expired, or stale SPEC.md lock. Acquire a lock and reread SPEC.md.", 409)
        return lease

    def renew(self, sid, root, actor, generation, token):
        with self._lockfile(root) as handle:
            state = self.repo.get(sid)
            self.authorize(state, actor, True)
            lease = self._require_lease(sid, actor, generation, token)
            renewed = dict(lease, expiresAt=self._new_expiry(state))
            self._save_lease(sid, actor, generation, handle, renewed, required=lease)
            return self._lease_result(renewed)

    def release(self, sid, root, actor, generation, token):
        with self._lockfile(root) as handle:
            state = self.repo.get(sid)
            self.authorize(state, actor, True)
            self._check_generation(state, generation)
            lease = self._require_lease(sid, actor, generation, token)
            self._clear(sid, handle, lease, generation=generation)
            return {"released": True}

    def edit(self, sid, root, actor, generation, *, action_id, token, base_version, section, markdown, reason, task_owner=None, verification=""):
        with self._lockfile(root) as handle:
            state = self.repo.get(sid)
            self._check_generation(state, generation)
            self._publish(root, state.canvas)
            operation = {"section": section, "taskOwnerId": task_owner, "baseVersion": base_version, "markdown": markdown, "reason": reason}
            if verification:
                operation["verification"] = verification
            operation_hash = hashlib.sha256(json.dumps(operation, sort_keys=True).encode()).hexdigest()
            key = f"change:{action_id}"
            previous = self.repo.record(sid, key)
            if previous:
                self.authorize(state, actor, False)
                if previous.agentId != actor or previous.data.get("operationHash") != operation_hash:
                    raise ChorusError("CONFLICT", "This SPEC.md operation ID has already been used.", 409)
                return {"version": previous.data["afterVersion"], "changeId": key}

            self.authorize(state, actor, True)
            lease = self._require_lease(sid, actor, generation, token)
            if lease["revision"] != base_version or state.canvasVersion != base_version:
                raise ChorusError("CONFLICT", "SPEC.md changed. Reread the current revision before editing.", 409)
            path, history = self._paths(state, section, task_owner)
            markdown = markdown.replace("\r\n", "\n").replace("\r", "\n").strip()
            reason = " ".join(reason.split())
            if not 1 <= len(reason) <= 400:
                raise ValueError("Supply a SPEC.md change reason of up to 400 characters.")
            if len(markdown) > 100_000:
                raise ValueError("A SPEC.md section body may contain up to 100,000 characters.")
            check_blocks(markdown, allow_headings=True)
            if any(heading.depth <= len(path) for heading in sections(markdown)):
                raise ValueError("Headings inside this body must be below the section heading level.")
            before = _body(state.canvas, path)
            if state.experiment is not None and section == "tasks":
                self.validate_checklist_edit(state, actor, task_owner, before, markdown, verification)
            if markdown == before:
                return {"version": base_version, "unchanged": True}

            version = base_version + 1
            at = now()
            diff = _diff(before, markdown, path)
            document = _replace_body(state.canvas, path, markdown)
            history_body = _body(document, history)
            entry = _history_entry(version, actor, reason, diff, at)
            document = _replace_body(document, history, f"{history_body}\n\n{entry}".strip())
            record = self._record("change", actor, {
                "beforeVersion": base_version, "afterVersion": version, "reason": reason,
                "section": section, "taskOwnerId": task_owner, "diff": diff, "markdown": document,
                "actionId": action_id, "operationHash": operation_hash,
            }, key)
            if verification:
                record.data["verification"] = verification.strip()
            updated_lease = dict(lease, revision=version)

            def save(current):
                self.authorize(current, actor, True)
                if current.canvasVersion != base_version:
                    raise ChorusError("CONFLICT", "SPEC.md changed before the edit was committed.", 409)
                if section == "tasks" and state.experiment is not None and current.experiment.phase != state.experiment.phase:
                    raise ChorusError("CONFLICT", "The experiment phase changed. Reread the checklist before editing.", 409)
                current.canvas, current.canvasVersion = document, version
                current.changeCount += 1

            self.repo.change(sid, save, records=[record], generation=generation, lease=updated_lease, required_lease=lease)
            self._publish(root, document)
            self._write_lockfile(handle, updated_lease)
            return {"version": version, "changeId": key}

    @staticmethod
    def validate_checklist_edit(state, actor, owner, before, markdown, verification):
        previous = dict(checklist(before))
        updated = dict(checklist(markdown, required=True))
        newly_checked = [task for task, done in updated.items() if done and not previous.get(task)]
        if state.experiment.phase == "plan":
            if any(updated.values()):
                raise ValueError("Keep all checklist items open during Plan. Verify and check them off during Build.")
            return
        if actor != owner:
            raise ChorusError("FORBIDDEN", "During Build, edit only your own checklist. Suggest changes to peers on the board.", 403)
        if previous.keys() - updated.keys():
            raise ValueError("Keep existing deliverables in the Build checklist. Leave unfinished items open and explain them when finishing.")
        if newly_checked and (
            len(newly_checked) != 1 or newly_checked[0] not in previous or not verification.strip()
        ):
            raise ValueError("Check off one existing item per edit and state how you verified it in the verification field.")

    @staticmethod
    def _paths(state, section, task_owner):
        if section == "product" and task_owner is None:
            return PRODUCT, PRODUCT_HISTORY
        agent = next((agent for agent in state.agents if agent.id == task_owner), None)
        if section == "tasks" and agent is not None:
            heading = _agent_heading(agent)
            return (*TASKS, heading), (*TASK_HISTORY, heading)
        raise ValueError("Choose the product section or one selected participant's tasks.")
