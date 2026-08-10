import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError

from backend.app.api.routes.decks import router as decks_router
from backend.app.api.routes.health import router as health_router
from backend.app.api.routes.infra import router as infra_router
from backend.app.api.routes.kubeconfigs import router as kubeconfigs_router
from backend.app.api.routes.terminal import router as terminal_router
from backend.app.api.routes.ws import router as ws_router
from backend.app.config import get_settings
from backend.app.logging import configure_logging
from backend.app.services.cluster import cluster_cleanup_loop
from backend.app.services.terminal import cleanup_terminal_workspace, ensure_terminal_tooling

settings = get_settings()
configure_logging()
logger = logging.getLogger(__name__)

project_root = Path(__file__).resolve().parents[2]
frontend_build_dir = project_root / "dist" / "public"
landing_dir = project_root / "frontend" / "landing"


@asynccontextmanager
async def setup_and_cleanup(api: FastAPI) -> AsyncGenerator[None, Any]:
    ensure_terminal_tooling()
    api.state.stop_flag = asyncio.Event()
    api.state.cluster_cleanup_task = asyncio.create_task(cluster_cleanup_loop(api.state.stop_flag))
    try:
        yield
    finally:
        api.state.stop_flag.set()
        await api.state.cluster_cleanup_task
        cleanup_terminal_workspace()  # TODO: to check later


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    openapi_url="/openapi.json",
    lifespan=setup_and_cleanup,
    license_info={
        "name": "GNU Affero General Public License v3.0 or later",
        "url": "https://www.gnu.org/licenses/agpl-3.0.html",
    },
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(OperationalError)
async def database_operational_error_handler(
    request: Request,
    exc: OperationalError,
) -> JSONResponse:
    logger.warning(
        "Database connection unavailable during %s %s",
        request.method,
        request.url.path,
        exc_info=exc,
    )
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database connection unavailable. Start Postgres before loading this data.",
        },
    )


app.include_router(health_router, prefix="/api/v1")
app.include_router(decks_router, prefix="/api/v1")

if settings.enable_more:
    app.include_router(infra_router, prefix="/api/v1")
    app.include_router(kubeconfigs_router, prefix="/api/v1")
    app.include_router(terminal_router, prefix="/api/v1")
    app.include_router(ws_router)

if Path(landing_dir).exists():
    app.mount("/landing", StaticFiles(directory=landing_dir, html=True), name="landing")

if Path(frontend_build_dir / "assets").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=frontend_build_dir / "assets"),
        name="frontend-assets",
    )


# TODO: get a favicon
@app.get("/favicon.png", include_in_schema=False, response_model=None)
async def favicon() -> FileResponse | PlainTextResponse:
    candidate = frontend_build_dir / "favicon.png"
    if candidate.exists():
        return FileResponse(candidate)
    return PlainTextResponse("Not Found", status_code=404)


@app.get("/", include_in_schema=False, response_model=None)
@app.get("/{full_path:path}", include_in_schema=False, response_model=None)
async def catch_all(full_path: str = "") -> FileResponse | PlainTextResponse:
    #   - explain main.py top to bottom without reading comments
    #   - explain why catch_all() exists
    #   - explain the difference between /, /{full_path:path}, app.mount(...), and include_router(...)
    if full_path.startswith(("api/", "ws/", "docs", "redoc", "openapi.json", "landing")):
        return PlainTextResponse("Not Found", status_code=404)

    if not frontend_build_dir.exists():
        return PlainTextResponse(
            "blueaccademy API is running but frontend is not.",
            status_code=200,
        )

    requested_path = frontend_build_dir / full_path
    if full_path and requested_path.is_file():
        return FileResponse(requested_path)

    index_file = frontend_build_dir / "index.html"
    if index_file.exists():
        return FileResponse(index_file)

    return PlainTextResponse("Frontend build not found", status_code=404)
