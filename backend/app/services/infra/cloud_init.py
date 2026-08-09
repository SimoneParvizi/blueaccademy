OPENVSCODE_SERVER_VERSION = "1.109.5"


def render_cloud_init() -> str:
    """Initial host bootstrap for Hetzner-backed exercise hosts."""

    return """#!/bin/bash
set -e

apt-get update -y
apt-get install -y docker.io curl
systemctl enable --now docker

docker run -d --name miniblue --restart always \\
  -p 4566:4566 -p 4567:4567 \\
  moabukar/miniblue:latest

curl -sfL https://get.k3s.io | sh -

curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

curl -sL "https://github.com/loft-sh/vcluster/releases/latest/download/vcluster-linux-amd64" \\
  -o /usr/local/bin/vcluster && chmod +x /usr/local/bin/vcluster
"""
