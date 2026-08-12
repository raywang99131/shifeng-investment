#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Small, resumable Eastmoney-only backfill.
# Designed to be safe when Eastmoney is throttling or rejecting requests:
# - tries only a few stocks per run
# - records failures and skips them during the cooldown window
# - aggregates whatever kline cache is already available

MAX_CODES="${MAX_CODES:-5}"
DELAY_SECONDS="${DELAY_SECONDS:-10}"
FAIL_COOLDOWN_MINUTES="${FAIL_COOLDOWN_MINUTES:-120}"
END_DATE="${END_DATE:-$(date +%Y%m%d)}"

python3 scripts/backfill_trading_congestion_eastmoney.py top100-fields \
  --recent-days 100 \
  --max-codes "$MAX_CODES" \
  --delay "$DELAY_SECONDS" \
  --retries 0 \
  --stop-after-failures 3 \
  --fail-cooldown-minutes "$FAIL_COOLDOWN_MINUTES" || true

python3 scripts/backfill_trading_congestion_eastmoney.py crawl-history \
  --since 20050101 \
  --end "$END_DATE" \
  --max-codes "$MAX_CODES" \
  --delay "$DELAY_SECONDS" \
  --retries 0 \
  --stop-after-failures 3 \
  --fail-cooldown-minutes "$FAIL_COOLDOWN_MINUTES" || true

python3 scripts/backfill_trading_congestion_eastmoney.py long-history --since 20050101
