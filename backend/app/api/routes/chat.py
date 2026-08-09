from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from backend.app.db.session import get_db
from backend.app.schemas.chat import ChatMessageRead, ClearChatHistoryResponse
from backend.app.services.chat import clear_chat_history, list_chat_history, stream_chat_events

<<<<<<< Updated upstream
# PUBLIC RELEASE CURRENTLY MOUNTS FLASHCARDS ROUTES ONLY
=======
>>>>>>> Stashed changes
router = APIRouter(tags=["chat"])


@router.get("/chat/stream")
async def stream_chat_route(
    db: Annotated[Session, Depends(get_db)],
    session_id: str = Query(default="default", alias="sessionId"),
    message: str | None = Query(default=None),
    context: str | None = Query(default=None),
) -> StreamingResponse:
    if not message:
        return JSONResponse(status_code=400, content={"error": "message is required"})
    return StreamingResponse(
        stream_chat_events(
            db,
            session_id=session_id,
            user_message=message,
            context=context,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/chat/history", response_model=list[ChatMessageRead])
async def get_chat_history_route(
    db: Annotated[Session, Depends(get_db)],
    session_id: str = Query(default="default", alias="sessionId"),
) -> list[ChatMessageRead]:
    return list_chat_history(db, session_id)


@router.delete("/chat/history", response_model=ClearChatHistoryResponse)
async def clear_chat_history_route(
    db: Annotated[Session, Depends(get_db)],
    session_id: str = Query(default="default", alias="sessionId"),
) -> ClearChatHistoryResponse:
    clear_chat_history(db, session_id)
    return ClearChatHistoryResponse(ok=True)
