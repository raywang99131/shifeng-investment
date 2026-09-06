import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { parseOpenRouterWeeklyHistory, readOpenRouterWeeklyHistory } from './openRouterWeeklyHistory.js';

const captured = JSON.parse(await fs.readFile(new URL('../data/ai-dashboard/openrouter-weekly-history.json', import.meta.url), 'utf8'));

test('browser capture retains all 52 calendar weeks, model colors and rounded website values', async () => {
  const data = await readOpenRouterWeeklyHistory();
  assert.equal(data.sourceMode, 'browser-tooltip');
  assert.equal(data.asOf, '2026-09-05');
  assert.equal(data.capturedAt, captured.capturedAt);
  assert.equal(data.models.length, 72);
  assert.equal(data.weeks.length, 52);
  assert.equal(data.weeks[0].startDate, '2025-09-08');
  assert.equal(data.weeks[0].endDate, '2025-09-14');
  assert.equal(data.weeks[0].totalDisplay, '4.9T');
  assert.equal(data.weeks[0].totalTokens, 4.9e12);
  assert.equal(data.models.find((model) => model.name === 'Others').color, '#ff69b4');
  assert.ok(data.weeks.every((week) => week.segments.length === 10));
});

test('latest week actual total and striped weekly pace remain separate', () => {
  const data = parseOpenRouterWeeklyHistory(captured);
  const previous = data.weeks.at(-2);
  const last = data.weeks.at(-1);
  assert.equal(previous.totalDisplay, '113T');
  assert.equal(previous.partial, false);
  assert.equal(previous.pace, null);
  assert.equal(last.startDate, '2026-08-31');
  assert.equal(last.endDate, '2026-09-06');
  assert.equal(last.totalTokens, 108e12);
  assert.equal(last.partial, true);
  assert.deepEqual(last.pace, { totalTokens: 116e12, totalDisplay: '116T', additionalTokens: 7.54e12, additionalDisplay: '7.54T' });
});

test('invalid or incomplete captures are rejected instead of rendering misleading bars', () => {
  const invalid = [
    (data) => { data.weeks = data.weeks.slice(-2); },
    (data) => { data.weeks.splice(10, 1); },
    (data) => { data.weeks[0][0] = '2025-09-09'; },
    (data) => { data.weeks[0][1] = '490T'; },
    (data) => { data.weeks[0][2][0][1] = 'unknown'; },
    (data) => { data.weeks[0][2][1][0] = data.weeks[0][2][0][0]; },
    (data) => { data.weeks.at(-1)[3] = '116T (+75.4T)'; },
    (data) => { data.weeks[0][3] = '8T (+3.1T)'; },
    (data) => { data.models[0][1] = 'url(https://example.com)'; },
    (data) => { data.asOf = '2026-09-99'; },
  ];
  for (const mutate of invalid) {
    const data = structuredClone(captured);
    mutate(data);
    assert.throws(() => parseOpenRouterWeeklyHistory(data), /OpenRouter/);
  }
});
