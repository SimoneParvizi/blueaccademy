import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from backend.app.schemas.health import HealthResponse
from backend.app.schemas.infra import (
    CheckMiniblueRequest,
    CheckMiniblueResponse,
    DeleteServerRequest,
    DeleteSSHKeyRequest,
    GenerateSSHKeypairResponse,
    OpenEditorRequest,
    OpenEditorResponse,
    ProvisionServerRequest,
    ProvisionServerResponse,
    RemoteCommandRequest,
    RemoteCommandResponse,
    RetrieveKubeconfigRequest,
    RetrieveKubeconfigResponse,
    ServerStatusResponse,
    SSHKeyResponse,
    UploadSSHKeyRequest,
)
from backend.app.services.infra.editor import ensure_openvscode_server
from backend.app.services.infra.hetzner import (
    HetznerAPIError,
    create_server,
    delete_server,
    delete_ssh_key,
    generate_ssh_keypair,
    get_server,
    upload_ssh_key,
)
from backend.app.services.infra.ssh import (
    retrieve_kubeconfig,
    run_host_diagnostics,
    run_remote_command,
)


# PUBLIC RELEASE CURRENTLY MOUNTS FLASHCARDS ROUTES ONLY
router = APIRouter(prefix="/infra", tags=["infra"])


@router.get("/health", response_model=HealthResponse)
async def infra_health() -> HealthResponse:
    return HealthResponse(service="infra")


@router.post("/ssh-keys/generate", response_model=GenerateSSHKeypairResponse)
async def generate_ssh_keys() -> GenerateSSHKeypairResponse:
    public_key, private_key = generate_ssh_keypair()
    return GenerateSSHKeypairResponse(public_key=public_key, private_key=private_key)


@router.post("/hetzner/ssh-keys", response_model=SSHKeyResponse)
async def create_hetzner_ssh_key(payload: UploadSSHKeyRequest) -> SSHKeyResponse:
    try:
        key_id = await upload_ssh_key(payload.token, payload.name, payload.public_key)
    except HetznerAPIError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc)})
    return SSHKeyResponse(id=key_id)


@router.delete("/hetzner/ssh-keys/{key_id}", response_model=HealthResponse)
async def remove_hetzner_ssh_key(key_id: int, payload: DeleteSSHKeyRequest) -> HealthResponse:
    try:
        await delete_ssh_key(payload.token, key_id)
    except HetznerAPIError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc)})
    return HealthResponse(service="infra")


@router.post("/hetzner/servers", response_model=ProvisionServerResponse)
async def provision_server(payload: ProvisionServerRequest) -> ProvisionServerResponse:
    try:
        server_id, server_ip = await create_server(
            payload.token,
            name=payload.name,
            server_type=payload.server_type,
            location=payload.location,
            ssh_key_ids=payload.ssh_key_ids,
        )
    except HetznerAPIError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc)})
    return ProvisionServerResponse(server_id=server_id, server_ip=server_ip)


@router.get("/hetzner/servers/{server_id}", response_model=ServerStatusResponse)
async def server_status(server_id: int, token: str) -> ServerStatusResponse:
    try:
        data = await get_server(token, server_id)
    except HetznerAPIError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc)})
    return ServerStatusResponse(**data)


@router.delete("/hetzner/servers/{server_id}", response_model=HealthResponse)
async def remove_server(server_id: int, payload: DeleteServerRequest) -> HealthResponse:
    try:
        await delete_server(payload.token, server_id)
    except HetznerAPIError as exc:
        return JSONResponse(status_code=502, content={"error": str(exc)})
    return HealthResponse(service="infra")


@router.post("/hosts/command", response_model=RemoteCommandResponse)
async def host_command(payload: RemoteCommandRequest) -> RemoteCommandResponse:
    result = await run_remote_command(payload.server_ip, payload.private_key, payload.command, payload.timeout_ms)
    return RemoteCommandResponse(**result)


@router.post("/hosts/diagnostics", response_model=RemoteCommandResponse)
async def host_diagnostics(payload: RetrieveKubeconfigRequest) -> RemoteCommandResponse:
    result = await run_host_diagnostics(payload.server_ip, payload.private_key)
    return RemoteCommandResponse(**result)


@router.post("/hosts/kubeconfig", response_model=RetrieveKubeconfigResponse)
async def host_kubeconfig(payload: RetrieveKubeconfigRequest) -> RetrieveKubeconfigResponse:
    kubeconfig = await retrieve_kubeconfig(payload.server_ip, payload.private_key)
    return RetrieveKubeconfigResponse(kubeconfig=kubeconfig)


@router.post("/hosts/miniblue/check", response_model=CheckMiniblueResponse)
async def miniblue_check(payload: CheckMiniblueRequest) -> CheckMiniblueResponse:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://{payload.server_ip}:{payload.port}/health")
        return CheckMiniblueResponse(ready=response.is_success)
    except httpx.HTTPError:
        return CheckMiniblueResponse(ready=False)


@router.post("/hosts/editor/open", response_model=OpenEditorResponse)
async def host_open_editor(payload: OpenEditorRequest) -> OpenEditorResponse:
    try:
        data = await ensure_openvscode_server(
            payload.server_ip,
            payload.private_key,
            miniblue_endpoint=payload.miniblue_endpoint,
            kubeconfig_content=payload.kubeconfig_content,
            port=payload.port,
        )
    except RuntimeError as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})
    return OpenEditorResponse(**data)
