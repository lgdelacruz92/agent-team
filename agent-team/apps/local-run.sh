#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.local docker compose --env-file .env.local up --build "$@"
