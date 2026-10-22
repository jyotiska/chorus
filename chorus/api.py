from __future__ import annotations
from contextlib import asynccontextmanager
import os
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4
from fastapi import FastAPI, Request
from dotenv import load_dotenv

load_dotenv()
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.exceptions import HTTPException as HTTPError
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response
from chorus.contracts import APIError
from chorus.llm.transport import ModelCall, OllamaTransport
from chorus.routers.api import router
from chorus.services.catalog import load_catalog
from chorus.services.errors import ChorusError
from chorus.services.sessions import SessionService
from chorus.storage import Store


def create_app(database: str | None = None, call: ModelCall | None = None, *, pacing: float | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        store = Store(database or os.getenv("CHORUS_DB", str(Path.home() / ".local/share/chorus/sessions.sqlite3")))
        app.state.service = SessionService(store, load_catalog(), call or OllamaTransport(), pacing=pacing if pacing is not None else float(os.getenv("CHORUS_PACING", "1.8")))
        try:
            yield
        finally:
            await app.state.service.close()
            store.close()
    app = FastAPI(title="Chorus Platform", version="1.0.0", lifespan=lifespan, responses={400: {"model": APIError}, 409: {"model": APIError}, 502: {"model": APIError}})
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])
    allowed = {"http://localhost:43188", "http://127.0.0.1:43188", "http://localhost:43189", "http://127.0.0.1:43189", "http://localhost:43187", "http://127.0.0.1:43187"}
    allowed.update(x.strip() for x in os.getenv("CHORUS_ALLOWED_ORIGINS", "").split(",") if x.strip())
    @app.middleware("http")
    async def request_context(request: Request, next_handler: RequestResponseEndpoint) -> Response:
        request.state.request_id = str(uuid4())
        origin = request.headers.get("origin")
        if origin and origin not in allowed:
            return JSONResponse(APIError(error="Origin is not allowed.", code="FORBIDDEN", requestId=request.state.request_id).model_dump(), status_code=403)
        response = await next_handler(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response
    @app.exception_handler(ChorusError)
    async def platform_error(request: Request, error: ChorusError) -> JSONResponse:
        return JSONResponse(APIError(error=str(error), code=error.code, requestId=request.state.request_id).model_dump(), status_code=error.status)
    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(APIError(error="The request is incomplete or invalid.", code="INVALID_REQUEST", requestId=request.state.request_id).model_dump(), status_code=400)
    @app.exception_handler(HTTPError)
    async def http_error(request: Request, error: HTTPError) -> JSONResponse:
        return JSONResponse(APIError(error=str(error.detail), code="NOT_FOUND" if error.status_code == 404 else "INVALID_REQUEST", requestId=request.state.request_id).model_dump(), status_code=error.status_code)
    @app.exception_handler(Exception)
    async def internal_error(request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(APIError(error="Chorus could not complete this request.", code="GENERATION_FAILED", requestId=request.state.request_id).model_dump(), status_code=500)
    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "chorus"}
    app.include_router(router)
    return app


app = create_app()
