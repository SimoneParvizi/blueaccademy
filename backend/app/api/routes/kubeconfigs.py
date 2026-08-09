from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.schemas.kubeconfig import (
    KubeconfigActivateResponse,
    KubeconfigCreate,
    KubeconfigCreateResponse,
    KubeconfigDeleteResponse,
    KubeconfigListItem,
)
from backend.app.services.kubeconfigs import (
    KubeconfigValidationError,
    activate_kubeconfig,
    create_kubeconfig,
    delete_kubeconfig,
    list_kubeconfigs,
)
from backend.app.services.shells import sync_shared_shell_environment

router = APIRouter(tags=["kubeconfigs"])


# PUBLIC RELEASE CURRENTLY MOUNTS FLASHCARDS ROUTES ONLY
@router.get("/kubeconfigs", response_model=list[KubeconfigListItem])
async def get_kubeconfigs(
    db: Annotated[Session, Depends(get_db)],
) -> list[KubeconfigListItem]:
    kubeconfigs = list_kubeconfigs(db)
    return [
        KubeconfigListItem(
            id=item.id,
            name=item.name,
            active=item.active,
            createdAt=item.created_at,
        )
        for item in kubeconfigs
    ]


@router.post("/kubeconfigs", response_model=KubeconfigCreateResponse)
async def post_kubeconfig(
    payload: KubeconfigCreate,
    db: Annotated[Session, Depends(get_db)],
) -> KubeconfigCreateResponse:
    if not payload.name or not payload.content:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "name and content are required"},
        )
    try:
        kubeconfig = create_kubeconfig(db, payload)
    except KubeconfigValidationError as exc:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": str(exc), "detail": exc.detail},
        )
    await sync_shared_shell_environment(db)
    return KubeconfigCreateResponse(id=kubeconfig.id, name=kubeconfig.name, active=kubeconfig.active)


@router.patch("/kubeconfigs/{kubeconfig_id}/activate", response_model=KubeconfigActivateResponse)
async def patch_kubeconfig_activate(
    kubeconfig_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> KubeconfigActivateResponse:
    activated = activate_kubeconfig(db, kubeconfig_id)
    if not activated:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"error": "Kubeconfig not found"})
    await sync_shared_shell_environment(db)
    return KubeconfigActivateResponse(ok=True)


@router.delete("/kubeconfigs/{kubeconfig_id}", response_model=KubeconfigDeleteResponse)
async def delete_kubeconfig_route(
    kubeconfig_id: int,
    db: Annotated[Session, Depends(get_db)],
) -> KubeconfigDeleteResponse:
    deleted = delete_kubeconfig(db, kubeconfig_id)
    if not deleted:
        return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={"error": "Kubeconfig not found"})
    return KubeconfigDeleteResponse(ok=True)
