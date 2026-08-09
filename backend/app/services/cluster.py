from __future__ import annotations

import asyncio
import secrets
from typing import Any, TypeVar

import httpx
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from backend.app.db.session import local_db_session
from backend.app.db.orm.cluster_server import ClusterServer
from backend.app.db.orm.cluster_session import ClusterSession
from backend.app.db.orm.kubeconfig import Kubeconfig
from backend.app.services.infra.editor import ensure_openvscode_server
from backend.app.services.infra.hetzner import (
    create_server as hetzner_create_server,
)
from backend.app.services.infra.hetzner import (
    delete_server as hetzner_delete_server,
)
from backend.app.services.infra.hetzner import (
    delete_ssh_key,
    generate_ssh_keypair,
    upload_ssh_key,
)
from backend.app.services.infra.hetzner import (
    get_server as hetzner_get_server,
)
from backend.app.services.infra.ssh import (
    retrieve_kubeconfig,
    run_host_diagnostics,
    run_remote_command,
)
from backend.app.services.shells import sync_shared_shell_environment
from backend.app.services.utils import now_ms

DEFAULT_SESSION_TTL_HOURS = 3
IDLE_SERVER_TTL_MS = 30 * 60 * 1000
Cluster = TypeVar("Cluster")


class ClusterNotReadyError(RuntimeError):
    pass


class EditorStartupError(RuntimeError):
    pass


async def _try(coroutine: Any) -> Any | None:
    try:
        return coroutine()
    except Exception:
        pass

def build_session_hardening_manifest(namespace: str, server_ip: str) -> str:
    return f"""
apiVersion: v1
kind: ResourceQuota
metadata:
  name: session-quota
  namespace: {namespace}
spec:
  hard:
    requests.cpu: "2"
    requests.memory: "2Gi"
    limits.cpu: "4"
    limits.memory: "4Gi"
    pods: "20"
    persistentvolumeclaims: "3"
    services.nodeports: "2"
    services.loadbalancers: "0"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: session-limits
  namespace: {namespace}
spec:
  limits:
    - type: Container
      default:
        cpu: "500m"
        memory: "256Mi"
      defaultRequest:
        cpu: "100m"
        memory: "64Mi"
      max:
        cpu: "1"
        memory: "1Gi"
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: session-isolation
  namespace: {namespace}
spec:
  podSelector: {{}}
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector: {{}}
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {namespace}
  egress:
    - to:
        - podSelector: {{}}
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {namespace}
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
    - to:
        - ipBlock:
            cidr: {server_ip}/32
      ports:
        - protocol: TCP
          port: 4566
        - protocol: TCP
          port: 4567
""".strip()


def serialize_cluster_server(cluster: ClusterServer) -> dict:
    return {
        "id": cluster.id,
        "name": cluster.name,
        "serverId": cluster.server_id,
        "serverIp": cluster.server_ip,
        "status": cluster.status,
        "errorMessage": cluster.error_message,
        "serverType": cluster.server_type,
        "location": cluster.location,
        "kubeconfigId": cluster.kubeconfig_id,
        "minibluePort": cluster.miniblue_port,
        "idleStartedAt": cluster.idle_started_at,
        "createdAt": cluster.created_at,
    }


def serialize_cluster_session(session: ClusterSession, *, include_kubeconfig: bool = False) -> dict:
    return {
        "id": session.id,
        "sessionId": session.session_id,
        "clusterServerId": session.cluster_server_id,
        "namespace": session.namespace,
        "status": session.status,
        "nodePort": session.node_port,
        "errorMessage": session.error_message,
        "expiresAt": session.expires_at,
        "createdAt": session.created_at,
        "kubeconfigContent": session.kubeconfig_content
        if include_kubeconfig and session.status == "ready"
        else None,
    }


def create_kubeconfig_record(db: Session, *, name: str, content: str, active: bool) -> Kubeconfig:
    if active:
        db.execute(update(Kubeconfig).values(active=False))
    kubeconfig = Kubeconfig(name=name, content=content, active=active, created_at=now_ms())
    db.add(kubeconfig)
    db.commit()
    db.refresh(kubeconfig)
    return kubeconfig


def delete_kubeconfig_record(db: Session, kubeconfig_id: int) -> None:
    kubeconfig = db.get(Kubeconfig, kubeconfig_id)
    if kubeconfig is None:
        return
    db.delete(kubeconfig)
    db.commit()


async def check_miniblue_ready(server_ip: str, port: int) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://{server_ip}:{port}/health")
        return response.is_success
    except httpx.HTTPError:
        return False


async def provision_cluster_server(
    db: Session,
    *,
    name: str,
    hetzner_token: str,
    server_type: str | None,
    location: str | None,
) -> ClusterServer:
    public_key, private_key = generate_ssh_keypair()
    ssh_key_id = await upload_ssh_key(hetzner_token, f"labforge-{name}-{now_ms()}", public_key)
    server_id, server_ip = await hetzner_create_server(
        hetzner_token,
        name=f"labforge-{name}",
        server_type=server_type or "cx23",
        location=location or "nbg1",
        ssh_key_ids=[ssh_key_id],
    )

    cluster = ClusterServer(
        name=name,
        hetzner_token=hetzner_token,
        server_id=str(server_id),
        server_ip=server_ip,
        ssh_private_key=private_key,
        ssh_key_id=str(ssh_key_id),
        status="provisioning",
        error_message=None,
        server_type=server_type or "cx23",
        location=location or "nbg1",
        kubeconfig_id=None,
        miniblue_port=4566,
        idle_started_at=None,
        created_at=now_ms(),
    )
    db.add(cluster)
    db.commit()
    db.refresh(cluster)
    return cluster


async def get_cluster_server_status(db: Session, cluster_id: int) -> dict | None:
    cluster = get_clusters(db, cluster_id, ClusterServer)
    if cluster is None:
        return None

    k3s_ready = False
    miniblue_ready = False
    try:
        if cluster.status == "provisioning" and cluster.server_id:
            server = await hetzner_get_server(cluster.hetzner_token, cluster.server_id)
            if server["status"] == "running":
                ip = server["server_ip"] or cluster.server_ip
                update_cluster_entity(
                    db, cluster.id, ClusterServer, status="installing", server_ip=ip
                )
                return {
                    "id": cluster.id,
                    "status": "installing",
                    "serverIp": ip,
                    "k3sReady": False,
                    "miniblueReady": False,
                    "errorMessage": None,
                }
            return {
                "id": cluster.id,
                "status": "provisioning",
                "serverIp": cluster.server_ip,
                "k3sReady": False,
                "miniblueReady": False,
                "errorMessage": None,
            }

        if cluster.status == "installing" and cluster.server_ip and cluster.ssh_private_key:
            try:
                kubeconfig_yaml = await retrieve_kubeconfig(
                    cluster.server_ip, cluster.ssh_private_key
                )
                k3s_ready = True
                kubeconfig = create_kubeconfig_record(
                    db,
                    name=f"hetzner-{cluster.name}",
                    content=kubeconfig_yaml,
                    active=True,
                )
                miniblue_ready = await check_miniblue_ready(
                    cluster.server_ip, cluster.miniblue_port
                )
                update_cluster_entity(
                    db,
                    cluster.id,
                    ClusterServer,
                    status="ready",
                    kubeconfig_id=kubeconfig.id,
                    idle_started_at=now_ms(),
                )
                await sync_shared_shell_environment(db)
                return {
                    "id": cluster.id,
                    "status": "ready",
                    "serverIp": cluster.server_ip,
                    "k3sReady": True,
                    "miniblueReady": miniblue_ready,
                    "errorMessage": None,
                }
            except Exception:
                miniblue_ready = await check_miniblue_ready(
                    cluster.server_ip, cluster.miniblue_port
                )
                return {
                    "id": cluster.id,
                    "status": "installing",
                    "serverIp": cluster.server_ip,
                    "k3sReady": False,
                    "miniblueReady": miniblue_ready,
                    "errorMessage": None,
                }

        if cluster.status == "ready" and cluster.server_ip:
            miniblue_ready = await check_miniblue_ready(cluster.server_ip, cluster.miniblue_port)
            k3s_ready = True

        return {
            "id": cluster.id,
            "status": cluster.status,
            "serverIp": cluster.server_ip,
            "k3sReady": k3s_ready,
            "miniblueReady": miniblue_ready,
            "errorMessage": cluster.error_message,
        }
    except Exception as exc:
        update_cluster_entity(db, cluster.id, ClusterServer, status="error", error_message=str(exc))
        return {
            "id": cluster.id,
            "status": "error",
            "serverIp": cluster.server_ip,
            "k3sReady": False,
            "miniblueReady": False,
            "errorMessage": str(exc),
        }


async def get_cluster_server_debug(db: Session, cluster_id: int) -> dict | None:
    cluster = get_clusters(db, cluster_id, ClusterServer)
    if cluster is None:
        return None
    if not cluster.server_ip or not cluster.ssh_private_key:
        raise ValueError("cluster server missing IP or SSH key")
    result = await run_host_diagnostics(cluster.server_ip, cluster.ssh_private_key)
    return {
        "ok": result["code"] == 0,
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "code": result["code"],
    }


def list_clusters(db: Session, cluster: type[Cluster]) -> list[Cluster]:
    return list(db.scalars(select(cluster).order_by(cluster.id.asc())).all())


def get_clusters(db: Session, session_id: int, cluster: type[Cluster]) -> type[Cluster] | None:
    return db.get(cluster, session_id)


def update_cluster_entity(
    db: Session, entity_id: int, cluster: type[Cluster], **changes
) -> type[Cluster] | None:
    entity = db.get(cluster, entity_id)
    if entity is None:
        return None
    for key, value in changes.items():
        setattr(entity, key, value)
    db.commit()
    db.refresh(entity)
    return entity


def delete_cluster_session_record(db: Session, session_id: int) -> None:
    session = db.get(ClusterSession, session_id)
    if session is None:
        return
    db.delete(session)
    db.commit()


def get_expired_sessions(db: Session, now: int) -> list[ClusterSession]:
    return list(
        db.scalars(
            select(ClusterSession).where(
                ClusterSession.expires_at <= now,
                ClusterSession.status == "ready",
            )
        ).all()
    )


async def create_cluster_session(
    db: Session, *, cluster_server_id: int, ttl_hours: int | None
) -> ClusterSession:
    server = get_clusters(db, cluster_server_id, ClusterServer)
    if server is None:
        raise LookupError("cluster server not found")
    if server.status != "ready":
        raise ClusterNotReadyError(server.status)

    ttl = min(max(ttl_hours or DEFAULT_SESSION_TTL_HOURS, 1), 8)
    slug = secrets.token_hex(4)
    now = now_ms()
    session = ClusterSession(
        session_id=slug,
        cluster_server_id=server.id,
        namespace=f"vc-{slug}",
        status="provisioning",
        kubeconfig_content=None,
        kubeconfig_id=None,
        node_port=None,
        error_message=None,
        expires_at=now + ttl * 60 * 60 * 1000,
        created_at=now,
    )
    db.add(session)
    server.idle_started_at = None
    db.commit()
    db.refresh(session)
    return session


async def provision_session(session_id: int) -> None:
    db = local_db_session()
    try:
        session = get_clusters(db, session_id, ClusterSession)
        if session is None:
            return
        server = get_clusters(db, session.cluster_server_id, ClusterServer)
        if server is None or not server.server_ip or not server.ssh_private_key:
            update_cluster_entity(
                db,
                session_id,
                ClusterSession,
                status="error",
                error_message="cluster server missing IP or SSH key",
            )
            return

        namespace = session.namespace
        try:
            create_ns = f"""kubectl create namespace {namespace} \\
        --dry-run=client -o yaml | kubectl apply -f - && \\
        kubectl label ns {namespace} \\
          pod-security.kubernetes.io/enforce=baseline \\
          pod-security.kubernetes.io/warn=baseline \\
          pod-security.kubernetes.io/audit=baseline \\
          blueaccademy.io/session=true \\
          --overwrite"""
            result = await run_remote_command(
                server.server_ip, server.ssh_private_key, create_ns, timeout_ms=30_000
            )
            if result["code"] != 0:
                raise RuntimeError(
                    f"namespace create failed: {result['stderr'] or result['stdout']}"
                )

            manifest = build_session_hardening_manifest(namespace, server.server_ip).replace(
                "'", "'\\''"
            )
            apply_hardening = f"echo '{manifest}' | kubectl apply -f -"
            result = await run_remote_command(
                server.server_ip, server.ssh_private_key, apply_hardening, timeout_ms=30_000
            )
            if result["code"] != 0:
                raise RuntimeError(
                    f"hardening apply failed: {result['stderr'] or result['stdout']}"
                )

            create_vcluster = f"""vcluster create {session.session_id} \\
        --namespace {namespace} \\
        --connect=false \\
        --expose \\
        --chart-values 'service:\\n  type: NodePort\\n'"""
            result = await run_remote_command(
                server.server_ip, server.ssh_private_key, create_vcluster, timeout_ms=180_000
            )
            if result["code"] != 0:
                raise RuntimeError(
                    f"vcluster create failed: {result['stderr'] or result['stdout']}"
                )

            wait_cmd = f"kubectl wait --for=condition=ready pod -l app=vcluster -n {namespace} --timeout=180s"
            result = await run_remote_command(
                server.server_ip, server.ssh_private_key, wait_cmd, timeout_ms=200_000
            )
            if result["code"] != 0:
                raise RuntimeError(f"vcluster wait failed: {result['stderr'] or result['stdout']}")

            node_port_cmd = f"kubectl get svc {session.session_id} -n {namespace} -o jsonpath='{{.spec.ports[0].nodePort}}'"
            result = await run_remote_command(
                server.server_ip, server.ssh_private_key, node_port_cmd, timeout_ms=15_000
            )
            node_port = int((result["stdout"] or "").strip())

            kubeconfig_cmd = f"vcluster connect {session.session_id} --namespace {namespace} --print --server=https://{server.server_ip}:{node_port}"
            result = await run_remote_command(
                server.server_ip, server.ssh_private_key, kubeconfig_cmd, timeout_ms=30_000
            )
            if result["code"] != 0 or not (result["stdout"] or "").strip():
                raise RuntimeError(
                    f"kubeconfig fetch failed: {result['stderr'] or result['stdout']}"
                )

            kubeconfig = create_kubeconfig_record(
                db,
                name=f"session-{session.session_id}",
                content=result["stdout"],
                active=True,
            )
            update_cluster_entity(
                db,
                session_id,
                ClusterSession,
                status="ready",
                kubeconfig_content=result["stdout"],
                kubeconfig_id=kubeconfig.id,
                node_port=node_port,
            )
        except Exception as exc:
            update_cluster_entity(
                db, session_id, ClusterSession, status="error", error_message=str(exc)
            )
    finally:
        db.close()


async def destroy_session(db: Session, session: ClusterSession) -> None:
    server = get_clusters(db, session.cluster_server_id, ClusterServer)
    if server and server.server_ip and server.ssh_private_key:
        command = f"kubectl delete namespace {session.namespace} --ignore-not-found --wait=false"
        await _try(run_remote_command(
            server.server_ip, server.ssh_private_key, command, timeout_ms=30_000
        ))
    if session.kubeconfig_id:
        delete_kubeconfig_record(db, session.kubeconfig_id)
    update_cluster_entity(db, session.id, ClusterSession, status="destroyed", kubeconfig_id=None)


async def destroy_server(db: Session, cluster: ClusterServer) -> None:
    if cluster.server_id:
            await _try(hetzner_delete_server(cluster.hetzner_token, cluster.server_id))

    if cluster.ssh_key_id:
            await _try(delete_ssh_key(cluster.hetzner_token, cluster.ssh_key_id))

    if cluster.kubeconfig_id:
        delete_kubeconfig_record(db, cluster.kubeconfig_id)

    db.delete(cluster)
    db.commit()


async def open_cluster_editor(
    db: Session, cluster_id: int, requested_session_id: int | None
) -> dict | None:
    cluster = get_clusters(db, cluster_id, ClusterServer)
    if cluster is None:
        return None
    if cluster.status != "ready":
        raise ClusterNotReadyError(cluster.status)
    if not cluster.server_ip or not cluster.ssh_private_key:
        raise ValueError("cluster server missing IP or SSH key")

    ready_session = next(
        (
            session
            for session in list_clusters(db, ClusterSession)
            if session.cluster_server_id == cluster.id
            and session.status == "ready"
            and (requested_session_id is None or session.id == requested_session_id)
        ),
        None,
    )
    if ready_session is None or not ready_session.kubeconfig_content:
        raise LookupError("no ready sandbox session is available")

    try:
        return await ensure_openvscode_server(
            cluster.server_ip,
            cluster.ssh_private_key,
            port=3000,
            miniblue_endpoint=f"http://{cluster.server_ip}:{cluster.miniblue_port}",
            kubeconfig_content=ready_session.kubeconfig_content,
        )
    except RuntimeError as exc:
        raise EditorStartupError(str(exc)) from exc


async def destroy_expired_sessions(db: Session) -> None:
    expired = get_expired_sessions(db, now_ms())
    for session in expired:
        await destroy_session(db, session)


def has_active_sessions(server: ClusterServer, sessions: list[ClusterSession]) -> bool:
    return any(
        session.cluster_server_id == server.id and session.status in {"ready", "provisioning"}
        for session in sessions
    )


def reset_idle_timer(server: ClusterServer, db: Session) -> None:
    if server.idle_started_at:
        update_cluster_entity(db, server.id, ClusterServer, idle_started_at=None)


def idle_ttl_exceeded(now, server: ClusterServer, server_ttl) -> bool:
    return now - server.idle_started_at >= server_ttl


def update_server_fields(db: Session, server_id: int, **changes) -> ClusterServer | None:
    return update_cluster_entity(db, server_id, ClusterServer, **changes)


# TODO: important to have unit test on this function to ensure we don't accidentally break the cleaning logic that keeps the cluster clean and cost efficient
async def clean_expired_sessions() -> None:
    db = local_db_session()
    try:
        await destroy_expired_sessions(db)

        servers = list_clusters(db, ClusterServer)
        sessions = list_clusters(db, ClusterSession)
        now = now_ms()
        for server in servers:
            if server.status != "ready":
                continue

            if has_active_sessions(server, sessions):
                reset_idle_timer(server, db)
                continue

            if not server.idle_started_at:
                update_server_fields(db, server.id, idle_started_at=now)
                continue

            if idle_ttl_exceeded(now, server, IDLE_SERVER_TTL_MS):
                await destroy_server(db, server)
    finally:
        db.close()


async def cluster_cleanup_loop(stop_event: asyncio.Event) -> None:
    await clean_expired_sessions()
    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=5 * 60)
        except asyncio.TimeoutError:
            await clean_expired_sessions()
