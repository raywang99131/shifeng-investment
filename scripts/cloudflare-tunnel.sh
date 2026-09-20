#!/usr/bin/env bash
set -euo pipefail

TUNNEL_ENV_FILE="${CLOUDFLARE_TUNNEL_ENV_FILE:-$HOME/.config/shifeng-investment/tunnel.env}"

if [[ -f "$TUNNEL_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$TUNNEL_ENV_FILE"
  set +a
fi

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-3000}"
ORIGIN="http://localhost:${PORT}"
SERVER_STARTED=0
SERVER_PID=""
SERVER_MONITOR_PID=""
ETF_MONITOR_ENABLED="${ETF_MONITOR_ENABLED:-1}"
ETF_MONITOR_PORT="${ETF_MONITOR_PORT:-8000}"
ETF_MONITOR_URL="${ETF_MONITOR_URL:-http://127.0.0.1:${ETF_MONITOR_PORT}}"
EDGE_DNS_PID=""
TUNNEL_EDGE_IP_VERSION="${CLOUDFLARE_TUNNEL_EDGE_IP_VERSION:-auto}"
TUNNEL_TRANSPORT_PROTOCOL="${CLOUDFLARE_TUNNEL_TRANSPORT_PROTOCOL:-auto}"
TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"
TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-}"
TUNNEL_HOSTNAME="${CLOUDFLARE_TUNNEL_HOSTNAME:-}"
TUNNEL_TOKEN_FILE="${CLOUDFLARE_TUNNEL_TOKEN_FILE:-}"
CLOUDFLARE_TUNNEL_MODE="${CLOUDFLARE_TUNNEL_MODE:-auto}"
EDGE_DNS_FALLBACK="${CLOUDFLARE_TUNNEL_EDGE_DNS_FALLBACK:-1}"
EDGE_DNS_HOST="${CLOUDFLARE_TUNNEL_EDGE_DNS_HOST:-127.0.0.1}"
EDGE_DNS_PORT="${CLOUDFLARE_TUNNEL_EDGE_DNS_PORT:-53535}"
TUNNEL_NO_PRECHECKS="${CLOUDFLARE_TUNNEL_NO_PRECHECKS:-1}"

cleanup() {
  if [[ -n "$EDGE_DNS_PID" ]]; then
    kill "$EDGE_DNS_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_MONITOR_PID" ]]; then
    kill "$SERVER_MONITOR_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$SERVER_STARTED" == "1" && -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared is not installed."
  echo "Install it first with: brew install cloudflared"
  exit 127
fi

cd "$PROJECT_DIR"

start_local_server() {
  if curl -fsS "${ORIGIN}/api/health" >/dev/null 2>&1; then
    echo "Using existing local server at ${ORIGIN}"
    return 0
  fi

  echo "Starting local production server at ${ORIGIN}..."
  npm run server &
  SERVER_PID="$!"
  SERVER_STARTED=1

  for _ in {1..30}; do
    if curl -fsS "${ORIGIN}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Local server did not become healthy at ${ORIGIN}/api/health"
  return 1
}

watch_local_server() {
  while true; do
    sleep 15
    if curl -fsS "${ORIGIN}/api/health" >/dev/null 2>&1; then
      continue
    fi

    echo "Local server unhealthy at ${ORIGIN}; restarting..."
    if [[ -n "$SERVER_PID" ]]; then
      kill "$SERVER_PID" >/dev/null 2>&1 || true
      wait "$SERVER_PID" >/dev/null 2>&1 || true
      SERVER_PID=""
    fi

    start_local_server || true
  done
}

start_edge_dns_fallback() {
  if [[ "$EDGE_DNS_FALLBACK" != "1" ]]; then
    return 0
  fi

  echo "Starting Cloudflare edge DNS fallback at ${EDGE_DNS_HOST}:${EDGE_DNS_PORT}..."
  node scripts/cloudflare-edge-dns.mjs --host "$EDGE_DNS_HOST" --port "$EDGE_DNS_PORT" &
  EDGE_DNS_PID="$!"
  sleep 1
}

if [[ "${SKIP_BUILD:-0}" == "1" ]]; then
  echo "Skipping production build because SKIP_BUILD=1"
else
  echo "Building production bundle..."
  npm run build
fi

export ETF_MONITOR_ENABLED ETF_MONITOR_PORT ETF_MONITOR_URL
start_local_server || exit 1
watch_local_server &
SERVER_MONITOR_PID="$!"
start_edge_dns_fallback

if [[ "$TUNNEL_TRANSPORT_PROTOCOL" != "auto" && "$TUNNEL_TRANSPORT_PROTOCOL" != "quic" && "$TUNNEL_TRANSPORT_PROTOCOL" != "http2" ]]; then
  echo "Invalid CLOUDFLARE_TUNNEL_TRANSPORT_PROTOCOL: ${TUNNEL_TRANSPORT_PROTOCOL}. Use: auto | quic | http2"
  exit 1
fi

if [[ "$CLOUDFLARE_TUNNEL_MODE" == "" ]]; then
  CLOUDFLARE_TUNNEL_MODE="auto"
fi

if [[ "$CLOUDFLARE_TUNNEL_MODE" != "stable" && "$CLOUDFLARE_TUNNEL_MODE" != "quick" && "$CLOUDFLARE_TUNNEL_MODE" != "auto" ]]; then
  echo "Unknown CLOUDFLARE_TUNNEL_MODE: ${CLOUDFLARE_TUNNEL_MODE}. Use: stable | quick | auto"
  exit 1
fi

if [[ "$CLOUDFLARE_TUNNEL_MODE" == "stable" ]]; then
  if [[ -z "$TUNNEL_TOKEN" && -z "$TUNNEL_TOKEN_FILE" ]]; then
    echo "CLOUDFLARE_TUNNEL_MODE=stable requires CLOUDFLARE_TUNNEL_TOKEN (or CLOUDFLARE_TUNNEL_TOKEN_FILE)."
    exit 1
  fi
else
  if [[ -z "$TUNNEL_TOKEN" && -z "$TUNNEL_TOKEN_FILE" ]]; then
    if [[ "$CLOUDFLARE_TUNNEL_MODE" == "quick" ]]; then
      echo "No token found, forcing Quick Tunnel."
    else
      echo "No token found, fallback to Quick Tunnel."
    fi
  fi
fi

if [[ "$CLOUDFLARE_TUNNEL_MODE" == "quick" ]]; then
  echo "CLOUDFLARE_TUNNEL_MODE is explicitly set to quick; skipping named-tunnel token mode."
elif [[ -n "$TUNNEL_TOKEN" || -n "$TUNNEL_TOKEN_FILE" ]]; then
  if [[ -n "$TUNNEL_TOKEN" ]]; then
    TUNNEL_TOKEN_ARG=(--token "$TUNNEL_TOKEN")
  else
    TUNNEL_TOKEN_ARG=(--token-file "$TUNNEL_TOKEN_FILE")
  fi

  DNS_RESOLVER_ARGS=()
  if [[ "$EDGE_DNS_FALLBACK" == "1" ]]; then
    DNS_RESOLVER_ARGS=(--dns-resolver-addrs "${EDGE_DNS_HOST}:${EDGE_DNS_PORT}")
  fi
  PRECHECK_ARGS=()
  if [[ "$TUNNEL_NO_PRECHECKS" == "1" ]]; then
    PRECHECK_ARGS=(--no-prechecks)
  fi

  echo
  echo "Cloudflare Named Tunnel mode is starting."
  if [[ -n "$TUNNEL_NAME" ]]; then
    echo "Tunnel name: ${TUNNEL_NAME}"
  fi
  if [[ -n "$TUNNEL_HOSTNAME" ]]; then
    echo "Tunnel hostname: https://${TUNNEL_HOSTNAME}"
  fi
  echo "Stable mode uses a fixed hostname in Cloudflare DNS; keep an eye on token rotation."
  echo
  cloudflared tunnel "${PRECHECK_ARGS[@]}" run \
    --protocol "${TUNNEL_TRANSPORT_PROTOCOL}" \
    "${DNS_RESOLVER_ARGS[@]}" \
    "${TUNNEL_TOKEN_ARG[@]}" \
    --url "$ORIGIN"
  exit 0
fi

echo
echo "Cloudflare Quick Tunnel is starting."
echo "Share the https://*.trycloudflare.com URL that appears below."
echo "Keep this terminal open while colleagues are using it."
echo

DNS_RESOLVER_ARGS=()
if [[ "$EDGE_DNS_FALLBACK" == "1" ]]; then
  DNS_RESOLVER_ARGS=(--dns-resolver-addrs "${EDGE_DNS_HOST}:${EDGE_DNS_PORT}")
fi
PRECHECK_ARGS=()
if [[ "$TUNNEL_NO_PRECHECKS" == "1" ]]; then
  PRECHECK_ARGS=(--no-prechecks)
fi

cloudflared tunnel "${PRECHECK_ARGS[@]}" \
  --protocol "${TUNNEL_TRANSPORT_PROTOCOL}" \
  "${DNS_RESOLVER_ARGS[@]}" \
  --edge-ip-version "${TUNNEL_EDGE_IP_VERSION}" \
  --url "$ORIGIN"
