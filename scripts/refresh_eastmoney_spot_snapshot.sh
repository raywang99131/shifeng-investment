#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/shifeng-eastmoney-spot-snapshot.lock"
LOG_DIR="$ROOT/server/data/tmt-margin/logs"
LOG_FILE="$LOG_DIR/eastmoney-spot-snapshot.log"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') eastmoney spot snapshot already running"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$LOG_DIR"
cd "$ROOT"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') eastmoney spot snapshot start ====="
  python3 scripts/backfill_trading_congestion_eastmoney.py spot-snapshot --page-size 100
  python3 scripts/backfill_trading_congestion_eastmoney.py status \
    --recent-days 100 \
    --json-field top100_recent_days,turnover_filled,volume_ratio_filled,kline_cached_stocks,kline_coverage_progress
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') eastmoney spot snapshot done ====="
} >>"$LOG_FILE" 2>&1
