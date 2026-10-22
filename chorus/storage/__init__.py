"""SQLite storage with a versioned initial migration and atomic session commits."""
from __future__ import annotations
from datetime import datetime, timezone
import fcntl
from pathlib import Path
from typing import Any
from sqlalchemy import JSON, Integer, String, ForeignKey, create_engine, select, update
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session
from sqlalchemy.pool import StaticPool
from chorus.contracts import Snapshot, Journal, Command
from chorus.services.errors import ChorusError


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class SchemaVersion(Base):
    __tablename__ = "schema_version"
    id: Mapped[int] = mapped_column(primary_key=True)


class SessionRow(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    operation: Mapped[str | None] = mapped_column(String, nullable=True)


class EventRow(Base):
    __tablename__ = "events"
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)


class JournalRow(Base):
    __tablename__ = "journals"
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    turn_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry: Mapped[dict[str, Any]] = mapped_column(JSON)


class CommandRow(Base):
    __tablename__ = "commands"
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    command_id: Mapped[str] = mapped_column(String, primary_key=True)
    command: Mapped[dict[str, Any]] = mapped_column(JSON)
    result: Mapped[dict[str, Any]] = mapped_column(JSON)


class Store:
    def __init__(self, path: str) -> None:
        self.lock: Any = None
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self.lock = open(path + ".lock", "a")
            try:
                fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                self.lock.close()
                raise RuntimeError("This database already has a Chorus runner. Connect to that service instead.") from None
        self.engine = create_engine("sqlite://" if path == ":memory:" else "sqlite:///" + path, connect_args={"check_same_thread": False}, **({"poolclass": StaticPool} if path == ":memory:" else {}))
        try:
            self.migrate()
        except Exception:
            self.close()
            raise

    def migrate(self) -> None:
        # Migration 1 is the initial schema. Later versions must supply an explicit
        # ordered upgrade here rather than changing existing tables via create_all.
        SchemaVersion.__table__.create(self.engine, checkfirst=True)
        with Session(self.engine) as db:
            version = db.scalar(select(SchemaVersion.id).order_by(SchemaVersion.id.desc()))
            if version not in (None, 1):
                raise RuntimeError("Unsupported Chorus database version.")
            if version is None:
                Base.metadata.create_all(self.engine)
                db.add(SchemaVersion(id=1))
                db.commit()

    def create(self, snapshot: Snapshot) -> Snapshot:
        data = snapshot.model_dump(mode="json")
        with Session(self.engine) as db, db.begin():
            db.add(SessionRow(id=snapshot.id, revision=0, snapshot=data, operation=None))
            db.flush()
            db.add(EventRow(session_id=snapshot.id, sequence=0, snapshot=data))
        return snapshot

    def get(self, session_id: str) -> Snapshot:
        with Session(self.engine) as db:
            row = db.get(SessionRow, session_id)
            if not row:
                raise ChorusError("NOT_FOUND", "Session not found.", 404)
            return Snapshot.model_validate(row.snapshot)

    def list(self) -> list[Snapshot]:
        with Session(self.engine) as db:
            return [Snapshot.model_validate(r.snapshot) for r in db.scalars(select(SessionRow).order_by(SessionRow.snapshot["updatedAt"].as_string().desc()))]

    def operation(self, session_id: str) -> str | None:
        with Session(self.engine) as db:
            row = db.get(SessionRow, session_id)
            return row.operation if row else None

    def prior_command(self, session_id: str, command: Command) -> Snapshot | None:
        with Session(self.engine) as db:
            row = db.get(CommandRow, (session_id, command.commandId))
            if row:
                if row.command != command.model_dump():
                    raise ChorusError("CONFLICT", "This command ID was already used with different input.", 409)
                return Snapshot.model_validate(row.result)
        return None

    def save(self, snapshot: Snapshot, expected: int, *, operation: str | None = None, expected_operation: str | None = None, command: Command | None = None, journal: Journal | None = None) -> Snapshot:
        candidate = snapshot.model_copy(update={"revision": expected + 1, "updatedAt": now()})
        data = candidate.model_dump(mode="json")
        with Session(self.engine) as db, db.begin():
            statement = update(SessionRow).where(SessionRow.id == candidate.id, SessionRow.revision == expected)
            if expected_operation is not None:
                statement = statement.where(SessionRow.operation == expected_operation)
            result = db.execute(statement.values(revision=candidate.revision, snapshot=data, operation=operation))
            if result.rowcount != 1:
                raise ChorusError("CONFLICT", "Session changed. Fetch its latest revision before retrying.", 409)
            db.add(EventRow(session_id=candidate.id, sequence=candidate.revision, snapshot=data))
            if journal is not None:
                db.add(JournalRow(session_id=candidate.id, turn_number=journal.turnNumber, entry=journal.model_dump()))
            if command:
                db.add(CommandRow(session_id=candidate.id, command_id=command.commandId, command=command.model_dump(), result=data))
        return candidate

    def journals(self, session_id: str) -> list[Journal]:
        self.get(session_id)
        with Session(self.engine) as db:
            rows = db.scalars(select(JournalRow).where(JournalRow.session_id == session_id).order_by(JournalRow.turn_number))
            return [Journal.model_validate(r.entry) for r in rows]

    def events(self, session_id: str, after: int) -> list[Snapshot]:
        with Session(self.engine) as db:
            rows = db.scalars(select(EventRow).where(EventRow.session_id == session_id, EventRow.sequence > after).order_by(EventRow.sequence))
            return [Snapshot.model_validate(r.snapshot) for r in rows]

    def close(self) -> None:
        self.engine.dispose()
        if self.lock:
            self.lock.close()
