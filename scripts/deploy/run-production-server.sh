#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${SHIFENG_DEPLOY_ROOT:-$HOME/services/shifeng-investment}"
SERVER_ENV_FILE="${SHIFENG_SERVER_ENV_FILE:-$HOME/.config/shifeng-investment/server.env}"

if [[ -f "$SERVER_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SERVER_ENV_FILE"
  set +a
fi

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3000}"
NODE_BIN="${SHIFENG_NODE_BIN:-node}"

cd "$DEPLOY_ROOT/current"
exec "$NODE_BIN" server/index.js
