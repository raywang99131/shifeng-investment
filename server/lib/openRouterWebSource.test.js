import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { load } from 'cheerio';
import { parseOpenRouterRankingsHtml } from './openRouterWebSource.js';

const html = await fs.readFile(new URL('./fixtures/openrouter/rankings.html', import.meta.url), 'utf8');
const now = new Date('2026-09-06T10:00:00.000Z');

test('streamed website tables preserve exact display units, free variants, and growth direction', () => {
  const result = parseOpenRouterRankingsHtml(html, { now });
  assert.deepEqual(result.topModels.map((row) => [row.model, row.tokenDisplay, row.weekOverWeekPercent]), [
    ['Hy4 preview', '14.1T tokens', 6.39],
    ['GLM 5.3 Flash', '12.5T tokens', 1.7],
    ['DeepSeek V4 Flash 0731', '12.3T tokens', 0],
    ['GPT-5.6 Luna', '12.2T tokens', 0.8],
    ['MiniMax M3 (free)', '5.56T tokens', 2.06],
    ['DeepSeek V4 Flash 0423', '5.24T tokens', -0.03],
    ['Hy3', '4.44T tokens', -0.33],
    ['Nemotron 3 Ultra (free)', '3.65T tokens', -0.35],
    ['GLM 5.3', '2.81T tokens', 1.27],
    ['MiMo-V2.5', '2.76T tokens', -0.72],
  ]);
  assert.equal(result.topModels[4].totalTokens, '5560000000000');
  assert.equal(result.topModels[4].url, 'https://openrouter.ai/minimax/minimax-m3:free');
});

test('changed layout, truncated tables, invalid dates, wrong windows, and unknown units fail closed', async (t) => {
  for (const [name, mutate, error] of [
    ['incomplete', ($) => $('tbody tr').last().remove(), /Top 10 不完整/],
    ['missing date', ($) => $('time').remove(), /UTC 数据日/],
    ['future date', ($) => $('time').attr('datetime', '2026-09-07T00:00:00.000Z'), /UTC 数据日/],
    ['duplicate rank', ($) => $('tbody tr').last().find('th').text('1.'), /排名重复/],
    ['wrong window', ($) => $('body').append('<button aria-label="Filter by time window">Today</button>'), /七日统计窗口/],
    ['unknown units', ($) => $('tbody tr').first().find('td').last().children('div').first().text('14.1Q tokens'), /单位无法识别/],
  ]) {
    await t.test(name, () => {
      const $ = load(html); mutate($);
      assert.throws(() => parseOpenRouterRankingsHtml($.html(), { now }), error);
    });
  }
});

test('an unsigned or undisclosed change is unavailable rather than silently positive', () => {
  const $ = load(html);
  $('tbody tr').first().find('.text-positive-text').removeClass('text-positive-text');
  assert.equal(parseOpenRouterRankingsHtml($.html(), { now }).topModels[0].weekOverWeekPercent, null);
});
