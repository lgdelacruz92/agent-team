#!/usr/bin/env bash
# Install Docker, the Compose plugin and Buildx on Amazon Linux (2023 or 2). Safe to run again.
#
# Usage (on the instance, e.g. in a Session Manager shell):
#   sudo ./install-docker.sh
#
# Optional env vars: COMPOSE_VERSION and BUILDX_VERSION (both default to latest), e.g. COMPOSE_VERSION=v2.29.7
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

COMPOSE_VERSION="${COMPOSE_VERSION:-latest}"
BUILDX_VERSION="${BUILDX_VERSION:-latest}"
plugin_dir=/usr/local/lib/docker/cli-plugins

if command -v dnf >/dev/null; then pkg=dnf; else pkg=yum; fi

# The Amazon Linux package has the Docker engine and CLI only, no Compose or Buildx.
$pkg install -y docker
systemctl enable --now docker

# SSM sessions log in as ssm-user, so give both users access without sudo (takes effect on next login).
for user in ec2-user ssm-user; do
  id "$user" &>/dev/null && usermod -aG docker "$user"
done

if [[ "$COMPOSE_VERSION" == "latest" ]]; then
  compose_url="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)"
else
  compose_url="https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$(uname -m)"
fi
mkdir -p "$plugin_dir"
curl -fsSL "$compose_url" -o "$plugin_dir/docker-compose"
chmod +x "$plugin_dir/docker-compose"

# `docker compose build` needs Buildx 0.17.0 or later. Release assets are named with the version.
if [[ "$BUILDX_VERSION" == "latest" ]]; then
  BUILDX_VERSION=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/docker/buildx/releases/latest | sed 's|.*/||')
fi
case "$(uname -m)" in
  x86_64) buildx_arch=amd64 ;;
  aarch64) buildx_arch=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
curl -fsSL "https://github.com/docker/buildx/releases/download/$BUILDX_VERSION/buildx-$BUILDX_VERSION.linux-$buildx_arch" \
  -o "$plugin_dir/docker-buildx"
chmod +x "$plugin_dir/docker-buildx"

docker --version
docker compose version
docker buildx version
echo "Done. Log out and back in so the docker group applies, then run: docker run --rm hello-world"
