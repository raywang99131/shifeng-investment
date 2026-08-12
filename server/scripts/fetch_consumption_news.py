#!/usr/bin/env python3
"""
Consumption News Fetcher
通用新闻抓取器：从消费与综合财经源抓取标题，再由后端按标题做归类
"""
import json
import urllib.request
import time
from xml.etree import ElementTree as ET

CATEGORY = "候选"
MAX_PER_FEED = 16
MAX_TOTAL = 80

RSS_FEEDS = [
    ("Yahoo Finance", "https://finance.yahoo.com/rss/"),
    ("Investing", "https://www.investing.com/rss/news.rss"),
    ("CNBC-Retail", "https://www.cnbc.com/id/10000116/device/rss/rss.html"),
    ("CNBC-Consumer", "https://www.cnbc.com/id/10000104/device/rss/rss.html"),
    ("CNBC-Goods", "https://www.cnbc.com/id/10000103/device/rss/rss.html"),
    ("CNBC-Autos", "https://www.cnbc.com/id/10000101/device/rss/rss.html"),
    ("FT-Companies", "https://www.ft.com/companies?format=rss"),
    ("FT-World", "https://www.ft.com/world?format=rss"),
    ("36Kr", "https://www.36kr.com/feed"),
    ("FT-Technology", "https://www.ft.com/technology?format=rss"),
]

def get_text(element, tag):
    node = element.find(tag)
    if node is None:
        return ''
    return (node.text or '').strip()


def get_link(element):
    node = element.find('link')
    if node is None:
        return ''
    href = node.get('href')
    if href:
        return href.strip()
    return (node.text or '').strip()


def fetch_rss(name, url, max_items=MAX_PER_FEED):
    items = []
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=12) as response:
            raw = response.read().decode('utf-8', errors='replace')

        root = ET.fromstring(raw)
        entries = root.findall('.//item') + root.findall('.//entry')
        for entry in entries[: max_items * 2]:
            title = get_text(entry, 'title')
            if not title:
                continue

            link = get_link(entry)
            if not link:
                continue
            pub = get_text(entry, 'pubDate') or get_text(entry, 'published') or get_text(entry, 'updated')

            items.append({
                'category': CATEGORY,
                'title': title,
                'source': name,
                'time': pub[:22] if pub else '',
                'url': link,
            })
            if len(items) >= max_items:
                break
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

    print(json.dumps(all_items[:MAX_TOTAL], ensure_ascii=False))


if __name__ == '__main__':
    main()
