#!/usr/bin/env python3
"""Standard SW2021 L1 TMT margin and turnover monitoring.

The production universe is exclusively the four Shenwan 2021 level-one
industries: Electronics, Computer, Media and Communications. There is no
name-keyword, hand-maintained-code or heuristic fallback.
"""

import json
import argparse
import sys
import os
import math
import hashlib
import tempfile
import requests
import pandas as pd
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from zoneinfo import ZoneInfo

try:
    import akshare as ak
except ImportError:
    print(json.dumps({"error": "akshare未安装，请运行: pip install akshare"}))
    sys.exit(1)

DEFINITION_ID = 'sw2021_l1_tmt_v1'
DEFINITION_NAME = '申万2021一级行业TMT（电子+计算机+传媒+通信）'
SW_TMT_INDUSTRIES = {
    '801080': '电子',
    '801750': '计算机',
    '801760': '传媒',
    '801770': '通信',
}
# These bounds deliberately tolerate normal rebalances but reject truncated or
# wrong-index responses before any snapshot or downstream cache can be updated.
SW_TMT_INDUSTRY_COUNT_BOUNDS = {
    '801080': (400, 1000),
    '801750': (250, 800),
    '801760': (100, 400),
    '801770': (90, 400),
}

_MACRO_SZ_CACHE = None
_MACRO_SH_CACHE = None
_STOCK_DETAIL_CACHE = {}
QUICK_COMPLETENESS_WINDOW_DAYS = 11
CACHE_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', 'server', 'data', 'tmt-margin', 'latest.json')
)
EASTMONEY_SPOT_SNAPSHOT_FILE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', 'server', 'data', 'tmt-margin', 'eastmoney-spot-snapshots.json')
)
SW_TMT_MEMBERSHIP_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), '..', 'server', 'data', 'tmt-margin', 'sw-tmt-membership')
)

EASTMONEY_SPOT_URL = "https://82.push2.eastmoney.com/api/qt/clist/get"
EASTMONEY_SPOT_URLS = [
    "https://push2delay.eastmoney.com/api/qt/clist/get",
    EASTMONEY_SPOT_URL,
    "https://push2.eastmoney.com/api/qt/clist/get",
]
SWS_INDEX_ANALYSIS_URL = (
    'https://www.swsresearch.com/institute-sw/api/index_analysis/index_analysis_report/'
)
SWS_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    )
}
EASTMONEY_SPOT_FIELDS = (
    "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,"
    "f20,f21,f23,f24,f25,f22,f11,f62,f124,f128,f136,f115,f152,f297"
)
STOCK_NAME_MAP = None


def _normalize_yyyymmdd(value):
    text = str(value or '').strip().replace('-', '')
    if len(text) != 8 or not text.isdigit():
        raise ValueError(f'无效日期: {value}')
    datetime.strptime(text, '%Y%m%d')
    return text


def _normalize_stock_code(value):
    if pd.isna(value):
        raise ValueError('证券代码为空')
    text = str(value).strip().upper()
    if '.' in text:
        head, tail = text.split('.', 1)
        if tail in {'SH', 'SZ', 'BJ', '0'}:
            text = head
    if not text.isdigit() or len(text) > 6:
        raise ValueError(f'无效证券代码: {value}')
    return text.zfill(6)


def _membership_hash(members):
    canonical = [
        {'code': item['code'], 'industry_code': item['industry_code']}
        for item in sorted(members, key=lambda item: (item['code'], item['industry_code']))
    ]
    encoded = json.dumps(canonical, ensure_ascii=True, separators=(',', ':'), sort_keys=True).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


def build_sw_tmt_membership(
    industry_frames,
    classification_asof,
    membership_mode='point_in_time',
    count_bounds=None,
):
    """Validate four official component tables and build a canonical universe."""
    classification_asof = _normalize_yyyymmdd(classification_asof)
    if membership_mode not in {'point_in_time', 'current_components_backfill'}:
        raise ValueError(f'无效成分口径: {membership_mode}')
    if set(industry_frames or {}) != set(SW_TMT_INDUSTRIES):
        missing = sorted(set(SW_TMT_INDUSTRIES) - set(industry_frames or {}))
        extra = sorted(set(industry_frames or {}) - set(SW_TMT_INDUSTRIES))
        raise RuntimeError(f'申万TMT四行业数据不完整 missing={missing} extra={extra}')

    bounds = count_bounds or SW_TMT_INDUSTRY_COUNT_BOUNDS
    members = []
    seen_codes = {}
    industry_counts = {}
    for industry_code, industry_name in SW_TMT_INDUSTRIES.items():
        frame = industry_frames[industry_code]
        if frame is None or not isinstance(frame, pd.DataFrame):
            raise RuntimeError(f'{industry_code} {industry_name}成分表无效')
        required = {'证券代码', '证券名称'}
        if not required.issubset(frame.columns):
            raise RuntimeError(f'{industry_code} {industry_name}成分表缺少列: {sorted(required - set(frame.columns))}')

        industry_members = []
        for _, row in frame.iterrows():
            code = _normalize_stock_code(row['证券代码'])
            name = str(row['证券名称'] or '').strip()
            if not name or name.lower() == 'nan':
                raise RuntimeError(f'{industry_code}成分 {code} 名称为空')
            if code in seen_codes:
                previous = seen_codes[code]
                raise RuntimeError(f'证券代码 {code} 在 {previous} 与 {industry_code} 重复')
            seen_codes[code] = industry_code
            industry_members.append({
                'code': code,
                'name': name,
                'industry_code': industry_code,
                'industry_name': industry_name,
            })

        lower, upper = bounds.get(industry_code, (1, 10000))
        count = len(industry_members)
        if count < lower or count > upper:
            raise RuntimeError(
                f'{industry_code} {industry_name}成分数 {count} 超出合理范围 [{lower}, {upper}]'
            )
        industry_counts[industry_code] = count
        members.extend(industry_members)

    members.sort(key=lambda item: (item['code'], item['industry_code']))
    return {
        'definition_id': DEFINITION_ID,
        'definition_name': DEFINITION_NAME,
        'classification_asof': classification_asof,
        'membership_mode': membership_mode,
        'membership_hash': _membership_hash(members),
        'industry_counts': industry_counts,
        'universe_count': len(members),
        'members': members,
        'generated_at': datetime.now().isoformat(),
        'source': 'swsresearch_index_component_sw',
    }


def validate_sw_tmt_membership(payload, count_bounds=None):
    """Validate persisted membership without contacting the network."""
    if not isinstance(payload, dict) or payload.get('definition_id') != DEFINITION_ID:
        raise RuntimeError('非标准申万TMT成分快照')
    members = payload.get('members')
    if not isinstance(members, list):
        raise RuntimeError('申万TMT成分快照缺少members')
    classification_asof = _normalize_yyyymmdd(payload.get('classification_asof'))
    mode = payload.get('membership_mode')
    if mode not in {'point_in_time', 'current_components_backfill'}:
        raise RuntimeError(f'无效成分口径: {mode}')

    frames = {}
    for industry_code in SW_TMT_INDUSTRIES:
        rows = [
            {'证券代码': item.get('code'), '证券名称': item.get('name')}
            for item in members
            if item.get('industry_code') == industry_code
        ]
        frames[industry_code] = pd.DataFrame(rows, columns=['证券代码', '证券名称'])
    rebuilt = build_sw_tmt_membership(frames, classification_asof, mode, count_bounds=count_bounds)
    if rebuilt['membership_hash'] != payload.get('membership_hash'):
        raise RuntimeError('申万TMT成分快照hash校验失败')
    if int(payload.get('universe_count') or -1) != rebuilt['universe_count']:
        raise RuntimeError('申万TMT成分快照总数校验失败')
    return payload


def fetch_current_sw_tmt_membership(
    classification_asof,
    count_bounds=None,
    max_attempts=3,
    retry_backoff_seconds=1.0,
):
    """Fetch all four component sources; no partial result is ever returned."""
    frames = {}
    failures = []
    attempts = max(1, int(max_attempts))
    for industry_code, industry_name in SW_TMT_INDUSTRIES.items():
        last_error = None
        for attempt in range(1, attempts + 1):
            try:
                frame = ak.index_component_sw(symbol=industry_code)
                if frame is None or frame.empty:
                    raise RuntimeError('返回空表')
                frames[industry_code] = frame
                last_error = None
                break
            except Exception as exc:
                last_error = exc
                if attempt < attempts and retry_backoff_seconds > 0:
                    time.sleep(retry_backoff_seconds * attempt)
        if last_error is not None:
            failures.append(f'{industry_code} {industry_name}: {last_error}')
    if failures:
        raise RuntimeError('申万TMT成分拉取失败（未写入任何快照）: ' + '; '.join(failures))
    return build_sw_tmt_membership(
        frames,
        classification_asof=classification_asof,
        membership_mode='point_in_time',
        count_bounds=count_bounds,
    )


def _atomic_write_json(path, payload):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', dir=directory, prefix='.tmp-', suffix='.json', delete=False
        ) as handle:
            temp_path = handle.name
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


def _read_membership_file(path, count_bounds=None):
    with open(path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    return validate_sw_tmt_membership(payload, count_bounds=count_bounds)


def sync_sw_tmt_membership(classification_asof, snapshot_dir=SW_TMT_MEMBERSHIP_DIR, count_bounds=None):
    """Fetch, validate and atomically persist an immutable daily snapshot."""
    classification_asof = _normalize_yyyymmdd(classification_asof)
    # Fetch and validate every source before touching either on-disk file.
    fetched = fetch_current_sw_tmt_membership(classification_asof, count_bounds=count_bounds)
    snapshot_path = os.path.join(snapshot_dir, f'{classification_asof}.json')
    last_good_path = os.path.join(snapshot_dir, 'last-good.json')
    if os.path.exists(snapshot_path):
        existing = _read_membership_file(snapshot_path, count_bounds=count_bounds)
        if existing.get('membership_hash') != fetched.get('membership_hash'):
            raise RuntimeError(f'不可变成分快照 {classification_asof} 与新数据不一致')
        fetched = existing
    else:
        _atomic_write_json(snapshot_path, fetched)
    _atomic_write_json(last_good_path, fetched)
    return fetched


def load_sw_tmt_membership_snapshot(classification_asof, snapshot_dir=SW_TMT_MEMBERSHIP_DIR, count_bounds=None):
    classification_asof = _normalize_yyyymmdd(classification_asof)
    path = os.path.join(snapshot_dir, f'{classification_asof}.json')
    if not os.path.exists(path):
        return None
    return _read_membership_file(path, count_bounds=count_bounds)


def load_last_good_sw_tmt_membership(snapshot_dir=SW_TMT_MEMBERSHIP_DIR, count_bounds=None):
    path = os.path.join(snapshot_dir, 'last-good.json')
    if not os.path.exists(path):
        return None
    return _read_membership_file(path, count_bounds=count_bounds)


def get_sw_tmt_membership(classification_asof, snapshot_dir=SW_TMT_MEMBERSHIP_DIR, allow_last_good=True):
    """Resolve a standard universe once; a standard last-good is the only fallback."""
    exact = load_sw_tmt_membership_snapshot(classification_asof, snapshot_dir=snapshot_dir)
    if exact is not None:
        return exact
    try:
        return sync_sw_tmt_membership(classification_asof, snapshot_dir=snapshot_dir)
    except Exception:
        if allow_last_good:
            last_good = load_last_good_sw_tmt_membership(snapshot_dir=snapshot_dir)
            if last_good is not None:
                return last_good
        raise


def membership_for_data_date(date_str, current_membership, snapshot_dir=SW_TMT_MEMBERSHIP_DIR):
    """Use exact daily membership when present; otherwise label current-list backfill."""
    exact = load_sw_tmt_membership_snapshot(date_str, snapshot_dir=snapshot_dir)
    if exact is not None:
        return exact
    return {
        **current_membership,
        'membership_mode': 'current_components_backfill',
    }


def build_sw_tmt_turnover_history(frame, requested_dates):
    """Validate official SW L1 daily analysis and calculate the standard sum."""
    dates = [_normalize_yyyymmdd(date) for date in requested_dates]
    if frame is None or not isinstance(frame, pd.DataFrame) or frame.empty:
        raise RuntimeError('申万一级行业指数分析返回空表')
    required = {'指数代码', '指数名称', '发布日期', '成交额占比'}
    if not required.issubset(frame.columns):
        raise RuntimeError(f'申万指数分析缺少列: {sorted(required - set(frame.columns))}')

    rows_by_date = {date: {} for date in dates}
    requested_set = set(dates)
    for _, row in frame.iterrows():
        try:
            date = pd.to_datetime(row['发布日期'], errors='raise').strftime('%Y%m%d')
        except Exception as exc:
            raise RuntimeError(f'申万指数分析日期无效: {row.get("发布日期")}') from exc
        if date not in requested_set:
            continue
        industry_code = str(row['指数代码']).strip().split('.')[0]
        if industry_code not in SW_TMT_INDUSTRIES:
            continue
        if industry_code in rows_by_date[date]:
            raise RuntimeError(f'{date} {industry_code}申万指数分析重复')
        turnover_pct = pd.to_numeric(row['成交额占比'], errors='coerce')
        if pd.isna(turnover_pct) or float(turnover_pct) < 0 or float(turnover_pct) > 100:
            raise RuntimeError(f'{date} {industry_code}成交额占比无效: {row["成交额占比"]}')
        rows_by_date[date][industry_code] = float(turnover_pct)

    result = {}
    for date in dates:
        found = rows_by_date[date]
        if set(found) != set(SW_TMT_INDUSTRIES):
            missing = sorted(set(SW_TMT_INDUSTRIES) - set(found))
            raise RuntimeError(f'{date}申万TMT成交占比四行业不完整 missing={missing}')
        breakdown = [
            {
                'industry_code': industry_code,
                'industry_name': industry_name,
                'turnover_pct': round(found[industry_code], 2),
            }
            for industry_code, industry_name in SW_TMT_INDUSTRIES.items()
        ]
        result[date] = {
            'tmt_turnover_pct': round(sum(item['turnover_pct'] for item in breakdown), 2),
            'tmt_turnover_by_industry': breakdown,
            'turnover_source': 'swsresearch_index_analysis_daily_sw',
        }
    return result


def fetch_sw_tmt_turnover_history(requested_dates, max_attempts=3, retry_backoff_seconds=1.0):
    """Fetch the official date-range table in one request, with bounded retries."""
    dates = sorted({_normalize_yyyymmdd(date) for date in requested_dates})
    if not dates:
        return {}
    params = {
        'page': '1',
        'page_size': '10000',
        'index_type': '一级行业',
        'start_date': f'{dates[0][:4]}-{dates[0][4:6]}-{dates[0][6:]}',
        'end_date': f'{dates[-1][:4]}-{dates[-1][4:6]}-{dates[-1][6:]}',
        'type': 'DAY',
        'swindexcode': 'all',
    }
    last_error = None
    raw_results = None
    attempts = max(1, int(max_attempts))
    for attempt in range(1, attempts + 1):
        try:
            response = requests.get(
                SWS_INDEX_ANALYSIS_URL,
                params=params,
                headers=SWS_HEADERS,
                verify=False,
                timeout=(10, 45),
            )
            response.raise_for_status()
            body = response.json()
            data = body.get('data') if isinstance(body, dict) else None
            raw_results = data.get('results') if isinstance(data, dict) else None
            total_count = int(data.get('count') or 0) if isinstance(data, dict) else 0
            if not isinstance(raw_results, list) or not raw_results:
                raise RuntimeError('官方接口返回空results')
            if total_count > len(raw_results):
                raise RuntimeError(f'官方接口分页截断 count={total_count} rows={len(raw_results)}')
            last_error = None
            break
        except Exception as exc:
            last_error = exc
            if attempt < attempts and retry_backoff_seconds > 0:
                time.sleep(retry_backoff_seconds * attempt)
    if last_error is not None:
        raise RuntimeError(f'申万一级行业成交占比拉取失败: {last_error}') from last_error

    frame = pd.DataFrame(raw_results).rename(columns={
        'swindexcode': '指数代码',
        'swindexname': '指数名称',
        'bargaindate': '发布日期',
        'bargainsumrate': '成交额占比',
    })
    return build_sw_tmt_turnover_history(frame, dates)


def get_recent_trading_dates(n=20):
    """获取近N个交易日期"""
    if not isinstance(n, int) or n <= 0:
        raise ValueError(f'交易日数量必须为正整数: {n}')

    sz_dates = set(get_macro_sz()['日期'].astype(str).str.replace('-', '', regex=False))
    sh_dates = set(get_macro_sh()['日期'].astype(str).str.replace('-', '', regex=False))
    dates = sorted(sz_dates & sh_dates, reverse=True)
    if not dates:
        raise RuntimeError('沪深市场两融交易日没有交集，拒绝使用硬编码日期回退')
    return dates[:n]


def _to_date_int(date_str):
    return int(date_str.replace('-', ''))


def _prepare_macro_df(df):
    df = df.copy()
    df['日期'] = df['日期'].astype(str)
    df['日期_int'] = df['日期'].apply(_to_date_int)
    return df.sort_values('日期_int')


def get_macro_sz():
    global _MACRO_SZ_CACHE
    if _MACRO_SZ_CACHE is None:
        _MACRO_SZ_CACHE = _prepare_macro_df(ak.macro_china_market_margin_sz())
    return _MACRO_SZ_CACHE


def get_macro_sh():
    global _MACRO_SH_CACHE
    if _MACRO_SH_CACHE is None:
        _MACRO_SH_CACHE = _prepare_macro_df(ak.macro_china_market_margin_sh())
    return _MACRO_SH_CACHE


def get_market_data(date_str):
    """获取全市场宏观数据"""
    date_int = _to_date_int(date_str)

    def exact_exchange_row(frame, exchange_name):
        rows = frame[frame['日期_int'] == date_int]
        if rows.empty:
            raise RuntimeError(f'{date_str} {exchange_name}市场两融汇总缺失')
        row = rows.iloc[-1]
        yy = pd.to_numeric(row.get('融资余额'), errors='coerce')
        buy = pd.to_numeric(row.get('融资买入额'), errors='coerce')
        if pd.isna(yy) or pd.isna(buy) or float(yy) <= 0 or float(buy) < 0:
            raise RuntimeError(f'{date_str} {exchange_name}市场两融汇总无效')
        return float(yy), float(buy)

    sz_yy, sz_buy = exact_exchange_row(get_macro_sz(), '深市')
    sh_yy, sh_buy = exact_exchange_row(get_macro_sh(), '沪市')

    return {
        'market_yy': round((sz_yy + sh_yy) / 1e8, 1),
        'market_buy': round((sz_buy + sh_buy) / 1e8, 1),
    }


def get_stock_margin_detail(date_str):
    """获取深市+沪市个股两融明细，合并返回"""
    if date_str in _STOCK_DETAIL_CACHE:
        return _STOCK_DETAIL_CACHE[date_str]

    all_stocks = []
    exchange_errors = []

    # 深市
    try:
        df_sz = ak.stock_margin_detail_szse(date=date_str)
        if df_sz is None or len(df_sz) == 0:
            raise RuntimeError('返回空数据')
        df_sz = df_sz.copy()
        df_sz['code'] = df_sz['证券代码'].astype(str).str.zfill(6)
        df_sz['market'] = 'sz'
        df_sz['name'] = df_sz['证券简称']
        df_sz['yy'] = df_sz['融资余额']
        df_sz['buy'] = df_sz['融资买入额']
        df_sz['repay'] = df_sz['融资偿还额'] if '融资偿还额' in df_sz.columns else None
        all_stocks.append(df_sz[['code', 'name', 'market', 'yy', 'buy', 'repay']])
    except Exception as exc:
        exchange_errors.append(f'深市: {exc}')

    # 沪市
    try:
        df_sh = ak.stock_margin_detail_sse(date=date_str)
        if df_sh is None or len(df_sh) == 0:
            raise RuntimeError('返回空数据')
        df_sh = df_sh.copy()
        df_sh['code'] = df_sh['标的证券代码'].astype(str).str.zfill(6)
        df_sh['market'] = 'sh'
        df_sh['name'] = df_sh['标的证券简称']
        df_sh['yy'] = df_sh['融资余额']
        df_sh['buy'] = df_sh['融资买入额']
        df_sh['repay'] = df_sh['融资偿还额']
        all_stocks.append(df_sh[['code', 'name', 'market', 'yy', 'buy', 'repay']])
    except Exception as exc:
        exchange_errors.append(f'沪市: {exc}')

    if exchange_errors or len(all_stocks) != 2:
        detail = '; '.join(exchange_errors) or '沪深两市数据未齐'
        raise RuntimeError(f'{date_str} 个股两融明细不完整（{detail}）')

    df = pd.concat(all_stocks, ignore_index=True)
    df['net_buy'] = df['buy'] - df['repay']
    _STOCK_DETAIL_CACHE[date_str] = df
    return df


def get_previous_balance_map(prev_date):
    if not prev_date:
        return {}
    prev = get_stock_margin_detail(prev_date)
    if prev is None:
        return {}
    return dict(zip(prev['code'], prev['yy']))


def _standard_membership_map(membership):
    if not isinstance(membership, dict) or membership.get('definition_id') != DEFINITION_ID:
        raise RuntimeError('缺少标准申万TMT成分定义')
    members = membership.get('members')
    if not isinstance(members, list) or not members:
        raise RuntimeError('标准申万TMT成分为空')
    return {item['code']: item for item in members}


def _filter_standard_tmt_margin(frame, membership):
    member_map = _standard_membership_map(membership)
    filtered = frame[frame['code'].isin(member_map)].copy()
    filtered['industry_code'] = filtered['code'].map(lambda code: member_map[code]['industry_code'])
    filtered['industry_name'] = filtered['code'].map(lambda code: member_map[code]['industry_name'])
    return filtered


def get_tmt_data_for_date(date_str, membership=None, turnover=None):
    """Calculate the standard SW four-industry margin concentration for a date."""
    membership = membership or get_sw_tmt_membership(date_str)
    if turnover is None:
        turnover = fetch_sw_tmt_turnover_history([date_str])[date_str]
    frame = get_stock_margin_detail(date_str)
    df_tmt = _filter_standard_tmt_margin(frame, membership)
    tmt_yy = float(pd.to_numeric(df_tmt['yy'], errors='coerce').fillna(0).sum())
    tmt_buy = float(pd.to_numeric(df_tmt['buy'], errors='coerce').fillna(0).sum())
    tmt_margin_count = int(df_tmt['code'].nunique())

    mkt = get_market_data(date_str)
    total_market_yy = mkt['market_yy']
    total_market_buy = mkt['market_buy']
    tmt_universe_count = int(membership.get('universe_count') or len(_standard_membership_map(membership)))
    return {
        'date': date_str,
        'definition_id': DEFINITION_ID,
        'definition_name': DEFINITION_NAME,
        'classification_asof': membership['classification_asof'],
        'membership_hash': membership['membership_hash'],
        'membership_mode': membership['membership_mode'],
        'tmt_yy': round(tmt_yy / 1e8, 1),
        'tmt_sz_yy': round(tmt_yy / 1e8, 1),  # compatibility alias; now includes both exchanges
        'market_yy': total_market_yy,
        'pct': round(tmt_yy / (total_market_yy * 1e8) * 100, 2) if total_market_yy > 0 else 0,
        'tmt_buy': round(tmt_buy / 1e8, 1),
        'market_buy': total_market_buy,
        'tmt_buy_pct': round(tmt_buy / (total_market_buy * 1e8) * 100, 2) if total_market_buy > 0 else 0,
        'tmt_universe_count': tmt_universe_count,
        'tmt_margin_count': tmt_margin_count,
        'tmt_count': tmt_margin_count,  # compatibility alias only
        'tmt_turnover_pct': turnover['tmt_turnover_pct'],
        'tmt_turnover_by_industry': turnover['tmt_turnover_by_industry'],
        'turnover_source': turnover.get('turnover_source'),
    }


def get_standard_tmt_stock_views(date_str, prev_date, membership, market_yy=None, top_n=20):
    """Build industry aggregates and stock rankings only from the standard pool."""
    frame = _filter_standard_tmt_margin(get_stock_margin_detail(date_str), membership)
    prev_balance_map = get_previous_balance_map(prev_date)
    frame['yy_chg_1d_raw'] = frame.apply(
        lambda row: row['yy'] - prev_balance_map[row['code']] if row['code'] in prev_balance_map else None,
        axis=1,
    )
    member_map = _standard_membership_map(membership)
    tmt_yy_raw = float(pd.to_numeric(frame['yy'], errors='coerce').fillna(0).sum())
    if market_yy is None:
        market_yy = get_market_data(date_str)['market_yy']

    def stock_row(row):
        repay = row.get('repay')
        net_buy = row.get('net_buy')
        change = row.get('yy_chg_1d_raw')
        return {
            'code': row['code'],
            'name': row['name'],
            'market': row['market'],
            'sw_industry_code': row['industry_code'],
            'sw_industry_name': row['industry_name'],
            'yy': round(float(row['yy']) / 1e8, 1),
            'buy': round(float(row['buy']) / 1e8, 1),
            'repay': None if pd.isna(repay) else round(float(repay) / 1e8, 1),
            'net': None if pd.isna(net_buy) else round(float(net_buy) / 1e8, 1),
            'yy_chg_1d': None if pd.isna(change) else round(float(change) / 1e8, 1),
        }

    top_balance_stocks = [
        stock_row(row)
        for _, row in frame.sort_values(['yy', 'code'], ascending=[False, True]).head(top_n).iterrows()
    ]
    change_frame = frame[frame['yy_chg_1d_raw'].notna()].sort_values(
        ['yy_chg_1d_raw', 'code'], ascending=[False, True]
    )
    top_change_stocks = [stock_row(row) for _, row in change_frame.head(top_n).iterrows()]

    industry_summary = []
    for industry_code, industry_name in SW_TMT_INDUSTRIES.items():
        group = frame[frame['industry_code'] == industry_code]
        yy_raw = float(pd.to_numeric(group['yy'], errors='coerce').fillna(0).sum())
        buy_raw = float(pd.to_numeric(group['buy'], errors='coerce').fillna(0).sum())
        changes = pd.to_numeric(group['yy_chg_1d_raw'], errors='coerce')
        industry_summary.append({
            'industry_code': industry_code,
            'industry_name': industry_name,
            'universe_count': sum(1 for item in member_map.values() if item['industry_code'] == industry_code),
            'margin_count': int(group['code'].nunique()),
            'yy': round(yy_raw / 1e8, 1),
            'buy': round(buy_raw / 1e8, 1),
            'yy_chg_1d': None if changes.notna().sum() == 0 else round(float(changes.sum()) / 1e8, 1),
            'pct': round(yy_raw / (float(market_yy) * 1e8) * 100, 2) if market_yy else 0,
            'tmt_share_pct': round(yy_raw / tmt_yy_raw * 100, 2) if tmt_yy_raw else 0,
        })

    return {
        'industry_summary': industry_summary,
        'top_balance_stocks': top_balance_stocks,
        'top_change_stocks': top_change_stocks,
    }


def load_previous_payload():
    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            if payload.get('success') and isinstance(payload.get('data'), dict):
                return payload
    except Exception:
        pass
    return None


def load_eastmoney_spot_snapshots():
    try:
        if os.path.exists(EASTMONEY_SPOT_SNAPSHOT_FILE):
            with open(EASTMONEY_SPOT_SNAPSHOT_FILE, 'r', encoding='utf-8') as f:
                payload = json.load(f)
            if isinstance(payload, dict):
                return payload
    except Exception:
        pass
    return {'source': 'eastmoney_spot_archive', 'snapshots': {}}


def save_eastmoney_spot_snapshot(date_str, row, top100, volume_top100):
    if not date_str or not row:
        return
    try:
        payload = load_eastmoney_spot_snapshots()
        snapshots = payload.setdefault('snapshots', {})
        clean_row = {k: v for k, v in row.items() if not k.endswith('_percentile')}
        clean_row['source'] = 'eastmoney_spot'
        clean_top100 = []
        for idx, item in enumerate(top100 or [], 1):
            clean_item = dict(item)
            clean_item['rank'] = int(clean_item.get('rank') or idx)
            clean_item['source'] = 'eastmoney_spot'
            clean_top100.append(clean_item)
        clean_volume_top100 = []
        for idx, item in enumerate(volume_top100 or [], 1):
            clean_item = dict(item)
            clean_item['rank'] = int(clean_item.get('rank') or idx)
            clean_item['source'] = 'eastmoney_spot'
            clean_volume_top100.append(clean_item)
        snapshots[str(date_str)] = {
            'date': str(date_str),
            'generatedAt': datetime.now().isoformat(),
            'row': clean_row,
            'top100': clean_top100,
            'volume_top100': clean_volume_top100,
        }
        payload['source'] = 'eastmoney_spot_archive'
        payload['updatedAt'] = datetime.now().isoformat()
        os.makedirs(os.path.dirname(EASTMONEY_SPOT_SNAPSHOT_FILE), exist_ok=True)
        with open(EASTMONEY_SPOT_SNAPSHOT_FILE, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        print(f"Eastmoney spot snapshot archive failed: {exc}", file=sys.stderr)


def merge_eastmoney_spot_snapshots(trend_by_date, top100_by_date, volume_top100_by_date):
    payload = load_eastmoney_spot_snapshots()
    snapshots = payload.get('snapshots') or {}
    if not isinstance(snapshots, dict):
        return
    for date, snapshot in snapshots.items():
        row = snapshot.get('row') or {}
        if row.get('date') and _is_eastmoney_trading_source(row):
            trend_by_date[str(row['date'])] = row
        top_rows = [item for item in (snapshot.get('top100') or []) if _is_eastmoney_trading_source(item)]
        volume_rows = [item for item in (snapshot.get('volume_top100') or []) if _is_eastmoney_trading_source(item)]
        if top_rows:
            top100_by_date[str(date)] = top_rows
        if volume_rows:
            volume_top100_by_date[str(date)] = volume_rows


def get_latest_trade_date():
    """获取不晚于今天的最近交易日，用于给实时横截面落日期。"""
    try:
        df = ak.tool_trade_date_hist_sina()
        today = datetime.now().date()
        dates = pd.to_datetime(df['trade_date'], errors='coerce').dt.date
        valid = sorted([d for d in dates.dropna().tolist() if d <= today])
        if valid:
            return valid[-1].strftime('%Y%m%d')
    except Exception:
        pass
    return datetime.now().strftime('%Y%m%d')


def _fetch_em_spot_page(page, page_size=100):
    params = {
        'pn': str(page),
        'pz': str(page_size),
        'po': '1',
        'np': '1',
        'ut': 'bd1d9ddb04089700cf9c27f6f7426281',
        'fltt': '2',
        'invt': '2',
        'fid': 'f6',
        'fs': 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
        'fields': EASTMONEY_SPOT_FIELDS,
    }
    last_error = None
    for url in EASTMONEY_SPOT_URLS:
        try:
            r = requests.get(url, params=params, timeout=20)
            r.raise_for_status()
            data = r.json().get('data') or {}
            rows = data.get('diff') or []
            if rows:
                return rows, int(data.get('total') or 0)
            last_error = RuntimeError(f"{url} returned empty diff")
        except Exception as exc:
            last_error = exc
            continue
    raise RuntimeError(str(last_error) if last_error else 'Eastmoney spot failed')


def get_a_share_spot_by_amount():
    """快速拉取全A实时横截面，按成交额降序返回。"""
    first_page, total = _fetch_em_spot_page(1)
    page_size = 100
    pages = max(1, math.ceil(total / page_size))
    rows = list(first_page)

    if pages > 1:
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {executor.submit(_fetch_em_spot_page, page, page_size): page for page in range(2, pages + 1)}
            for future in as_completed(futures):
                page_rows, _ = future.result()
                rows.extend(page_rows)

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    rename_map = {
        'f2': 'price',
        'f3': 'pct_chg',
        'f4': 'chg',
        'f5': 'volume',
        'f6': 'amount',
        'f8': 'turnover_rate',
        'f10': 'volume_ratio',
        'f12': 'code',
        'f14': 'name',
        'f20': 'market_cap',
        'f21': 'float_market_cap',
        'f124': 'spot_timestamp',
        'f297': 'spot_trade_date',
    }
    df = df.rename(columns=rename_map)
    for col in ['price', 'pct_chg', 'chg', 'volume', 'amount', 'turnover_rate', 'volume_ratio', 'market_cap', 'float_market_cap']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    if 'spot_trade_date' in df.columns:
        df['spot_trade_date'] = df['spot_trade_date'].map(lambda value: str(value).replace('-', '')[:8] if pd.notna(value) else None)
    df = df.dropna(subset=['code', 'name', 'amount'])
    df = df[df['amount'] > 0].copy()
    return df.sort_values('amount', ascending=False).reset_index(drop=True)


def _safe_round(value, digits=2):
    if value is None or pd.isna(value):
        return None
    return round(float(value), digits)


def _calc_percentile(value, values):
    clean = [float(v) for v in values if v is not None and not pd.isna(v)]
    if value is None or pd.isna(value) or not clean:
        return None
    return round(sum(1 for v in clean if v <= float(value)) / len(clean) * 100, 2)


def _with_amount_percentiles(trend):
    keys = ['top1_ratio', 'top3_ratio', 'top5_ratio']
    values_by_key = {key: [item.get(key) for item in trend] for key in keys}
    sample_count = max((len([v for v in values if v is not None]) for values in values_by_key.values()), default=0)
    next_trend = []
    for item in trend:
        next_item = {k: v for k, v in item.items() if k not in ['top100', 'volume_top100']}
        next_item['top1_percentile'] = _calc_percentile(item.get('top1_ratio'), values_by_key['top1_ratio'])
        next_item['top3_percentile'] = _calc_percentile(item.get('top3_ratio'), values_by_key['top3_ratio'])
        next_item['top5_percentile'] = _calc_percentile(item.get('top5_ratio'), values_by_key['top5_ratio'])
        next_trend.append(next_item)
    return next_trend, sample_count


def _has_trading_ratio(item):
    if not item:
        return False
    return any(item.get(key) is not None for key in ['top1_ratio', 'top3_ratio', 'top5_ratio'])


def _is_eastmoney_trading_source(item):
    source = str((item or {}).get('source') or '')
    if source in {
        'eastmoney_spot',
        'sina_spot',
        'eastmoney_kline_cache',
        'akshare_sina_historical_reconstruction',
        'tushare_historical_reconstruction',
        'tushare_daily_fallback',
        'baostock_historical_reconstruction',
    }:
        return True
    if source:
        return False

    row = item or {}
    date = str(row.get('date') or '')
    has_trend_values = (
        len(date) == 8
        and date.isdigit()
        and _has_trading_ratio(row)
    )
    code = str(row.get('code') or '').strip()
    has_top100_values = bool(code) and any(
        row.get(key) is not None
        for key in ['amount', 'amount_yi', 'amount_share', 'volume']
    )
    return has_trend_values or has_top100_values


def _filter_eastmoney_top100_cache(by_date):
    filtered = {}
    for date, rows in (by_date or {}).items():
        safe_rows = [row for row in (rows or []) if _is_eastmoney_trading_source(row)]
        if safe_rows:
            filtered[str(date)] = safe_rows
    return filtered


def _trading_warning(latest):
    max_percentile = max([
        latest.get('top1_percentile') or 0,
        latest.get('top3_percentile') or 0,
        latest.get('top5_percentile') or 0,
    ])
    if max_percentile >= 98:
        return 'danger'
    if max_percentile >= 95:
        return 'warning'
    if max_percentile >= 90:
        return 'warm'
    return 'normal'


def _safe_int_stock_code(ts_code):
    if not ts_code:
        return None
    code = str(ts_code).strip().upper().split('.')[0]
    if code.startswith('SH'):
        code = code[2:]
    elif code.startswith('SZ'):
        code = code[2:]
    elif code.startswith('BJ'):
        code = code[2:]
    return code.zfill(6)


def _safe_text(value, fallback='-'):
    if value is None:
        return fallback
    try:
        if pd.isna(value):
            return fallback
    except Exception:
        pass
    text = str(value).strip()
    return text if text else fallback


def _get_stock_name_map():
    global STOCK_NAME_MAP
    if STOCK_NAME_MAP is not None:
        return STOCK_NAME_MAP

    def _load_from_akshare():
        try:
            df = ak.stock_info_a_code_name()
        except Exception:
            return {}
        if df is None or df.empty:
            return {}
        code_col = next((col for col in ['code', '代码', '证券代码'] if col in df.columns), None)
        name_col = next((col for col in ['name', '名称', '证券简称'] if col in df.columns), None)
        if not code_col or not name_col:
            return {}
        result = {}
        for _, row in df.iterrows():
            code = _safe_int_stock_code(row.get(code_col))
            name = _safe_text(row.get(name_col), '')
            if code and name:
                result[code] = name
        return result

    def _load_from_eastmoney_spot():
        try:
            df = get_a_share_spot_by_amount()
        except Exception:
            return {}
        if df is None or df.empty:
            return {}
        result = {}
        for _, row in df.iterrows():
            code = _safe_int_stock_code(row.get('code'))
            name = _safe_text(row.get('name'), '')
            if code and name:
                result[code] = name
        return result

    STOCK_NAME_MAP = _load_from_eastmoney_spot() or _load_from_akshare()
    return STOCK_NAME_MAP


def _build_top_list_by_field(df, field, top_n=100, total_amount_raw=None):
    if df is None or df.empty:
        return []

    if field not in df.columns:
        return []

    safe_df = df.copy()
    safe_df[field] = pd.to_numeric(safe_df[field], errors='coerce')
    if 'amount' in safe_df.columns:
        safe_df['amount'] = pd.to_numeric(safe_df['amount'], errors='coerce')
    if 'vol' in safe_df.columns:
        safe_df['vol'] = pd.to_numeric(safe_df['vol'], errors='coerce')
    safe_df = safe_df.dropna(subset=[field]).sort_values(field, ascending=False)
    safe_df = safe_df.head(top_n)

    items = []
    if total_amount_raw is None:
        total_amount_raw = float(pd.to_numeric(df.get('amount'), errors='coerce').sum()) if 'amount' in df.columns else 0
    if total_amount_raw <= 0:
        total_amount_raw = 0

    for rank, (_, row) in enumerate(safe_df.iterrows(), 1):
        code = _safe_int_stock_code(row.get('ts_code'))
        if not code:
            continue
        amount_raw = row.get('amount')
        amount = None if amount_raw is None or pd.isna(amount_raw) else float(amount_raw) * 1000
        amount_yi = round(amount / 1e8, 2) if amount is not None else None
        amount_share = (float(amount_raw) / total_amount_raw) * 100 if total_amount_raw > 0 and amount_raw is not None and not pd.isna(amount_raw) else None
        volume = row.get('vol')
        items.append({
            'rank': int(rank),
            'code': code,
            'name': _safe_text(row.get('name'), '-'),
            'price': _safe_round(row.get('close'), 2),
            'pct_chg': _safe_round(row.get('pct_chg'), 2),
            'volume': _safe_round(volume, 0),
            'volume_10k_lot': _safe_round(volume / 10000 if pd.notna(volume) else None, 2),
            'amount': round(amount, 2) if amount is not None else None,
            'amount_yi': amount_yi,
            'amount_share': round(amount_share, 2) if amount_share is not None else None,
            'turnover_rate': _safe_round(row.get('turnover_rate'), 2),
            'volume_ratio': _safe_round(row.get('volume_ratio'), 2),
            'market_cap_yi': None,
            'float_market_cap_yi': None,
        })
    return items


def _build_trading_row_from_daily(df_by_date, date_str):
    if df_by_date is None or df_by_date.empty:
        return None

    safe = df_by_date.copy()
    safe['amount'] = pd.to_numeric(safe.get('amount'), errors='coerce')
    safe = safe.dropna(subset=['amount'])
    if safe.empty:
        return None

    stock_count = len(safe)
    total_amount_raw = float(safe['amount'].sum())  # 历史日线成交额单位：千元
    total_amount = total_amount_raw * 1000
    if total_amount <= 0:
        return None

    total_amount_yi = total_amount / 1e8
    safe = safe.sort_values('amount', ascending=False).reset_index(drop=True)

    def ratio_for(top_n):
        subset = safe.head(top_n)
        if subset.empty:
            return None, 0
        amount = float(subset['amount'].sum()) * 1000
        return amount, amount / total_amount * 100

    bucket_defs = [
        ('top1', 0.01),
        ('top3', 0.03),
        ('top5', 0.05),
    ]
    bucket_data = {}
    for key, pct in bucket_defs:
        count = max(1, math.ceil(stock_count * pct))
        amount, ratio = ratio_for(count)
        bucket_data[f'{key}_count'] = int(count)
        bucket_data[f'{key}_amount'] = round(float(amount), 2)
        bucket_data[f'{key}_amount_yi'] = round(float(amount) / 1e8, 2)
        bucket_data[f'{key}_ratio'] = round(float(ratio), 2) if ratio is not None else None

    top100_by_amount = _build_top_list_by_field(safe, 'amount', top_n=100, total_amount_raw=total_amount_raw)
    top100_by_volume = _build_top_list_by_field(safe, 'vol', top_n=100, total_amount_raw=total_amount_raw)

    return {
        'date': date_str,
        'stock_count': int(stock_count),
        'total_amount': round(total_amount, 2),
        'total_amount_yi': round(total_amount_yi, 2),
        **bucket_data,
        'top100': top100_by_amount,
        'volume_top100': top100_by_volume,
    }, top100_by_amount, top100_by_volume


def get_historical_trading_congestion_rows(target_dates, existing_dates=None):
    if not target_dates:
        return {}, {}, {}

    existing_dates = set(existing_dates or [])
    needed_dates = [date for date in target_dates if date and date not in existing_dates]
    if not needed_dates:
        return {}, {}, {}

    print(
        "Eastmoney-only mode: skip non-Eastmoney historical Top100 fetch; "
        "use scripts/backfill_trading_congestion_eastmoney.py for resumable Eastmoney backfill.",
        file=sys.stderr,
    )
    return {}, {}, {}


def dedupe_dates(dates, limit=None):
    result = []
    seen = set()
    for date in dates or []:
        if not date:
            continue
        date = str(date)
        if date in seen:
            continue
        seen.add(date)
        result.append(date)
        if limit and len(result) >= limit:
            break
    return result


def get_trading_congestion(current_date, trend_dates=None, previous_payload=None, include_history=False):
    previous = (previous_payload or {}).get('data', {}).get('trading_congestion') or {}
    realtime_error = None
    try:
        df = get_a_share_spot_by_amount()
    except Exception as e:
        df = pd.DataFrame()
        realtime_error = str(e)

    if df.empty:
        if not previous:
            raise RuntimeError(realtime_error or '全A成交额横截面拉取失败')
        latest_previous = next(
            (item for item in previous.get('trend') or [] if item.get('date') and item.get('top1_ratio') is not None),
            None,
        )
        current = dict(latest_previous or {})
        if not current:
            current = {k: v for k, v in previous.items() if k not in ['trend', 'top100', 'top100_by_date', 'volume_top100', 'volume_top100_by_date']}
        current_date = str(current.get('date') or previous.get('date') or current_date)
        top100 = previous.get('top100') or []
        volume_top100 = previous.get('volume_top100') or []
    else:
        if 'spot_trade_date' in df.columns:
            spot_dates = [str(date) for date in df['spot_trade_date'].dropna().unique().tolist() if str(date).isdigit()]
            if spot_dates:
                current_date = max(spot_dates)
        stock_count = len(df)
        total_amount = float(df['amount'].sum())
        bucket_defs = [
            ('top1', 0.01),
            ('top3', 0.03),
            ('top5', 0.05),
        ]

        current = {
            'date': current_date,
            'source': 'eastmoney_spot',
            'stock_count': int(stock_count),
            'total_amount': round(total_amount, 2),
            'total_amount_yi': round(total_amount / 1e8, 2),
        }
        for key, pct in bucket_defs:
            count = max(1, math.ceil(stock_count * pct))
            amount = float(df.head(count)['amount'].sum())
            current[f'{key}_count'] = int(count)
            current[f'{key}_amount'] = round(amount, 2)
            current[f'{key}_amount_yi'] = round(amount / 1e8, 2)
            current[f'{key}_ratio'] = round(amount / total_amount * 100, 2) if total_amount > 0 else None

        def build_top100(ranked_df):
            items = []
            for idx, row in enumerate(ranked_df.head(100).itertuples(index=False), 1):
                row_dict = row._asdict()
                amount = float(row_dict['amount'])
                volume = row_dict.get('volume')
                items.append({
                    'rank': int(idx),
                    'code': str(row_dict['code']).zfill(6),
                    'name': str(row_dict['name']),
                    'price': _safe_round(row_dict.get('price'), 2),
                    'pct_chg': _safe_round(row_dict.get('pct_chg'), 2),
                    'volume': _safe_round(volume, 0),
                    'volume_10k_lot': _safe_round(volume / 10000 if volume is not None else None, 2),
                    'amount': round(amount, 2),
                    'amount_yi': round(amount / 1e8, 2),
                    'amount_share': round(amount / total_amount * 100, 2) if total_amount > 0 else None,
                    'turnover_rate': _safe_round(row_dict.get('turnover_rate'), 2),
                    'volume_ratio': _safe_round(row_dict.get('volume_ratio'), 2),
                    'market_cap_yi': _safe_round(row_dict.get('market_cap') / 1e8 if row_dict.get('market_cap') is not None else None, 1),
                    'float_market_cap_yi': _safe_round(row_dict.get('float_market_cap') / 1e8 if row_dict.get('float_market_cap') is not None else None, 1),
                    'source': 'eastmoney_spot',
                })
            return items

        top100 = build_top100(df)
        volume_top100 = build_top100(df.sort_values('volume', ascending=False))
        save_eastmoney_spot_snapshot(current_date, current, top100, volume_top100)

    trend_by_date = {}
    for item in previous.get('trend') or []:
        if item.get('date') and item.get('top1_ratio') is not None:
            if not _is_eastmoney_trading_source(item):
                continue
            clean_item = {k: v for k, v in item.items() if not k.endswith('_percentile')}
            trend_by_date[item['date']] = clean_item
    trend_by_date[current_date] = current

    top100_by_date = _filter_eastmoney_top100_cache(previous.get('top100_by_date') or {})
    volume_top100_by_date = _filter_eastmoney_top100_cache(previous.get('volume_top100_by_date') or {})
    merge_eastmoney_spot_snapshots(trend_by_date, top100_by_date, volume_top100_by_date)
    source = '东方财富全A实时行情；历史Top100来自本地东财缓存'
    used_historical = False

    if include_history and trend_dates:
        existing_dates = set(trend_by_date.keys())
        historical_rows, historical_top100_by_date, historical_volume_top100_by_date = get_historical_trading_congestion_rows(
            trend_dates,
            existing_dates=existing_dates,
        )
        if historical_rows:
            used_historical = True
            source = '东方财富全A实时行情；历史Top100来自本地东财缓存'
            trend_by_date.update(historical_rows)
            top100_by_date.update(historical_top100_by_date)
            volume_top100_by_date.update(historical_volume_top100_by_date)

    if trend_dates:
        for date in trend_dates:
            trend_by_date.setdefault(date, {'date': str(date)})

    trend = sorted(
        trend_by_date.values(),
        key=lambda x: x['date'],
        reverse=True,
    )
    trend_with_percentiles, sample_count = _with_amount_percentiles(trend)
    latest = next((item for item in trend_with_percentiles if item.get('date') == current_date), trend_with_percentiles[0])

    if top100:
        top100_by_date[current_date] = top100
    if volume_top100:
        volume_top100_by_date[current_date] = volume_top100
    available_top100_dates = sorted(
        {
            str(date)
            for date, items in top100_by_date.items()
            if date and isinstance(items, list) and len(items) > 0
        },
        reverse=True,
    )
    for date in available_top100_dates:
        top100_by_date.setdefault(date, [])
        volume_top100_by_date.setdefault(date, [])
    if not trend_dates and not used_historical:
        source = '东方财富全A实时行情；历史Top100暂缺（仅返回真实东财当日）'

    result = {
        **latest,
        'warning': _trading_warning(latest),
        'percentile_sample_count': sample_count,
        'trend': trend_with_percentiles,
        'top100': top100,
        'top100_by_date': top100_by_date,
        'volume_top100': volume_top100,
        'volume_top100_by_date': volume_top100_by_date,
        'available_top100_dates': available_top100_dates,
        'source': source,
    }
    if realtime_error:
        result['realtime_error'] = realtime_error
        if not used_historical and sample_count == 0:
            result['stale'] = True
            result['error'] = realtime_error
    return result


def align_trading_congestion_trend(trading_congestion, reference_dates):
    """按参考日期序列补齐交易拥挤度趋势，缺失日期保持占位（保持分位数按真实样本计算）。"""
    if not trading_congestion:
        return trading_congestion
    current_trend = trading_congestion.get('trend') or []
    if not current_trend:
        return trading_congestion

    normalized_dates = [str(d) for d in reference_dates if d]
    if not normalized_dates:
        return trading_congestion

    trend_by_date = {}
    for item in current_trend:
        if item.get('date'):
            trend_by_date[str(item.get('date'))] = item

    deduped_dates = []
    seen = set()
    for date in normalized_dates:
        if date in seen:
            continue
        seen.add(date)
        deduped_dates.append(date)

    if not deduped_dates:
        return trading_congestion

    all_dates = sorted(set(deduped_dates) | set(trend_by_date.keys()), reverse=True)
    aligned = []
    for date in all_dates:
        item = trend_by_date.get(date)
        if item is None:
            item = {'date': date}
        aligned.append(item)

    aligned_with_percentiles, sample_count = _with_amount_percentiles(aligned)
    valid_rows = [row for row in aligned_with_percentiles if _has_trading_ratio(row)]
    latest = valid_rows[0] if valid_rows else aligned_with_percentiles[0]

    top100_by_date = trading_congestion.get('top100_by_date') or {}
    volume_top100_by_date = trading_congestion.get('volume_top100_by_date') or {}
    available_top100_dates = sorted(
        {
            str(date)
            for date, items in top100_by_date.items()
            if date and isinstance(items, list) and len(items) > 0
        },
        reverse=True,
    )

    return {
        **trading_congestion,
        **latest,
        'trend': aligned_with_percentiles,
        'percentile_sample_count': sample_count,
        'available_top100_dates': available_top100_dates,
        'warning': _trading_warning(latest),
    }


def _cached_standard_row_is_compatible(item, current_membership):
    if not isinstance(item, dict) or item.get('definition_id') != DEFINITION_ID:
        return False
    turnover_rows = item.get('tmt_turnover_by_industry')
    if item.get('tmt_turnover_pct') is None or not isinstance(turnover_rows, list):
        return False
    if len(turnover_rows) != len(SW_TMT_INDUSTRIES):
        return False
    turnover_map = {
        str(row.get('industry_code')): row.get('industry_name')
        for row in turnover_rows
        if isinstance(row, dict)
    }
    if turnover_map != SW_TMT_INDUSTRIES:
        return False
    mode = item.get('membership_mode')
    item_hash = item.get('membership_hash')
    if not item_hash or mode not in {'point_in_time', 'current_components_backfill'}:
        return False
    if mode == 'current_components_backfill':
        return item_hash == current_membership.get('membership_hash')
    return True


def _compatible_cached_trend(cached_payload, current_membership):
    if not cached_payload or not current_membership:
        return []
    rows = cached_payload.get('data', {}).get('trend', []) or []
    return [item for item in rows if _cached_standard_row_is_compatible(item, current_membership)]


def merge_trend(current_items, cached_payload, max_items=40, current_membership=None):
    trend_by_date = {}
    if cached_payload:
        cached_rows = (
            _compatible_cached_trend(cached_payload, current_membership)
            if current_membership is not None
            else cached_payload.get('data', {}).get('trend', []) or []
        )
        for item in cached_rows:
            if item.get('date'):
                trend_by_date[item['date']] = item
    for item in current_items:
        if item and item.get('date'):
            trend_by_date[item['date']] = item
    return sorted(trend_by_date.values(), key=lambda x: x['date'], reverse=True)[:max_items]


def calc_incr_pct(trend, dates, window):
    trend_by_date = {item['date']: item for item in trend}
    if not dates or len(dates) <= window:
        return None
    latest = trend_by_date.get(dates[0])
    older = trend_by_date.get(dates[window])
    if not latest or not older:
        return None
    tmt_d = latest['tmt_yy'] - older['tmt_yy']
    mkt_d = latest['market_yy'] - older['market_yy']
    return round(tmt_d / mkt_d * 100, 1) if mkt_d > 0 else None


def get_target_dates(dates, include_history, previous_payload=None, current_membership=None):
    if not dates:
        return []
    existing_trend_dates = set()
    if previous_payload:
        cached_rows = (
            _compatible_cached_trend(previous_payload, current_membership)
            if current_membership is not None
            else previous_payload.get('data', {}).get('trend') or []
        )
        for item in cached_rows:
            if item.get('date'):
                existing_trend_dates.add(str(item.get('date')))

    # First standard run, old custom cache, or changed current-list backfill:
    # recompute every missing date so methodologies never merge by date.
    if current_membership is not None:
        missing_standard_dates = [date for date in dates if date not in existing_trend_dates]
        if missing_standard_dates:
            target = list(missing_standard_dates)
            if dates[0] not in target:
                target.insert(0, dates[0])
            return dedupe_dates(target, limit=len(dates))

    if include_history:
        target_dates = [date for date in dates if date not in existing_trend_dates]
        latest_date = dates[0]
        if latest_date not in target_dates:
            target_dates = [latest_date] + target_dates

        deduped = []
        seen = set()
        for date in target_dates:
            if date not in seen:
                seen.add(date)
                deduped.append(date)
        return deduped[:len(dates)]
    target = list(dates[:2])
    recent_window = dates[:QUICK_COMPLETENESS_WINDOW_DAYS]
    target.extend(date for date in recent_window if date not in existing_trend_dates)
    return dedupe_dates(target)


def fetch_tmt_items(
    dates,
    current_membership=None,
    turnover_by_date=None,
    snapshot_dir=SW_TMT_MEMBERSHIP_DIR,
):
    items = []
    failures = []
    if not dates:
        return items, failures
    if current_membership is None:
        raise RuntimeError('未提供标准申万TMT成分，拒绝按名称或手工名单回退')
    turnover_by_date = turnover_by_date or {}
    missing_turnover = [date for date in dates if date not in turnover_by_date]
    if missing_turnover:
        raise RuntimeError(f'申万TMT成交占比缺少日期: {missing_turnover}')

    def _fetch_one(date_str):
        try:
            membership = membership_for_data_date(
                date_str,
                current_membership,
                snapshot_dir=snapshot_dir,
            )
            return get_tmt_data_for_date(
                date_str,
                membership=membership,
                turnover=turnover_by_date[date_str],
            ), None
        except Exception as e:
            return None, {'date': date_str, 'error': str(e)}

    with ThreadPoolExecutor(max_workers=6) as executor:
        future_to_date = {executor.submit(_fetch_one, date): date for date in dates}
        for future in as_completed(future_to_date):
            data, error = future.result()
            if data is None:
                failures.append(error)
            else:
                items.append(data)

    items.sort(key=lambda x: x.get('date') or '', reverse=True)
    return items, failures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--api', action='store_true')
    parser.add_argument('--history', action='store_true')
    parser.add_argument('--history-days', type=int, default=260)
    args = parser.parse_args()

    if args.api:
        trading_history_days = args.history_days if args.history else 35
        margin_history_days = min(args.history_days, 40) if args.history else 40
        dates = get_recent_trading_dates(margin_history_days)
        trading_dates = get_recent_trading_dates(trading_history_days) if args.history else dates
        previous_payload = load_previous_payload()
        expected_current_date = dates[0]

        # Resolve/sync the four official component sources exactly once before
        # starting history workers. Workers may read immutable snapshots only.
        classification_asof = datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d')
        current_membership = get_sw_tmt_membership(classification_asof)
        target_dates = get_target_dates(
            dates,
            args.history,
            previous_payload,
            current_membership=current_membership,
        )
        turnover_by_date = fetch_sw_tmt_turnover_history(target_dates)
        current_items, failures = fetch_tmt_items(
            target_dates,
            current_membership=current_membership,
            turnover_by_date=turnover_by_date,
        )
        if not current_items:
            raise RuntimeError('当前交易日TMT明细拉取失败')

        current = next((item for item in current_items if item.get('date') == expected_current_date), None)
        if current is None:
            latest_failure = next(
                (item for item in failures if item and item.get('date') == expected_current_date),
                None,
            )
            detail = latest_failure.get('error') if latest_failure else '未返回完整数据'
            raise RuntimeError(f'最新交易日 {expected_current_date} TMT明细拉取失败: {detail}')

        current_date = current['date']
        try:
            base_index = dates.index(current_date)
        except ValueError:
            base_index = 0
        prev_date = dates[base_index + 1] if len(dates) > base_index + 1 else None

        merge_capacity = len(dates) if args.history else 40
        trend = merge_trend(
            current_items,
            previous_payload,
            max_items=merge_capacity,
            current_membership=current_membership,
        )

        incr_pct_3d_trading = calc_incr_pct(trend, dates, 3)   # 近3交易日
        incr_pct_5d_trading = calc_incr_pct(trend, dates, 5)   # 近5交易日
        incr_pct_10d_trading = calc_incr_pct(trend, dates, 10) # 近10交易日

        # Old custom-universe warning thresholds are intentionally retired.
        warning = 'normal'
        current_date_membership = membership_for_data_date(current_date, current_membership)
        stock_views = get_standard_tmt_stock_views(
            current_date,
            prev_date,
            current_date_membership,
            market_yy=current['market_yy'],
            top_n=20,
        )
        trading_congestion = None
        trading_error = None
        latest_trade_date = get_latest_trade_date()
        trend_dates = [item.get('date') for item in trend if item.get('date')]
        trading_trend_dates = dedupe_dates([latest_trade_date] + trading_dates, limit=trading_history_days) if args.history else None
        try:
            trading_congestion = get_trading_congestion(
                latest_trade_date,
                trend_dates=trading_trend_dates,
                previous_payload=previous_payload,
                include_history=args.history,
            )
        except Exception as e:
            trading_error = str(e)
            previous_trading = (previous_payload or {}).get('data', {}).get('trading_congestion')
            if previous_trading:
                trading_congestion = {
                    **previous_trading,
                    'stale': True,
                    'error': trading_error,
                }
            else:
                trading_congestion = {
                    'date': None,
                    'warning': 'normal',
                    'error': trading_error,
                    'trend': [],
                    'top100': [],
                    'top100_by_date': {},
                    'available_top100_dates': [],
                }
        if trading_trend_dates:
            trading_congestion = align_trading_congestion_trend(trading_congestion, trading_trend_dates)

        result = {
            'success': True,
            'date': current_date,
            'definition_id': DEFINITION_ID,
            'definition_name': DEFINITION_NAME,
            'classification_asof': current['classification_asof'],
            'membership_hash': current['membership_hash'],
            'membership_mode': current['membership_mode'],
            'data': {
                'definition_id': DEFINITION_ID,
                'definition_name': DEFINITION_NAME,
                'date': current_date,
                'classification_asof': current['classification_asof'],
                'membership_hash': current['membership_hash'],
                'membership_mode': current['membership_mode'],
                'tmt_yy': current['tmt_yy'],
                'tmt_universe_count': current['tmt_universe_count'],
                'tmt_margin_count': current['tmt_margin_count'],
                'tmt_count': current['tmt_count'],
                'market_yy': current['market_yy'],
                'pct': current['pct'],
                'tmt_buy': current['tmt_buy'],
                'market_buy': current['market_buy'],
                'tmt_buy_pct': current['tmt_buy_pct'],
                'tmt_turnover_pct': current['tmt_turnover_pct'],
                'tmt_turnover_by_industry': current['tmt_turnover_by_industry'],
                'incr_pct_3d': incr_pct_3d_trading,
                'incr_pct_5d': incr_pct_5d_trading,
                'incr_pct_10d': incr_pct_10d_trading,
                'history_status': {
                    'mode': 'history' if args.history else 'quick',
                    'requested_dates': target_dates,
                    'requested_count': len(target_dates),
                    'completed_count': len(current_items),
                    'failed_count': len(failures),
                    'failed_dates': failures,
                },
                'warning': warning,
                'warning_methodology': 'calibration_pending_for_sw2021_l1_tmt_v1',
                'trend': trend,
                'industry_summary': stock_views['industry_summary'],
                'top_balance_stocks': stock_views['top_balance_stocks'],
                'top_change_stocks': stock_views['top_change_stocks'],
                'trading_congestion': trading_congestion,
                'note': '标准TMT=申万2021一级电子+计算机+传媒+通信；无名称关键词、手工代码或自定义股票池回退',
            },
            'lastUpdated': datetime.now().isoformat()
        }
        print(json.dumps(result, ensure_ascii=False))
    else:
        print("用法: python3 tmt_margin.py --api [--history]")


if __name__ == '__main__':
    import pandas as pd
    main()
