from urllib.parse import parse_qs

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from backend.app.db.session import local_db_session
from backend.app.db.orm.cluster_server import ClusterServer
from backend.app.db.orm.cluster_session import ClusterSession
from backend.app.services.shells import remote_shell_session, shared_shell_manager


# PUBLIC RELEASE CURRENTLY MOUNTS FLASHCARDS ROUTES ONLY
router = APIRouter(tags=["ws"])


@router.websocket("/ws/terminal")
async def terminal_websocket(websocket: WebSocket) -> None:
    db: Session = local_db_session()
    try:
        await shared_shell_manager.connect(websocket, db)
        while True:
            message = await websocket.receive_json()
            await shared_shell_manager.handle_message(websocket, db, message)
    except WebSocketDisconnect:
        await shared_shell_manager.disconnect(websocket)
    finally:
        db.close()


@router.websocket("/ws/e2e-terminal")
async def e2e_terminal_websocket(websocket: WebSocket) -> None:
    db: Session = local_db_session()
    try:
        query = parse_qs(websocket.scope.get("query_string", b"").decode("utf-8"))
        server_id = int(query.get("serverId", ["0"])[0] or "0")
        session_id_raw = query.get("sessionId", [None])[0]
        session_id = int(session_id_raw) if session_id_raw else None
        if not server_id:
            await websocket.accept()
            await websocket.send_json(
                {
                    "type": "snapshot",
                    "entries": [{"id": 1, "type": "error", "text": "serverId is required"}],
                }
            )
            await websocket.close()
            return

        server = db.get(ClusterServer, server_id)
        if server is None or not server.server_ip or not server.ssh_private_key or server.status != "ready":
            await websocket.accept()
            await websocket.send_json(
                {
                    "type": "snapshot",
                    "entries": [{"id": 1, "type": "error", "text": "Selected host is not ready."}],
                }
            )
            await websocket.close()
            return

        session = db.get(ClusterSession, session_id) if session_id is not None else None
        if session_id is not None and (
            session is None or session.cluster_server_id != server.id or session.status != "ready"
        ):
            await websocket.accept()
            await websocket.send_json(
                {
                    "type": "snapshot",
                    "entries": [{"id": 1, "type": "error", "text": "Selected sandbox session is not ready."}],
                }
            )
            await websocket.close()
            return

        await remote_shell_session(websocket, server=server, session=session)
    finally:
        db.close()
