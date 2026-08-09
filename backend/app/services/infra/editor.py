from __future__ import annotations

import base64

from backend.app.services.infra.ssh import run_remote_command

OPENVSCODE_SERVER_VERSION = "1.109.5"


async def ensure_openvscode_server(
    server_ip: str,
    private_key: str,
    *,
    miniblue_endpoint: str,
    kubeconfig_content: str | None,
    port: int = 3000,
) -> dict:
    kubeconfig_b64 = (
        base64.b64encode(kubeconfig_content.encode("utf-8")).decode("ascii")
        if kubeconfig_content
        else ""
    )

    command = f"""
set -euo pipefail

workspace_root=/root/.blueaccademy
env_file="$workspace_root/e2e-shell-env"
editor_env_file="$workspace_root/openvscode.env"
workspace_dir="$workspace_root/workspace"
mkdir -p "$workspace_root" "$workspace_dir" "$workspace_root/logs"

cat > "$env_file" <<'ENVFILE'
export MINIBLUE_ENDPOINT={miniblue_endpoint}
export ARM_ENDPOINT={miniblue_endpoint}
ENVFILE

if [ -n "{kubeconfig_b64}" ]; then
  printf '%s' '{kubeconfig_b64}' | base64 -d > "$workspace_root/current-session.kubeconfig"
  chmod 600 "$workspace_root/current-session.kubeconfig"
  printf '%s\\n' 'export KUBECONFIG=/root/.blueaccademy/current-session.kubeconfig' >> "$env_file"
fi

if [ ! -s "$editor_env_file" ]; then
  token="$(openssl rand -hex 24)"
  cat > "$editor_env_file" <<EOF
OPENVSCODE_PORT={port}
OPENVSCODE_TOKEN=$token
EOF
fi

set -a
. "$editor_env_file"
set +a

arch="x64"
if [ "$(uname -m)" = "aarch64" ]; then
  arch="arm64"
fi

if [ ! -x /opt/openvscode-server/bin/openvscode-server ]; then
  tmp="/tmp/openvscode-server-v{OPENVSCODE_SERVER_VERSION}-linux-$arch.tar.gz"
  curl -fsSL -o "$tmp" "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v{OPENVSCODE_SERVER_VERSION}/openvscode-server-v{OPENVSCODE_SERVER_VERSION}-linux-$arch.tar.gz"
  rm -rf /opt/openvscode-server "/opt/openvscode-server-v{OPENVSCODE_SERVER_VERSION}-linux-$arch"
  tar -xzf "$tmp" -C /opt
  mv "/opt/openvscode-server-v{OPENVSCODE_SERVER_VERSION}-linux-$arch" /opt/openvscode-server
fi

cat > /etc/systemd/system/blueaccademy-openvscode.service <<'SERVICE'
[Unit]
Description=blueaccademy OpenVSCode Server
After=network.target

[Service]
Type=simple
EnvironmentFile=/root/.blueaccademy/openvscode.env
ExecStart=/bin/bash -lc '/opt/openvscode-server/bin/openvscode-server --host 0.0.0.0 --port "$OPENVSCODE_PORT" --connection-token "$OPENVSCODE_TOKEN" --telemetry-level off --server-data-dir /root/.blueaccademy/openvscode-server-data --user-data-dir /root/.blueaccademy/openvscode-user-data --extensions-dir /root/.blueaccademy/openvscode-extensions /root/.blueaccademy/workspace'
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable blueaccademy-openvscode >/dev/null 2>&1 || true
systemctl restart blueaccademy-openvscode

for attempt in $(seq 1 20); do
  if curl -fsSI "http://127.0.0.1:$OPENVSCODE_PORT/?tkn=$OPENVSCODE_TOKEN" >/dev/null 2>&1; then
    echo "__TOKEN__:$OPENVSCODE_TOKEN"
    exit 0
  fi
  sleep 2
done

echo "__TOKEN__:$OPENVSCODE_TOKEN"
exit 1
"""

    result = await run_remote_command(server_ip, private_key, command, timeout_ms=180_000)
    lines = f"{result['stdout']}\n{result['stderr']}".splitlines()
    token_line = next((line for line in lines if line.startswith("__TOKEN__:")), None)
    token = token_line.replace("__TOKEN__:", "").strip() if token_line else None
    if result["code"] != 0 or not token:
        raise RuntimeError(
            result["stderr"] or result["stdout"] or "OpenVSCode Server failed to start"
        )
    return {
        "port": port,
        "token": token,
        "url": f"http://{server_ip}:{port}/?tkn={token}",
    }
