from __future__ import annotations
import asyncio
import json
from typing import Annotated, AsyncIterator, Literal
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse
from chorus.contracts import Catalog, Agent, Scenario, ModelInfo, SessionConfig, Snapshot, Command, Journal
from chorus.llm.transport import OllamaTransport
from chorus.services.errors import ChorusError
from chorus.services.sessions import SessionService

router = APIRouter(prefix="/api/v1")


def service(request: Request) -> SessionService:
    return request.app.state.service


Service = Annotated[SessionService, Depends(service)]


@router.get("/catalog", response_model=Catalog)
async def catalog(svc: Service) -> Catalog:
    return svc.catalog


@router.get("/agents", response_model=list[Agent])
async def agents(svc: Service, collection: str | None = None) -> list[Agent]:
    return [a for a in svc.catalog.agents if collection is None or a.collection == collection]


@router.get("/scenarios", response_model=list[Scenario])
async def scenarios(svc: Service, collection: str | None = None) -> list[Scenario]:
    return [s for s in svc.catalog.scenarios if collection is None or s.collection == collection]


@router.get("/models", response_model=list[ModelInfo])
async def models(svc: Service) -> list[ModelInfo]:
    installed = await svc.call.models() if isinstance(svc.call, OllamaTransport) else set()
    return [m.model_copy(update={"installed": m.id in installed}) for m in svc.catalog.models]


@router.post("/sessions", response_model=Snapshot, status_code=201)
async def create(config: SessionConfig, svc: Service) -> Snapshot:
    return svc.create(config)


@router.get("/sessions", response_model=list[Snapshot])
async def sessions(svc: Service) -> list[Snapshot]:
    return svc.store.list()


@router.get("/sessions/{session_id}", response_model=Snapshot)
async def session(session_id: str, svc: Service) -> Snapshot:
    return svc.store.get(session_id)


@router.post("/sessions/{session_id}/commands", response_model=Snapshot)
async def command(session_id: str, body: Command, svc: Service) -> Snapshot:
    return svc.command(session_id, body)


@router.get("/sessions/{session_id}/journals", response_model=list[Journal])
async def journals(session_id: str, svc: Service) -> list[Journal]:
    return svc.store.journals(session_id)


@router.get("/sessions/{session_id}/export")
async def export(session_id: str, svc: Service, format: Literal["markdown", "json"] = "markdown", includeJournals: bool = False) -> Response:
    snap = svc.store.get(session_id)
    if format == "markdown":
        return Response(snap.canvas, media_type="text/markdown", headers={"Content-Disposition": f'attachment; filename="{snap.id}.md"'})
    data = snap.model_dump(mode="json")
    if includeJournals:
        data["journals"] = [j.model_dump() for j in svc.store.journals(session_id)]
    return Response(json.dumps(data, ensure_ascii=False), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{snap.id}.json"'})


@router.get("/sessions/{session_id}/events", response_class=StreamingResponse)
async def events(session_id: str, request: Request, svc: Service, after: int = Query(default=-1, ge=-1)) -> StreamingResponse:
    svc.store.get(session_id)
    try:
        last = max(after, int(request.headers.get("last-event-id", "-1")))
    except ValueError:
        raise ChorusError("INVALID_REQUEST", "Invalid event cursor.", 400) from None
    async def stream() -> AsyncIterator[str]:
        cursor = last
        while not await request.is_disconnected():
            updates = svc.store.events(session_id, cursor)
            for snap in updates:
                cursor = snap.revision
                yield f"id: {cursor}\nevent: snapshot\ndata: {snap.model_dump_json()}\n\n"
            yield ": keepalive\n\n"
            await asyncio.sleep(0.3)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
