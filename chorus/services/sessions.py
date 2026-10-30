from __future__ import annotations
import asyncio
import logging
import json
from uuid import uuid4
from chorus import ENGINE_VERSION
from chorus.contracts import Catalog, Command, FinalJudgement, Journal, SessionConfig, Snapshot, Turn, Work
from chorus.llm.transport import ModelCall, OPERATION_TIMEOUT
from chorus.services.catalog import resolve_config
from chorus.services.errors import ChorusError
from chorus.services.generation import bounded, run_turn, run_review, review_message
from chorus.services.prompts import count
from chorus.services.agent_state import apply_turn_state
from chorus.storage import Store, now

logger = logging.getLogger("chorus.sessions")


def next_work(session: Snapshot) -> Work | None:
    if session.status not in {"running", "reviewing"}:
        return None
    used = count(session)
    if session.endedEarly or used >= session.config.maxTurns:
        return Work(kind="final") if session.config.judgeEnabled and not session.finalJudgement else None
    if session.config.judgeEnabled and used > 0 and used % 5 == 0 and session.turns[-1].kind != "judge":
        return Work(kind="checkpoint")
    return Work(kind="turn", speakerId=session.agents[used % len(session.agents)].id)


class SessionService:
    def __init__(self, store: Store, catalog: Catalog, call: ModelCall, *, pacing: float = 1.8) -> None:
        self.store, self.catalog, self.call = store, catalog, call
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.model_slot = asyncio.Semaphore(1)
        self.pacing = pacing
        self.closing = False
        self.recover()

    def recover(self) -> None:
        for session in self.store.list():
            if session.status in {"running", "reviewing"} or session.pending:
                session.status = "paused"
                session.pending = None
                session.error = "Chorus restarted during execution. Resume to retry the interrupted work."
                session.errorCode = "RECOVERED"
                self.store.save(session, session.revision)

    def create(self, config: SessionConfig) -> Snapshot:
        scenario, agents = resolve_config(config, self.catalog)
        self.validate_model(config.model)
        config = config.model_copy(update={"participantIds": [a.id for a in agents]})
        return self.store.create(Snapshot(id=str(uuid4()), config=config, scenario=scenario, agents=agents, createdAt=now(), updatedAt=now()))

    def validate_model(self, model: str) -> None:
        if model not in {item.id for item in self.catalog.models}:
            raise ChorusError("MODEL_NOT_FOUND", "This session uses a retired model. Its saved work remains available; start a new session with a current model.", 409)
        validate = getattr(self.call, "validate_model", None)
        if validate is not None:
            validate(model)

    def command(self, session_id: str, command: Command) -> Snapshot:
        session = self.store.get(session_id)
        previous = self.store.prior_command(session_id, command)
        if previous:
            return previous
        if command.expectedRevision != session.revision:
            raise ChorusError("CONFLICT", "Session changed. Fetch its latest revision before retrying.", 409)
        if session.status in {"completed", "stopped"}:
            raise ChorusError("INVALID_STATE", "This session has ended.", 409)
        action = command.action
        if action in {"start", "resume"} or action == "stop" and session.config.judgeEnabled:
            self.validate_model(session.config.model)
        if action in {"start", "resume"}:
            if session.engineVersion != ENGINE_VERSION:
                raise ChorusError("VERSION_MISMATCH", "This session uses a different engine version. Keep its saved work and start a new session.", 409)
            if action == "start" and session.status != "ready" or action == "resume" and session.status != "paused":
                raise ChorusError("INVALID_STATE", "This command is not valid for the current session state.", 409)
            if session.errorCode == "CONTEXT_LIMIT":
                raise ChorusError("CONTEXT_LIMIT", "Start a shorter session; the complete history exceeds the context budget.", 409)
            if len(self.tasks) >= 64 and session_id not in self.tasks:
                raise ChorusError("CAPACITY", "The local execution queue is full. Try again after a session finishes.", 429)
            session.status = "reviewing" if session.endedEarly else "running"
        elif action == "pause":
            if session.status not in {"running", "reviewing"}:
                raise ChorusError("INVALID_STATE", "Only an executing session can be paused.", 409)
            session.status = "paused"
        elif action == "stop":
            if session.endedEarly or count(session) >= session.config.maxTurns:
                raise ChorusError("INVALID_STATE", "This session is already ending. Resume its pending review instead.", 409)
            session.endedEarly = True
            session.status = "reviewing" if session.config.judgeEnabled else "stopped"
        session.pending = None
        session.error, session.errorCode = "", None
        saved = self.store.save(session, session.revision, command=command)
        old = self.tasks.pop(session_id, None)
        if old:
            old.cancel()
        if next_work(saved):
            task = asyncio.create_task(self.run(session_id))
            self.tasks[session_id] = task
        return saved

    async def run(self, session_id: str) -> None:
        try:
            while not self.closing:
                async with self.model_slot:
                    session = self.store.get(session_id)
                    work = next_work(session)
                    if not work:
                        return
                    op = str(uuid4())
                    session.pending = work
                    session = self.store.save(session, session.revision, operation=op)
                    try:
                        journal = None
                        if work.kind == "turn":
                            speaker = next(a for a in session.agents if a.id == work.speakerId)
                            result = await bounded(run_turn(session, speaker, self.call), OPERATION_TIMEOUT)
                            used = count(session) + 1
                            turn = Turn(kind="skipped" if result.skipped else "agent", turnNumber=used, speakerId=speaker.id, speakerName=speaker.name, text=result.text, actions=["updated"] if result.updated and not result.skipped else [], tokenUsage=result.usage, latencySeconds=round(result.latency, 1))
                            session.turns.append(turn)
                            if not result.skipped:
                                session.canvas = result.canvas
                                turn.statChanges = apply_turn_state(session.agents, turn)
                                journal = Journal(agentId=speaker.id, turnNumber=used, text=result.journal, createdAt=now())
                            if used >= session.config.maxTurns:
                                session.status = "reviewing" if session.config.judgeEnabled else "completed"
                        else:
                            review, usage, latency = await bounded(run_review(session, work.kind == "final", self.call), OPERATION_TIMEOUT)
                            if isinstance(review, FinalJudgement):
                                session.finalJudgement = review
                                session.status = "stopped" if session.endedEarly else "completed"
                            else:
                                prior = next((t for t in reversed(session.turns) if t.kind == "judge"), None)
                                unchanged = prior and all(f in prior.text for f in review.improvements + review.nextPriorities)
                                text = ("Concerns unchanged after reviewing the current canvas.\n\n" if unchanged else "") + review_message(review)
                                session.turns.append(Turn(kind="judge", turnNumber=count(session), speakerId="judge", speakerName="Judge", text=text, tokenUsage=usage, latencySeconds=round(latency, 1)))
                        session.pending = None
                        committed = self.store.save(session, session.revision, expected_operation=op, journal=journal)
                        if work.kind == "turn":
                            logger.info(json.dumps({"event": "slot_committed" if result.skipped else "turn_committed", "sessionId": session_id, "operationId": op, "runId": result.run_id, "revision": committed.revision, "canvasOperation": result.operation, "preservedReason": result.preserved_reason}))
                    except ChorusError as error:
                        if error.code == "CONFLICT":
                            return
                        session = self.store.get(session_id)
                        if self.store.operation(session_id) != op:
                            return
                        session.pending = None
                        session.status, session.error, session.errorCode = "paused", str(error), error.code
                        self.store.save(session, session.revision, expected_operation=op)
                        return
                following = next_work(self.store.get(session_id))
                if not following:
                    return
                if following.kind == "turn":
                    await asyncio.sleep(self.pacing)
        except asyncio.CancelledError:
            return
        except Exception as failure:
            logger.error("Session execution failed (%s)", type(failure).__name__)
            session = self.store.get(session_id)
            if self.tasks.get(session_id) is asyncio.current_task():
                session.status, session.pending = "paused", None
                session.error, session.errorCode = "Session execution failed. Saved work is preserved; Resume to retry.", "GENERATION_FAILED"
                self.store.save(session, session.revision)
        finally:
            if self.tasks.get(session_id) is asyncio.current_task():
                self.tasks.pop(session_id, None)

    async def close(self) -> None:
        self.closing = True
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.recover()
