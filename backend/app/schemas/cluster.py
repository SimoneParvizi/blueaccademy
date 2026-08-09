from pydantic import BaseModel, Field


class ClusterProvisionRequest(BaseModel):
    name: str
    hetzner_token: str = Field(alias="hetznerToken")
    server_type: str | None = Field(default=None, alias="serverType")
    location: str | None = None


class ClusterServerRead(BaseModel):
    id: int
    name: str
    server_id: str | None = Field(alias="serverId", default=None)
    server_ip: str | None = Field(alias="serverIp", default=None)
    status: str
    error_message: str | None = Field(alias="errorMessage", default=None)
    server_type: str = Field(alias="serverType")
    location: str
    kubeconfig_id: int | None = Field(alias="kubeconfigId", default=None)
    miniblue_port: int = Field(alias="minibluePort")
    idle_started_at: int | None = Field(alias="idleStartedAt", default=None)
    created_at: int = Field(alias="createdAt")


class ClusterServerStatusRead(BaseModel):
    id: int
    status: str
    server_ip: str | None = Field(alias="serverIp", default=None)
    k3s_ready: bool = Field(alias="k3sReady")
    miniblue_ready: bool = Field(alias="miniblueReady")
    error_message: str | None = Field(alias="errorMessage", default=None)


class ClusterServerDebugRead(BaseModel):
    ok: bool
    stdout: str
    stderr: str
    code: int


class OpenEditorRequest(BaseModel):
    session_id: int | None = Field(default=None, alias="sessionId")


class OpenEditorResponse(BaseModel):
    url: str
    port: int


class ClusterDeleteResponse(BaseModel):
    ok: bool


class ClusterSessionCreateRequest(BaseModel):
    cluster_server_id: int = Field(alias="clusterServerId")
    ttl_hours: int | None = Field(default=None, alias="ttlHours")


class ClusterSessionRead(BaseModel):
    id: int
    session_id: str = Field(alias="sessionId")
    cluster_server_id: int = Field(alias="clusterServerId")
    namespace: str
    status: str
    node_port: int | None = Field(alias="nodePort", default=None)
    error_message: str | None = Field(alias="errorMessage", default=None)
    expires_at: int = Field(alias="expiresAt")
    created_at: int = Field(alias="createdAt")
    kubeconfig_content: str | None = Field(alias="kubeconfigContent", default=None)


class ClusterSessionCreateResponse(BaseModel):
    id: int
    session_id: str = Field(alias="sessionId")
    namespace: str
    status: str
    expires_at: int = Field(alias="expiresAt")
