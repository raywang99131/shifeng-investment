#!/usr/bin/env bash
set -euo pipefail

LABEL="com.shifeng-investment.server"
ACTION="${1:-}"
DEPLOY_ROOT="${SHIFENG_DEPLOY_ROOT:-$HOME/services/shifeng-investment}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$LABEL.plist"
DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$DOMAIN/$LABEL"
LAUNCHCTL_BIN="${SHIFENG_LAUNCHCTL_BIN:-launchctl}"
LSOF_BIN="${SHIFENG_LSOF_BIN:-lsof}"
RUNNER_SCRIPT="$DEPLOY_ROOT/current/scripts/deploy/run-production-server.sh"
LOG_DIR="$DEPLOY_ROOT/shared/logs"

xml_escape() {
  local value="$1"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "LaunchAgent paths cannot contain newlines." >&2
    return 1
  fi
  printf '%s' "$value" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g' \
    -e 's/"/\&quot;/g' \
    -e "s/'/\\\&apos;/g"
}

is_loaded() {
  "$LAUNCHCTL_BIN" print "$SERVICE_TARGET" >/dev/null 2>&1
}

resolve_node() {
  if [[ -n "${SHIFENG_NODE_BIN:-}" ]]; then
    printf '%s\n' "$SHIFENG_NODE_BIN"
    return
  fi
  command -v node || {
    echo "Node.js is not available to the production runner." >&2
    return 127
  }
}

render_plist() {
  local node_bin="$1"
  local deploy_root_xml runner_script_xml node_bin_xml stdout_xml stderr_xml temp_plist
  deploy_root_xml="$(xml_escape "$DEPLOY_ROOT")"
  runner_script_xml="$(xml_escape "$RUNNER_SCRIPT")"
  node_bin_xml="$(xml_escape "$node_bin")"
  stdout_xml="$(xml_escape "$LOG_DIR/server.out.log")"
  stderr_xml="$(xml_escape "$LOG_DIR/server.err.log")"
  temp_plist="$PLIST_PATH.tmp.$$"

  umask 077
  cat >"$temp_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$runner_script_xml</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$deploy_root_xml/current</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SHIFENG_DEPLOY_ROOT</key>
    <string>$deploy_root_xml</string>
    <key>SHIFENG_NODE_BIN</key>
    <string>$node_bin_xml</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$stdout_xml</string>
  <key>StandardErrorPath</key>
  <string>$stderr_xml</string>
</dict>
</plist>
EOF
  chmod 600 "$temp_plist"
  mv "$temp_plist" "$PLIST_PATH"
}

install_service() {
  if [[ ! -f "$RUNNER_SCRIPT" ]]; then
    echo "Production launcher is missing: $RUNNER_SCRIPT" >&2
    return 1
  fi

  local node_bin loaded=0 port_pids
  node_bin="$(resolve_node)"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

  if is_loaded; then
    loaded=1
  else
    port_pids="$($LSOF_BIN -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -n "$port_pids" ]]; then
      port_pids="$(printf '%s' "$port_pids" | tr '\n' ',' | sed 's/,$//')"
      echo "Port 3000 is already in use by PID $port_pids. Stop the legacy website server, then rerun deployment." >&2
      return 1
    fi
  fi

  render_plist "$node_bin"
  if [[ "$loaded" == "1" ]]; then
    "$LAUNCHCTL_BIN" bootout "$DOMAIN" "$PLIST_PATH"
  fi
  "$LAUNCHCTL_BIN" bootstrap "$DOMAIN" "$PLIST_PATH"
  "$LAUNCHCTL_BIN" kickstart -k "$SERVICE_TARGET"
  echo "Installed $LABEL"
}

restart_service() {
  "$LAUNCHCTL_BIN" kickstart -k "$SERVICE_TARGET"
  echo "Restarted $LABEL"
}

case "$ACTION" in
  install)
    install_service
    ;;
  restart)
    restart_service
    ;;
  status)
    exec "$LAUNCHCTL_BIN" print "$SERVICE_TARGET"
    ;;
  *)
    echo "Usage: $0 {install|restart|status}" >&2
    exit 64
    ;;
esac
