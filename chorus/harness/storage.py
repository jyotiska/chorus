"""Normalized harness records sharing the existing single-owner SQLite store."""
from __future__ import annotations
from typing import Callable
from uuid import uuid4
from datetime import datetime, timezone
from sqlalchemy import JSON, Integer, String, Index, select, update
from sqlalchemy.orm import Mapped, mapped_column, Session
from chorus.storage import Base, now
from chorus.harness.models import HarnessSnapshot, Record, RecordPage
from chorus.services.errors import ChorusError


class HarnessSessionRow(Base):
    __tablename__ = "harness_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)


class HarnessRecordRow(Base):
    __tablename__ = "harness_records"
    session_id: Mapped[str] = mapped_column(String, primary_key=True)
    id: Mapped[str] = mapped_column(String, primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String)
    agent_id: Mapped[str] = mapped_column(String)
    record: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (Index("harness_record_cursor", "session_id", "kind", "sequence"), Index("harness_agent_records", "session_id", "agent_id", "kind", "sequence"))


class HarnessEventRow(Base):
    __tablename__ = "harness_events"
    session_id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    snapshot: Mapped[dict] = mapped_column(JSON)


class HarnessLeaseRow(Base):
    __tablename__ = "harness_leases"
    session_id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


TABLES = (HarnessSessionRow, HarnessRecordRow, HarnessEventRow, HarnessLeaseRow)


class Repository:
    def __init__(self, store):
        self.store, self.engine = store, store.engine

    def create(self, state: HarnessSnapshot) -> HarnessSnapshot:
        data = state.model_dump(mode="json")
        with Session(self.engine) as db, db.begin():
            db.add(HarnessSessionRow(id=state.id, revision=0, snapshot=data))
            db.add(HarnessEventRow(session_id=state.id, revision=0, snapshot=data))
        return state

    def get(self, session_id: str) -> HarnessSnapshot:
        with Session(self.engine) as db:
            row = db.get(HarnessSessionRow, session_id)
            if row is None:
                raise ChorusError("NOT_FOUND", "Harness session not found.", 404)
            return HarnessSnapshot.model_validate(row.snapshot)

    def list(self) -> list[HarnessSnapshot]:
        with Session(self.engine) as db:
            return [HarnessSnapshot.model_validate(r.snapshot) for r in db.scalars(select(HarnessSessionRow))]

    def change(self, session_id: str, mutate: Callable, *, records: list[Record] = (), generation: int | None = None, expected: int | None = None, lease: dict | None = None, required_lease: dict | None = None) -> HarnessSnapshot:
        with Session(self.engine) as db, db.begin():
            row = db.get(HarnessSessionRow, session_id)
            if row is None:
                raise ChorusError("NOT_FOUND", "Harness session not found.", 404)
            state = HarnessSnapshot.model_validate(row.snapshot)
            if expected is not None and expected != state.revision:
                raise ChorusError("CONFLICT", "Session changed. Fetch the latest revision.", 409)
            if generation is not None and (state.generation != generation or state.status not in {"running", "reviewing"}):
                raise ChorusError("CANCELLED", "This operation no longer has publication authority.", 409)
            if required_lease is not None:
                lease_row = db.get(HarnessLeaseRow, session_id)
                current = lease_row.data if lease_row else {}
                if any(current.get(k) != required_lease.get(k) for k in ("token", "agentId", "generation", "fencing")) or not current.get("token") or datetime.now(timezone.utc) >= datetime.fromisoformat(current["expiresAt"]) or current.get("generation") != state.generation:
                    raise ChorusError("CONFLICT", "Canvas lease expired or changed before commit. Reread and reacquire.", 409)
            mutate(state)
            for record in records:
                if db.get(HarnessRecordRow, (session_id, record.id)) is not None:
                    raise ChorusError("CONFLICT", "This action is already recorded.", 409)
                state.sequence += 1
                record.sequence = state.sequence
                db.add(HarnessRecordRow(session_id=session_id, id=record.id, sequence=record.sequence, kind=record.kind, agent_id=record.agentId, record=record.model_dump(mode="json")))
            if lease is not None:
                entry = db.get(HarnessLeaseRow, session_id)
                if entry is None:
                    db.add(HarnessLeaseRow(session_id=session_id, data=lease))
                else:
                    entry.data = lease
            old_revision = state.revision
            state.revision += 1
            state.updatedAt = now()
            data = state.model_dump(mode="json")
            result = db.execute(update(HarnessSessionRow).where(HarnessSessionRow.id == session_id, HarnessSessionRow.revision == old_revision).values(revision=state.revision, snapshot=data))
            if result.rowcount != 1:
                raise ChorusError("CONFLICT", "Concurrent state update; retry against current state.", 409)
            db.add(HarnessEventRow(session_id=session_id, revision=state.revision, snapshot=data))
        return state

    def append(self, session_id: str, kind: str, agent: str, turn: int, data: dict, *, generation=None, record_id=None) -> Record:
        record = Record(id=record_id or str(uuid4()), sequence=0, kind=kind, agentId=agent, turn=turn, createdAt=now(), data=data)
        self.change(session_id, lambda _: None, records=[record], generation=generation)
        return record

    def record(self, session_id: str, record_id: str) -> Record | None:
        with Session(self.engine) as db:
            row = db.get(HarnessRecordRow, (session_id, record_id))
            return Record.model_validate(row.record) if row else None

    def record_at_sequence(self, session_id: str, kind: str, sequence: int) -> Record | None:
        with Session(self.engine) as db:
            query = select(HarnessRecordRow).where(
                HarnessRecordRow.session_id == session_id, HarnessRecordRow.kind == kind,
                HarnessRecordRow.sequence == sequence,
            )
            row = db.scalars(query).one_or_none()
            return Record.model_validate(row.record) if row else None

    def update_record(self, session_id: str, record_id: str, data: dict) -> None:
        """Finalize an existing ledger row, even after cancellation; never republish it."""
        with Session(self.engine) as db, db.begin():
            row = db.get(HarnessRecordRow, (session_id, record_id))
            if row is None:
                raise ChorusError("NOT_FOUND", "Ledger record not found.", 404)
            record = Record.model_validate(row.record)
            record.data = data
            row.record = record.model_dump(mode="json")

    def page(self, session_id: str, kind: str, after: int = 0, limit: int = 50, agent: str | None = None, through: int | None = None) -> RecordPage:
        state = self.get(session_id)
        high = state.sequence if through is None else min(through, state.sequence)
        query = select(HarnessRecordRow).where(HarnessRecordRow.session_id == session_id, HarnessRecordRow.kind == kind, HarnessRecordRow.sequence > after, HarnessRecordRow.sequence <= high)
        if agent is not None:
            query = query.where(HarnessRecordRow.agent_id == agent)
        with Session(self.engine) as db:
            rows = list(db.scalars(query.order_by(HarnessRecordRow.sequence).limit(min(max(limit, 1), 100) + 1)))
        count = min(max(limit, 1), 100)
        items = [Record.model_validate(r.record) for r in rows[:count]]
        return RecordPage(records=items, cursor=items[-1].sequence if items else after, highWater=high, hasMore=len(rows) > count)

    def all(self, session_id: str, kind: str, agent: str | None = None, through: int | None = None) -> list[Record]:
        out, cursor = [], 0
        while True:
            page = self.page(session_id, kind, cursor, 100, agent, through)
            out.extend(page.records)
            if not page.hasMore:
                return out
            cursor = page.cursor

    def recent(self, session_id: str, kind: str, agent: str, limit: int = 100, *, before: int | None = None) -> list[Record]:
        with Session(self.engine) as db:
            query = select(HarnessRecordRow).where(
                HarnessRecordRow.session_id == session_id, HarnessRecordRow.kind == kind,
                HarnessRecordRow.agent_id == agent,
            )
            if before is not None:
                query = query.where(HarnessRecordRow.sequence < before)
            rows = list(db.scalars(query.order_by(HarnessRecordRow.sequence.desc()).limit(limit)))
            return [Record.model_validate(row.record) for row in reversed(rows)]

    def lease(self, session_id: str) -> dict:
        with Session(self.engine) as db:
            row = db.get(HarnessLeaseRow, session_id)
            return dict(row.data) if row else {}

    def events(self, session_id: str, after: int) -> list[HarnessSnapshot]:
        with Session(self.engine) as db:
            query = select(HarnessEventRow).where(HarnessEventRow.session_id == session_id, HarnessEventRow.revision > after).order_by(HarnessEventRow.revision).limit(100)
            return [HarnessSnapshot.model_validate(r.snapshot) for r in db.scalars(query)]
