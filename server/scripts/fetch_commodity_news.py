#!/usr/bin/env python3
"""
Commodity News Fetcher — 大宗商品 RSS 源
采集黄金、原油、铜等大宗商品资讯，输出 JSON 数组
"""
import json
import sys
import time
import urllib.request
from xml.etree import ElementTree as ET

RSS_FEEDS = [
    ("Investing.com 大宗商品", "https://www.investing.com/rss/commodities.rss"),
]

CATEGORY = "大宗商品"
MAX_PER_FEED = 15
MAX_TOTAL = 40


def fetch_rss(name: str, url: str, max_items: int = MAX_PER_FEED) -> list:
    items = []
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode('utf-8', errors='replace')

        root = ET.fromstring(raw)
        all_entries = root.findall('.//item') + root.findall('.//entry')
        for entry in all_entries[:max_items]:
            def get_text(tag):
                el = entry.find(tag)
                return el.text.strip() if el is not None and el.text else ''

            title = get_text('title')
            link = get_text('link')
            pub = get_text('pubDate') or get_text('published') or get_text('updated')
            if pub:
                pub = pub[:16]

            if not title:
                continue

            items.append({
                'category': CATEGORY,
                'title': title,
                'source': name,
                'time': pub,
                'url': link,
            })
    except Exception:
        pass
    return items


def main():
    all_items = []
    seen = set()

    for name, url in RSS_FEEDS:
        items = fetch_rss(name, url)
        for item in items:
            key = item['title'][:50].lower()
            if key in seen:
                continue
            seen.add(key)
            all_items.append(item)
        if len(all_items) >= MAX_TOTAL:
            break
        time.sleep(0.2)

    print(json.dumps(all_items, ensure_ascii=False))


if __name__ == '__main__':
    main()
