from __future__ import annotations

import asyncio

import asyncssh


async def run_remote_command(
    server_ip: str,
    private_key: str,
    command: str,
    timeout_ms: int = 60_000,
) -> dict:
    timeout = timeout_ms / 1000
    async with asyncssh.connect(
        server_ip,
        port=22,
        username="root",
        client_keys=[asyncssh.import_private_key(private_key)],
        known_hosts=None,
    ) as conn:
        result = await asyncio.wait_for(conn.run(f"bash -lc {command!r}", check=False), timeout=timeout)
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "code": result.exit_status,
    }


async def retrieve_kubeconfig(server_ip: str, private_key: str) -> str:
    result = await run_remote_command(
        server_ip,
        private_key,
        "sudo cat /etc/rancher/k3s/k3s.yaml",
        timeout_ms=30_000,
    )
    if result["code"] != 0 or not result["stdout"].strip():
        raise RuntimeError(result["stderr"] or result["stdout"] or "Could not retrieve kubeconfig")
    return result["stdout"]


async def run_host_diagnostics(server_ip: str, private_key: str) -> dict:
    command = "; ".join(
        [
            "echo '== cloud-init ==' ",
            "cloud-init status 2>&1 || true",
            "echo",
            "echo '== docker ==' ",
            "systemctl is-active docker 2>&1 || true",
            "echo",
            "echo '== k3s ==' ",
            "systemctl is-active k3s 2>&1 || true",
            "echo",
            "echo '== docker ps ==' ",
            "docker ps 2>&1 || true",
            "echo",
            "echo '== kubectl get nodes ==' ",
            "kubectl get nodes -o wide 2>&1 || true",
            "echo",
            "echo '== miniblue health ==' ",
            "curl -fsS http://127.0.0.1:4566/health 2>&1 || true",
            "echo",
            "echo '== k3s journal ==' ",
            "journalctl -u k3s --no-pager -n 80 2>&1 || true",
        ]
    )
    return await run_remote_command(server_ip, private_key, command)
