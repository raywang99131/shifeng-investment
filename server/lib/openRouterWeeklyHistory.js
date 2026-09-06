import fs from 'node:fs/promises';

const CAPTURE_FILE = new URL('../data/ai-dashboard/openrouter-weekly-history.json', import.meta.url);
const DAY_MS = 86_400_000;
const check = (condition, message) => { if (!condition) throw new Error(`OpenRouter 周图：${message}`); };

function dateMs(value) {
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(ms)
    && new Date(ms).toISOString().slice(0, 10) === value, '日期无效');
  return ms;
}

function tokens(display) {
  const match = typeof display === 'string' && display.match(/^(\d+(?:\.\d+)?)\s*([KMBT])$/);
  check(match, `Token 显示值无效：${display}`);
  const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]];
  const value = Math.round(Number(match[1]) * scale);
  check(Number.isSafeInteger(value) && value > 0, 'Token 数值超出有效范围');
  // The website rounds each segment and the total independently. Accept only
  // discrepancies explained by their displayed precision, never force equality.
  const precision = (match[1].split('.')[1] || '').length;
  return { value, tolerance: scale / 10 ** precision / 2 };
}

export function parseOpenRouterWeeklyHistory(capture) {
  check(capture?.schemaVersion === 1 && capture.sourceMode === 'browser-tooltip'
    && capture.sourceUrl === 'https://openrouter.ai/rankings#top-models', '来源格式无效');
  const asOf = dateMs(capture.asOf);
  check(Number.isFinite(Date.parse(capture.capturedAt)) && Date.parse(capture.capturedAt) >= asOf, '采集时间无效');
  check(Array.isArray(capture.models) && capture.models.length > 0, '缺少模型');
  const models = capture.models.map(([name, color], id) => {
    check(typeof name === 'string' && name.trim() && typeof color === 'string'
      && /^(#[\da-f]{6}|tomato|orchid|purple)$/i.test(color), '模型名称或颜色无效');
    return { id, name, color };
  });
  check(new Set(models.map((model) => model.name)).size === models.length, '模型重复');
  check(Array.isArray(capture.weeks) && capture.weeks.length >= 52, '缺少完整的 52 周历史');
  let previous = null;
  const weeks = capture.weeks.map(([startDate, totalDisplay, items, paceDisplay], index) => {
    const start = dateMs(startDate);
    check(new Date(start).getUTCDay() === 1 && start <= asOf
      && (previous === null || start === previous + 7 * DAY_MS), '历史周重复、不连续或非周一');
    previous = start;
    const end = start + 6 * DAY_MS;
    const partial = end > asOf;
    const total = tokens(totalDisplay);
    check(Array.isArray(items) && items.length === 10, '每周模型明细不完整');
    let sum = 0;
    let tolerance = total.tolerance;
    const segments = items.map(([modelId, display]) => {
      check(Number.isInteger(modelId) && Boolean(models[modelId]), '模型索引无效');
      const parsed = tokens(display);
      sum += parsed.value;
      tolerance += parsed.tolerance;
      return { modelId, tokens: parsed.value, display };
    });
    check(new Set(segments.map((segment) => segment.modelId)).size === segments.length, '每周模型重复');
    check(Math.abs(sum - total.value) <= tolerance + 1, '模型用量合计与周总量不符');
    let pace = null;
    if (paceDisplay != null) {
      check(partial && index === capture.weeks.length - 1, '已完成周不应包含预计增量');
      const match = paceDisplay.match(/^(\d+(?:\.\d+)?[KMBT]) \(\+(\d+(?:\.\d+)?[KMBT])\)$/);
      check(match, '预计增量格式无效');
      const projected = tokens(match[1]);
      const additional = tokens(match[2]);
      check(Math.abs(projected.value - total.value - additional.value)
        <= projected.tolerance + total.tolerance + additional.tolerance + 1, '预计总量与增量不符');
      pace = { totalTokens: projected.value, totalDisplay: match[1], additionalTokens: additional.value, additionalDisplay: match[2] };
    }
    return { startDate, endDate: new Date(end).toISOString().slice(0, 10), partial,
      totalTokens: total.value, totalDisplay, segments, pace };
  });
  check(asOf - dateMs(weeks.at(-1).startDate) < 7 * DAY_MS, '最新一周缺失');
  return { sourceUrl: capture.sourceUrl, sourceMode: capture.sourceMode, asOf: capture.asOf,
    capturedAt: capture.capturedAt, approximate: true, models, weeks };
}

export async function readOpenRouterWeeklyHistory(file = CAPTURE_FILE) {
  return parseOpenRouterWeeklyHistory(JSON.parse(await fs.readFile(file, 'utf8')));
}
