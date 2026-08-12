#!/usr/bin/env python3
"""
Hardware News Fetcher
通用新闻抓取器：抓取技术/产业链相关新闻，再由后端按标题做归类
"""
import json
import urllib.request
import time
from xml.etree import ElementTree as ET

CATEGORY = "候选"
MAX_PER_FEED = 12
MAX_TOTAL = 60

RSS_FEEDS = [
    ("MacRumors", "https://feeds.macrumors.com/All"),
    ("Engadget", "https://www.engadget.com/rss.xml"),
    ("EE Times", "https://www.eetimes.com/rss"),
    ("雷峰网", "https://www.leiphone.com/feed"),
    ("TechNode", "https://www.technode.com/feed/"),
    ("TechRadar", "https://www.techradar.com/rss"),
    ("AnandTech", "https://www.anandtech.com/feed"),
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
