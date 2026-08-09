from pydantic import BaseModel, ConfigDict


class KubeconfigCreate(BaseModel):
    name: str
    content: str
    active: bool | None = None


class KubeconfigListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    active: bool
    createdAt: int


class KubeconfigCreateResponse(BaseModel):
    id: int
    name: str
    active: bool


class KubeconfigActivateResponse(BaseModel):
    ok: bool


class KubeconfigDeleteResponse(BaseModel):
    ok: bool
