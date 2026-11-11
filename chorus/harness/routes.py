"""Versioned harness HTTP API. Mutation tools are never exposed to browsers."""
import asyncio
import json
from importlib.resources import files
from typing import Literal
from fastapi import APIRouter, Request, Query
from fastapi.responses import Response, StreamingResponse
from chorus.harness.models import (
    ExperimentConfig, ExperimentTasks, HarnessCatalog, HarnessCommand, HarnessConfig,
    HarnessSnapshot, ModelInfo, Record, RecordPage, RepositoryFile, RepositoryTree, UsageReport,
)
from chorus.harness.accounting import usage_report
from chorus.harness.experiment_spec import checklist
from chorus.services.errors import ChorusError

router = APIRouter(prefix="/api/v2")


def service(request):
    return request.app.state.harness


@router.get("/catalog", response_model=HarnessCatalog)
async def catalog(request: Request):
    svc = service(request)
    return await current_catalog(svc, svc.catalog)


async def current_catalog(svc, catalog):
    models = await svc.call.model_infos() if hasattr(svc.call, "model_infos") else catalog.models
    infos = [ModelInfo.model_validate({k: v for k, v in m.model_dump().items() if k in ModelInfo.model_fields}) for m in models]
    return catalog.model_copy(update={"models": infos})


@router.get("/experiments/catalog", response_model=HarnessCatalog)
async def experiment_catalog(request: Request):
    svc = service(request)
    return await current_catalog(svc, svc.experiments.catalog)


@router.post("/experiments", response_model=HarnessSnapshot, status_code=201)
async def create_experiment(request: Request, config: ExperimentConfig):
    return service(request).experiments.create(config)


@router.get("/assets/{agent_id}/{asset}")
async def asset(request: Request, agent_id: str, asset: Literal["portrait.svg", "sprite.svg"]):
    if agent_id not in {a.id for a in service(request).catalog.agents}:
        raise ChorusError("NOT_FOUND", "Agent artwork not found.", 404)
    path = files("chorus.harness").joinpath("assets", agent_id + "-" + asset)
    if not path.is_file():
        raise ChorusError("NOT_FOUND", "Agent artwork not found.", 404)
    return Response(path.read_text(), media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})


@router.post("/sessions", response_model=HarnessSnapshot, status_code=201)
async def create(request: Request, config: HarnessConfig):
    return service(request).create(config)


@router.get("/sessions", response_model=list[HarnessSnapshot])
async def sessions(request: Request):
    return service(request).repo.list()


@router.get("/sessions/{sid}", response_model=HarnessSnapshot)
async def get(request: Request, sid: str):
    return service(request).repo.get(sid)


def repository_for(svc, sid, branch):
    experiment = svc.repo.get(sid).experiment
    if experiment is None or branch not in {"main", *(tree.branch for tree in experiment.repository.worktrees)}:
        raise ChorusError("NOT_FOUND", "Experiment branch not found.", 404)
    return svc.experiments.git


@router.get("/sessions/{sid}/repository/tree", response_model=RepositoryTree)
def repository_tree(request: Request, sid: str, branch: str = Query(default="main", max_length=90)):
    return repository_for(service(request), sid, branch).browse_tree(sid, branch)


@router.get("/sessions/{sid}/repository/file", response_model=RepositoryFile)
def repository_file(request: Request, sid: str, revision: str, path: str = Query(min_length=1, max_length=1024),
                    branch: str = Query(default="main", max_length=90)):
    return repository_for(service(request), sid, branch).browse_file(sid, branch, revision, path)


@router.get("/sessions/{sid}/agents/{agent_id}/tasks", response_model=ExperimentTasks)
def agent_tasks(request: Request, sid: str, agent_id: str):
    svc = service(request)
    state = svc.repo.get(sid)
    agent = next((agent for agent in state.agents if agent.id == agent_id), None)
    if state.experiment is None or agent is None:
        raise ChorusError("NOT_FOUND", "Agent task list not found.", 404)
    markdown = svc.experiments.spec.agent_tasks(state, agent)
    items = checklist(markdown)
    return ExperimentTasks(revision=state.canvasVersion, markdown=markdown,
                           completed=sum(done for _, done in items), total=len(items))


@router.post("/sessions/{sid}/commands", response_model=HarnessSnapshot)
async def command(request: Request, sid: str, command: HarnessCommand):
    return service(request).command(sid, command)


PRIVATE_DURING_EXPERIMENT = {"summary", "conversation", "tool", "request", "output"}


def visible(state, kind):
    return state.experiment is None or kind not in PRIVATE_DURING_EXPERIMENT or state.status in {"completed", "killed"}


@router.get("/sessions/{sid}/records", response_model=RecordPage)
async def records(request: Request, sid: str, kind: Literal["board", "summary", "change", "conversation", "call", "version", "activity", "diagnostic", "assessment", "tool", "request", "output", "vote", "plan_completion", "commit", "pr", "process"], after: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=100), agent: str | None = None):
    repo = service(request).repo
    state = repo.get(sid)
    if not visible(state, kind):
        return RecordPage(records=[], cursor=after, highWater=state.sequence, hasMore=False)
    return repo.page(sid, kind, after, limit, agent)


@router.get("/sessions/{sid}/records/{record_id}", response_model=Record)
async def record(request: Request, sid: str, record_id: str):
    svc = service(request)
    state = svc.repo.get(sid)
    value = svc.repo.record(sid, record_id)
    if value is None or not visible(state, value.kind):
        raise ChorusError("NOT_FOUND", "Evidence record not found.", 404)
    return value


@router.get("/sessions/{sid}/usage", response_model=UsageReport)
async def usage(request: Request, sid: str):
    return usage_report(service(request).repo, sid)


@router.get("/sessions/{sid}/export")
async def export(request: Request, sid: str, format: Literal["json", "markdown"] = "json"):
    svc = service(request)
    state = svc.repo.get(sid)
    headers = {"Content-Disposition": f'attachment; filename="{state.id}.{ "md" if format == "markdown" else "json"}"'}
    if format == "markdown":
        return Response(state.canvas, media_type="text/markdown", headers=headers)
    kinds = ("board", "summary", "change", "conversation", "call", "version", "activity", "diagnostic", "assessment", "tool", "command", "request", "output")
    if state.experiment is not None:
        kinds += ("vote", "plan_completion", "commit", "pr", "process")
    payload = {"session": state.model_dump(mode="json"), "records": {kind: [r.model_dump(mode="json") for r in svc.repo.all(sid, kind)] for kind in kinds if visible(state, kind)}, "usage": usage_report(svc.repo, sid).model_dump(mode="json")}
    return Response(json.dumps(payload, ensure_ascii=False), media_type="application/json", headers=headers)


@router.get("/sessions/{sid}/events", response_class=StreamingResponse)
async def events(request: Request, sid: str, after: int = Query(default=-1, ge=-1)):
    svc = service(request)
    svc.repo.get(sid)
    try:
        after = max(after, int(request.headers.get("last-event-id", "-1")))
    except ValueError:
        raise ChorusError("INVALID_REQUEST", "Invalid event cursor.", 400)
    async def stream():
        cursor = after
        while not await request.is_disconnected():
            # Stream the latest committed state immediately, even when a large
            # roster produced thousands of durable revisions between polls.
            # The independent record cursor retains the complete audit trail.
            snap = svc.repo.get(sid)
            if snap.revision > cursor:
                cursor = snap.revision
                yield f"id: {cursor}\nevent: snapshot\ndata: {snap.model_dump_json()}\n\n"
            else:
                yield ": keepalive\n\n"
            await asyncio.sleep(.3)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
