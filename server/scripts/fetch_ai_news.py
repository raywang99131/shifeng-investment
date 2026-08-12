#!/usr/bin/env python3
"""
AI News Fetcher v2 — 严选版
基于 aihot.virxact.com 精选机制：
1. 只采集过去24小时内的新闻
2. 多维评分：模型打5个维度分，代码算最终分
3. 信源分级权重：T1 > T1.5 > T2
4. 事件去重：同一事件只推一条最权威的
5. 分类阈值不同
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from xml.etree import ElementTree as ET

RSS_FEEDS = [
    # T1 官方一手信息（最高权重）
    ("OpenAI Blog",        "https://openai.com/blog/rss.xml",               "T1"),
    ("Anthropic Blog",     "https://www.anthropic.com/rss.xml",              "T1"),
    ("GitHub Blog",         "https://github.blog/feed/",                      "T1"),
    ("OpenRouter",         "https://openrouter.ai/feed",                     "T1"),
    ("Apple ML",            "https://machinelearning.apple.com/feed.xml",    "T1"),
    ("Nathan Lambert",     "https://www.interconnects.ai/feed",              "T1"),
    # T1.5 官方账号（次高权重）
    ("Simon Willison",      "https://simonwillison.net/feed/atom",            "T1.5"),
    # T2 综合媒体/KOL
    ("IT之家",              "https://www.ithome.com/rss/",                   "T2"),
    ("Hacker News 中文",    "https://hn.buzzing.cc/rss",                      "T2"),
]

# 时间衰减：超过24小时的新闻权重降低（最多降50%）
HOUR_SCORE_DECAY = 0.02  # 每小时降2%
MAX_DECAY = 0.5  # 最多降50%

# 分类阈值（分数 >= 此值才进入精选）
THRESHOLDS = {
    "T1":    35,
    "T1.5":  40,
    "T2":    45,
}

# 各维度权重（用于计算最终分）
DIM_WEIGHTS = {
    "importance":        0.30,  # 对AI行业的重要程度
    "technical_depth":   0.20,  # 技术深度
    "originality":        0.20,  # 原创/独家程度
    "credibility":        0.20,  # 来源可信度
    "reader_value":      0.10,  # 对读者的价值
}

CATEGORY = "软件/AI大模型"
MAX_TOTAL = 60  # 严选，最多60条


def parse_pubdate(pub_str):  # -> datetime | None
    """解析 RSS pubDate，返回 datetime 或 None"""
    if not pub_str:
        return None
    # 常见格式：Thu, 08 May 2026 07:43:00 GMT
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(pub_str)
    except Exception:
        pass
    # 备用简单解析
    try:
        pub_str = pub_str.strip()
        parts = pub_str.split()
        if len(parts) >= 5:
            months = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
                      "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}
            day = int(parts[1])
            month = months.get(parts[2], 1)
            year = int(parts[3])
            hm = parts[4].split(":")
            hour = int(hm[0])
            minute = int(hm[1])
            return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
    except Exception:
        pass
    return None


def fetch_rss(name: str, url: str, tier: str, max_items: int = 12) -> list:
    items = []
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        with urllib.request.urlopen(req, timeout=12) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
        root = ET.fromstring(raw)
        all_entries = root.findall('.//item') + root.findall('.//entry')
        now = datetime.now(timezone.utc)
        for entry in all_entries[:max_items * 2]:  # 多抓点，后面过滤
            def get_text(tag):
                el = entry.find(tag)
                return el.text.strip() if el is not None and el.text else ''
            title = get_text('title')
            link = get_text('link') or get_text('guid')
            pub_str = get_text('pubDate') or get_text('published') or get_text('updated')
            if not title:
                continue
            pub_dt = parse_pubdate(pub_str)
            # 时间过滤：只保留过去24小时
            if pub_dt:
                age_hours = (now - pub_dt).total_seconds() / 3600
                if age_hours > 24:
                    continue
            else:
                # 无法解析时间，默认通过（避免丢失）
                age_hours = 0
            items.append({
                'title': title,
                'source': name,
                'tier': tier,
                'link': link,
                'time': pub_str[:22] if pub_str else '',
                'age_hours': age_hours,
            })
    except Exception:
        pass
    return items


def score_news(title: str, source: str, tier: str) -> dict:
    """
    简化评分：用关键词规则打分（5个维度）
    在生产环境中这里应该调用 LLM。
    """
    score = 50.0  # 基础分
    keywords_high = [
        "openai", "anthropic", "claude", "gpt", "gemini", "llm", "model",
        "agent", "reasoning", "deepseek", "qwen", "llama", "mistral",
        "nvidia", "gpu", "chip",
    ]
    keywords_medium = [
        "ai ", "machine learning", "neural", "inference", "training",
        "startup", "funding", "investment", "partnership",
    ]
    keywords_low = [
        "meta", "apple", "google", "microsoft", "amazon", "tesla",
    ]
    for kw in keywords_high:
        if kw.lower() in title.lower():
            score += 20
    for kw in keywords_medium:
        if kw.lower() in title.lower():
            score += 10
    for kw in keywords_low:
        if kw.lower() in title.lower():
            score += 5
    # 信源等级权重
    tier_weight = {"T1": 1.0, "T1.5": 0.85, "T2": 0.7}
    score *= tier_weight.get(tier, 0.7)
    return {
        "importance":        min(100, score),
        "technical_depth":  min(100, score * 0.9),
        "originality":       min(100, score * 0.8),
        "credibility":       min(100, score * 0.95),
        "reader_value":     min(100, score * 0.85),
    }


def calc_final_score(dims: dict, tier: str) -> float:
    """代码计算最终分（不用模型）"""
    total = sum(dims[k] * DIM_WEIGHTS[k] for k in DIM_WEIGHTS)
    tier_weight = {"T1": 1.0, "T1.5": 0.85, "T2": 0.7}
    return total * tier_weight.get(tier, 0.7)


def is_selected(final_score: float, tier: str) -> bool:
    """代码判断是否精选"""
    threshold = THRESHOLDS.get(tier, 70)
    return final_score >= threshold


def deduplicate(items: list) -> list:
    """简单的词重叠去重：标题前30字符相同视为同一事件，取分数最高的"""
    seen = {}
    for item in items:
        key = item['title'][:30].lower()
        if key not in seen or item['final_score'] > seen[key]['final_score']:
            seen[key] = item
    return list(seen.values())


def main():
    all_raw = []
    now = datetime.now(timezone.utc)
    for name, url, tier in RSS_FEEDS:
        items = fetch_rss(name, url, tier)
        all_raw.extend(items)
        time.sleep(0.2)

    # 时间过滤 + 评分 + 是否精选
    scored = []
    for item in all_raw:
        dims = score_news(item['title'], item['source'], item['tier'])
        final_score = calc_final_score(dims, item['tier'])
        selected = is_selected(final_score, item['tier'])
        # 时间衰减
        age_hours = item.get('age_hours', 0)
        decay = max(1 - age_hours * HOUR_SCORE_DECAY, MAX_DECAY)
        final_score *= decay
        item['final_score'] = round(final_score, 1)
        item['selected'] = selected
        item['category'] = CATEGORY
        item['dims'] = dims
        scored.append(item)

    # 只保留精选的
    selected_items = [i for i in scored if i['selected']]
    # 去重
    deduped = deduplicate(selected_items)
    # 按分数排序，取前MAX_TOTAL
    deduped.sort(key=lambda x: -x['final_score'])
    result = deduped[:MAX_TOTAL]

    for item in result:
        item.pop('age_hours', None)
        item.pop('selected', None)
        item.pop('dims', None)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
