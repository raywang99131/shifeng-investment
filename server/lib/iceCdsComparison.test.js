import assert from 'node:assert/strict';
import test from 'node:test';
import { createIceCdsComparisonBuilder } from './iceCdsComparison.js';

const curve = { curveId: 'ust-par-zero-proxy-2026-09-04', asOf: '2026-09-04', currency: 'USD', nodes: [{ years: 1, zeroRate: .03 }, { years: 10, zeroRate: .04 }] };
const inputRow = (date) => ({ company: 'Oracle', clearingDate: date, instrumentName: 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20', eodPrice: 96, spreadBp: date.endsWith('04') ? 200 : 185, couponBp: 100, recoveryRate: .4, maturityDate: '2031-06-20', modelVersion: 'ice-isda-compatible-v1', curveId: curve.curveId });
const state = { batchId: 'test', rawRows: [inputRow('2026-09-04'), inputRow('2026-09-11')], derivedRows: [inputRow('2026-09-04'), inputRow('2026-09-11'), { company: 'Oracle', clearingDate: '2026-08-21', modelVersion: 'screenshot-backfill-v1', spreadBp: 210 }], curves: [curve] };
const pricing = async (records) => ({ engine: 'QuantLib ISDA', engineVersion: '1.43', modelVersion: 'quantlib-isda-v2', rows: records.map(r => ({ id: r.id, spreadBp: r.clearingDate.endsWith('04') ? 199 : 184, roundTripPrice: r.cleanPrice, priceResidual: 0, curveId: r.discountCurve.curveId, curveAsOf: r.discountCurve.asOf })) });
const generatedAt = '2026-09-14T01:00:00Z';
test('reprices actual ICE history only and preserves primary values', async () => {
  const before = JSON.stringify(state);
  const result = await createIceCdsComparisonBuilder({ priceBatch: pricing })(state, { generatedAt });
  assert.equal(JSON.stringify(state), before);
  assert.equal(result.status, 'proxy');
  assert.equal(result.mode, 'parallel');
  assert.equal(result.promotionEligible, false);
  assert.equal(result.companies[0].history.length, 2);
  assert.equal(result.companies[0].legacyBp, 185);
  assert.equal(result.companies[0].newBp, 184);
  assert.equal(result.companies[0].newChanges.sevenDayBp, -15);
});
test('uses matching standard discount factors and does not mix curve regimes in changes', async () => {
  const standard = { curveId: 'isda-0911', asOf: '2026-09-11', marketDataAsOf: '2026-09-10', currency: 'USD', sourceKind: 'isda-standard-rfr', sourceUrl: 'https://rfr.spglobal.com/', discountFactors: [{ date: '2026-09-11', discountFactor: 1 }, { date: '2036-09-11', discountFactor: .7 }] };
  const result = await createIceCdsComparisonBuilder({ priceBatch: pricing, standardCurvesFile: 'curves.json', readFile: async () => JSON.stringify({ curves: [standard] }) })(state, { generatedAt });
  assert.equal(result.companies[0].curveKind, 'standard-rfr');
  assert.equal(result.companies[0].newChanges.sevenDayBp, null);
});
test('malformed configured curves fail visibly and retain last success with its original date', async () => {
  const previous = { asOf: '2026-09-04', lastSuccessAt: '2026-09-05T00:00:00Z', companies: [{ company: 'Oracle', newBp: 199 }] };
  const result = await createIceCdsComparisonBuilder({ priceBatch: pricing, standardCurvesFile: 'bad.json', readFile: async () => '{bad' })(state, { generatedAt, previous });
  assert.equal(result.status, 'error');
  assert.equal(result.asOf, '2026-09-04');
  assert.equal(result.lastSuccessAt, previous.lastSuccessAt);
  assert.equal(result.lastAttemptAt, generatedAt);
});
test('engine failures do not label previous results as fresh', async () => {
  const result = await createIceCdsComparisonBuilder({ priceBatch: async () => { throw new Error('offline'); } })(state, { generatedAt });
  assert.equal(result.status, 'error');
  assert.equal(result.asOf, null);
  assert.equal(result.companies.length, 0);
});
test('missing raw prices fail the whole comparison and retain its last successful date', async () => {
  const previous = { asOf: '2026-09-04', lastSuccessAt: '2026-09-05T00:00:00Z', companies: [] };
  const incomplete = { ...state, rawRows: state.rawRows.slice(0, 1) };
  const result = await createIceCdsComparisonBuilder({ priceBatch: pricing })(incomplete, { generatedAt, previous });
  assert.equal(result.status, 'error');
  assert.equal(result.asOf, previous.asOf);
  assert.equal(result.lastSuccessAt, previous.lastSuccessAt);
  assert.match(result.message, /raw/i);
});
