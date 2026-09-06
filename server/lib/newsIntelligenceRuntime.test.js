import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('direct news runtime uses the project Python environment for RSS dependencies', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shifeng-news-python-'));
  const tasksRoot = path.join(tempRoot, '石锋平台要用的');
  const scriptsDir = path.join(tasksRoot, '新闻资讯', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'fetch_rss.py'), [
    'import json',
    'from datetime import datetime, timezone',
    'import feedparser',
    'print(json.dumps([{',
    '  "title": "project Python RSS dependency is available",',
    '  "source_name": "Runtime fixture",',
    '  "source_id": "runtime-fixture",',
    '  "source_type": "media",',
    '  "collection_channel": "rss",',
    '  "published_at": datetime.now(timezone.utc).isoformat(),',
    '  "url": "https://example.test/runtime-fixture"',
    '}]))',
  ].join('\n'));
  fs.writeFileSync(path.join(scriptsDir, 'fetch_wechat_mp.py'), 'print("[]")\n');
  fs.writeFileSync(path.join(scriptsDir, 'fetch_newsletter.py'), 'print("[]")\n');

  const previousTasksRoot = process.env.SHIFENG_TASKS_DIR;
  const previousNewsRoot = process.env.NEWS_INTELLIGENCE_ROOT;
  const previousNewsPython = process.env.NEWS_INTELLIGENCE_PYTHON;
  const previousPython = process.env.PYTHON;
  const previousPath = process.env.PATH;
  const previousFetch = globalThis.fetch;
  process.env.SHIFENG_TASKS_DIR = tasksRoot;
  delete process.env.NEWS_INTELLIGENCE_ROOT;
  delete process.env.NEWS_INTELLIGENCE_PYTHON;
  delete process.env.PYTHON;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { Results: { series: [] } };
    },
  });

  try {
    const moduleUrl = new URL(`./newsIntelligence.js?python-test=${Date.now()}`, import.meta.url);
    const { fetchNewsIntelligence } = await import(moduleUrl.href);
    const result = await fetchNewsIntelligence({ mode: 'quick', since: '1h', limit: 1 });

    assert.equal(result.news.length, 1);
    assert.equal(result.news[0].title, 'project Python RSS dependency is available');
    assert.equal(result.meta.collectorStatus.successfulChannels.length, 12);
  } finally {
    if (previousTasksRoot === undefined) delete process.env.SHIFENG_TASKS_DIR;
    else process.env.SHIFENG_TASKS_DIR = previousTasksRoot;
    if (previousNewsRoot === undefined) delete process.env.NEWS_INTELLIGENCE_ROOT;
    else process.env.NEWS_INTELLIGENCE_ROOT = previousNewsRoot;
    if (previousNewsPython === undefined) delete process.env.NEWS_INTELLIGENCE_PYTHON;
    else process.env.NEWS_INTELLIGENCE_PYTHON = previousNewsPython;
    if (previousPython === undefined) delete process.env.PYTHON;
    else process.env.PYTHON = previousPython;
    process.env.PATH = previousPath;
    globalThis.fetch = previousFetch;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
