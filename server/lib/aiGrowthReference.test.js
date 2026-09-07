import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGrowthReference, readGrowthReference, createGrowthReferenceCollector } from './aiGrowthReference.js';

const now = new Date('2026-09-06T12:00:00Z');
const reference = readGrowthReference();

test('Yipit keeps all five dated observations, rescales billions and evaluates the final date formula', () => {
  const data = buildGrowthReference(reference, { now });
  const series = data.companies.find((s) => s.company === 'Anthropic' && s.sourceLabel === 'Yipit');
  assert.deepEqual(series.actualPoints.map((p) => [p.observedAt, p.value]), [
    ['2026-05-30', 540], ['2026-06-14', 620], ['2026-06-26', 670], ['2026-07-12', 730], ['2026-07-26', 800],
  ]);
  assert.equal(series.latestActual.momAbsolute, 70);
  assert.equal(series.latestActual.consecutiveMonth, false);
  assert.equal(data.companies.find((s) => s.company === 'OpenAI' && s.sourceLabel === 'Yipit').latestActual.value, 470);
});

test('monthly tracking retains ranges and forecasts and keeps annual revenue outside ARR series', () => {
  const data = buildGrowthReference(reference, { now });
  const monthly = (company) => data.companies.find((s) => s.company === company && s.seriesKind === 'reference');
  assert.equal(monthly('Anthropic').latestActual.value, 730);
  assert.equal(monthly('Anthropic').forecastPoints.find((p) => p.month === '2026-12').value, 1100);
  assert.equal(monthly('OpenAI').actualPoints.find((p) => p.month === '2026-06').valueHigh, 400);
  assert.equal(monthly('Kimi').latestActual.valueQualifier, 'lower-bound');
  assert.equal(monthly('DeepSeek').actualPoints.some((p) => p.month === '2025-12'), false);
  assert.equal(data.otherRevenue.find((p) => p.sourceCell === 'J15').value, 4);
  assert.deepEqual(data.companies.find((s) => s.company === 'OpenAI' && s.seriesKind === 'official').actualPoints.map((p) => p.value), [20, 60, 200]);
});

test('P/ARR recalculates source formulas and exposes forward denominators and standalone assumptions', () => {
  const data = buildGrowthReference(reference, { now });
  const row = (cell) => data.valuations.find((v) => v.sourceCell === cell);
  assert.equal(row('O9').parrLow, 31);
  assert.equal(row('Q17').valuationLow, 8400);
  assert.equal(row('Q17').parrLow, 33.6);
  assert.equal(row('Q17').arrAsOf, '2026-03-01');
  assert.equal(row('Q17').forwardDenominator, true);
  assert.equal(row('Q17').historicalArrValue, 200);
  assert.equal(row('Q17').historicalParrLow, 42);
  assert.equal(row('O20').parrLow, 19.3);
  assert.equal(row('Q20').valuationLow, 10000);
  assert.equal(row('Q20').valuationBasis, 'formula-assumption');
  assert.equal(row('Q20').historicalParrLow, null);
  assert.equal(row('U20').multipleKind, 'P/S');
  assert.equal(row('U21').parrLow, null);
  assert.equal(row('S22').historicalParrLow, null);
});

test('refresh preserves source observation dates and reports an imported snapshot, without relabelling it live', async () => {
  const collector = createGrowthReferenceCollector();
  const result = await collector({ now, generatedAt: now.toISOString() });
  assert.equal(result.source.asOf, '2026-08-23');
  assert.equal(result.source.stale, false);
  assert.equal(result.payload.arrAndValuation.reference.retrievedAt, reference.retrievedAt);
});

test('August MTD excerpt preserves provisional ARR and source uncertainty, without inferring contraction', () => {
  const data = buildGrowthReference(reference, { now });
  for (const [company, value, sourceCell] of [['Anthropic', 683, 'B47'], ['OpenAI', 410, 'C47']]) {
    const latest = data.companies.filter((s) => s.company === company)
      .map((s) => s.latestActual).filter(Boolean).sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
    assert.equal(latest.value, value);
    assert.equal(latest.observedAt, '2026-08-23');
    assert.equal(latest.sourceCell, sourceCell);
    assert.equal(latest.sourceLabel, '报告摘录');
    assert.equal(latest.preliminary, true);
    assert.equal(latest.momAbsolute, null);
    assert.match(latest.comparisonNote, /尚未核对一致/);
    assert.match(latest.commentary, /B2B/);
  }
  const openai = data.companies.find((s) => s.company === 'OpenAI' && s.sourceLabel === '报告摘录');
  assert.equal(openai.actualPoints.length, 1);
  assert.match(openai.latestActual.reportSummary, /420 亿.*预测/);
});

test('a sheet note update never converts the original monthly forecasts into historical ARR', () => {
  const data = buildGrowthReference({ ...reference, sourceUpdatedAt: '2027-01-01' }, { now });
  const monthly = data.companies.find((s) => s.company === 'Anthropic' && s.seriesKind === 'reference');
  assert.equal(monthly.latestActual.value, 730);
  assert.equal(monthly.forecastPoints.find((p) => p.month === '2026-12').value, 1100);
});
