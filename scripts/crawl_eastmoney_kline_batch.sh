#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/shifeng-eastmoney-kline-crawl.lock"
LOG_DIR="$ROOT/server/data/tmt-margin/logs"
LOG_FILE="$LOG_DIR/eastmoney-kline-crawl.log"

SINCE="${SINCE:-20120101}"
END="${END:-$(date '+%Y%m%d')}"
MAX_CODES="${MAX_CODES:-3}"
DELAY="${DELAY:-8}"
STOP_AFTER_FAILURES="${STOP_AFTER_FAILURES:-2}"
MIN_STOCK_COUNT="${MIN_STOCK_COUNT:-4500}"
HOST_LIMIT="${HOST_LIMIT:-2}"
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-3}"
SOURCE_COOLDOWN_MINUTES="${SOURCE_COOLDOWN_MINUTES:-30}"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') eastmoney kline crawl already running"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$LOG_DIR"
cd "$ROOT"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') eastmoney kline crawl start ====="
  echo "SINCE=$SINCE END=$END MAX_CODES=$MAX_CODES DELAY=$DELAY HOST_LIMIT=$HOST_LIMIT"
  remaining="$(
    python3 scripts/backfill_trading_congestion_eastmoney.py status \
      --recent-days 100 \
      --json-field kline_source_cooldown_remaining_seconds
  )"
  if [ "${remaining:-0}" != "0" ]; then
    echo "Eastmoney kline source cooldown active remaining=${remaining}s; skip crawl"
    python3 scripts/backfill_trading_congestion_eastmoney.py status \
      --recent-days 100 \
      --json-field kline_cached_stocks,kline_long_history_remaining_stocks,kline_long_history_ready_progress
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') eastmoney kline crawl skipped/cooling ====="
    exit 0
  fi
  set +e
  python3 scripts/backfill_trading_congestion_eastmoney.py crawl-history \
    --since "$SINCE" \
    --end "$END" \
    --max-codes "$MAX_CODES" \
    --delay "$DELAY" \
    --retries 0 \
    --stop-after-failures "$STOP_AFTER_FAILURES" \
    --fail-cooldown-minutes 120 \
    --host-limit "$HOST_LIMIT" \
    --request-timeout "$REQUEST_TIMEOUT" \
    --source-cooldown-minutes "$SOURCE_COOLDOWN_MINUTES" \
    --min-stock-count "$MIN_STOCK_COUNT"
  exit_code=$?
  set -e
  if [ "$exit_code" -eq 2 ]; then
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') eastmoney kline crawl skipped/cooling ====="
    exit 0
  fi
  if [ "$exit_code" -ne 0 ]; then
    echo "===== $(date '+%Y-%m-%d %H:%M:%S') eastmoney kline crawl failed exit=$exit_code ====="
    exit "$exit_code"
  fi
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') eastmoney kline crawl done ====="
} >>"$LOG_FILE" 2>&1
