import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('recovered task root resolves the complete news-intelligence source', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shifeng-news-home-'));
  const tasksRoot = path.join(tempHome, 'Downloads', '石锋平台要用的');
  const newsRoot = path.join(tasksRoot, '新闻资讯');
  const scriptsDir = path.join(newsRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  ['fetch_rss.py', 'fetch_wechat_mp.py', 'fetch_newsletter.py'].forEach((name) => {
    fs.writeFileSync(path.join(scriptsDir, name), '');
  });

  try {
    const moduleUrl = new URL(`./newsIntelligencePaths.js?test=${Date.now()}`, import.meta.url);
    const pathsModule = await import(moduleUrl.href).catch(() => ({}));

    assert.equal(typeof pathsModule.resolveNewsIntelligenceRoot, 'function');
    assert.equal(pathsModule.resolveNewsIntelligenceRoot({
      env: { SHIFENG_TASKS_DIR: tasksRoot },
      homeDir: tempHome,
    }), newsRoot);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test('news-intelligence runtime uses the recovered task root', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shifeng-news-runtime-'));
  const tasksRoot = path.join(tempHome, '石锋平台要用的');
  const newsRoot = path.join(tasksRoot, '新闻资讯');
  const scriptsDir = path.join(newsRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  ['fetch_rss.py', 'fetch_wechat_mp.py', 'fetch_newsletter.py'].forEach((name) => {
    fs.writeFileSync(path.join(scriptsDir, name), '');
  });

  const previousTasksRoot = process.env.SHIFENG_TASKS_DIR;
  const previousNewsRoot = process.env.NEWS_INTELLIGENCE_ROOT;
  process.env.SHIFENG_TASKS_DIR = tasksRoot;
  delete process.env.NEWS_INTELLIGENCE_ROOT;

  try {
    const moduleUrl = new URL(`./newsIntelligence.js?path-test=${Date.now()}`, import.meta.url);
    const newsModule = await import(moduleUrl.href);

    assert.equal(typeof newsModule.getNewsIntelligenceSourceStatus, 'function');
    assert.equal(newsModule.getNewsIntelligenceSourceStatus().root, newsRoot);
    assert.equal(typeof newsModule.buildNewsPythonArgs, 'function');
    const pythonArgs = newsModule.buildNewsPythonArgs(
      path.join(newsRoot, 'scripts', 'fetch_rss.py'),
      ['--since', '1h'],
    );
    assert.equal(path.basename(pythonArgs[0]), 'run_legacy_news.py');
    assert.deepEqual(pythonArgs.slice(1), [
      path.join(newsRoot, 'scripts', 'fetch_rss.py'),
      '--since',
      '1h',
    ]);
  } finally {
    if (previousTasksRoot === undefined) delete process.env.SHIFENG_TASKS_DIR;
    else process.env.SHIFENG_TASKS_DIR = previousTasksRoot;
    if (previousNewsRoot === undefined) delete process.env.NEWS_INTELLIGENCE_ROOT;
    else process.env.NEWS_INTELLIGENCE_ROOT = previousNewsRoot;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
