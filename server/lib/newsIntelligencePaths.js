import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REQUIRED_NEWS_SCRIPTS = [
  'fetch_rss.py',
  'fetch_wechat_mp.py',
  'fetch_newsletter.py',
];

const hasRequiredNewsScripts = (root, existsSync) => Boolean(root) && REQUIRED_NEWS_SCRIPTS.every(
  (script) => existsSync(path.join(root, 'scripts', script)),
);

export function resolveNewsIntelligenceRoot({
  env = process.env,
  homeDir = os.homedir(),
  existsSync = fs.existsSync,
} = {}) {
  if (env.NEWS_INTELLIGENCE_ROOT) return path.resolve(env.NEWS_INTELLIGENCE_ROOT);

  const candidates = [
    env.SHIFENG_TASKS_DIR ? path.join(path.resolve(env.SHIFENG_TASKS_DIR), '新闻资讯') : null,
    path.join(homeDir, 'Downloads', '石锋平台要用的', '新闻资讯'),
    path.join(homeDir, 'Documents', '新闻资讯'),
    '/Users/rayw/Documents/新闻资讯',
  ].filter(Boolean);

  return candidates.find((candidate) => hasRequiredNewsScripts(candidate, existsSync))
    || candidates[0];
}

export { REQUIRED_NEWS_SCRIPTS };
