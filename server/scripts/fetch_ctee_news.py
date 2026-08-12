#!/usr/bin/env python3
"""
CTEE News Fetcher
抓取CTEE「今日晨报」的最近N天页面，抽取包含涨价关键词的相关新闻。
"""
import json
import re
import urllib.request
from datetime import datetime, timedelta
from html import unescape
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed


CATEGORY = '候选'
MAX_DAYS = 35
MAX_TOTAL = 120
BASE_URL = 'https://service.ctee.com.tw/w/ctee2/{date}/index.html'
REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
}
REQUEST_TIMEOUT = 3
MAX_WORKERS = 6

PRICE_KEYWORDS = [
    '涨价',
    '提价',
    '漲價',
    '漲',
    '涨',
    '上漲',
    '喊漲',
    '调价',
    '調價',
    '上调',
    '上涨',
    '价格上涨',
    '价格上调',
    '加价',
    '提調',
    '涨幅',
    '价格',
    '成本上升',
]

SEMICON_KEYWORDS = [
    '半导体',
    '半導體',
    '晶圆',
    '晶圓',
    '台积',
    '台積',
    '台積電',
    'cowos',
    'CoWoS',
    '封装',
    '封测',
    '封測',
    '代工',
    '芯片',
    'GPU',
    'HBM',
    '光刻',
    '硅',
    '矽',
    '玻纤布',
    '玻纖布',
    '晶粒',
]

AI_HINT_KEYWORDS = [
    'AI',
    'ai',
    '人工智能',
    '大模型',
    '模型',
    '半导体',
    '半導體',
    '芯片',
    '封装',
    '代工',
    '晶圆',
    '晶圓',
]

AI_METAL_KEYWORDS = [
    '锡',
    '钽',
    '钽电容',
    '钽靶材',
    '锗',
    '磷化铟',
    '铟',
    '镓',
    '碳化硅',
    '碳化硅衬底',
    '氧化锆',
    '锆',
    '海绵锆',
    '六氧化钨',
    '钨粉',
    '钨条',
    '钼',
    '稀土',
    '海绵钛',
]


def _has_keyword(text, keywords):
    return any(keyword in text for keyword in keywords)


def _strip_html(raw):
    text = re.sub(r'<[^>]+>', '', raw)
    text = unescape(text).replace('\xa0', ' ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def _normalize_url(href):
    href = href.strip()
    if href.startswith('//'):
        return 'https:' + href
    if href.startswith('/'):
        return urljoin('https://www.ctee.com.tw', href)
    if href.startswith('http://') or href.startswith('https://'):
        return href
    return 'https://www.ctee.com.tw/' + href.lstrip('/')


def _extract_time_from_url(url):
    match = re.search(r'(20\d{6})', url)
    if not match:
        return ''
    raw = match.group(1)
    try:
        parsed = datetime.strptime(raw, '%Y%m%d')
        return parsed.strftime('%Y-%m-%d')
    except ValueError:
        return ''


def _is_ctee_link(url):
    low = url.lower()
    return 'ctee.com.tw' in low or 'service.ctee.com.tw' in low


def _fetch_day(date_str):
    url = BASE_URL.format(date=date_str)
    try:
        req = urllib.request.Request(url, headers=REQUEST_HEADERS)
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as response:
            html = response.read().decode('utf-8', errors='replace')
    except Exception:
        return []

    items = []
    anchors = re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, flags=re.I | re.S)
    for href, raw_title in anchors:
        link = _normalize_url(href)
        if not _is_ctee_link(link):
            continue
        title = _strip_html(raw_title)
        if not title or len(title) < 6:
            continue
        if len(title) < 6 or len(title) > 120:
            continue

        # 只保留价格相关
        if not _has_keyword(title, PRICE_KEYWORDS):
            continue
        # 优先保留AI/半导体/AI金属相关，避免把全网食品涨价噪声塞进来
        if not (
            _has_keyword(title, SEMICON_KEYWORDS) or
            _has_keyword(title, AI_HINT_KEYWORDS) or
            _has_keyword(title, AI_METAL_KEYWORDS)
        ):
            continue

        items.append({
            'category': CATEGORY,
            'title': title,
            'source': 'CTEE',
            'time': _extract_time_from_url(link),
            'url': link,
        })
    return items


def main():
    today = datetime.now()
    all_items = []
    seen = set()
    dates = [(today - timedelta(days=i)).strftime('%Y%m%d') for i in range(MAX_DAYS)]

    futures = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for date_str in dates:
            futures[pool.submit(_fetch_day, date_str)] = date_str

    day_results = {}
    for future in as_completed(futures):
        date_str = futures[future]
        items = future.result() or []
        day_results[date_str] = items

    for date_str in dates:
        if len(all_items) >= MAX_TOTAL:
            break
        for item in day_results.get(date_str, []):
            key = item['title'][:50].lower()
            if key in seen:
                continue
            seen.add(key)
            all_items.append(item)
            if len(all_items) >= MAX_TOTAL:
                break

    print(json.dumps(all_items[:MAX_TOTAL], ensure_ascii=False))


if __name__ == '__main__':
    main()
