from pydantic import BaseModel, Field


class GenerateSSHKeypairResponse(BaseModel):
    public_key: str
    private_key: str


class UploadSSHKeyRequest(BaseModel):
    token: str = Field(min_length=1)
    name: str = Field(min_length=1)
    public_key: str = Field(min_length=1)


class DeleteSSHKeyRequest(BaseModel):
    token: str = Field(min_length=1)


class SSHKeyResponse(BaseModel):
    id: int


class ProvisionServerRequest(BaseModel):
    token: str = Field(min_length=1)
    name: str = Field(min_length=1)
    server_type: str = Field(default="cx23")
    location: str = Field(default="nbg1")
    ssh_key_ids: list[int]


class ProvisionServerResponse(BaseModel):
    server_id: int
    server_ip: str


class ServerStatusResponse(BaseModel):
    server_id: int
    status: str
    server_ip: str | None = None


class DeleteServerRequest(BaseModel):
    token: str = Field(min_length=1)


class RemoteCommandRequest(BaseModel):
    server_ip: str
    private_key: str
    command: str
    timeout_ms: int = 60_000


class RemoteCommandResponse(BaseModel):
    stdout: str
    stderr: str
    code: int


class RetrieveKubeconfigRequest(BaseModel):
    server_ip: str
    private_key: str


class RetrieveKubeconfigResponse(BaseModel):
    kubeconfig: str


class CheckMiniblueRequest(BaseModel):
    server_ip: str
    port: int = 4566


class CheckMiniblueResponse(BaseModel):
    ready: bool


class OpenEditorRequest(BaseModel):
    server_ip: str
    private_key: str
    miniblue_endpoint: str
    kubeconfig_content: str | None = None
    port: int = 3000


class OpenEditorResponse(BaseModel):
    port: int
    token: str
    url: str
