#!/usr/bin/env python3
"""Refresh project-local price sources sequentially, then publish JSON cache."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path


SERVER_ROOT = Path(__file__).resolve().parents[1]
PRICE_ROOT = SERVER_ROOT / "price_tracking"
SCRIPTS = PRICE_ROOT / "scripts"
WORKBOOK = PRICE_ROOT / "price_summarized_optimized.xlsx"
STATUS_FILE = SERVER_ROOT / "data" / "price-tracking" / "refresh-status.json"
EXPORT_SCRIPT = Path(__file__).with_name("export_price_tracking.py")
LAST_GOOD_WORKBOOK = PRICE_ROOT / ".price_summarized_optimized.last-good.xlsx"
LOCK_FILE = SERVER_ROOT / "data" / "price-tracking" / "refresh.lock"
ANACONDA_PYTHON = Path("/Users/rayw/opt/anaconda3/bin/python3")

COLLECTORS = [
    ("钨", "fetch_tungsten_prices.py", []),
    ("伦敦金", "update_xau_price.py", []),
    ("BTC/ETH/ICE布油", "update_btc_eth_cme.py", []),
    ("R32/TDI/MDI", "fetch_r32_price.py", []),
    ("LNG", "fetch_shpgx_lng.py", []),
    ("动力煤", "scrape_q5500.py", []),
    ("氯化钾", "update_kcl.py", []),
    ("钴", "update_co.py", []),
    ("LME铜铝", "update_lme_cnal_prices.py", []),
    ("铪", "scrape_hafnium.py", []),
    ("布伦特原油", "scrape_brent_oil.py", []),
    ("国内期货及COMEX白银", "update_futures_with_comex_silver.py", ["--input", str(WORKBOOK), "--inplace"]),
]


def write_status(payload: dict) -> None:
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATUS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(STATUS_FILE)


def run_command(label: str, script: Path, args: list[str], timeout: int) -> dict:
    started = datetime.now().astimezone().isoformat()
    python_executable = (
        ANACONDA_PYTHON
        if script.name == "update_futures_with_comex_silver.py" and ANACONDA_PYTHON.exists()
        else Path(sys.executable)
    )
    try:
        result = subprocess.run(
            [str(python_executable), str(script), *args],
            cwd=PRICE_ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "label": label,
            "script": script.name,
            "startedAt": started,
            "success": result.returncode == 0,
            "returnCode": result.returncode,
            "message": (result.stdout or result.stderr or "").strip()[-1200:],
        }
    except Exception as error:
        return {"label": label, "script": script.name, "startedAt": started, "success": False, "message": str(error)}


def acquire_refresh_lock():
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    lock_handle = LOCK_FILE.open("a+", encoding="utf-8")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_handle.close()
        print("price refresh skipped; another refresh is already running")
        raise SystemExit(0)
    lock_handle.seek(0)
    lock_handle.truncate()
    lock_handle.write(str(os.getpid()))
    lock_handle.flush()
    return lock_handle


def workbook_is_valid() -> bool:
    try:
        with zipfile.ZipFile(WORKBOOK) as archive:
            return archive.testzip() is None
    except Exception:
        return False


def snapshot_workbook() -> None:
    if workbook_is_valid():
        shutil.copy2(WORKBOOK, LAST_GOOD_WORKBOOK)


def restore_workbook_if_needed(result: dict) -> dict:
    if workbook_is_valid():
        return result
    if LAST_GOOD_WORKBOOK.exists():
        shutil.copy2(LAST_GOOD_WORKBOOK, WORKBOOK)
    return {**result, "success": False, "message": f"{result.get('message', '')}\nWorkbook validation failed; restored last good snapshot.".strip()}


def main() -> None:
    refresh_lock = acquire_refresh_lock()
    parser = argparse.ArgumentParser()
    parser.add_argument("--export-only", action="store_true")
    parser.add_argument("--only", choices=["tungsten"])
    parser.add_argument("--skip-tungsten", action="store_true")
    args = parser.parse_args()
    started_at = datetime.now().astimezone().isoformat()
    results = []
    collectors = (
        COLLECTORS[:1]
        if args.only == "tungsten"
        else COLLECTORS[1:]
        if args.skip_tungsten
        else COLLECTORS
    )
    refresh_mode = args.only or ("export" if args.export_only else "full")

    if not args.export_only:
        for label, filename, collector_args in collectors:
            snapshot_workbook()
            collector_result = run_command(label, SCRIPTS / filename, collector_args, 180)
            collector_result = restore_workbook_if_needed(collector_result)
            results.append(collector_result)
            publish_result = run_command("增量导出价格缓存", EXPORT_SCRIPT, [], 120)
            write_status({
                "updating": True,
                "mode": refresh_mode,
                "startedAt": started_at,
                "current": label,
                "lastPublishedAt": datetime.now().astimezone().isoformat() if publish_result["success"] else None,
                "publishError": None if publish_result["success"] else publish_result["message"],
                "results": results,
            })

    export_result = run_command("导出价格缓存", EXPORT_SCRIPT, [], 120)
    results.append(export_result)
    completed_at = datetime.now().astimezone().isoformat()
    failed_sources = [item["label"] for item in results if not item["success"]]
    write_status({
        "updating": False,
        "mode": refresh_mode,
        "startedAt": started_at,
        "completedAt": completed_at,
        "success": export_result["success"] and not failed_sources,
        "cachePublished": export_result["success"],
        "failedSources": failed_sources,
        "results": results,
    })
    if not export_result["success"]:
        raise SystemExit(1)
    suffix = f"; failed sources: {', '.join(failed_sources)}" if failed_sources else ""
    print(f"price refresh completed; {sum(1 for item in results if item['success'])}/{len(results)} tasks succeeded{suffix}")


if __name__ == "__main__":
    main()
