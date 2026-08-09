from pydantic import BaseModel, ConfigDict, Field


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    session_id: str = Field(alias="sessionId")
    role: str
    content: str
    created_at: int = Field(alias="createdAt")


class ClearChatHistoryResponse(BaseModel):
    ok: bool
