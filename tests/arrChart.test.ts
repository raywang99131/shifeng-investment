import assert from 'node:assert/strict';
import test from 'node:test';
import { arrChartSeries, arrValueLabel, latestCompanyValuations, primaryArrMetrics } from '../src/pages/AIDashboard/arrChart.ts';
import type { ArrCompanyMetric, ValuationMetric } from '../src/pages/AIDashboard/types.ts';
import { buildGrowthReference, readGrowthReference } from '../server/lib/aiGrowthReference.js';

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

test('unreconciled report vintages retain both observations but break the connecting line', () => {
  const preliminary = { ...metric.actualPoints[0], observedAt: '2026-08-23', value: 683, preliminary: true, comparisonNote: '新旧口径尚未核对一致' };
  const series = arrChartSeries([{ ...metric, actualPoints: [...metric.actualPoints, preliminary] }]);
  assert.deepEqual(series[0].data.map((d) => d.value[1]), [730, 800, null, 683]);
  assert.equal(series[0].connectNulls, false);
});

test('latest company multiples use the August 23 provisional ARR, excluding the month-end extrapolation', () => {
  const data = buildGrowthReference(readGrowthReference());
  const rows = latestCompanyValuations(data.valuations, data.companies);
  for (const [company, arr, valuation, multiple] of [['Anthropic', 683, 9650, '14.1'], ['OpenAI', 410, 8400, '20.5']] as const) {
    const row = rows.find((r) => r.company === company)!;
    assert.equal(row.arrValue, arr);
    assert.equal(row.parrLow, valuation / arr);
    assert.equal(row.parrLow?.toFixed(1), multiple);
    assert.equal(row.arrAsOf, '2026-08-23');
    assert.equal(row.arrPoint?.preliminary, true);
  }
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

test('latest P/ARR has one row per company and uses the newest historical ARR, not the old formula or a forecast', () => {
  const valuations = [
    { company: 'Anthropic', asOf: '2026-05-01', valuationLow: 9650, valuationHigh: 9650, arrValue: 500, parrLow: 19.3, parrHigh: 19.3 },
    { company: 'Anthropic', asOf: '2026-02-01', valuationLow: 3800, valuationHigh: 3800 },
    { company: 'Anthropic', asOf: '2026-08-01', valuationLow: 10000, valuationHigh: 10000, valuationBasis: 'formula-assumption' },
  ] as ValuationMetric[];
  const rows = latestCompanyValuations(valuations, [{ ...metric, forecastPoints: [{ ...metric.actualPoints[0], kind: 'forecast', value: 1100, observedAt: '2026-12-01' }] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valuationLow, 9650);
  assert.equal(rows[0].arrValue, 800);
  assert.equal(rows[0].arrAsOf, '2026-07-26');
  assert.equal(rows[0].parrLow, 12.0625);
});

test('latest P/ARR preserves ARR lower bounds, divides ranges in the right order, and leaves missing ARR blank', () => {
  const points = [
    { ...metric.actualPoints[0], value: 8, valueLow: 6, valueHigh: 10, company: 'Range' },
    { ...metric.actualPoints[0], value: 10, valueQualifier: 'lower-bound', company: 'Bound' },
  ];
  const rows = latestCompanyValuations(['Range', 'Bound', 'Missing'].map((company) => ({ company, asOf: '2026-06-01', valuationLow: 200, valuationHigh: 300 })) as ValuationMetric[],
    points.map((point) => ({ ...metric, company: point.company, actualPoints: [point] })) as ArrCompanyMetric[]);
  const range = rows.find((r) => r.company === 'Range')!;
  assert.equal(range.parrLow, 20);
  assert.equal(range.parrHigh, 50);
  assert.equal(rows.find((r) => r.company === 'Bound')?.parrUpperBound, true);
  assert.equal(rows.find((r) => r.company === 'Missing')?.parrLow, null);
});
