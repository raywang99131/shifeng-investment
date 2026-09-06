import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

export const OPENROUTER_SOURCE_URL = 'https://openrouter.ai/rankings';
const DAY_MS = 86_400_000;

function tokenCount(display) {
  const match = display.trim().match(/^(\d+(?:\.\d+)?)\s*([KMBT]?)\s+tokens$/i);
  if (!match) throw new Error(`OpenRouter 网页 Token 单位无法识别：${display}`);
  const [whole, decimals = ''] = match[1].split('.');
  const scale = 10n ** BigInt(({ '': 0, K: 3, M: 6, B: 9, T: 12 })[match[2].toUpperCase()]);
  const divisor = 10n ** BigInt(decimals.length);
  const numerator = BigInt(whole + decimals) * scale;
  if (numerator % divisor !== 0n) throw new Error('OpenRouter 网页 Token 数量不是整数');
  return String(numerator / divisor);
}

export function parseOpenRouterRankingsHtml(html, { now = new Date() } = {}) {
  const $ = load(html);
  // Next.js streams the visible table into a later HTML fragment. Read semantic
  // tables across the document, without executing scripts or calling endpoints.
  const weeklyMetadata = $('script[type="application/ld+json"]').toArray().some((element) => {
    try {
      const item = JSON.parse($(element).text());
      return item['@type'] === 'ItemList' && /weekly token usage/i.test(item.name || '');
    } catch { return false; }
  });
  const period = $('[aria-label="Filter by time window"]').text().trim();
  if ((period && period !== 'This Week') || (!period && !weeklyMetadata)) {
    throw new Error('OpenRouter 网页未确认 This Week 七日统计窗口');
  }
  const time = $('time[datetime]').filter((_i, element) => /Usage data through/i.test($(element).parent().text())).first();
  const dateTime = time.attr('datetime') || '';
  const endDate = dateTime.slice(0, 10);
  const date = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(date)
    || new Date(date).toISOString().slice(0, 10) !== endDate
    || date >= Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)) {
    throw new Error('OpenRouter 网页缺少有效的最新完整 UTC 数据日');
  }
  const rows = $('table').filter((_i, element) =>
    $(element).find('caption').text().replace(/\s+/g, ' ').trim() === 'Model rankings by tokens processed',
  ).find('tbody tr').toArray();
  if (rows.length !== 10) throw new Error(`OpenRouter 网页 Top 10 不完整：读取到 ${rows.length} 行`);
  const topModels = rows.map((element) => {
    const row = $(element);
    const cells = row.find('th, td');
    const rank = Number(cells.eq(0).text().trim().replace(/\.$/, ''));
    const modelLink = cells.eq(1).find('a').first();
    const model = modelLink.text().trim();
    const href = modelLink.attr('href') || '';
    const url = new URL(href, OPENROUTER_SOURCE_URL);
    if (!model || !href || url.origin !== 'https://openrouter.ai' || !/^\/[^/]+\/[^/]+$/.test(url.pathname)) {
      throw new Error('OpenRouter 网页模型链接无效');
    }
    const tokenDisplay = cells.eq(2).children('div').first().text().trim();
    const totalTokens = tokenCount(tokenDisplay);
    const change = cells.eq(2).find('[title="Change in tokens processed in the last week from the previous period"]');
    const percent = change.text().trim().match(/^(\d+(?:\.\d+)?)%$/);
    const positive = change.find('.text-positive-text').length > 0;
    const negative = change.find('.text-negative-text').length > 0;
    const weekOverWeekPercent = percent && positive !== negative
      ? Number(percent[1]) / 100 * (negative ? -1 : 1) : null;
    return { rank, model, modelId: url.pathname.slice(1), url: url.href, totalTokens,
      tokenDisplay, approximate: true, weekOverWeekPercent };
  }).sort((a, b) => a.rank - b.rank);
  if (new Set(topModels.map((row) => row.modelId)).size !== 10
    || topModels.some((row, i) => row.rank !== i + 1
      || (i > 0 && BigInt(row.totalTokens) > BigInt(topModels[i - 1].totalTokens)))) {
    throw new Error('OpenRouter 网页排名重复、不连续或 Token 顺序异常');
  }
  return {
    sourceMode: 'public-webpage', sourceUrl: OPENROUTER_SOURCE_URL, period: 'This Week',
    asOf: endDate, fetchedAt: now.toISOString(),
    startDate: new Date(date - 6 * DAY_MS).toISOString().slice(0, 10), endDate,
    topModels,
    top10TotalTokens: String(topModels.reduce((sum, row) => sum + BigInt(row.totalTokens), 0n)),
  };
}

export function createOpenRouterWebClient({ fetchImpl = fetch, cacheFile, now = () => new Date(), timeoutMs = 30_000 } = {}) {
  return {
    async readRankings() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(OPENROUTER_SOURCE_URL, {
          headers: { Accept: 'text/html' }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`OpenRouter 网页读取失败：HTTP ${response.status}`);
        if (!/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('OpenRouter 返回内容不是 HTML 网页');
        const payload = parseOpenRouterRankingsHtml(await response.text(), { now: now() });
        if (cacheFile) {
          await fs.mkdir(path.dirname(cacheFile), { recursive: true });
          const temp = `${cacheFile}.${process.pid}.tmp`;
          await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
          await fs.rename(temp, cacheFile);
        }
        return payload;
      } catch (error) {
        if (controller.signal.aborted) throw new Error(`OpenRouter 网页读取超时（${timeoutMs}ms）`);
        throw error;
      } finally { clearTimeout(timer); }
    },
  };
}
