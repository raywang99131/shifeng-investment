import assert from 'node:assert/strict';
import test from 'node:test';
import { arrChartSeries, arrValueLabel, primaryArrMetrics } from '../src/pages/AIDashboard/arrChart.ts';
import type { ArrCompanyMetric } from '../src/pages/AIDashboard/types.ts';

const metric = {
  company: 'Anthropic', seriesId: 'test', seriesKind: 'estimate', sourceLabel: 'Yipit',
  actualPoints: [
    { company: 'Anthropic', sourceLabel: 'Yipit', seriesKind: 'estimate', observedAt: '2026-07-12', month: '2026-07', value: 730, kind: 'actual', momAbsolute: 60 },
    { company: 'Anthropic', sourceLabel: 'Yipit', seriesKind: 'estimate', observedAt: '2026-07-26', month: '2026-07', value: 800, kind: 'actual', momAbsolute: 70 },
  ], forecastPoints: [], latestActual: null, stale: true,
} as ArrCompanyMetric;

test('ARR chart retains both July dates on a time axis and labels levels, not increments', () => {
  const series = arrChartSeries([metric]);
  assert.deepEqual(series[0].data.map((d) => d.value), [
    [Date.UTC(2026, 6, 12), 730], [Date.UTC(2026, 6, 26), 800],
  ]);
  assert.equal(series[0].type, 'line');
  assert.equal(arrValueLabel(metric.actualPoints[1]), '800');
  assert.equal(arrValueLabel({ value: 395, valueLow: 390, valueHigh: 400 }), '390–400');
});

test('overview combines every source for the two companies and excludes forecasts', () => {
  const monthly = { ...metric, sourceLabel: '飞书月度跟踪', seriesKind: 'reference' } as ArrCompanyMetric;
  assert.deepEqual(primaryArrMetrics([monthly, metric]), [monthly, metric]);
  const series = arrChartSeries([{ ...metric, forecastPoints: [{ ...metric.actualPoints[0], kind: 'forecast', observedAt: '2026-12-01', value: 1100 }] }]);
  assert.equal(series.length, 1);
  assert.equal(series[0].data.length, 2);
  const combined = arrChartSeries([monthly, metric]);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].data.length, 4);
});
