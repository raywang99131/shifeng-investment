#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH}"
RUN_ID="$(date -u +%Y%m%d_%H%M%S)-$$"

LAUNCH_AGENT_LABEL="com.shifeng-investment.cloudflare-tunnel"
LAUNCH_AGENT_PATH="$HOME/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist"

kill_processes() {
  local pattern=$1
  local pids
  pids="$(pgrep -f "${pattern}" || true)"
  if [[ -n "${pids}" ]]; then
    echo "Stopping processes: ${pattern}"
    pkill -f "${pattern}" || true
    sleep 1
  fi
}

stop_launch_agent() {
  if [[ ! -f "$LAUNCH_AGENT_PATH" ]] || ! command -v launchctl >/dev/null 2>&1; then
    return
  fi

  if launchctl print "gui/$(id -u)" 2>/dev/null | grep -q "${LAUNCH_AGENT_LABEL}"; then
    echo "Stopping Cloudflare launch agent: ${LAUNCH_AGENT_LABEL}"
    launchctl bootout gui/$(id -u) "$LAUNCH_AGENT_PATH" || true
    sleep 1
  fi
}

cd "$PROJECT_DIR"

stop_launch_agent

kill_processes "cloudflared tunnel"
kill_processes "cloudflared run"
kill_processes "node server/index.js"
kill_processes "npm run server"
kill_processes "npm run public:tunnel"

if command -v lsof >/dev/null 2>&1; then
  for _ in {1..5}; do
    local_ports="$(lsof -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -z "$local_ports" ]]; then
      break
    fi
    echo "Freeing port 3000..."
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      kill -9 "$pid" >/dev/null 2>&1 || true
    done <<<"$local_ports"
    sleep 1
  done
fi

echo "Building production assets..."
rm -rf dist
npm run build

BUILD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > dist/build-meta.json <<EOF
{
  "buildId": "${BUILD_TIME} (git:${BUILD_SHA})",
  "builtAt": "${BUILD_TIME}",
  "git": "${BUILD_SHA}",
  "runId": "${RUN_ID}"
}
EOF

echo "Build info written to dist/build-meta.json"

echo "Starting stable tunnel and local server..."
SKIP_BUILD=1 npm run public:tunnel
