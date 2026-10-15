import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANTHROPIC_INVESTOR_DAY,
  INVESTOR_DAY_VALUATION_SCENARIOS,
  withInvestorDayGrowthSupplement,
} from '../src/pages/AIDashboard/anthropicInvestorDayData.ts';
import { arrChartSeries, arrSourceCategory } from '../src/pages/AIDashboard/arrChart.ts';
import type { AiDashboardSnapshot, ArrCompanyMetric, ArrPoint } from '../src/pages/AIDashboard/types.ts';

function point(overrides: Partial<ArrPoint> = {}): ArrPoint {
  return {
    company: 'Anthropic', month: '2026-08', observedAt: '2026-08-23', value: 683,
    kind: 'actual', seriesKind: 'estimate', datePrecision: 'day', sourceKind: 'estimate',
    sourceLabel: '既有研究估算', ...overrides,
  };
}

function series(actualPoints: ArrPoint[], forecastPoints: ArrPoint[] = []): ArrCompanyMetric {
  const first = actualPoints[0] ?? forecastPoints[0];
  return {
    company: first.company, seriesId: `${first.company}:${first.sourceLabel}`,
    seriesKind: first.seriesKind, sourceLabel: first.sourceLabel,
    actualPoints, forecastPoints, latestActual: actualPoints.at(-1) ?? null, stale: false,
  };
}

function snapshot(extra: ArrCompanyMetric[] = []): AiDashboardSnapshot {
  const ready = { status: 'ready' as const, stale: false };
  return {
    schemaVersion: 1, generatedAt: '2026-10-15T00:00:00Z',
    sources: {
      growth: ready, openRouter: ready, pricing: ready, capital: ready,
      benchmarks: ready, artificialAnalysis: ready, compute: ready, creditRisk: ready,
    },
    arrAndValuation: {
      companies: [
        series([point()]),
        series([point({ observedAt: '2026-05-26', month: '2026-05', value: 470,
          seriesKind: 'official', sourceKind: 'official', sourceLabel: 'Anthropic 官网' })]),
        ...extra,
      ],
      valuations: [{ company: 'Anthropic', asOf: '2026-05-28', valuationLow: 9650, valuationHigh: 9650,
        arrAsOf: '2026-05-26', arrValue: 470, parrLow: 20.53191489361702, parrHigh: 20.53191489361702 }],
      otherRevenue: [point({ value: 46, kind: 'actual' })],
      reference: { title: '既有跟踪', sheet: 'ARR&估值', url: 'https://example.test/reference',
        retrievedAt: '2026-09-07', sourceUpdatedAt: '2026-09-07', note: '保留历史原表' },
    },
    openRouter: { startDate: null, endDate: null, weekTotalTokens: null, priorWeekTotalTokens: null,
      weekOverWeekAbsolute: null, weekOverWeekPercent: null, topModels: [], history: [], attribution: '保留来源' },
    modelPricing: { token: [], tokenHistory: [], priceEvents: [], video: [], videoHistory: [],
      codingPlans: [], codingPlanHistory: [], sourceReports: [] },
    benchmarks: { models: [], metrics: [], winners: {}, vendorSources: [], asOf: null,
      sourceMode: 'none', coverage: { vendors: 0, disclosedVendors: 0, metrics: 0, comparableMetrics: 0 }, attributions: [] },
    artificialAnalysis: { intelligenceIndex: [], taskCosts: [], indexVersion: null },
    computeRental: [], computeSourceReports: [], capitalEvents: [],
    capitalMetrics: { industry: null, byEntity: [] }, capitalSourceReports: [], debtFinancing: [],
    creditRisk: { cds5y: { asOf: null, sourceLabel: '保留信用数据', historyEstimated: false, companies: [] } },
  };
}

function freezeDeep(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
}

test('quarterly revenue keeps USD 100 million units and separates quarterly annualization from September ARR', () => {
  assert.equal(ANTHROPIC_INVESTOR_DAY.eventDate, '2026-10-14');
  assert.equal(ANTHROPIC_INVESTOR_DAY.checkedAt, '2026-10-15');
  assert.deepEqual(ANTHROPIC_INVESTOR_DAY.quarters.map(row => [row.period, row.revenue]), [
    ['2026 Q1', 47], ['2026 Q2', 116], ['2026 Q3', 168],
  ]);
  assert.equal(ANTHROPIC_INVESTOR_DAY.nineMonthRevenue, 331);
  assert.equal(ANTHROPIC_INVESTOR_DAY.q3AnnualizedRevenue, 672);
  assert.equal(ANTHROPIC_INVESTOR_DAY.septemberArrEstimate, 700);
  assert.equal(ANTHROPIC_INVESTOR_DAY.yipitQuotedEstimate, 740);
  assert.deepEqual([ANTHROPIC_INVESTOR_DAY.ipoValuationLow, ANTHROPIC_INVESTOR_DAY.ipoValuationHigh], [18000, 20000]);
});

test('quarter-on-quarter changes are ratios, with no invented first-quarter comparison', () => {
  const [q1, q2, q3] = ANTHROPIC_INVESTOR_DAY.quarters;
  assert.deepEqual([q1.momAbsolute, q1.momPercent], [null, null]);
  assert.equal(q2.momAbsolute, 69);
  assert.ok(Math.abs(q2.momPercent! - 1.4680851063829787) < 1e-12);
  assert.equal(q3.momAbsolute, 52);
  assert.ok(Math.abs(q3.momPercent! - 0.4482758620689655) < 1e-12);
});

test('valuation scenarios cross the valuation and ARR range endpoints rather than pairing low with low', () => {
  assert.deepEqual(INVESTOR_DAY_VALUATION_SCENARIOS.map(row => [row.id, row.arrLow, row.arrHigh,
    row.parrLow.toFixed(1), row.parrHigh.toFixed(1)]), [
    ['september-common', 700, 700, '25.7', '28.6'],
    ['yipit-quoted', 740, 740, '24.3', '27.0'],
    ['caitong-year-end', 800, 850, '21.2', '25.0'],
    ['csc-year-end', 1000, 1000, '18.0', '20.0'],
  ]);
  const range = INVESTOR_DAY_VALUATION_SCENARIOS[2];
  assert.ok(range.parrLow > 21.17 && range.parrLow < 21.18);
  assert.equal(range.parrHigh, 25);
});

test('the supplement is immutable and preserves every existing observation and unrelated snapshot field', () => {
  const original = snapshot();
  const saved = structuredClone(original);
  freezeDeep(original);
  const updated = withInvestorDayGrowthSupplement(original);
  assert.notEqual(updated, original);
  assert.deepEqual(original, saved);
  assert.equal(updated.arrAndValuation.companies.length, 3);
  assert.equal(updated.arrAndValuation.companies[0], original.arrAndValuation.companies[0]);
  assert.equal(updated.arrAndValuation.companies[1], original.arrAndValuation.companies[1]);
  assert.deepEqual(updated.arrAndValuation.companies.flatMap(row => row.actualPoints).map(row => row.value), [683, 470, 700]);
  assert.equal(updated.arrAndValuation.valuations, original.arrAndValuation.valuations);
  assert.equal(updated.arrAndValuation.otherRevenue, original.arrAndValuation.otherRevenue);
  assert.equal(updated.arrAndValuation.reference, original.arrAndValuation.reference);
  for (const key of Object.keys(original).filter(key => key !== 'arrAndValuation') as Array<keyof AiDashboardSnapshot>) {
    assert.equal(updated[key], original[key], key);
  }
});

test('the September point is a standalone historical research estimate and breaks any cross-vintage connecting line', () => {
  const updated = withInvestorDayGrowthSupplement(snapshot());
  const added = updated.arrAndValuation.companies.at(-1)!;
  const observation = added.actualPoints[0];
  assert.equal(added.seriesKind, 'estimate');
  assert.equal(added.latestActual, observation);
  assert.deepEqual(added.forecastPoints, []);
  assert.deepEqual([observation.company, observation.value, observation.kind, observation.seriesKind, observation.sourceKind,
    observation.datePrecision, observation.month, observation.observedAt],
  ['Anthropic', 700, 'actual', 'estimate', 'estimate', 'month', '2026-09', '2026-09-30']);
  assert.equal(observation.sourceLabel, '财通海外 / 建投AI互联网 / 中金（研究估算）');
  assert.deepEqual([observation.momAbsolute, observation.momPercent], [null, null]);
  assert.equal(arrSourceCategory(observation), 'unspecified');
  assert.ok(observation.comparisonNote);
  const chart = arrChartSeries(updated.arrAndValuation.companies)[0];
  assert.deepEqual(chart.data.slice(-2).map(row => row.value[1]), [null, 700]);
});

test('adding the September research estimate is idempotent', () => {
  const once = withInvestorDayGrowthSupplement(snapshot());
  assert.equal(withInvestorDayGrowthSupplement(once), once);
});

test('same-day and later historical observations take precedence over the dated research supplement', () => {
  for (const observation of [
    point({ observedAt: '2026-09-30', month: '2026-09', value: 710 }),
    point({ observedAt: '2026-10-01', month: '2026-10', value: 720 }),
    point({ observedAt: '2026-10-15', month: '2026-10', value: 730, sourceKind: 'official', seriesKind: 'official' }),
  ]) {
    const original = snapshot([series([observation])]);
    assert.equal(withInvestorDayGrowthSupplement(original), original, observation.observedAt);
  }
});

test('whole-month precision protects existing September or later estimates even with an earlier representative day', () => {
  for (const observation of [
    point({ observedAt: '2026-09-01', month: '2026-09', datePrecision: 'month' }),
    point({ observedAt: '2026-10-01', month: '2026-10', datePrecision: 'month' }),
  ]) {
    const original = snapshot([series([observation])]);
    assert.equal(withInvestorDayGrowthSupplement(original), original, `${observation.month}:${observation.datePrecision}`);
  }
});

test('September month-start data does not block the later month-end estimate, while October month-start data does', () => {
  const earlier = point({ observedAt: '2026-09-01', month: '2026-09', datePrecision: 'month-start', value: 680 });
  const original = snapshot([series([earlier])]);
  const updated = withInvestorDayGrowthSupplement(original);
  assert.notEqual(updated, original);
  assert.deepEqual(updated.arrAndValuation.companies.flatMap(row => row.actualPoints).map(row => row.value), [683, 470, 680, 700]);
  assert.equal(updated.arrAndValuation.companies[2].actualPoints[0], earlier);
  const later = snapshot([series([point({ observedAt: '2026-10-01', month: '2026-10', datePrecision: 'month-start', value: 720 })])]);
  assert.equal(withInvestorDayGrowthSupplement(later), later);
});

test('a latestActual-only historical observation also protects a fresher source', () => {
  const fresh = series([point({ observedAt: '2026-10-01', month: '2026-10' })]);
  const original = snapshot([{ ...fresh, actualPoints: [] }]);
  assert.equal(withInvestorDayGrowthSupplement(original), original);
});

test('forecasts, another company and an earlier exact-date September observation do not block the historical estimate', () => {
  const future = point({ observedAt: '2026-12-31', month: '2026-12', value: 1000, kind: 'forecast', datePrecision: 'month' });
  const openai = point({ company: 'OpenAI', observedAt: '2026-10-01', month: '2026-10', value: 500 });
  const earlier = point({ observedAt: '2026-09-29', month: '2026-09', value: 695 });
  const original = snapshot([series([], [future]), series([openai]), series([earlier])]);
  const updated = withInvestorDayGrowthSupplement(original);
  assert.notEqual(updated, original);
  assert.equal(updated.arrAndValuation.companies.length, 6);
  assert.equal(updated.arrAndValuation.companies.at(-1)!.actualPoints[0].value, 700);
  assert.equal(updated.arrAndValuation.companies[2].forecastPoints[0], future);
});

test('quoted and high-frequency ARR values and proposed IPO scenarios never enter historical observation or capital arrays', () => {
  const original = snapshot();
  const updated = withInvestorDayGrowthSupplement(original);
  const points = updated.arrAndValuation.companies.flatMap(row => [...row.actualPoints, ...row.forecastPoints]);
  assert.equal(points.some(row => [740, 750, 768, 18000, 20000].includes(row.value)), false);
  assert.deepEqual(updated.arrAndValuation.valuations, original.arrAndValuation.valuations);
  assert.equal(updated.capitalEvents, original.capitalEvents);
  assert.equal(updated.capitalMetrics, original.capitalMetrics);
});

test('the CICC unit conflict remains visible without reducing Reuters quarterly revenue by a factor of ten', () => {
  assert.ok('cicc' in ANTHROPIC_INVESTOR_DAY.sources);
  const note = ANTHROPIC_INVESTOR_DAY.sources.cicc.note;
  assert.ok(note.includes('16.8亿美元'));
  assert.ok(note.includes('168亿美元'));
  assert.match(note, /疑误/);
  assert.equal(ANTHROPIC_INVESTOR_DAY.quarters[2].revenue, 168);
  assert.equal(ANTHROPIC_INVESTOR_DAY.nineMonthRevenue, 331);
});

test('CICC high-frequency comparisons keep their own estimates and unknown observation dates rather than using receipt dates', () => {
  assert.ok(Array.isArray(ANTHROPIC_INVESTOR_DAY.highFrequencyComparisons));
  assert.deepEqual(ANTHROPIC_INVESTOR_DAY.highFrequencyComparisons.map(row => [row.provider, row.arr, row.observedAt, row.receivedAt]), [
    ['Yipit', 750, null, '2026-10-15'],
    ['TickerTrends', 768, null, '2026-10-15'],
  ]);
  assert.equal(ANTHROPIC_INVESTOR_DAY.yipitQuotedEstimate, 740);
  assert.deepEqual(INVESTOR_DAY_VALUATION_SCENARIOS.map(row => row.arrLow), [700, 740, 800, 1000]);
});
