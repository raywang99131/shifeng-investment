#!/usr/bin/env python3
"""
X Watch News Fetcher
Reads the local x_opencli archive and turns relevant X posts into news items.
This does not call opencli or X; it only consumes already-synced jsonl files.
"""
import glob
import html
import json
import os
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime


HISTORY_DIR = '/Users/rayw/Documents/x_opencli/history'
DAILY_DIR = os.path.join(HISTORY_DIR, 'daily')
CATEGORY = '候选'
MAX_DAILY_FILES = 14
MAX_TOTAL = 80
MAX_TITLE_CHARS = 180

RELEVANCE_KEYWORDS = [
    'ai', 'artificial intelligence', 'agent', 'agents', 'llm',
    'openai', 'anthropic', 'claude', 'chatgpt', 'codex', 'gpt', 'gemini', 'kimi',
    'deepseek', 'qwen', 'llama', 'xai', 'grok', 'mcp', 'rag', 'inference',
    'training', 'reasoning', 'robot', 'robotics', 'gpu', 'hbm', 'chip', 'chips',
    'semiconductor', 'nvidia', 'broadcom', 'tsmc', 'wafer', 'datacenter',
    'compute', 'pricing', 'price increase', 'shortage', 'supply',
    '人工智能', '大模型', '模型', '智能体', '代理', '推理', '训练', '算力',
    '芯片', '半导体', '半導體', '台积', '台積', '英伟达', '英偉達',
    '数据中心', '資料中心', '涨价', '漲價', '提价', '漲', '涨',
]

BROAD_AUTHORS = {
    'wallstengine',
    'stocksavvyshay',
    'elonmusk',
}

STRICT_RELEVANCE_KEYWORDS = [
    'ai', 'artificial intelligence', 'openai', 'anthropic', 'claude', 'chatgpt',
    'codex', 'gpt', 'gemini', 'kimi', 'deepseek', 'qwen', 'llama', 'xai',
    'spacexai', 'grok', 'nvidia', 'nvda', 'gpu', 'hbm', 'semiconductor',
    'chip', 'chips', 'tsmc', 'smci', 'mu', 'broadcom', 'datacenter',
    'data center', 'ai infrastructure', 'foundry', 'palantir', 'pltr',
    'robotics', 'humanoid', 'unitree', 'agi', 'inference', 'training',
    '芯片', '半导体', '半導體', '台积', '台積', '英伟达', '英偉達',
    '算力', '数据中心', '涨价', '漲價',
]

NOISE_PATTERNS = [
    r'^https?://t\.co/\S+$',
    r'^https?://x\.com/\S+$',
]


def parse_created_at(value):
    if not value:
        return None
    try:
        return parsedate_to_datetime(value)
    except Exception:
        return None


def clean_text(value):
    value = value or ''
    value = html.unescape(value)
    value = re.sub(r'\s+', ' ', value).strip()
    return value


def is_noise(text):
    text = clean_text(text)
    if not text:
        return True
    return any(re.match(pattern, text, flags=re.I) for pattern in NOISE_PATTERNS)


def has_relevance(item):
    card = item.get('card') or {}
    quoted = item.get('quoted_tweet') or {}
    author_key = (item.get('author_key') or item.get('author') or '').lower()
    visible_text = ' '.join([
        item.get('text') or '',
        card.get('title') or '',
        card.get('description') or '',
    ])
    combined = ' '.join([visible_text, quoted.get('text') or ''])
    keywords = STRICT_RELEVANCE_KEYWORDS if author_key in BROAD_AUTHORS else RELEVANCE_KEYWORDS
    text_to_check = visible_text if author_key in BROAD_AUTHORS else combined
    return any(keyword_matches(text_to_check, keyword) for keyword in keywords)


def keyword_matches(text, keyword):
    text = text or ''
    keyword = keyword or ''
    if not keyword:
        return False
    if keyword.isascii():
        escaped = re.escape(keyword.lower())
        return re.search(r'(?<![a-z0-9_]){}(?![a-z0-9_])'.format(escaped), text.lower()) is not None
    return keyword in text


def build_summary(item):
    text = clean_text(item.get('text') or '')
    card = item.get('card') or {}
    card_title = clean_text(card.get('title') or '')
    card_description = clean_text(card.get('description') or '')

    if is_noise(text) and card_title:
        summary = card_title
        if card_description:
            summary = summary + ' - ' + card_description
    else:
        summary = text
        if card_title and card_title.lower() not in summary.lower():
            summary = summary + ' - ' + card_title

    summary = clean_text(summary)
    if len(summary) > MAX_TITLE_CHARS:
        summary = summary[:MAX_TITLE_CHARS].rstrip() + '...'
    return summary


def score_item(item):
    likes = int(item.get('likes') or 0)
    retweets = int(item.get('retweets') or 0)
    replies = int(item.get('replies') or 0)
    score = likes + retweets * 8 + replies * 2
    if item.get('card'):
        score += 80
    if item.get('has_media'):
        score += 30
    return score


def read_daily_items():
    files = sorted(glob.glob(os.path.join(DAILY_DIR, '*.jsonl')))
    files = files[-MAX_DAILY_FILES:]
    items = []
    for file_path in files:
        try:
            with open(file_path, 'r', encoding='utf-8') as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        items.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            continue
    return items


def main():
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    seen_ids = set()
    candidates = []

    for item in read_daily_items():
        tweet_id = str(item.get('id') or '')
        if not tweet_id or tweet_id in seen_ids:
            continue
        seen_ids.add(tweet_id)

        created_at = parse_created_at(item.get('created_at') or '')
        if created_at and created_at < cutoff:
            continue
        if not has_relevance(item):
            continue

        summary = build_summary(item)
        if not summary or is_noise(summary):
            continue

        author = item.get('author') or item.get('author_key') or 'unknown'
        author_key = (item.get('author_key') or author or '').lower()
        display_keywords = STRICT_RELEVANCE_KEYWORDS if author_key in BROAD_AUTHORS else RELEVANCE_KEYWORDS
        if not any(keyword_matches('{} {}'.format(author, summary), keyword) for keyword in display_keywords):
            continue
        title = '@{}: {}'.format(author, summary)
        candidates.append({
            'category': CATEGORY,
            'title': title,
            'source': 'X/@{}'.format(author),
            'time': created_at.strftime('%Y-%m-%d %H:%M') if created_at else '',
            'url': item.get('url') or '',
            '_created_ts': created_at.timestamp() if created_at else 0,
            '_score': score_item(item),
        })

    candidates.sort(key=lambda row: (row['_created_ts'], row['_score']), reverse=True)
    result = []
    seen_titles = set()
    for item in candidates:
        key = item['title'][:80].lower()
        if key in seen_titles:
            continue
        seen_titles.add(key)
        item.pop('_created_ts', None)
        item.pop('_score', None)
        result.append(item)
        if len(result) >= MAX_TOTAL:
            break

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
