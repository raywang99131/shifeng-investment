import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklyChartGeometry } from '../src/pages/AIDashboard/openRouterWeeklyGeometry.ts';
import type { OpenRouterWeeklyHistory } from '../src/pages/AIDashboard/types.ts';

const history: OpenRouterWeeklyHistory = {
  sourceUrl: 'https://openrouter.ai/rankings#top-models', sourceMode: 'browser-tooltip',
  asOf: '2026-09-05', capturedAt: '2026-09-06T12:00:00Z', approximate: true,
  models: [{ id: 0, name: 'Others', color: '#ff69b4' }, { id: 1, name: 'Model', color: '#0088fe' }],
  weeks: [{ startDate: '2026-08-31', endDate: '2026-09-06', partial: true, totalTokens: 100e12, totalDisplay: '100T',
    segments: [{ modelId: 1, tokens: 90e12, display: '90T' }, { modelId: 0, tokens: 10e12, display: '10T' }],
    pace: { totalTokens: 120e12, totalDisplay: '120T', additionalTokens: 20e12, additionalDisplay: '20T' } }],
};

test('bars follow source model order and forecast is separate above actual tokens', () => {
  const chart = weeklyChartGeometry(history, 'linear');
  const column = chart.columns[0];
  assert.deepEqual(column.segments.map((s) => s.modelId), [0, 1]);
  assert.equal(chart.maximum, 120e12);
  assert.equal(column.segments[0].bottom, 0);
  assert.equal(column.segments[0].top, 1 / 12);
  assert.equal(column.segments[1].top, 5 / 6);
  assert.equal(column.pace?.bottom, 5 / 6);
  assert.equal(column.pace?.top, 1);
});

test('log scale transforms cumulative boundaries and remains finite at zero', () => {
  const chart = weeklyChartGeometry(history, 'log');
  const column = chart.columns[0];
  assert.deepEqual(chart.ticks, [1e12, 10e12, 100e12, 1000e12]);
  assert.equal(column.segments[0].bottom, 0);
  assert.equal(column.segments[0].top, 1 / 3);
  assert.equal(column.segments[1].bottom, 1 / 3);
  assert.equal(column.segments[1].top, 2 / 3);
  assert.ok(column.pace!.top > column.pace!.bottom);
  assert.ok(column.segments.every((s) => Number.isFinite(s.top) && Number.isFinite(s.bottom)));
});
