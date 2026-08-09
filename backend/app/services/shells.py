from __future__ import annotations
import os
import asyncio
import base64
from collections.abc import AsyncIterator

import asyncssh
from fastapi import WebSocket
from sqlalchemy.orm import Session

from backend.app.db.orm.cluster_server import ClusterServer
from backend.app.db.orm.cluster_session import ClusterSession
from backend.app.db.orm.kubeconfig import Kubeconfig
from backend.app.services.terminal import (
    blocked_terminal_commands,
    ensure_terminal_tooling,
    expand_kubectl_alias,
    terminal_bin_dir,
    terminal_home,
    terminal_workspace,
)

TERMINAL_ENTRY_TYPES = {"prompt", "output", "error", "success", "info"}


def make_terminal_entry(entry_id: int, entry_type: str, text: str) -> dict:
    return {
        "id": entry_id,
        "type": entry_type if entry_type in TERMINAL_ENTRY_TYPES else "info",
        "text": text,
    }


def get_active_kubeconfig(db: Session) -> Kubeconfig | None:
    return db.query(Kubeconfig).filter_by(active=True).first()


def get_ready_cluster_server(db: Session) -> ClusterServer | None:
    return (
        db.query(ClusterServer)
        .filter(ClusterServer.status == "ready", ClusterServer.server_ip.is_not(None))
        .order_by(ClusterServer.id.asc())
        .first()
    )


class SharedShellManager:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._history: list[dict] = []
        self._max_entries = 500
        self._entry_id = 1
        self._process: asyncio.subprocess.Process | None = None
        self._stdout_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, db: Session) -> None:
        await websocket.accept()
        async with self._lock:
            if not self._history:
                self.reset_history(False)
            await self.ensure_shell(db)
            self._clients.add(websocket)
            await websocket.send_json({"type": "snapshot", "entries": self._history})

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(websocket)

    async def handle_message(self, websocket: WebSocket, db: Session, message: dict) -> None:
        kind = message.get("type")
        if kind == "clear":
            async with self._lock:
                self.reset_history(True)
            return
        if kind != "command":
            await self.push_entry("error", "Failed to parse terminal message.")
            return

        raw_command = str(message.get("command", "")).strip()
        if not raw_command:
            return
        command = expand_kubectl_alias(raw_command)
        if command == "clear":
            async with self._lock:
                self.reset_history(True)
            return

        await self.push_entry("prompt", f"$ {raw_command}")
        if any(blocked in command for blocked in blocked_terminal_commands):
            await self.push_entry("error", "This command is not allowed in the sandbox.")
            return

        await self.ensure_shell(db)
        if self._process is not None and self._process.stdin is not None:
            self._process.stdin.write(f"{command}\n".encode("utf-8"))
            await self._process.stdin.drain()

    def reset_history(self, broadcast_clear: bool) -> None:
        self._history.clear()
        if broadcast_clear:
            asyncio.create_task(self.broadcast({"type": "clear"}))
        self._append_history("info", f"BlueAccademy shared shell ready in {terminal_workspace}")
        self._append_history("info", "Footer terminal and Free Terminal share this session.")
        self._append_history(
            "info", "The workspace is temporary and is deleted when the backend stops."
        )

    def _append_history(self, entry_type: str, text: str) -> None:
        if not text:
            return
        entry = make_terminal_entry(self._entry_id, entry_type, text)
        self._entry_id += 1
        self._history.append(entry)
        if len(self._history) > self._max_entries:
            self._history.pop(0)

    async def push_entry(self, entry_type: str, text: str) -> None:
        if not text:
            return
        self._append_history(entry_type, text)
        await self.broadcast({"type": "entry", "entry": self._history[-1]})

    async def broadcast(self, payload: dict) -> None:
        dead: list[WebSocket] = []
        for client in self._clients:
            try:
                await client.send_json(payload)
            except Exception:
                dead.append(client)
        for client in dead:
            self._clients.discard(client)

    async def ensure_shell(self, db: Session) -> None:
        if self._process and self._process.returncode is None:
            await self.sync_shell_env(db)
            return

        ensure_terminal_tooling()
        shell_path = os.environ.get("SHELL", "/bin/zsh")
        shell_args = ["-l"] if shell_path.endswith("zsh") or shell_path.endswith("bash") else []
        env = dict(os.environ)
        env["HOME"] = terminal_home
        env["TERM"] = "xterm-256color"
        env["PATH"] = f"{terminal_bin_dir}:{env.get('PATH', '')}"
        self._process = await asyncio.create_subprocess_exec(
            shell_path,
            *shell_args,
            cwd=terminal_workspace,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._stdout_task = asyncio.create_task(self._read_stream(self._process.stdout, "output"))
        self._stderr_task = asyncio.create_task(self._read_stream(self._process.stderr, "error"))
        asyncio.create_task(self._watch_process())
        await self.sync_shell_env(db)

    async def _read_stream(self, stream: asyncio.StreamReader | None, entry_type: str) -> None:
        if stream is None:
            return
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                break
            await self.push_entry(entry_type, chunk.decode("utf-8", errors="replace"))

    async def _watch_process(self) -> None:
        if self._process is None:
            return
        code = await self._process.wait()
        await self.push_entry(
            "info",
            f"Shell session ended (code {code}). A new session will start on the next command.",
        )
        self._process = None

    async def sync_shell_env(self, db: Session) -> None:
        if (
            self._process is None
            or self._process.stdin is None
            or self._process.returncode is not None
        ):
            return
        active = get_active_kubeconfig(db)
        if active:
            kube_dir = os.path.join(terminal_workspace, ".kube")
            os.makedirs(kube_dir, exist_ok=True)
            kubeconfig_path = os.path.join(kube_dir, "config")
            with open(kubeconfig_path, "w", encoding="utf-8") as handle:
                handle.write(active.content)
            self._process.stdin.write(f'export KUBECONFIG="{kubeconfig_path}"\n'.encode("utf-8"))
        self._process.stdin.write(f'export PATH="{terminal_bin_dir}:$PATH"\n'.encode("utf-8"))
        ready_server = get_ready_cluster_server(db)
        if ready_server and ready_server.server_ip:
            endpoint = f"http://{ready_server.server_ip}:{ready_server.miniblue_port}"
            self._process.stdin.write(f'export MINIBLUE_ENDPOINT="{endpoint}"\n'.encode("utf-8"))
            self._process.stdin.write(f'export ARM_ENDPOINT="{endpoint}"\n'.encode("utf-8"))
        await self._process.stdin.drain()


shared_shell_manager = SharedShellManager()


async def sync_shared_shell_environment(db: Session) -> None:
    await shared_shell_manager.sync_shell_env(db)


async def remote_shell_session(
    websocket: WebSocket,
    *,
    server: ClusterServer,
    session: ClusterSession | None,
) -> None:
    await websocket.accept()
    await websocket.send_json({"type": "snapshot", "entries": []})

    async def push(entry_type: str, text: str, entry_id: list[int]) -> None:
        payload = {"type": "entry", "entry": make_terminal_entry(entry_id[0], entry_type, text)}
        entry_id[0] += 1
        await websocket.send_json(payload)

    entry_id = [1]
    await push("info", f"Connected to {server.name} ({server.server_ip})", entry_id)
    if session is not None:
        await push(
            "info",
            f"Sandbox session {session.session_id} active in namespace {session.namespace}",
            entry_id,
        )
    else:
        await push(
            "info", "No sandbox session selected. Commands run on the host environment.", entry_id
        )

    conn = await asyncssh.connect(
        server.server_ip,
        port=22,
        username="root",
        client_keys=[asyncssh.import_private_key(server.ssh_private_key or "")],
        known_hosts=None,
    )
    process = await conn.create_process(term_type="xterm")

    bootstrap_lines = [
        "export TERM=xterm-256color",
        "export KUBECONFIG=/etc/rancher/k3s/k3s.yaml",
        f'export MINIBLUE_ENDPOINT="http://127.0.0.1:{server.miniblue_port}"',
        f'export ARM_ENDPOINT="http://127.0.0.1:{server.miniblue_port}"',
    ]
    if session and session.kubeconfig_content:
        encoded = base64.b64encode(session.kubeconfig_content.encode("utf-8")).decode("ascii")
        bootstrap_lines.extend(
            [
                "mkdir -p /root/.blueaccademy",
                f"printf %s '{encoded}' | base64 -d > /root/.blueaccademy/session-{session.id}.kubeconfig",
                f"chmod 600 /root/.blueaccademy/session-{session.id}.kubeconfig",
                f"export KUBECONFIG=/root/.blueaccademy/session-{session.id}.kubeconfig",
            ]
        )
    bootstrap_lines.append('export PS1="\\u@${HOSTNAME%%.*}:\\w$ "')
    process.stdin.write("\n".join(bootstrap_lines) + "\n")

    async def stream_reader(reader: AsyncIterator[str], entry_type: str) -> None:
        async for chunk in reader:
            await push(entry_type, chunk, entry_id)

    stdout_task = asyncio.create_task(stream_reader(process.stdout, "output"))
    stderr_task = asyncio.create_task(stream_reader(process.stderr, "error"))

    try:
        while True:
            message = await websocket.receive_json()
            kind = message.get("type")
            if kind == "clear":
                await websocket.send_json({"type": "clear"})
                continue
            if kind != "command":
                await push("error", "Failed to parse terminal message.", entry_id)
                continue
            command = str(message.get("command", "")).strip()
            if not command:
                continue
            await push("prompt", f"$ {command}", entry_id)
            process.stdin.write(f"{command}\n")
        # unreachable
    except Exception:
        pass
    finally:
        stdout_task.cancel()
        stderr_task.cancel()
        process.stdin.write_eof()
        process.close()
        conn.close()
