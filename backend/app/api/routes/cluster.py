import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

<<<<<<< Updated upstream
=======
from backend.app.db.orm.cluster_server import ClusterServer
from backend.app.db.orm.cluster_session import ClusterSession
>>>>>>> Stashed changes
from backend.app.db.session import get_db
from backend.app.schemas.cluster import (
    ClusterDeleteResponse,
    ClusterProvisionRequest,
    ClusterServerDebugRead,
    ClusterServerRead,
    ClusterServerStatusRead,
    ClusterSessionCreateRequest,
    ClusterSessionCreateResponse,
    ClusterSessionRead,
    OpenEditorRequest,
    OpenEditorResponse,
)
from backend.app.services.cluster import (
    ClusterNotReadyError,
    EditorStartupError,
    create_cluster_session,
    destroy_server,
    destroy_session,
    get_cluster_server_debug,
    get_cluster_server_status,
    get_clusters,
    list_clusters,
    open_cluster_editor,
    provision_cluster_server,
    provision_session,
    serialize_cluster_server,
    serialize_cluster_session,
)

<<<<<<< Updated upstream

# PUBLIC RELEASE CURRENTLY MOUNTS FLASHCARDS ROUTES ONLY
=======
>>>>>>> Stashed changes
router = APIRouter(tags=["cluster"])


def parse_not_found_id(raw_value: str) -> int | JSONResponse:
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        return JSONResponse(status_code=404, content={"error": "Not found"})


@router.post("/cluster/provision", response_model=ClusterServerRead)
async def provision_cluster_route(
    payload: ClusterProvisionRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ClusterServerRead:
    if not payload.name or not payload.hetzner_token:
        return JSONResponse(
            status_code=400,
            content={"error": "name and hetznerToken are required"},
        )
    try:
        cluster = await provision_cluster_server(
            db,
            name=payload.name,
            hetzner_token=payload.hetzner_token,
            server_type=payload.server_type,
            location=payload.location,
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": "Provisioning failed", "detail": str(exc)},
        )
    return serialize_cluster_server(cluster)


@router.get("/cluster/servers", response_model=list[ClusterServerRead])
async def list_cluster_servers_route(
    db: Annotated[Session, Depends(get_db)],
) -> list[ClusterServerRead]:
    return [serialize_cluster_server(cluster) for cluster in list_clusters(db, ClusterServer)]


@router.get("/cluster/servers/{cluster_id}/status", response_model=ClusterServerStatusRead)
async def get_cluster_server_status_route(
    cluster_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ClusterServerStatusRead:
    parsed_cluster_id = parse_not_found_id(cluster_id)
    if isinstance(parsed_cluster_id, JSONResponse):
        return parsed_cluster_id
    status = await get_cluster_server_status(db, parsed_cluster_id)
    if status is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return status


@router.get("/cluster/servers/{cluster_id}/debug", response_model=ClusterServerDebugRead)
async def get_cluster_server_debug_route(
    cluster_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ClusterServerDebugRead:
    parsed_cluster_id = parse_not_found_id(cluster_id)
    if isinstance(parsed_cluster_id, JSONResponse):
        return parsed_cluster_id
    try:
        debug = await get_cluster_server_debug(db, parsed_cluster_id)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": "debug failed", "detail": str(exc) or "remote debug failed"},
        )
    if debug is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return debug


@router.post("/cluster/servers/{cluster_id}/open-editor", response_model=OpenEditorResponse)
async def open_cluster_editor_route(
    cluster_id: str,
    payload: OpenEditorRequest,
    db: Annotated[Session, Depends(get_db)],
) -> OpenEditorResponse:
    parsed_cluster_id = parse_not_found_id(cluster_id)
    if isinstance(parsed_cluster_id, JSONResponse):
        return parsed_cluster_id
    try:
        editor = await open_cluster_editor(db, parsed_cluster_id, payload.session_id)
    except ClusterNotReadyError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": "cluster server is not ready", "status": str(exc)},
        )
    except EditorStartupError as exc:
        return JSONResponse(
            status_code=500,
            content={
                "error": "editor startup failed",
                "detail": str(exc) or "Could not start OpenVSCode Server",
            },
        )
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})
    except LookupError as exc:
        detail = str(exc)
        if detail == "no ready sandbox session is available":
            return JSONResponse(
                status_code=400,
                content={
                    "error": "no ready sandbox session is available",
                    "detail": "Create a sandbox session first so the editor targets the virtual cluster instead of the host cluster.",
                },
            )
        return JSONResponse(status_code=400, content={"error": detail})
    if editor is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return {"url": editor["url"], "port": editor["port"]}


@router.delete("/cluster/servers/{cluster_id}", response_model=ClusterDeleteResponse)
async def delete_cluster_server_route(
    cluster_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ClusterDeleteResponse:
    parsed_cluster_id = parse_not_found_id(cluster_id)
    if isinstance(parsed_cluster_id, JSONResponse):
        return parsed_cluster_id
    cluster = get_clusters(db, parsed_cluster_id, ClusterServer)
    if cluster is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    try:
        await destroy_server(db, cluster)
        return {"ok": True}
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": "Cleanup failed", "detail": str(exc)},
        )


@router.post("/cluster/sessions", response_model=ClusterSessionCreateResponse)
async def create_cluster_session_route(
    payload: ClusterSessionCreateRequest,
    db: Annotated[Session, Depends(get_db)],
) -> ClusterSessionCreateResponse:
    if not payload.cluster_server_id:
        return JSONResponse(status_code=400, content={"error": "clusterServerId is required"})
    try:
        session = await create_cluster_session(
            db,
            cluster_server_id=payload.cluster_server_id,
            ttl_hours=payload.ttl_hours,
        )
    except LookupError as exc:
        detail = str(exc)
        if detail == "cluster server not found":
            return JSONResponse(status_code=404, content={"error": detail})
        raise
    except ClusterNotReadyError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": "cluster server is not ready", "status": str(exc)},
        )

    asyncio.create_task(provision_session(session.id))
    return {
        "id": session.id,
        "sessionId": session.session_id,
        "namespace": session.namespace,
        "status": session.status,
        "expiresAt": session.expires_at,
    }


@router.get("/cluster/sessions", response_model=list[ClusterSessionRead])
async def list_cluster_sessions_route(
    db: Annotated[Session, Depends(get_db)],
) -> list[ClusterSessionRead]:
    return [serialize_cluster_session(session) for session in list_clusters(db, ClusterSession)]


@router.get("/cluster/sessions/{session_id}", response_model=ClusterSessionRead)
async def get_cluster_session_route(
    session_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ClusterSessionRead:
    parsed_session_id = parse_not_found_id(session_id)
    if isinstance(parsed_session_id, JSONResponse):
        return parsed_session_id
    session = get_clusters(db, parsed_session_id, ClusterSession)
    if session is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    return serialize_cluster_session(session, include_kubeconfig=True)


@router.delete("/cluster/sessions/{session_id}", response_model=ClusterDeleteResponse)
async def delete_cluster_session_route(
    session_id: str,
    db: Annotated[Session, Depends(get_db)],
) -> ClusterDeleteResponse:
    parsed_session_id = parse_not_found_id(session_id)
    if isinstance(parsed_session_id, JSONResponse):
        return parsed_session_id
    session = get_clusters(db, parsed_session_id, ClusterSession)
    if session is None:
        return JSONResponse(status_code=404, content={"error": "Not found"})
    try:
        await destroy_session(db, session)
        db.delete(session)
        db.commit()
        return {"ok": True}
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"error": "destroy failed", "detail": str(exc)},
        )
