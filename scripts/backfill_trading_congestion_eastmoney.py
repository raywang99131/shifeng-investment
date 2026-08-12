#!/usr/bin/env python3
"""Backfill trading congestion data with Eastmoney data only.

Modes:
- top100-fields: enrich cached Top100 rows with Eastmoney historical kline fields.
- long-history: slowly crawl Eastmoney stock klines and aggregate daily concentration.

The script is intentionally resumable and rate-limited because Eastmoney can reject
bursty requests with empty replies or 502 responses.
"""

from __future__ import annotations

import argparse
import json
import math
import multiprocessing
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


ROOT = Path(__file__).resolve().parents[1]
TMT_CACHE = ROOT / "server/data/tmt-margin/latest.json"
EM_KLINE_CACHE = ROOT / "server/data/tmt-margin/eastmoney-kline-cache.json"
EM_UNIVERSE_CACHE = ROOT / "server/data/tmt-margin/eastmoney-universe.json"
EM_LONG_HISTORY = ROOT / "server/data/tmt-margin/eastmoney-long-history.json"
EM_SPOT_SNAPSHOTS = ROOT / "server/data/tmt-margin/eastmoney-spot-snapshots.json"
HISTORICAL_SNAPSHOT_PROGRESS_DIR = ROOT / "server/data/tmt-margin/historical-snapshot-progress"
TUSHARE_HISTORICAL_SOURCE = "tushare_historical_reconstruction"
TUSHARE_DAILY_FALLBACK_SOURCE = "tushare_daily_fallback"
TUSHARE_MIN_ALL_A_ROWS = 5000
AKSHARE_SINA_HISTORICAL_SOURCE = "akshare_sina_historical_reconstruction"
EM_CLIST_URL = "https://push2.eastmoney.com/api/qt/clist/get"
EM_SPOT_URLS = [
    "https://push2delay.eastmoney.com/api/qt/clist/get",
    "https://82.push2.eastmoney.com/api/qt/clist/get",
    EM_CLIST_URL,
]
SINA_SPOT_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
SINA_SPOT_COUNT_URL = "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a"
SINA_INDEX_URL = "https://hq.sinajs.cn/list=sh000001"
EM_KLINE_HOSTS = [
    "https://push2his.eastmoney.com",
    "https://1.push2his.eastmoney.com",
    "https://2.push2his.eastmoney.com",
    "https://33.push2his.eastmoney.com",
    "https://53.push2his.eastmoney.com",
    "https://72.push2his.eastmoney.com",
    "https://84.push2his.eastmoney.com",
]
EM_KLINE_PATH = "/api/qt/stock/kline/get"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "close",
    "Referer": "https://quote.eastmoney.com/",
}


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    tmp.replace(path)


def normalize_code(code: Any) -> str:
    text = str(code or "").strip()
    text = re.sub(r"^(sh|sz|bj)\.?", "", text, flags=re.I)
    text = text.split(".")[0]
    return text.zfill(6)


def normalize_date(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    if not text:
        return None
    text = text.replace("-", "")[:8]
    return text if len(text) == 8 and text.isdigit() else None


def is_strict_a_share_code(provider_code: Any) -> bool:
    """Exclude indices/funds while retaining Shanghai, Shenzhen and Beijing A shares."""
    text = str(provider_code or "").strip().lower()
    if re.fullmatch(r"sh\.(?:600|601|603|605|688|689)\d{3}", text):
        return True
    if re.fullmatch(r"sz\.(?:000|001|002|003|300|301)\d{3}", text):
        return True
    return bool(re.fullmatch(r"bj\.[489]\d{5}", text))


def is_strict_tushare_a_share_code(provider_code: Any) -> bool:
    """Accept stock codes only; reject indices, funds and B shares."""
    match = re.fullmatch(r"(\d{6})\.(SH|SZ|BJ)", str(provider_code or "").strip().upper())
    if not match:
        return False
    code, market = match.groups()
    if market == "SH":
        return code.startswith("6")
    if market == "SZ":
        return code.startswith(("0", "3"))
    return code.startswith(("4", "8", "9"))


def secid_for_code(code: str) -> str:
    code = normalize_code(code)
    return f"1.{code}" if code.startswith(("6", "9")) else f"0.{code}"


def parse_float(value: str) -> Optional[float]:
    if value in ("", "-", "None", "null"):
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except Exception:
        return None


def parse_kline(line: str) -> Optional[Dict[str, Any]]:
    parts = line.split(",")
    if len(parts) < 11:
        return None
    date = parts[0].replace("-", "")
    return {
        "date": date,
        "open": parse_float(parts[1]),
        "close": parse_float(parts[2]),
        "high": parse_float(parts[3]),
        "low": parse_float(parts[4]),
        "volume": parse_float(parts[5]),
        "amount": parse_float(parts[6]),
        "amplitude": parse_float(parts[7]),
        "pct_chg": parse_float(parts[8]),
        "chg": parse_float(parts[9]),
        "turnover_rate": parse_float(parts[10]),
    }


def spot_trade_date(item: Dict[str, Any]) -> Optional[str]:
    date = normalize_date(item.get("f297"))
    if date and len(date) == 8:
        return date
    ts = parse_float(item.get("f124"))
    if ts and ts > 0:
        try:
            return datetime.fromtimestamp(ts).strftime("%Y%m%d")
        except Exception:
            return None
    return None


def fetch_eastmoney_spot_top100(session: requests.Session) -> Tuple[Optional[str], List[Dict[str, Any]], str]:
    params = {
        "pn": 1,
        "pz": 100,
        "po": 1,
        "np": 1,
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": 2,
        "invt": 2,
        "fid": "f6",
        "fs": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
        "fields": "f2,f3,f5,f6,f8,f10,f12,f14,f20,f21,f124,f297",
    }
    last_error = ""
    spot_headers = {
        **HEADERS,
        "Referer": "https://quote.eastmoney.com/center/gridlist.html",
    }
    for url in EM_SPOT_URLS:
        try:
            resp = session.get(url, params=params, headers=spot_headers, timeout=10)
            if resp.status_code != 200:
                last_error = f"{url} HTTP {resp.status_code}"
                continue
            rows = (resp.json().get("data") or {}).get("diff") or []
            if not rows:
                last_error = f"{url} returned empty diff"
                continue
            trade_date = spot_trade_date(rows[0])
            return trade_date, rows, url
        except Exception as exc:
            last_error = f"{url} {exc}"
            continue
    raise RuntimeError(last_error or "Eastmoney spot snapshot failed")


def fetch_eastmoney_spot_page(
    session: requests.Session,
    page: int,
    page_size: int,
    request_timeout: float = 12,
    urls: Optional[List[str]] = None,
) -> Tuple[Optional[str], List[Dict[str, Any]], int, str]:
    params = {
        "pn": page,
        "pz": page_size,
        "po": 1,
        "np": 1,
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": 2,
        "invt": 2,
        "fid": "f6",
        "fs": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
        "fields": "f2,f3,f5,f6,f8,f10,f12,f14,f20,f21,f124,f297",
    }
    last_error = ""
    spot_headers = {
        **HEADERS,
        "Referer": "https://quote.eastmoney.com/center/gridlist.html",
    }
    for url in urls or EM_SPOT_URLS:
        try:
            resp = session.get(url, params=params, headers=spot_headers, timeout=request_timeout)
            if resp.status_code != 200:
                last_error = f"{url} HTTP {resp.status_code}"
                continue
            data = resp.json().get("data") or {}
            rows = data.get("diff") or []
            if not rows:
                last_error = f"{url} returned empty diff"
                continue
            return spot_trade_date(rows[0]), rows, int(data.get("total") or 0), url
        except Exception as exc:
            last_error = f"{url} {exc}"
            continue
    raise RuntimeError(last_error or "Eastmoney spot page failed")


def fetch_eastmoney_spot_all(
    session: requests.Session,
    page_size: int = 100,
    request_timeout: float = 12,
    max_workers: int = 6,
    host_limit: int = 3,
) -> Tuple[str, List[Dict[str, Any]], str]:
    spot_urls = EM_SPOT_URLS[:max(1, min(int(host_limit or 1), len(EM_SPOT_URLS)))]
    first_date, first_rows, total, source_url = fetch_eastmoney_spot_page(
        session, 1, page_size, request_timeout, spot_urls
    )
    rows = list(first_rows)
    actual_page_size = max(1, len(first_rows))
    page_count = max(1, math.ceil(total / actual_page_size)) if total else 1
    if page_count > 1:
        page_rows_by_number: Dict[int, List[Dict[str, Any]]] = {}

        def fetch_page(page: int) -> Tuple[int, List[Dict[str, Any]]]:
            # requests.Session is not guaranteed to be thread-safe, so each
            # worker owns a short-lived session while sharing no mutable state.
            with requests.Session() as page_session:
                _, page_rows, _, _ = fetch_eastmoney_spot_page(
                    page_session, page, page_size, request_timeout, spot_urls
                )
            return page, page_rows

        worker_count = max(1, min(int(max_workers or 1), 8, page_count - 1))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(fetch_page, page) for page in range(2, page_count + 1)]
            for future in as_completed(futures):
                page, page_rows = future.result()
                page_rows_by_number[page] = page_rows

        for page in range(2, page_count + 1):
            rows.extend(page_rows_by_number[page])
    trade_dates = [spot_trade_date(row) for row in rows]
    trade_dates = [date for date in trade_dates if date]
    trade_date = max(trade_dates) if trade_dates else first_date
    if not trade_date:
        raise RuntimeError("Eastmoney spot snapshot has no trade date")
    if total and len(rows) < total * 0.9:
        raise RuntimeError(f"Eastmoney spot snapshot incomplete rows={len(rows)} total={total}")
    return trade_date, rows, source_url


def fetch_sina_spot_all(
    request_timeout: float = 8,
    max_workers: int = 4,
) -> Tuple[str, List[Dict[str, Any]], str]:
    headers = {
        **HEADERS,
        "Referer": "https://finance.sina.com.cn/",
    }
    index_response = requests.get(SINA_INDEX_URL, headers=headers, timeout=request_timeout)
    index_response.raise_for_status()
    trade_date_match = re.search(r",(\d{4}-\d{2}-\d{2}),\d{2}:\d{2}:\d{2},", index_response.text)
    if not trade_date_match:
        raise RuntimeError("Sina spot snapshot has no trade date")
    trade_date = trade_date_match.group(1).replace("-", "")

    count_response = requests.get(SINA_SPOT_COUNT_URL, headers=headers, timeout=request_timeout)
    count_response.raise_for_status()
    count_match = re.search(r"\d+", count_response.text)
    total = int(count_match.group(0)) if count_match else 0
    if total <= 0:
        raise RuntimeError("Sina spot snapshot has no stock count")

    page_size = 100
    page_count = math.ceil(total / page_size)

    def fetch_page(page: int) -> Tuple[int, List[Dict[str, Any]]]:
        params = {
            "page": str(page),
            "num": str(page_size),
            "sort": "symbol",
            "asc": "1",
            "node": "hs_a",
            "symbol": "",
            "_s_r_a": "page",
        }
        raw_rows = None
        last_error = None
        for attempt in range(2):
            try:
                response = requests.get(SINA_SPOT_URL, params=params, headers=headers, timeout=request_timeout)
                response.raise_for_status()
                raw_rows = response.json()
                if isinstance(raw_rows, list) and raw_rows:
                    break
                last_error = RuntimeError(f"Sina spot page {page} returned empty data")
            except Exception as exc:
                last_error = exc
            if attempt == 0:
                time.sleep(0.3)
        if not isinstance(raw_rows, list) or not raw_rows:
            raise RuntimeError(f"Sina spot page {page} failed: {last_error}")
        mapped_rows: List[Dict[str, Any]] = []
        for item in raw_rows:
            market_cap = parse_float(item.get("mktcap"))
            float_market_cap = parse_float(item.get("nmc"))
            mapped_rows.append({
                "f2": item.get("trade"),
                "f3": item.get("changepercent"),
                "f5": item.get("volume"),
                "f6": item.get("amount"),
                "f8": item.get("turnoverratio"),
                "f10": None,
                "f12": item.get("code"),
                "f14": item.get("name"),
                "f20": market_cap * 10000 if market_cap is not None else None,
                "f21": float_market_cap * 10000 if float_market_cap is not None else None,
                "f297": trade_date,
            })
        return page, mapped_rows

    rows_by_page: Dict[int, List[Dict[str, Any]]] = {}
    worker_count = max(1, min(int(max_workers or 1), 8, page_count))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = [executor.submit(fetch_page, page) for page in range(1, page_count + 1)]
        for future in as_completed(futures):
            page, page_rows = future.result()
            rows_by_page[page] = page_rows

    rows = [row for page in range(1, page_count + 1) for row in rows_by_page[page]]
    if len(rows) < total * 0.9:
        raise RuntimeError(f"Sina spot snapshot incomplete rows={len(rows)} total={total}")
    return trade_date, rows, SINA_SPOT_URL


def build_spot_trading_snapshot(
    trade_date: str,
    rows: List[Dict[str, Any]],
    source_key: str = "eastmoney_spot",
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    items: List[Dict[str, Any]] = []
    for row in rows:
        code = normalize_code(row.get("f12"))
        name = str(row.get("f14") or "").strip()
        amount = parse_float(row.get("f6"))
        if not code or not name or amount is None or amount <= 0:
            continue
        volume = parse_float(row.get("f5"))
        items.append({
            "code": code,
            "name": name,
            "price": parse_float(row.get("f2")),
            "pct_chg": parse_float(row.get("f3")),
            "volume": volume,
            "amount": amount,
            "turnover_rate": parse_float(row.get("f8")),
            "volume_ratio": parse_float(row.get("f10")),
            "market_cap": parse_float(row.get("f20")),
            "float_market_cap": parse_float(row.get("f21")),
            "source": source_key,
        })
    if not items:
        raise RuntimeError("Eastmoney spot snapshot has no valid rows")

    items.sort(key=lambda item: float(item["amount"]), reverse=True)
    stock_count = len(items)
    total_amount = sum(float(item["amount"]) for item in items)
    row: Dict[str, Any] = {
        "date": trade_date,
        "source": source_key,
        "stock_count": stock_count,
        "total_amount": round(total_amount, 2),
        "total_amount_yi": round(total_amount / 1e8, 2),
    }
    for key, pct in [("top1", 0.01), ("top3", 0.03), ("top5", 0.05)]:
        count = max(1, math.ceil(stock_count * pct))
        amount = sum(float(item["amount"]) for item in items[:count])
        row[f"{key}_count"] = count
        row[f"{key}_amount"] = round(amount, 2)
        row[f"{key}_amount_yi"] = round(amount / 1e8, 2)
        row[f"{key}_ratio"] = round(amount / total_amount * 100, 2) if total_amount > 0 else None

    def top_list(ranked: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result = []
        for rank, item in enumerate(ranked[:100], 1):
            amount = float(item["amount"])
            volume = item.get("volume")
            result.append({
                "rank": rank,
                "code": item["code"],
                "name": item["name"],
                "price": round(float(item["price"]), 2) if item.get("price") is not None else None,
                "pct_chg": round(float(item["pct_chg"]), 2) if item.get("pct_chg") is not None else None,
                "volume": round(float(volume), 0) if volume is not None else None,
                "volume_10k_lot": round(float(volume) / 10000, 2) if volume is not None else None,
                "amount": round(amount, 2),
                "amount_yi": round(amount / 1e8, 2),
                "amount_share": round(amount / total_amount * 100, 2) if total_amount > 0 else None,
                "turnover_rate": round(float(item["turnover_rate"]), 2) if item.get("turnover_rate") is not None else None,
                "volume_ratio": round(float(item["volume_ratio"]), 2) if item.get("volume_ratio") is not None else None,
                "market_cap_yi": round(float(item["market_cap"]) / 1e8, 1) if item.get("market_cap") is not None else None,
                "float_market_cap_yi": round(float(item["float_market_cap"]) / 1e8, 1) if item.get("float_market_cap") is not None else None,
                "source": source_key,
            })
        return result

    top100 = top_list(items)
    volume_ranked = sorted(items, key=lambda item: float(item.get("volume") or 0), reverse=True)
    volume_top100 = top_list(volume_ranked)
    return row, top100, volume_top100


def build_historical_trading_snapshot(
    trade_date: str,
    rows: List[Dict[str, Any]],
    source_key: str = TUSHARE_HISTORICAL_SOURCE,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Build the spot-compatible snapshot contract from one historical daily bar."""
    spot_rows = []
    for item in rows:
        volume_shares = parse_float(item.get("volume"))
        spot_rows.append({
            "f2": item.get("close"),
            "f3": item.get("pct_chg"),
            # Provider volume is normalized to shares; spot f5 is lots (100 shares).
            "f5": volume_shares / 100 if volume_shares is not None else None,
            "f6": item.get("amount"),
            "f8": item.get("turnover_rate"),
            "f10": item.get("volume_ratio"),
            "f12": item.get("code"),
            "f14": item.get("name"),
            "f20": item.get("market_cap"),
            "f21": item.get("float_market_cap"),
            "f297": trade_date,
        })
    return build_spot_trading_snapshot(trade_date, spot_rows, source_key)


def merge_tushare_historical_rows(
    trade_date: str,
    daily_rows: List[Dict[str, Any]],
    basic_rows: List[Dict[str, Any]],
    names_by_code: Optional[Dict[str, str]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Join Tushare bulk responses and normalize units to the snapshot contract."""
    names_by_code = names_by_code or {}
    daily_by_code = {
        normalize_code(item.get("ts_code")): item
        for item in daily_rows
        if normalize_code(item.get("ts_code"))
    }
    basic_by_code = {
        normalize_code(item.get("ts_code")): item
        for item in basic_rows
        if normalize_code(item.get("ts_code"))
    }
    rows = []
    for code in sorted(set(daily_by_code) & set(basic_by_code)):
        daily = daily_by_code[code]
        basic = basic_by_code[code]
        volume_lots = parse_float(daily.get("vol"))
        amount_thousand_yuan = parse_float(daily.get("amount"))
        total_mv_ten_thousand_yuan = parse_float(basic.get("total_mv"))
        circ_mv_ten_thousand_yuan = parse_float(basic.get("circ_mv"))
        rows.append({
            "date": trade_date,
            "code": code,
            "name": names_by_code.get(code) or code,
            "close": parse_float(daily.get("close")),
            "preclose": parse_float(daily.get("pre_close")),
            "pct_chg": parse_float(daily.get("pct_chg")),
            "volume": volume_lots * 100 if volume_lots is not None else None,
            "amount": amount_thousand_yuan * 1000 if amount_thousand_yuan is not None else None,
            "turnover_rate": parse_float(basic.get("turnover_rate")),
            "volume_ratio": parse_float(basic.get("volume_ratio")),
            "market_cap": total_mv_ten_thousand_yuan * 10000 if total_mv_ten_thousand_yuan is not None else None,
            "float_market_cap": circ_mv_ten_thousand_yuan * 10000 if circ_mv_ten_thousand_yuan is not None else None,
            "source": TUSHARE_HISTORICAL_SOURCE,
        })
    return rows, {
        "dailyRowCount": len(daily_rows),
        "dailyUniqueCodeCount": len(daily_by_code),
        "dailyBasicRowCount": len(basic_rows),
        "dailyBasicUniqueCodeCount": len(basic_by_code),
        "joinedRowCount": len(rows),
    }


def validate_tushare_bulk_rows(
    trade_date: str,
    dataset: str,
    rows: List[Dict[str, Any]],
    expected_row_count: Optional[int] = None,
    min_row_count: int = TUSHARE_MIN_ALL_A_ROWS,
) -> set[str]:
    """Validate one complete, single-date Tushare all-A cross-section."""
    if not rows:
        raise RuntimeError(f"Tushare {dataset} returned no rows for {trade_date}")

    wrong_dates = sorted({
        str(item.get("trade_date") or "")
        for item in rows
        if normalize_date(item.get("trade_date")) != trade_date
    })
    if wrong_dates:
        raise RuntimeError(
            f"Tushare {dataset} date gate failed: target={trade_date} "
            f"unexpected_dates={wrong_dates[:5]}"
        )

    invalid_codes = sorted({
        str(item.get("ts_code") or "")
        for item in rows
        if not is_strict_tushare_a_share_code(item.get("ts_code"))
    })
    if invalid_codes:
        raise RuntimeError(
            f"Tushare {dataset} A-share universe gate failed: "
            f"invalid_codes={invalid_codes[:5]}"
        )

    codes = {normalize_code(item.get("ts_code")) for item in rows}
    if len(codes) != len(rows):
        raise RuntimeError(
            f"Tushare {dataset} unique-code gate failed: "
            f"rows={len(rows)} unique_codes={len(codes)}"
        )

    if expected_row_count is not None and expected_row_count > 0:
        if len(rows) != expected_row_count:
            raise RuntimeError(
                f"Tushare {dataset} row-count gate failed: "
                f"expected={expected_row_count} rows={len(rows)}"
            )
    elif len(rows) < min_row_count:
        raise RuntimeError(
            f"Tushare {dataset} all-A coverage gate failed: "
            f"minimum={min_row_count} rows={len(rows)}"
        )
    return codes


def fetch_and_cache_tushare_daily_rows(
    trade_date: str,
    expected_row_count: Optional[int] = None,
    pro: Any = None,
) -> List[Dict[str, Any]]:
    """Persist the higher-frequency daily response independently of daily_basic."""
    path = HISTORICAL_SNAPSHOT_PROGRESS_DIR / f"tushare-{trade_date}-daily.json"
    cached = read_json(path, {})
    rows = cached.get("rows") or []
    if cached.get("date") == trade_date and cached.get("dataset") == "daily":
        try:
            validate_tushare_bulk_rows(
                trade_date, "daily", rows, expected_row_count
            )
            return rows
        except RuntimeError:
            pass
    if pro is None:
        import tushare as ts
        pro = ts.pro_api()
    rows = pro.daily(
        trade_date=trade_date,
        fields="ts_code,trade_date,close,pre_close,pct_chg,vol,amount",
    ).to_dict("records")
    validate_tushare_bulk_rows(trade_date, "daily", rows, expected_row_count)
    write_json(path, {
        "source": TUSHARE_HISTORICAL_SOURCE,
        "dataset": "daily",
        "date": trade_date,
        "updatedAt": datetime.now().isoformat(),
        "rows": rows,
    })
    return rows


def build_tushare_daily_fallback_rows(
    trade_date: str,
    daily_rows: List[Dict[str, Any]],
    names_by_code: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Normalize Tushare daily when low-frequency daily_basic is unavailable."""
    names_by_code = names_by_code or {}
    rows = []
    for daily in daily_rows:
        code = normalize_code(daily.get("ts_code"))
        volume_lots = parse_float(daily.get("vol"))
        amount_thousand_yuan = parse_float(daily.get("amount"))
        rows.append({
            "date": trade_date,
            "code": code,
            "name": names_by_code.get(code) or code,
            "close": parse_float(daily.get("close")),
            "preclose": parse_float(daily.get("pre_close")),
            "pct_chg": parse_float(daily.get("pct_chg")),
            "volume": volume_lots * 100 if volume_lots is not None else None,
            "amount": amount_thousand_yuan * 1000 if amount_thousand_yuan is not None else None,
            "turnover_rate": None,
            "volume_ratio": None,
            "market_cap": None,
            "float_market_cap": None,
            "source": TUSHARE_DAILY_FALLBACK_SOURCE,
        })
    return rows


def fetch_tushare_daily_fallback_rows(
    trade_date: str,
    names_by_code: Optional[Dict[str, str]] = None,
    pro: Any = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Fetch the complete all-A daily cross-section without daily_basic fields."""
    daily_rows = fetch_and_cache_tushare_daily_rows(
        trade_date, expected_row_count=None, pro=pro
    )
    codes = validate_tushare_bulk_rows(trade_date, "daily", daily_rows)
    rows = build_tushare_daily_fallback_rows(
        trade_date, daily_rows, names_by_code
    )
    return rows, {
        "dailyRowCount": len(daily_rows),
        "dailyUniqueCodeCount": len(codes),
        "joinedRowCount": len(rows),
    }


def fetch_tushare_historical_rows(
    trade_date: str,
    names_by_code: Optional[Dict[str, str]] = None,
    expected_row_count: Optional[int] = None,
    pro: Any = None,
    retries: int = 3,
    retry_delay: float = 2,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Fetch daily + daily_basic through Tushare's local credential mechanism."""
    if pro is None:
        import tushare as ts
        pro = ts.pro_api()

    def cached_bulk_rows(dataset: str, loader: Any) -> List[Dict[str, Any]]:
        path = HISTORICAL_SNAPSHOT_PROGRESS_DIR / f"tushare-{trade_date}-{dataset}.json"
        cached = read_json(path, {})
        cached_rows = cached.get("rows") or []
        if cached.get("date") == trade_date and cached.get("dataset") == dataset:
            try:
                validate_tushare_bulk_rows(
                    trade_date, dataset, cached_rows, expected_row_count
                )
                return cached_rows
            except RuntimeError:
                pass
        last_error = ""
        for attempt in range(retries + 1):
            try:
                rows = loader().to_dict("records")
                validate_tushare_bulk_rows(
                    trade_date, dataset, rows, expected_row_count
                )
                write_json(path, {
                    "source": TUSHARE_HISTORICAL_SOURCE,
                    "dataset": dataset,
                    "date": trade_date,
                    "updatedAt": datetime.now().isoformat(),
                    "rows": rows,
                })
                return rows
            except Exception as exc:
                last_error = str(exc)
                # Rate-limit windows are long; fail immediately and let the
                # caller retry at the known safe window instead of hammering.
                if "频率超限" in last_error or attempt >= retries:
                    raise
                time.sleep(retry_delay * (attempt + 1))
        raise RuntimeError(f"Tushare {dataset} failed: {last_error}")

    # Fetch and persist the low-frequency endpoint first. Once cached, retries
    # never consume its hourly allowance again.
    basic_rows = cached_bulk_rows(
        "daily-basic",
        lambda: pro.daily_basic(
            trade_date=trade_date,
            fields="ts_code,trade_date,turnover_rate,volume_ratio,total_mv,circ_mv",
        ),
    )
    daily_rows = cached_bulk_rows(
        "daily",
        lambda: pro.daily(
            trade_date=trade_date,
            fields="ts_code,trade_date,close,pre_close,pct_chg,vol,amount",
        ),
    )
    daily_codes = validate_tushare_bulk_rows(
        trade_date, "daily", daily_rows, expected_row_count
    )
    basic_codes = validate_tushare_bulk_rows(
        trade_date, "daily-basic", basic_rows, expected_row_count
    )
    daily_only = daily_codes - basic_codes
    basic_only = basic_codes - daily_codes
    if daily_only or basic_only:
        raise RuntimeError(
            "Tushare daily/daily_basic universe gate failed: "
            f"daily_only={len(daily_only)} sample={sorted(daily_only)[:5]} "
            f"daily_basic_only={len(basic_only)} sample={sorted(basic_only)[:5]}"
        )
    rows, counts = merge_tushare_historical_rows(
        trade_date,
        daily_rows,
        basic_rows,
        names_by_code,
    )
    strict_counts = {
        counts["dailyRowCount"],
        counts["dailyUniqueCodeCount"],
        counts["dailyBasicRowCount"],
        counts["dailyBasicUniqueCodeCount"],
        counts["joinedRowCount"],
    }
    if len(strict_counts) != 1:
        raise RuntimeError(
            f"Tushare historical same-universe gate failed: counts={counts}"
        )
    counts["dailyOnlyCodeCount"] = 0
    counts["dailyBasicOnlyCodeCount"] = 0
    return rows, counts


def akshare_sina_symbol(code: Any) -> str:
    normalized = normalize_code(code)
    if normalized.startswith(("5", "6", "9")):
        return f"sh{normalized}"
    if normalized.startswith(("0", "1", "2", "3")):
        return f"sz{normalized}"
    return f"bj{normalized}"


def build_akshare_sina_historical_row(
    trade_date: str,
    code: str,
    name: str,
    records: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    ordered = sorted(
        [item for item in records if normalize_date(item.get("date"))],
        key=lambda item: normalize_date(item.get("date")) or "",
    )
    target_index = next(
        (
            index for index, item in enumerate(ordered)
            if normalize_date(item.get("date")) == trade_date
        ),
        None,
    )
    if target_index is None:
        return None
    item = ordered[target_index]
    close = parse_float(item.get("close"))
    volume = parse_float(item.get("volume"))
    amount = parse_float(item.get("amount"))
    if (
        close is None or volume is None or amount is None
        or not math.isfinite(close) or not math.isfinite(volume)
        or not math.isfinite(amount) or amount <= 0
    ):
        return None
    previous = ordered[max(0, target_index - 5):target_index]
    previous_close = (
        parse_float(ordered[target_index - 1].get("close"))
        if target_index > 0
        else None
    )
    previous_volumes = [
        value for value in (parse_float(row.get("volume")) for row in previous)
        if value is not None and math.isfinite(value) and value > 0
    ]
    volume_ratio = None
    if previous_volumes:
        average_volume = sum(previous_volumes) / len(previous_volumes)
        if average_volume > 0:
            volume_ratio = volume / average_volume
    turnover_fraction = parse_float(item.get("turnover"))
    outstanding_share = parse_float(item.get("outstanding_share"))
    return {
        "date": trade_date,
        "code": normalize_code(code),
        "name": name,
        "close": close,
        "preclose": previous_close,
        "pct_chg": (
            (close / previous_close - 1) * 100
            if previous_close is not None and previous_close > 0
            else None
        ),
        "volume": volume,
        "amount": amount,
        "turnover_rate": (
            turnover_fraction * 100
            if turnover_fraction is not None and math.isfinite(turnover_fraction)
            else None
        ),
        "volume_ratio": volume_ratio,
        "market_cap": None,
        "float_market_cap": (
            outstanding_share * close
            if outstanding_share is not None and math.isfinite(outstanding_share)
            else None
        ),
        "trade_status": "1",
        "source": AKSHARE_SINA_HISTORICAL_SOURCE,
    }


def fetch_akshare_sina_historical_rows(
    trade_date: str,
    stocks: List[Dict[str, str]],
    workers: int = 8,
    save_every: int = 25,
    retries: int = 2,
    retry_delay: float = 1,
    max_codes: int = 0,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Fetch a resumable historical cross-section through AkShare's Sina API."""
    import akshare as ak

    # AkShare's Sina decoder constructs a V8 runtime per request. Its global
    # address pool is not safe to initialize concurrently, so initialize it
    # once on the main thread before the worker pool starts.
    if workers > 1:
        import py_mini_racer
        js_runtime = py_mini_racer.MiniRacer()
        js_runtime.eval("1 + 1")

    progress_path = (
        HISTORICAL_SNAPSHOT_PROGRESS_DIR
        / f"akshare-sina-{trade_date}.json"
    )
    progress = read_json(progress_path, {
        "source": AKSHARE_SINA_HISTORICAL_SOURCE,
        "date": trade_date,
        "rows": {},
        "failures": {},
    })
    cached_rows = progress.setdefault("rows", {})
    failures = progress.setdefault("failures", {})
    targets = [
        {"code": normalize_code(item.get("code")), "name": str(item.get("name") or "")}
        for item in stocks
        if normalize_code(item.get("code"))
    ]
    pending = [item for item in targets if item["code"] not in cached_rows]
    if max_codes and max_codes > 0:
        pending = pending[:max_codes]
    start_date = "20260710" if trade_date == "20260720" else trade_date

    def fetch_one(stock: Dict[str, str]) -> Tuple[str, Optional[Dict[str, Any]], str]:
        code = stock["code"]
        last_error = ""
        for attempt in range(retries + 1):
            try:
                frame = ak.stock_zh_a_daily(
                    symbol=akshare_sina_symbol(code),
                    start_date=start_date,
                    end_date=trade_date,
                    adjust="",
                )
                records = frame.to_dict("records") if frame is not None else []
                row = build_akshare_sina_historical_row(
                    trade_date, code, stock["name"], records
                )
                if row:
                    return code, row, ""
                last_error = "empty target-date row"
                break
            except Exception as exc:
                last_error = str(exc)
                if attempt < retries:
                    time.sleep(retry_delay * (attempt + 1))
        return code, None, last_error

    completed = 0
    fetched = 0
    try:
        worker_count = max(1, min(int(workers), 12, len(pending) or 1))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(fetch_one, stock) for stock in pending]
            for future in as_completed(futures):
                code, row, error = future.result()
                completed += 1
                if row:
                    cached_rows[code] = row
                    failures.pop(code, None)
                    fetched += 1
                else:
                    failures[code] = {
                        "updatedAt": datetime.now().isoformat(),
                        "error": error or "empty target-date row",
                    }
                if completed % max(1, save_every) == 0:
                    progress["updatedAt"] = datetime.now().isoformat()
                    progress["processed"] = completed
                    write_json(progress_path, progress)
                if completed % 100 == 0:
                    print(
                        f"akshare-sina date={trade_date} processed={completed}/{len(pending)} "
                        f"fetched={fetched} cached_total={len(cached_rows)} "
                        f"failures={len(failures)}",
                        flush=True,
                    )
    finally:
        progress["updatedAt"] = datetime.now().isoformat()
        progress["processed"] = completed
        write_json(progress_path, progress)
    rows = [
        row for row in cached_rows.values()
        if str(row.get("date")) == trade_date
    ]
    return rows, {
        "targetCount": len(targets),
        "pendingCount": len(pending),
        "processedCount": completed,
        "fetchedThisRun": fetched,
        "rowCount": len(rows),
        "failureCount": len(failures),
    }


def historical_snapshot_quality(
    row: Dict[str, Any],
    fetched_row_count: int,
    universe_count: int,
    adjacent_stock_counts: List[int],
    min_coverage: float = 0.9,
    min_adjacent_ratio: float = 0.9,
    expected_row_count: Optional[int] = None,
) -> Dict[str, Any]:
    coverage = fetched_row_count / universe_count if universe_count else 0
    adjacent = sorted(int(value) for value in adjacent_stock_counts if int(value) > 0)
    adjacent_baseline = adjacent[len(adjacent) // 2] if adjacent else None
    valid_stock_count = int(row.get("stock_count") or 0)
    adjacent_ratio = (
        valid_stock_count / adjacent_baseline
        if adjacent_baseline
        else None
    )
    failures = []
    if expected_row_count is not None and fetched_row_count != expected_row_count:
        failures.append(
            f"fetched row count {fetched_row_count} does not equal required {expected_row_count}"
        )
    if coverage < min_coverage:
        failures.append(
            f"coverage {coverage:.2%} below minimum {min_coverage:.2%}"
        )
    if adjacent_ratio is None:
        failures.append("no adjacent snapshot stock-count baseline")
    elif adjacent_ratio < min_adjacent_ratio:
        failures.append(
            f"valid stock count ratio {adjacent_ratio:.2%} below adjacent minimum {min_adjacent_ratio:.2%}"
        )
    return {
        "ok": not failures,
        "coverage": round(coverage, 6),
        "fetched_row_count": fetched_row_count,
        "universe_count": universe_count,
        "valid_stock_count": valid_stock_count,
        "adjacent_stock_counts": adjacent,
        "adjacent_baseline": adjacent_baseline,
        "adjacent_ratio": round(adjacent_ratio, 6) if adjacent_ratio is not None else None,
        "expected_row_count": expected_row_count,
        "failures": failures,
    }


def save_spot_snapshot_archive(
    trade_date: str,
    row: Dict[str, Any],
    top100: List[Dict[str, Any]],
    volume_top100: List[Dict[str, Any]],
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    archive = read_json(EM_SPOT_SNAPSHOTS, {"source": "eastmoney_spot_archive", "snapshots": {}})
    snapshots = archive.setdefault("snapshots", {})
    snapshot = {
        "date": trade_date,
        "generatedAt": datetime.now().isoformat(),
        "row": row,
        "top100": top100,
        "volume_top100": volume_top100,
    }
    if metadata:
        snapshot["reconstruction"] = metadata
    snapshots[trade_date] = snapshot
    archive["source"] = "eastmoney_spot_archive"
    archive["updatedAt"] = datetime.now().isoformat()
    write_json(EM_SPOT_SNAPSHOTS, archive)


def merge_spot_snapshot_to_latest(
    trade_date: str,
    row: Dict[str, Any],
    top100: List[Dict[str, Any]],
    volume_top100: List[Dict[str, Any]],
) -> None:
    payload = read_json(TMT_CACHE, {})
    data = payload.setdefault("data", {})
    trading = data.setdefault("trading_congestion", {})
    existing = {
        str(item.get("date")): {k: v for k, v in item.items() if not k.endswith("_percentile")}
        for item in trading.get("trend") or []
        if item.get("date")
    }
    existing[trade_date] = row
    merged = sorted(existing.values(), key=lambda item: str(item.get("date") or ""), reverse=True)
    ratio_values = {
        "top1_ratio": [item.get("top1_ratio") for item in merged],
        "top3_ratio": [item.get("top3_ratio") for item in merged],
        "top5_ratio": [item.get("top5_ratio") for item in merged],
    }
    for item in merged:
        item["top1_percentile"] = percentile(item.get("top1_ratio"), ratio_values["top1_ratio"])
        item["top3_percentile"] = percentile(item.get("top3_ratio"), ratio_values["top3_ratio"])
        item["top5_percentile"] = percentile(item.get("top5_ratio"), ratio_values["top5_ratio"])

    top100_by_date = keep_cached_top100(trading.get("top100_by_date") or {})
    volume_top100_by_date = keep_cached_top100(trading.get("volume_top100_by_date") or {})
    top100_by_date[trade_date] = top100
    volume_top100_by_date[trade_date] = volume_top100
    current_date = max(
        str(trading.get("date") or ""),
        max((str(item.get("date") or "") for item in merged), default=""),
    )
    latest = next((item for item in merged if str(item.get("date")) == current_date), row)
    source_key = str(latest.get("source") or "eastmoney_spot")
    source_label = (
        "新浪全A实时行情（东方财富不可用时降级）；历史趋势/Top100来自本地缓存"
        if source_key == "sina_spot"
        else (
            "Tushare历史日K重建；历史趋势/Top100来自本地缓存"
            if source_key == TUSHARE_HISTORICAL_SOURCE
            else (
                "Tushare历史日K重建（基础行情字段）；历史趋势/Top100来自本地缓存"
                if source_key == TUSHARE_DAILY_FALLBACK_SOURCE
                else "东方财富全A实时行情；历史趋势/Top100来自本地缓存"
            )
        )
    )
    trading.update({
        **latest,
        "date": current_date,
        "warning": warning_for_percentiles(latest),
        "percentile_sample_count": len([item for item in merged if item.get("top1_ratio") is not None]),
        "trend": merged,
        "top100": top100_by_date.get(current_date) or trading.get("top100") or [],
        "volume_top100": volume_top100_by_date.get(current_date) or trading.get("volume_top100") or [],
        "top100_by_date": top100_by_date,
        "volume_top100_by_date": volume_top100_by_date,
        "available_top100_dates": sorted(top100_by_date.keys(), reverse=True),
        "source": source_label,
    })
    payload["success"] = True
    payload["generatedAt"] = datetime.now().isoformat()
    write_json(TMT_CACHE, payload)


def spot_snapshot(args: argparse.Namespace) -> int:
    session = requests.Session()
    provider = args.provider
    eastmoney_error = None
    if args.provider == "sina":
        provider = "sina_fallback"
        trade_date, rows, source_url = fetch_sina_spot_all(
            request_timeout=args.request_timeout,
            max_workers=args.workers,
        )
    elif args.provider == "eastmoney":
        trade_date, rows, source_url = fetch_eastmoney_spot_all(
            session,
            page_size=args.page_size,
            request_timeout=args.request_timeout,
            max_workers=args.workers,
            host_limit=args.host_limit,
        )
    else:
        try:
            provider = "eastmoney"
            trade_date, rows, source_url = fetch_eastmoney_spot_all(
                session,
                page_size=args.page_size,
                request_timeout=args.request_timeout,
                max_workers=args.workers,
                host_limit=args.host_limit,
            )
        except Exception as exc:
            eastmoney_error = str(exc)
            provider = "sina_fallback"
            trade_date, rows, source_url = fetch_sina_spot_all(
                request_timeout=args.request_timeout,
                max_workers=min(args.workers, 4),
            )
    source_key = "sina_spot" if provider == "sina_fallback" else "eastmoney_spot"
    row, top100, volume_top100 = build_spot_trading_snapshot(trade_date, rows, source_key)
    save_spot_snapshot_archive(trade_date, row, top100, volume_top100)
    if args.merge_latest:
        merge_spot_snapshot_to_latest(trade_date, row, top100, volume_top100)
    print(json.dumps({
        "date": trade_date,
        "source": source_url,
        "provider": provider,
        "eastmoney_error": eastmoney_error,
        "stock_count": row.get("stock_count"),
        "top100_rows": len(top100),
        "volume_top100_rows": len(volume_top100),
    }, ensure_ascii=False))
    return 0


def baostock_universe_cache_path(trade_date: str) -> Path:
    return HISTORICAL_SNAPSHOT_PROGRESS_DIR / f"baostock-{trade_date}-universe.json"


def baostock_login(bs: Any, retries: int = 3, retry_delay: float = 2) -> None:
    last_error = ""
    for attempt in range(retries + 1):
        try:
            login = bs.login()
            if login.error_code == "0":
                # BaoStock otherwise has no socket timeout and can hang forever.
                import baostock.common.context as bs_context
                socket = getattr(bs_context, "default_socket", None)
                if socket is not None:
                    socket.settimeout(30)
                return
            last_error = login.error_msg
        except Exception as exc:
            last_error = str(exc)
        if attempt < retries:
            time.sleep(retry_delay * (attempt + 1))
    raise RuntimeError(f"BaoStock login failed: {last_error}")


def fetch_baostock_universe(
    trade_date: str,
    retries: int = 3,
    retry_delay: float = 2,
) -> List[Dict[str, str]]:
    import baostock as bs

    cache_path = baostock_universe_cache_path(trade_date)
    cached = read_json(cache_path, {})
    if cached.get("date") == trade_date and cached.get("stocks"):
        return cached["stocks"]

    day = f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}"
    last_error = ""
    for attempt in range(retries + 1):
        baostock_login(bs, retries=1, retry_delay=retry_delay)
        try:
            query = bs.query_all_stock(day=day)
            if query.error_code != "0":
                raise RuntimeError(query.error_msg)
            rows = []
            while query.next():
                item = dict(zip(query.fields, query.get_row_data()))
                if is_strict_a_share_code(item.get("code")):
                    rows.append({
                        "provider_code": str(item.get("code") or "").lower(),
                        "code": normalize_code(item.get("code")),
                        "name": str(item.get("code_name") or "").strip(),
                    })
            if rows:
                write_json(cache_path, {
                    "source": "baostock_query_all_stock",
                    "date": trade_date,
                    "updatedAt": datetime.now().isoformat(),
                    "stocks": rows,
                })
                return rows
            last_error = "empty universe"
        except Exception as exc:
            last_error = str(exc)
        finally:
            try:
                bs.logout()
            except Exception:
                pass
        if attempt < retries:
            time.sleep(retry_delay * (attempt + 1))
    raise RuntimeError(f"BaoStock universe failed: {last_error}")


def baostock_progress_path(trade_date: str, shard: int) -> Path:
    return HISTORICAL_SNAPSHOT_PROGRESS_DIR / f"baostock-{trade_date}-part-{shard:02d}.json"


def fetch_baostock_historical_shard(
    trade_date: str,
    shard: int,
    stocks: List[Dict[str, str]],
    save_every: int,
    retries: int,
    retry_delay: float,
) -> Dict[str, Any]:
    """Fetch one process-owned shard and save it atomically for resumability."""
    import baostock as bs

    path = baostock_progress_path(trade_date, shard)
    progress = read_json(path, {
        "source": "baostock_historical_reconstruction_progress",
        "date": trade_date,
        "shard": shard,
        "rows": {},
        "failures": {},
    })
    cached_rows = progress.setdefault("rows", {})
    failures = progress.setdefault("failures", {})
    day = f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}"
    baostock_login(bs, retries=retries, retry_delay=retry_delay)
    processed = 0
    fetched = 0
    try:
        for stock in stocks:
            code = normalize_code(stock.get("code"))
            if code in cached_rows:
                continue
            processed += 1
            result_rows = []
            error_code = ""
            error_message = ""
            for attempt in range(retries + 1):
                try:
                    query = bs.query_history_k_data_plus(
                        stock["provider_code"],
                        "date,code,open,high,low,close,preclose,volume,amount,turn,pctChg,tradestatus,isST",
                        start_date=day,
                        end_date=day,
                        frequency="d",
                        adjustflag="3",
                    )
                    error_code = query.error_code
                    error_message = query.error_msg
                    if query.error_code == "0":
                        while query.next():
                            result_rows.append(dict(zip(query.fields, query.get_row_data())))
                    if result_rows:
                        break
                except Exception as exc:
                    error_code = "exception"
                    error_message = str(exc)
                if attempt < retries:
                    try:
                        bs.logout()
                    except Exception:
                        pass
                    time.sleep(retry_delay * (attempt + 1))
                    baostock_login(bs, retries=retries, retry_delay=retry_delay)
            if result_rows:
                item = result_rows[0]
                cached_rows[code] = {
                    "date": trade_date,
                    "code": code,
                    "name": stock.get("name") or "",
                    "open": parse_float(item.get("open")),
                    "high": parse_float(item.get("high")),
                    "low": parse_float(item.get("low")),
                    "close": parse_float(item.get("close")),
                    "preclose": parse_float(item.get("preclose")),
                    "volume": parse_float(item.get("volume")),
                    "amount": parse_float(item.get("amount")),
                    "turnover_rate": parse_float(item.get("turn")),
                    "pct_chg": parse_float(item.get("pctChg")),
                    "trade_status": item.get("tradestatus"),
                    "is_st": item.get("isST"),
                    "source": "baostock_historical_reconstruction",
                }
                failures.pop(code, None)
                fetched += 1
            else:
                failures[code] = {
                    "updatedAt": datetime.now().isoformat(),
                    "error_code": error_code,
                    "error": error_message or "empty historical row",
                }
            if processed % max(1, save_every) == 0:
                progress["updatedAt"] = datetime.now().isoformat()
                progress["processed"] = processed
                write_json(path, progress)
                print(
                    f"historical-snapshot shard={shard} processed={processed}/{len(stocks)} "
                    f"fetched={fetched} failures={len(failures)}",
                    flush=True,
                )
    finally:
        progress["updatedAt"] = datetime.now().isoformat()
        progress["processed"] = processed
        write_json(path, progress)
        bs.logout()
    return {
        "shard": shard,
        "processed": processed,
        "fetched": fetched,
        "failures": len(failures),
        "path": str(path),
    }


def load_baostock_historical_progress(trade_date: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    rows: Dict[str, Any] = {}
    failures: Dict[str, Any] = {}
    if HISTORICAL_SNAPSHOT_PROGRESS_DIR.exists():
        for path in sorted(HISTORICAL_SNAPSHOT_PROGRESS_DIR.glob(f"baostock-{trade_date}-part-*.json")):
            payload = read_json(path, {})
            rows.update(payload.get("rows") or {})
            failures.update(payload.get("failures") or {})
    for code in rows:
        failures.pop(code, None)
    return rows, failures


def adjacent_snapshot_stock_counts(trade_date: str, archive: Dict[str, Any]) -> List[int]:
    snapshots = archive.get("snapshots") or {}
    before = sorted((date for date in snapshots if date < trade_date), reverse=True)
    after = sorted(date for date in snapshots if date > trade_date)
    adjacent_dates = before[:1] + after[:1]
    return [
        int(((snapshots.get(date) or {}).get("row") or {}).get("stock_count") or 0)
        for date in adjacent_dates
        if int(((snapshots.get(date) or {}).get("row") or {}).get("stock_count") or 0) > 0
    ]


def historical_snapshot(args: argparse.Namespace) -> int:
    trade_date = normalize_date(args.date)
    if not trade_date:
        raise ValueError("--date must be YYYYMMDD or YYYY-MM-DD")
    local_universe = read_json(EM_UNIVERSE_CACHE, {}).get("stocks") or []
    local_by_code = {
        normalize_code(item.get("code")): str(item.get("name") or "").strip()
        for item in local_universe
        if normalize_code(item.get("code"))
    }
    if not local_by_code:
        raise RuntimeError("local Eastmoney universe is empty")
    archive = read_json(EM_SPOT_SNAPSHOTS, {"snapshots": {}})
    names_by_code = dict(local_by_code)
    snapshots = archive.get("snapshots") or {}
    for snapshot_date in sorted(snapshots, reverse=True):
        snapshot = snapshots.get(snapshot_date) or {}
        for item in (snapshot.get("top100") or []) + (snapshot.get("volume_top100") or []):
            code = normalize_code(item.get("code"))
            name = str(item.get("name") or "").strip()
            if code and name and name != code:
                names_by_code.setdefault(code, name)
    progress_failures: Dict[str, Any] = {}
    source_counts: Dict[str, int] = {}
    partial_fields: List[str] = []
    if args.provider == "akshare":
        if args.finalize_only:
            progress_path = (
                HISTORICAL_SNAPSHOT_PROGRESS_DIR
                / f"akshare-sina-{trade_date}.json"
            )
            progress = read_json(progress_path, {})
            progress_rows = progress.get("rows") or {}
            progress_failures = progress.get("failures") or {}
            reconstructed = [
                row for row in progress_rows.values()
                if str(row.get("date")) == trade_date
            ]
            source_counts = {
                "targetCount": len(local_by_code),
                "pendingCount": 0,
                "processedCount": int(progress.get("processed") or 0),
                "fetchedThisRun": 0,
                "rowCount": len(reconstructed),
                "failureCount": len(progress_failures),
            }
        else:
            reconstructed, source_counts = fetch_akshare_sina_historical_rows(
                trade_date,
                local_universe,
                workers=args.workers,
                save_every=args.save_every,
                retries=args.retries,
                retry_delay=args.retry_delay,
                max_codes=args.max_codes,
            )
        provider_universe_count = len(local_by_code)
        intersection_count = len(reconstructed)
        print(
            f"historical-snapshot date={trade_date} provider=akshare-sina "
            f"rows={len(reconstructed)} failures={source_counts['failureCount']}",
            flush=True,
        )
    elif args.provider == "tushare":
        reconstructed, source_counts = fetch_tushare_historical_rows(
            trade_date,
            names_by_code,
        )
        provider_universe_count = source_counts["dailyUniqueCodeCount"]
        intersection_count = sum(
            1 for item in reconstructed if normalize_code(item.get("code")) in local_by_code
        )
        print(
            f"historical-snapshot date={trade_date} provider=tushare "
            f"rows={len(reconstructed)} named={intersection_count}",
            flush=True,
        )
    elif args.provider == "tushare-daily":
        reconstructed, source_counts = fetch_tushare_daily_fallback_rows(
            trade_date,
            names_by_code,
        )
        provider_universe_count = source_counts["dailyUniqueCodeCount"]
        intersection_count = sum(
            1 for item in reconstructed if normalize_code(item.get("code")) in local_by_code
        )
        partial_fields = [
            "turnover_rate",
            "volume_ratio",
            "market_cap",
            "float_market_cap",
        ]
        print(
            f"historical-snapshot date={trade_date} provider=tushare-daily "
            f"rows={len(reconstructed)} named={intersection_count}",
            flush=True,
        )
    else:
        provider_universe = fetch_baostock_universe(
            trade_date, args.retries, args.retry_delay
        )
        targets = []
        for item in provider_universe:
            code = normalize_code(item.get("code"))
            if code in local_by_code:
                targets.append({
                    **item,
                    "name": item.get("name") or local_by_code[code],
                })
        targets.sort(key=lambda item: item["code"])
        progress_rows, _ = load_baostock_historical_progress(trade_date)
        pending = [
            item for item in targets
            if normalize_code(item.get("code")) not in progress_rows
        ]
        if args.max_codes and args.max_codes > 0:
            pending = pending[:args.max_codes]
        worker_count = max(1, min(int(args.workers), 8, len(pending) or 1))
        shards = [[] for _ in range(worker_count)]
        for index, stock in enumerate(pending):
            shards[index % worker_count].append(stock)
        print(
            f"historical-snapshot date={trade_date} local_universe={len(local_by_code)} "
            f"provider_universe={len(provider_universe)} intersection={len(targets)} "
            f"cached={len(progress_rows)} pending={len(pending)} workers={worker_count}",
            flush=True,
        )
        tasks = [
            (trade_date, shard, stocks, args.save_every, args.retries, args.retry_delay)
            for shard, stocks in enumerate(shards)
            if stocks
        ]
        if tasks:
            context = multiprocessing.get_context("fork")
            with context.Pool(processes=len(tasks)) as pool:
                summaries = pool.starmap(fetch_baostock_historical_shard, tasks)
            print(json.dumps({"worker_summaries": summaries}, ensure_ascii=False), flush=True)
        progress_rows, progress_failures = load_baostock_historical_progress(trade_date)
        target_codes = {item["code"] for item in targets}
        reconstructed = [
            item for code, item in progress_rows.items()
            if code in target_codes and str(item.get("date")) == trade_date
        ]
        provider_universe_count = len(provider_universe)
        intersection_count = len(targets)

    if args.provider == "akshare":
        source_key = AKSHARE_SINA_HISTORICAL_SOURCE
    elif args.provider == "tushare":
        source_key = TUSHARE_HISTORICAL_SOURCE
    elif args.provider == "tushare-daily":
        source_key = TUSHARE_DAILY_FALLBACK_SOURCE
    else:
        source_key = "baostock_historical_reconstruction"
    row, top100, volume_top100 = build_historical_trading_snapshot(
        trade_date, reconstructed, source_key
    )
    adjacent_counts = adjacent_snapshot_stock_counts(trade_date, archive)
    reference_universe_count = max(adjacent_counts) if adjacent_counts else len(local_by_code)
    quality = historical_snapshot_quality(
        row,
        len(reconstructed),
        reference_universe_count,
        adjacent_counts,
        args.min_coverage,
        args.min_adjacent_ratio,
        None,
    )
    if int(row.get("stock_count") or 0) < args.min_valid_stocks:
        quality["ok"] = False
        quality["failures"].append(
            f"valid stock count {row.get('stock_count')} below minimum {args.min_valid_stocks}"
        )
    metadata = {
        "source": source_key,
        "provider": {
            "akshare": "AkShare stock_zh_a_daily (Sina historical A-share)",
            "tushare": "Tushare daily + daily_basic bulk cross-section",
            "tushare-daily": "Tushare daily bulk cross-section (daily_basic unavailable)",
            "baostock": "BaoStock historical daily K",
        }[args.provider],
        "targetDate": trade_date,
        "localUniverseCount": len(local_by_code),
        "providerUniverseCount": provider_universe_count,
        "intersectionCount": intersection_count,
        "progressRowCount": len(reconstructed),
        "failureCount": len(progress_failures),
        "sourceCounts": source_counts,
        "partialFields": partial_fields,
        "quality": quality,
        "generatedAt": datetime.now().isoformat(),
    }
    print(json.dumps(metadata, ensure_ascii=False, indent=2), flush=True)
    if not quality["ok"]:
        print("historical snapshot quality gate failed; archive was not modified", file=sys.stderr, flush=True)
        return 2

    save_spot_snapshot_archive(trade_date, row, top100, volume_top100, metadata)
    if args.merge_latest:
        merge_spot_snapshot_to_latest(trade_date, row, top100, volume_top100)
    print(json.dumps({
        "date": trade_date,
        "source": source_key,
        "stock_count": row.get("stock_count"),
        "coverage": quality["coverage"],
        "top100_rows": len(top100),
        "volume_top100_rows": len(volume_top100),
        "archive_written": True,
    }, ensure_ascii=False), flush=True)
    return 0


def enrich_item_from_spot(item: Dict[str, Any], spot: Dict[str, Any]) -> bool:
    changed = False
    field_map = [
        ("price", "f2", 2),
        ("pct_chg", "f3", 2),
        ("volume", "f5", 0),
        ("amount", "f6", 2),
        ("turnover_rate", "f8", 2),
        ("volume_ratio", "f10", 2),
    ]
    for target, source, digits in field_map:
        value = parse_float(spot.get(source))
        if value is None:
            continue
        next_value = round(value, digits)
        if item.get(target) != next_value:
            item[target] = next_value
            changed = True
    volume = parse_float(spot.get("f5"))
    if volume is not None:
        next_value = round(volume / 10000, 2)
        if item.get("volume_10k_lot") != next_value:
            item["volume_10k_lot"] = next_value
            changed = True
    amount = parse_float(spot.get("f6"))
    if amount is not None:
        next_value = round(amount / 1e8, 2)
        if item.get("amount_yi") != next_value:
            item["amount_yi"] = next_value
            changed = True
    market_cap = parse_float(spot.get("f20"))
    if market_cap is not None:
        item["market_cap_yi"] = round(market_cap / 1e8, 1)
        changed = True
    float_market_cap = parse_float(spot.get("f21"))
    if float_market_cap is not None:
        item["float_market_cap_yi"] = round(float_market_cap / 1e8, 1)
        changed = True
    name = str(spot.get("f14") or "").strip()
    if name and item.get("name") != name:
        item["name"] = name
        changed = True
    return changed


def enrich_matching_spot_snapshot(
    trading: Dict[str, Any],
    dates: List[str],
    kline_cache: Dict[str, Any],
    session: requests.Session,
) -> int:
    try:
        spot_date, rows, source_url = fetch_eastmoney_spot_top100(session)
    except Exception as exc:
        kline_cache["spotSnapshot"] = {
            "updatedAt": datetime.now().isoformat(),
            "matched": False,
            "error": str(exc),
        }
        return 0

    spot_by_code = {
        normalize_code(row.get("f12")): row
        for row in rows
        if normalize_code(row.get("f12"))
    }
    matched = bool(spot_date and spot_date in set(dates))
    updated = 0
    if matched:
        for group_name in ["top100_by_date", "volume_top100_by_date"]:
            by_date = trading.get(group_name) or {}
            for item in by_date.get(spot_date) or []:
                spot = spot_by_code.get(normalize_code(item.get("code")))
                if spot and enrich_item_from_spot(item, spot):
                    updated += 1
        if spot_date == str(trading.get("date") or ""):
            if trading.get("top100_by_date", {}).get(spot_date):
                trading["top100"] = trading["top100_by_date"][spot_date]
            if trading.get("volume_top100_by_date", {}).get(spot_date):
                trading["volume_top100"] = trading["volume_top100_by_date"][spot_date]

    kline_cache["spotSnapshot"] = {
        "updatedAt": datetime.now().isoformat(),
        "source": source_url,
        "date": spot_date,
        "matched": matched,
        "updatedRows": updated,
        "codes": len(spot_by_code),
        "reason": None if matched else "spot_date_not_in_cached_top100_dates",
    }
    return updated


def kline_source_cooldown_message(kline_cache: Dict[str, Any], cooldown_minutes: int) -> Optional[str]:
    if not cooldown_minutes:
        return None
    kline_health = ((kline_cache.get("sourceHealth") or {}).get("kline") or {})
    if kline_health.get("ok") is not False:
        return None
    try:
        failed_at = datetime.fromisoformat(str(kline_health.get("updatedAt")))
        age_seconds = (datetime.now() - failed_at).total_seconds()
    except Exception:
        age_seconds = 0
    cooldown_seconds = max(0, cooldown_minutes) * 60
    if age_seconds >= cooldown_seconds:
        return None
    return (
        f"Eastmoney kline source cooldown active "
        f"age={age_seconds:.0f}s cooldown={cooldown_seconds:.0f}s "
        f"error={kline_health.get('error')}"
    )


def kline_source_cooldown_remaining_seconds(kline_cache: Dict[str, Any], cooldown_minutes: int) -> int:
    if not cooldown_minutes:
        return 0
    kline_health = ((kline_cache.get("sourceHealth") or {}).get("kline") or {})
    if kline_health.get("ok") is not False:
        return 0
    try:
        failed_at = datetime.fromisoformat(str(kline_health.get("updatedAt")))
        age_seconds = (datetime.now() - failed_at).total_seconds()
    except Exception:
        age_seconds = 0
    cooldown_seconds = max(0, cooldown_minutes) * 60
    return max(0, math.ceil(cooldown_seconds - age_seconds))


def kline_source_cooldown_until(kline_cache: Dict[str, Any], cooldown_minutes: int) -> Optional[str]:
    remaining = kline_source_cooldown_remaining_seconds(kline_cache, cooldown_minutes)
    if remaining <= 0:
        return None
    return datetime.fromtimestamp(time.time() + remaining).isoformat()


def fetch_eastmoney_kline(
    session: requests.Session,
    code: str,
    beg: str,
    end: str,
    retries: int,
    delay: float,
    host_limit: int = 2,
    request_timeout: float = 3,
) -> Tuple[str, List[Dict[str, Any]]]:
    params = {
        "secid": secid_for_code(code),
        "klt": "101",
        "fqt": "1",
        "beg": beg,
        "end": end,
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
        "lmt": "1000000",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    }
    last_error = ""
    hosts = EM_KLINE_HOSTS[:max(1, host_limit)] if host_limit else EM_KLINE_HOSTS
    for attempt in range(retries + 1):
        for host in hosts:
            try:
                resp = session.get(
                    host + EM_KLINE_PATH,
                    params=params,
                    headers=HEADERS,
                    timeout=request_timeout,
                )
                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code}"
                    continue
                payload = resp.json()
                data = payload.get("data") or {}
                rows = [row for row in (parse_kline(line) for line in data.get("klines") or []) if row]
                name = data.get("name") or ""
                if rows:
                    return name, rows
                last_error = "Eastmoney kline returned empty rows"
                continue
            except Exception as exc:
                last_error = str(exc)
                continue
        time.sleep(delay * (attempt + 1))
    raise RuntimeError(last_error or "Eastmoney kline failed")


def collect_top100_codes(trading: Dict[str, Any], dates: Iterable[str]) -> List[str]:
    seen = set()
    codes: List[str] = []
    top100_by_date = trading.get("top100_by_date") or {}
    for date in dates:
        for item in top100_by_date.get(date) or []:
            code = normalize_code(item.get("code"))
            if code and code not in seen:
                seen.add(code)
                codes.append(code)
    return codes


def fetch_eastmoney_universe(session: requests.Session, retries: int = 1) -> List[Dict[str, str]]:
    _, spot_rows, _ = fetch_eastmoney_spot_all(session, page_size=100)
    rows: List[Dict[str, str]] = []
    seen = set()
    for item in spot_rows:
        code = normalize_code(item.get("f12"))
        name = str(item.get("f14") or "").strip()
        if code and name and code not in seen:
            seen.add(code)
            rows.append({"code": code, "name": name})
    return rows


def load_universe(args: argparse.Namespace, session: requests.Session) -> List[Dict[str, str]]:
    if EM_UNIVERSE_CACHE.exists() and not args.refresh_universe:
        cached = read_json(EM_UNIVERSE_CACHE, {})
        rows = cached.get("stocks") or []
        if cached.get("source") == "eastmoney_clist" and rows:
            return rows
        print("ignored non-Eastmoney universe cache", file=sys.stderr, flush=True)

    try:
        rows = fetch_eastmoney_universe(session, retries=args.retries)
        if rows:
            write_json(EM_UNIVERSE_CACHE, {
                "source": "eastmoney_clist",
                "updatedAt": datetime.now().isoformat(),
                "stocks": rows,
            })
            return rows
    except Exception as exc:
        print(f"Eastmoney universe failed: {exc}", file=sys.stderr, flush=True)

    return []


def volume_ratio_for(rows: List[Dict[str, Any]], date: str, window: int = 5) -> Optional[float]:
    rows = sorted([row for row in rows if row.get("date")], key=lambda row: row["date"])
    for index, row in enumerate(rows):
        if row["date"] != date:
            continue
        prev = [r for r in rows[max(0, index - window):index] if r.get("volume")]
        if not prev or not row.get("volume"):
            return None
        avg = sum(float(r["volume"]) for r in prev) / len(prev)
        return round(float(row["volume"]) / avg, 2) if avg > 0 else None
    return None


def volume_ratio_map_for(rows: List[Dict[str, Any]], window: int = 5) -> Dict[str, Optional[float]]:
    sorted_rows = sorted([row for row in rows if row.get("date")], key=lambda row: row["date"])
    result: Dict[str, Optional[float]] = {}
    for index, row in enumerate(sorted_rows):
        date = row.get("date")
        if not date:
            continue
        prev = [r for r in sorted_rows[max(0, index - window):index] if r.get("volume")]
        if not prev or not row.get("volume"):
            result[date] = None
            continue
        avg = sum(float(r["volume"]) for r in prev) / len(prev)
        result[date] = round(float(row["volume"]) / avg, 2) if avg > 0 else None
    return result


def enrich_item_from_kline(item: Dict[str, Any], date: str, stock_cache: Dict[str, Any]) -> None:
    code = normalize_code(item.get("code"))
    stock = stock_cache.get(code) or {}
    rows = stock.get("rows") or []
    row = next((r for r in rows if r.get("date") == date), None)
    if stock.get("name"):
        item["name"] = stock["name"]
    if not row:
        return
    if row.get("close") is not None:
        item["price"] = round(float(row["close"]), 2)
    if row.get("pct_chg") is not None:
        item["pct_chg"] = round(float(row["pct_chg"]), 2)
    if row.get("turnover_rate") is not None:
        item["turnover_rate"] = round(float(row["turnover_rate"]), 2)
    ratio = volume_ratio_for(rows, date)
    if ratio is not None:
        item["volume_ratio"] = ratio


def top100_dates(trading: Dict[str, Any], recent_days: Optional[int]) -> List[str]:
    dates = [
        str(date)
        for date, items in (trading.get("top100_by_date") or {}).items()
        if date and isinstance(items, list) and items
    ]
    dates = sorted(set(dates), reverse=True)
    return dates[:recent_days] if recent_days else dates


def backfill_top100_fields(args: argparse.Namespace) -> int:
    payload = read_json(TMT_CACHE, {})
    trading = payload.get("data", {}).get("trading_congestion") or {}
    dates = top100_dates(trading, args.recent_days)
    if not dates:
        print("No Top100 dates found", file=sys.stderr)
        return 1

    beg = args.beg or min(dates)
    end = args.end or max(dates)
    codes = collect_top100_codes(trading, dates)
    kline_cache = read_json(EM_KLINE_CACHE, {"stocks": {}, "updatedAt": None})
    stocks = kline_cache.setdefault("stocks", {})
    failures = kline_cache.setdefault("failures", {})
    source_health = kline_cache.setdefault("sourceHealth", {})
    source_health = kline_cache.setdefault("sourceHealth", {})
    session = requests.Session()
    spot_updated = enrich_matching_spot_snapshot(trading, dates, kline_cache, session)
    spot_snapshot = kline_cache.get("spotSnapshot") or {}
    if spot_updated:
        print(f"spot snapshot enriched rows={spot_updated} date={spot_snapshot.get('date')}", flush=True)
    elif spot_snapshot:
        print(
            f"spot snapshot date={spot_snapshot.get('date')} matched={spot_snapshot.get('matched')} "
            f"reason={spot_snapshot.get('reason') or spot_snapshot.get('error')}",
            flush=True,
        )

    cooldown_message = kline_source_cooldown_message(kline_cache, args.source_cooldown_minutes)
    if cooldown_message:
        print(cooldown_message, file=sys.stderr, flush=True)
        kline_cache["updatedAt"] = datetime.now().isoformat()
        write_json(EM_KLINE_CACHE, kline_cache)
        write_json(TMT_CACHE, payload)
        return 2

    print(f"Eastmoney top100-fields dates={len(dates)} codes={len(codes)} range={beg}-{end}", flush=True)
    now_ts = time.time()
    fail_cooldown_seconds = max(0, args.fail_cooldown_minutes) * 60
    pending_codes: List[str] = []
    skipped_cached = 0
    skipped_cooldown = 0
    for code in codes:
        cached_rows = stocks.get(code, {}).get("rows") or []
        cached_dates = {row.get("date") for row in cached_rows}
        if all(date in cached_dates for date in dates):
            skipped_cached += 1
            continue
        failure = failures.get(code) or {}
        failed_at = float(failure.get("at") or 0)
        if fail_cooldown_seconds and failed_at and now_ts - failed_at < fail_cooldown_seconds:
            skipped_cooldown += 1
            continue
        pending_codes.append(code)
    if args.max_codes and args.max_codes > 0:
        pending_codes = pending_codes[:args.max_codes]
    print(
        f"pending={len(pending_codes)} skipped_cached={skipped_cached} skipped_cooldown={skipped_cooldown}",
        flush=True,
    )

    fetched = 0
    failed: List[Tuple[str, str]] = []
    processed = 0
    for code in pending_codes:
        cached_rows = stocks.get(code, {}).get("rows") or []
        processed += 1
        try:
            name, rows = fetch_eastmoney_kline(
                session,
                code,
                beg,
                end,
                args.retries,
                args.delay,
                args.host_limit,
                args.request_timeout,
            )
        except Exception as exc:
            error = str(exc)
            source_health["kline"] = {
                "ok": False,
                "updatedAt": datetime.now().isoformat(),
                "code": code,
                "error": error,
            }
            failed.append((code, error))
            failures[code] = {
                "at": time.time(),
                "error": error,
                "dates": dates,
            }
            print(f"failed {code}: {exc}", file=sys.stderr, flush=True)
            if args.stop_after_failures and len(failed) >= args.stop_after_failures and fetched == 0:
                break
            continue
        if rows:
            source_health["kline"] = {
                "ok": True,
                "updatedAt": datetime.now().isoformat(),
                "code": code,
                "rows": len(rows),
            }
            merged = {row["date"]: row for row in cached_rows if row.get("date")}
            merged.update({row["date"]: row for row in rows if row.get("date")})
            stocks[code] = {
                "name": name or stocks.get(code, {}).get("name") or "",
                "rows": sorted(merged.values(), key=lambda row: row["date"]),
            }
            failures.pop(code, None)
            fetched += 1
        if processed and processed % args.save_every == 0:
            kline_cache["updatedAt"] = datetime.now().isoformat()
            write_json(EM_KLINE_CACHE, kline_cache)
            print(f"saved kline cache processed={processed} fetched={fetched} failed={len(failed)}", flush=True)
        time.sleep(args.delay)
    if args.stop_after_failures and len(failed) >= args.stop_after_failures and fetched == 0:
        print("stopped early because Eastmoney is rejecting requests", file=sys.stderr, flush=True)

    top100_by_date = trading.get("top100_by_date") or {}
    volume_top100_by_date = trading.get("volume_top100_by_date") or {}
    for date in dates:
        for item in top100_by_date.get(date) or []:
            enrich_item_from_kline(item, date, stocks)
        for item in volume_top100_by_date.get(date) or []:
            enrich_item_from_kline(item, date, stocks)

    latest = str(trading.get("date") or "")
    if latest and top100_by_date.get(latest):
        trading["top100"] = top100_by_date[latest]
    if latest and volume_top100_by_date.get(latest):
        trading["volume_top100"] = volume_top100_by_date[latest]

    if processed:
        if fetched > 0:
            source_health["kline"] = {
                "ok": True,
                "updatedAt": datetime.now().isoformat(),
                "fetched": fetched,
                "failed": len(failed),
            }
        elif failed:
            last_code, last_error = failed[-1]
            source_health["kline"] = {
                "ok": False,
                "updatedAt": datetime.now().isoformat(),
                "code": last_code,
                "error": last_error,
                "fetched": fetched,
                "failed": len(failed),
            }

    kline_cache["updatedAt"] = datetime.now().isoformat()
    write_json(EM_KLINE_CACHE, kline_cache)
    write_json(TMT_CACHE, payload)
    print(f"done processed={processed} fetched={fetched} failed={len(failed)}")
    return 2 if failed and fetched == 0 and spot_updated == 0 else 0


def aggregate_long_history(args: argparse.Namespace) -> int:
    """Aggregate concentration from cached Eastmoney stock klines.

    This uses only Eastmoney kline rows already fetched into EM_KLINE_CACHE. Run
    top100-fields or a future universe crawl first to keep this job resumable.
    """
    kline_cache = read_json(EM_KLINE_CACHE, {"stocks": {}})
    stocks = kline_cache.get("stocks") or {}
    by_date: Dict[str, List[Dict[str, Any]]] = {}
    for code, stock in stocks.items():
        stock_rows = stock.get("rows") or []
        ratio_by_date = volume_ratio_map_for(stock_rows)
        for row in stock.get("rows") or []:
            date = str(row.get("date") or "")
            amount = row.get("amount")
            if date < args.since or amount is None:
                continue
            by_date.setdefault(date, []).append({
                "code": normalize_code(code),
                "name": stock.get("name") or "",
                "date": date,
                "price": row.get("close"),
                "pct_chg": row.get("pct_chg"),
                "volume": row.get("volume"),
                "amount": float(amount),
                "turnover_rate": row.get("turnover_rate"),
                "volume_ratio": ratio_by_date.get(date),
            })

    def build_top_items(items: List[Dict[str, Any]], rank_field: str, total_amount: float) -> List[Dict[str, Any]]:
        ranked = sorted(
            [item for item in items if item.get(rank_field) is not None],
            key=lambda item: float(item.get(rank_field) or 0),
            reverse=True,
        )[:100]
        result = []
        for rank, item in enumerate(ranked, 1):
            volume = item.get("volume")
            amount = float(item.get("amount") or 0)
            result.append({
                "rank": rank,
                "code": item.get("code"),
                "name": item.get("name") or "-",
                "price": round(float(item["price"]), 2) if item.get("price") is not None else None,
                "pct_chg": round(float(item["pct_chg"]), 2) if item.get("pct_chg") is not None else None,
                "volume": round(float(volume), 0) if volume is not None else None,
                "volume_10k_lot": round(float(volume) / 10000, 2) if volume is not None else None,
                "amount": round(amount, 2),
                "amount_yi": round(amount / 1e8, 2),
                "amount_share": round(amount / total_amount * 100, 2) if total_amount > 0 else None,
                "turnover_rate": round(float(item["turnover_rate"]), 2) if item.get("turnover_rate") is not None else None,
                "volume_ratio": round(float(item["volume_ratio"]), 2) if item.get("volume_ratio") is not None else None,
                "market_cap_yi": None,
                "float_market_cap_yi": None,
                "source": "eastmoney_kline_cache",
            })
        return result

    rows = []
    top100_by_date: Dict[str, List[Dict[str, Any]]] = {}
    volume_top100_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for date, items in sorted(by_date.items(), reverse=True):
        items = [item for item in items if float(item.get("amount") or 0) > 0]
        if not items:
            continue
        items.sort(key=lambda item: float(item.get("amount") or 0), reverse=True)
        total = sum(float(item.get("amount") or 0) for item in items)
        stock_count = len(items)
        if stock_count < args.min_stock_count:
            continue
        row: Dict[str, Any] = {
            "date": date,
            "stock_count": stock_count,
            "total_amount": round(total, 2),
            "total_amount_yi": round(total / 1e8, 2),
            "source": "eastmoney_kline_cache",
        }
        for key, pct in [("top1", 0.01), ("top3", 0.03), ("top5", 0.05)]:
            count = max(1, math.ceil(stock_count * pct))
            amount = sum(float(item.get("amount") or 0) for item in items[:count])
            row[f"{key}_count"] = count
            row[f"{key}_amount"] = round(amount, 2)
            row[f"{key}_amount_yi"] = round(amount / 1e8, 2)
            row[f"{key}_ratio"] = round(amount / total * 100, 2) if total > 0 else None
        rows.append(row)
        top100_by_date[date] = build_top_items(items, "amount", total)
        volume_top100_by_date[date] = build_top_items(items, "volume", total)

    output = {
        "source": "eastmoney_kline_cache",
        "since": args.since,
        "generatedAt": datetime.now().isoformat(),
        "rows": rows,
        "top100_by_date": top100_by_date,
        "volume_top100_by_date": volume_top100_by_date,
    }
    write_json(EM_LONG_HISTORY, output)
    if args.merge_latest and rows:
        merge_long_history_to_latest(rows, top100_by_date, volume_top100_by_date)
    print(f"aggregated rows={len(rows)} from stocks={len(stocks)}")
    return 0


def crawl_history(args: argparse.Namespace) -> int:
    kline_cache = read_json(EM_KLINE_CACHE, {"stocks": {}, "updatedAt": None})
    stocks = kline_cache.setdefault("stocks", {})
    failures = kline_cache.setdefault("failures", {})
    source_health = kline_cache.setdefault("sourceHealth", {})
    cooldown_message = kline_source_cooldown_message(kline_cache, args.source_cooldown_minutes)
    if cooldown_message:
        print(cooldown_message, file=sys.stderr, flush=True)
        return 2

    session = requests.Session()
    universe = load_universe(args, session)
    if not universe:
        print("No stock universe available", file=sys.stderr)
        return 1
    now_ts = time.time()
    cooldown = max(0, args.fail_cooldown_minutes) * 60

    pending = []
    skipped_cached = 0
    skipped_cooldown = 0
    start_month_end = str(args.since)[:6] + "31"
    end_month_start = str(args.end)[:6] + "01"
    for stock in universe:
        code = normalize_code(stock.get("code"))
        cached_rows = stocks.get(code, {}).get("rows") or []
        cached_dates = sorted(str(row.get("date")) for row in cached_rows if row.get("date"))
        range_dates = [date for date in cached_dates if str(args.since) <= date <= str(args.end)]
        if range_dates and range_dates[0] <= start_month_end and range_dates[-1] >= end_month_start:
            skipped_cached += 1
            continue
        failure = failures.get(code) or {}
        failed_at = float(failure.get("at") or 0)
        if cooldown and failed_at and now_ts - failed_at < cooldown:
            skipped_cooldown += 1
            continue
        pending.append({"code": code, "name": stock.get("name") or ""})

    if args.max_codes and args.max_codes > 0:
        pending = pending[:args.max_codes]

    print(
        f"Eastmoney crawl-history universe={len(universe)} pending={len(pending)} "
        f"skipped_cached={skipped_cached} skipped_cooldown={skipped_cooldown} range={args.since}-{args.end}",
        flush=True,
    )

    fetched = 0
    failed = 0
    processed = 0
    last_failure_code = None
    last_failure_error = None
    for stock in pending:
        code = stock["code"]
        cached_rows = stocks.get(code, {}).get("rows") or []
        processed += 1
        try:
            name, rows = fetch_eastmoney_kline(
                session,
                code,
                args.since,
                args.end,
                args.retries,
                args.delay,
                args.host_limit,
                args.request_timeout,
            )
        except Exception as exc:
            failed += 1
            last_failure_code = code
            last_failure_error = str(exc)
            source_health["kline"] = {
                "ok": False,
                "updatedAt": datetime.now().isoformat(),
                "code": code,
                "error": str(exc),
            }
            failures[code] = {
                "at": time.time(),
                "error": str(exc),
                "range": [args.since, args.end],
            }
            print(f"failed {code}: {exc}", file=sys.stderr, flush=True)
            if args.stop_after_failures and failed >= args.stop_after_failures and fetched == 0:
                break
            continue
        if rows:
            source_health["kline"] = {
                "ok": True,
                "updatedAt": datetime.now().isoformat(),
                "code": code,
                "rows": len(rows),
            }
            merged = {row["date"]: row for row in cached_rows if row.get("date")}
            merged.update({row["date"]: row for row in rows if row.get("date")})
            stocks[code] = {
                "name": name or stock.get("name") or stocks.get(code, {}).get("name") or "",
                "rows": sorted(merged.values(), key=lambda row: row["date"]),
            }
            failures.pop(code, None)
            fetched += 1
        if processed % args.save_every == 0:
            kline_cache["updatedAt"] = datetime.now().isoformat()
            write_json(EM_KLINE_CACHE, kline_cache)
            print(f"saved crawl processed={processed} fetched={fetched} failed={failed}", flush=True)
        time.sleep(args.delay)

    if processed:
        if fetched > 0:
            source_health["kline"] = {
                "ok": True,
                "updatedAt": datetime.now().isoformat(),
                "fetched": fetched,
                "failed": failed,
            }
        elif failed > 0:
            source_health["kline"] = {
                "ok": False,
                "updatedAt": datetime.now().isoformat(),
                "code": last_failure_code,
                "error": last_failure_error,
                "fetched": fetched,
                "failed": failed,
            }

    kline_cache["updatedAt"] = datetime.now().isoformat()
    write_json(EM_KLINE_CACHE, kline_cache)
    if args.aggregate:
        aggregate_long_history(argparse.Namespace(
            since=args.since,
            merge_latest=True,
            min_stock_count=args.min_stock_count,
        ))
    print(f"done processed={processed} fetched={fetched} failed={failed}", flush=True)
    return 2 if failed and fetched == 0 else 0


def status(args: argparse.Namespace) -> int:
    payload = read_json(TMT_CACHE, {})
    trading = payload.get("data", {}).get("trading_congestion") or {}
    dates = top100_dates(trading, args.recent_days)
    top100_by_date = trading.get("top100_by_date") or {}
    total_rows = 0
    filled_turnover = 0
    filled_volume_ratio = 0
    for date in dates:
        rows = top100_by_date.get(date) or []
        total_rows += len(rows)
        filled_turnover += sum(1 for row in rows if row.get("turnover_rate") is not None)
        filled_volume_ratio += sum(1 for row in rows if row.get("volume_ratio") is not None)

    kline_cache = read_json(EM_KLINE_CACHE, {"stocks": {}, "failures": {}})
    long_history = read_json(EM_LONG_HISTORY, {"rows": []})
    universe = read_json(EM_UNIVERSE_CACHE, {"stocks": []})
    universe_count = len(universe.get("stocks") or [])
    cached_stocks = len(kline_cache.get("stocks") or {})
    min_stock_count = 4500
    payload = {
        "top100_recent_days": len(dates),
        "top100_rows": total_rows,
        "turnover_filled": filled_turnover,
        "volume_ratio_filled": filled_volume_ratio,
        "kline_cached_stocks": cached_stocks,
        "kline_universe_stocks": universe_count,
        "kline_coverage_progress": round(cached_stocks / universe_count * 100, 2) if universe_count else 0,
        "kline_long_history_min_stocks": min_stock_count,
        "kline_long_history_remaining_stocks": max(0, min_stock_count - cached_stocks),
        "kline_long_history_ready_progress": round(min(cached_stocks, min_stock_count) / min_stock_count * 100, 2),
        "kline_failed_stocks": len(kline_cache.get("failures") or {}),
        "kline_source_health": (kline_cache.get("sourceHealth") or {}).get("kline"),
        "kline_source_cooldown_remaining_seconds": kline_source_cooldown_remaining_seconds(kline_cache, 30),
        "kline_source_cooldown_until": kline_source_cooldown_until(kline_cache, 30),
        "spot_snapshot": kline_cache.get("spotSnapshot"),
        "long_history_rows": len(long_history.get("rows") or []),
        "long_history_since": long_history.get("since"),
        "long_history_generatedAt": long_history.get("generatedAt"),
    }
    if args.json_field:
        fields = [field.strip() for field in str(args.json_field).split(",") if field.strip()]
        if len(fields) == 1:
            print(payload.get(fields[0], ""))
        else:
            print(json.dumps({field: payload.get(field, "") for field in fields}, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def percentile(value: Optional[float], values: List[Optional[float]]) -> Optional[float]:
    clean = [float(v) for v in values if v is not None]
    if value is None or not clean:
        return None
    return round(sum(1 for v in clean if v <= float(value)) / len(clean) * 100, 2)


def warning_for_percentiles(row: Dict[str, Any]) -> str:
    max_percentile = max([
        row.get("top1_percentile") or 0,
        row.get("top3_percentile") or 0,
        row.get("top5_percentile") or 0,
    ])
    if max_percentile >= 98:
        return "danger"
    if max_percentile >= 95:
        return "warning"
    if max_percentile >= 90:
        return "warm"
    return "normal"


def is_eastmoney_row(row: Dict[str, Any]) -> bool:
    source = str((row or {}).get("source") or "")
    if source in {
        "eastmoney_spot",
        "sina_spot",
        "eastmoney_kline_cache",
        AKSHARE_SINA_HISTORICAL_SOURCE,
        TUSHARE_HISTORICAL_SOURCE,
        "tushare_daily_fallback",
        "baostock_historical_reconstruction",
    }:
        return True
    if source:
        return False

    item = row or {}
    date = str(item.get("date") or "")
    has_trend_values = (
        len(date) == 8
        and date.isdigit()
        and any(item.get(key) is not None for key in ["top1_ratio", "top3_ratio", "top5_ratio"])
    )
    code = str(item.get("code") or "").strip()
    has_top100_values = bool(code) and any(
        item.get(key) is not None
        for key in ["amount", "amount_yi", "amount_share", "volume"]
    )
    return has_trend_values or has_top100_values


def filter_eastmoney_top100(by_date: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    result: Dict[str, List[Dict[str, Any]]] = {}
    for date, rows in (by_date or {}).items():
        safe_rows = [row for row in (rows or []) if is_eastmoney_row(row)]
        if safe_rows:
            result[str(date)] = safe_rows
    return result


def keep_cached_top100(by_date: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    result: Dict[str, List[Dict[str, Any]]] = {}
    for date, rows in (by_date or {}).items():
        if isinstance(rows, list) and rows:
            result[str(date)] = rows
    return result


def merge_long_history_to_latest(
    rows: List[Dict[str, Any]],
    top100_by_date: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    volume_top100_by_date: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> None:
    payload = read_json(TMT_CACHE, {})
    trading = payload.get("data", {}).get("trading_congestion") or {}
    existing = {
        str(row.get("date")): row
        for row in trading.get("trend") or []
        if row.get("date")
    }
    for row in rows:
        if row.get("date"):
            existing[str(row["date"])] = row
    merged = sorted(existing.values(), key=lambda row: str(row.get("date") or ""), reverse=True)
    ratio_values = {
        "top1_ratio": [row.get("top1_ratio") for row in merged],
        "top3_ratio": [row.get("top3_ratio") for row in merged],
        "top5_ratio": [row.get("top5_ratio") for row in merged],
    }
    for row in merged:
        row.pop("top1_percentile", None)
        row.pop("top3_percentile", None)
        row.pop("top5_percentile", None)
        row["top1_percentile"] = percentile(row.get("top1_ratio"), ratio_values["top1_ratio"])
        row["top3_percentile"] = percentile(row.get("top3_ratio"), ratio_values["top3_ratio"])
        row["top5_percentile"] = percentile(row.get("top5_ratio"), ratio_values["top5_ratio"])
    trading["trend"] = merged
    trading["percentile_sample_count"] = len([row for row in merged if row.get("top1_ratio") is not None])
    merged_top100 = keep_cached_top100(trading.get("top100_by_date") or {})
    merged_volume_top100 = keep_cached_top100(trading.get("volume_top100_by_date") or {})
    merged_top100.update(top100_by_date or {})
    merged_volume_top100.update(volume_top100_by_date or {})
    trading["top100_by_date"] = merged_top100
    trading["volume_top100_by_date"] = merged_volume_top100
    trading["available_top100_dates"] = sorted(merged_top100.keys(), reverse=True)
    latest_date = str(trading.get("date") or "")
    trading["top100"] = merged_top100.get(latest_date) or trading.get("top100") or []
    trading["volume_top100"] = merged_volume_top100.get(latest_date) or trading.get("volume_top100") or []
    trading["source"] = "eastmoney cached trend/top100"
    payload["data"]["trading_congestion"] = trading
    write_json(TMT_CACHE, payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_top = sub.add_parser("top100-fields")
    p_top.add_argument("--recent-days", type=int, default=100)
    p_top.add_argument("--beg")
    p_top.add_argument("--end")
    p_top.add_argument("--delay", type=float, default=5.0)
    p_top.add_argument("--retries", type=int, default=2)
    p_top.add_argument("--save-every", type=int, default=25)
    p_top.add_argument("--stop-after-failures", type=int, default=2)
    p_top.add_argument("--max-codes", type=int, default=3)
    p_top.add_argument("--fail-cooldown-minutes", type=int, default=60)
    p_top.add_argument("--host-limit", type=int, default=2)
    p_top.add_argument("--request-timeout", type=float, default=3)
    p_top.add_argument("--source-cooldown-minutes", type=int, default=30)
    p_top.set_defaults(func=backfill_top100_fields)

    p_long = sub.add_parser("long-history")
    p_long.add_argument("--since", default="20120101")
    p_long.add_argument("--min-stock-count", type=int, default=4500)
    p_long.add_argument("--merge-latest", action="store_true", default=True)
    p_long.set_defaults(func=aggregate_long_history)

    p_crawl = sub.add_parser("crawl-history")
    p_crawl.add_argument("--since", default="20120101")
    p_crawl.add_argument("--end", default=datetime.now().strftime("%Y%m%d"))
    p_crawl.add_argument("--max-codes", type=int, default=3)
    p_crawl.add_argument("--delay", type=float, default=8.0)
    p_crawl.add_argument("--retries", type=int, default=0)
    p_crawl.add_argument("--save-every", type=int, default=5)
    p_crawl.add_argument("--stop-after-failures", type=int, default=2)
    p_crawl.add_argument("--fail-cooldown-minutes", type=int, default=60)
    p_crawl.add_argument("--host-limit", type=int, default=2)
    p_crawl.add_argument("--request-timeout", type=float, default=3)
    p_crawl.add_argument("--source-cooldown-minutes", type=int, default=30)
    p_crawl.add_argument("--min-stock-count", type=int, default=4500)
    p_crawl.add_argument("--refresh-universe", action="store_true")
    p_crawl.add_argument("--aggregate", action="store_true", default=True)
    p_crawl.set_defaults(func=crawl_history)

    p_status = sub.add_parser("status")
    p_status.add_argument("--recent-days", type=int, default=100)
    p_status.add_argument("--json-field")
    p_status.set_defaults(func=status)

    p_spot = sub.add_parser("spot-snapshot")
    p_spot.add_argument("--page-size", type=int, default=100)
    p_spot.add_argument("--request-timeout", type=float, default=12)
    p_spot.add_argument("--workers", type=int, default=6)
    p_spot.add_argument("--host-limit", type=int, default=1)
    p_spot.add_argument("--provider", choices=["auto", "eastmoney", "sina"], default="auto")
    p_spot.add_argument("--merge-latest", action="store_true", default=True)
    p_spot.set_defaults(func=spot_snapshot)

    p_historical = sub.add_parser("historical-snapshot")
    p_historical.add_argument("--date", required=True)
    p_historical.add_argument(
        "--provider",
        choices=["akshare", "tushare", "tushare-daily", "baostock"],
        default="akshare",
    )
    p_historical.add_argument("--workers", type=int, default=8)
    p_historical.add_argument("--save-every", type=int, default=25)
    p_historical.add_argument("--max-codes", type=int, default=0)
    p_historical.add_argument("--finalize-only", action="store_true")
    p_historical.add_argument("--retries", type=int, default=3)
    p_historical.add_argument("--retry-delay", type=float, default=2)
    p_historical.add_argument("--min-coverage", type=float, default=0.9)
    p_historical.add_argument("--min-adjacent-ratio", type=float, default=0.9)
    p_historical.add_argument("--min-valid-stocks", type=int, default=5000)
    p_historical.add_argument("--merge-latest", action="store_true", default=True)
    p_historical.set_defaults(func=historical_snapshot)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
