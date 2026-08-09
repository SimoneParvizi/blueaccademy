from __future__ import annotations

import tempfile
from pathlib import Path
from subprocess import run

import httpx

from backend.app.services.infra.cloud_init import render_cloud_init

HETZNER_API = "https://api.hetzner.cloud/v1"


class HetznerAPIError(RuntimeError):
    pass


async def hetzner_fetch(
    token: str,
    path: str,
    *,
    method: str = "GET",
    json: dict | None = None,
) -> dict | None:
    async with httpx.AsyncClient(base_url=HETZNER_API, timeout=30.0) as client:
        response = await client.request(
            method,
            path,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=json,
        )
    if response.status_code == 204:
        return None
    if response.is_error:
        raise HetznerAPIError(f"Hetzner API {response.status_code}: {response.text}")
    return response.json()


def generate_ssh_keypair() -> tuple[str, str]:
    with tempfile.TemporaryDirectory(prefix="blueaccademy-ssh-") as temp_dir:
        key_path = Path(temp_dir) / "id_ed25519"
        run(
            ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "labforge", "-f", str(key_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        private_key = key_path.read_text()
        public_key = key_path.with_suffix(".pub").read_text().strip()
        return public_key, private_key


async def upload_ssh_key(token: str, name: str, public_key: str) -> int:
    data = await hetzner_fetch(
        token,
        "/ssh_keys",
        method="POST",
        json={"name": name, "public_key": public_key},
    )
    assert data is not None
    return int(data["ssh_key"]["id"])


async def delete_ssh_key(token: str, key_id: str | int) -> None:
    await hetzner_fetch(token, f"/ssh_keys/{key_id}", method="DELETE")


async def delete_server(token: str, server_id: str | int) -> None:
    await hetzner_fetch(token, f"/servers/{server_id}", method="DELETE")


async def create_server(
    token: str,
    *,
    name: str,
    server_type: str,
    location: str,
    ssh_key_ids: list[int],
) -> tuple[int, str]:
    data = await hetzner_fetch(
        token,
        "/servers",
        method="POST",
        json={
            "name": name,
            "server_type": server_type,
            "location": location,
            "ssh_keys": ssh_key_ids,
            "image": "ubuntu-24.04",
            "user_data": render_cloud_init(),
        },
    )
    assert data is not None
    server = data["server"]
    return int(server["id"]), server["public_net"]["ipv4"]["ip"]


async def get_server(token: str, server_id: str | int) -> dict:
    data = await hetzner_fetch(token, f"/servers/{server_id}")
    assert data is not None
    server = data["server"]
    return {
        "server_id": int(server["id"]),
        "status": server["status"],
        "server_ip": server["public_net"]["ipv4"]["ip"] if server["public_net"]["ipv4"] else None,
    }
