#!/usr/bin/env bash
# 一键备份 funds.json 到 ~/Documents/shifeng-investment-backups/
# 保留每次的时间戳副本 + 最新的 funds_latest.json 覆盖
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE="$PROJECT_DIR/server/data/funds.json"
BACKUP_DIR="$HOME/Documents/shifeng-investment-backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

if [ ! -f "$SOURCE" ]; then
  echo "❌ 找不到 $SOURCE"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
DEST="$BACKUP_DIR/funds_${TIMESTAMP}.json"
LATEST="$BACKUP_DIR/funds_latest.json"

cp "$SOURCE" "$DEST"
cp "$SOURCE" "$LATEST"

# 校验
if diff -q "$SOURCE" "$LATEST" >/dev/null; then
  SIZE=$(wc -c <"$DEST" | tr -d ' ')
  FUND_COUNT=$(python3 -c "import json; print(len(json.load(open('$DEST'))['funds']))" 2>/dev/null || echo "?")
  echo "✅ 备份成功"
  echo "  $DEST"
  echo "  $LATEST"
  echo "  size: $SIZE bytes, funds: $FUND_COUNT"
else
  echo "❌ 备份校验失败：源文件和备份不一致"
  exit 1
fi
