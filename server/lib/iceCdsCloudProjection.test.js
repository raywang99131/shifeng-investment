import assert from 'node:assert/strict';
import test from 'node:test';
import { projectIceCdsCloud } from './iceCdsCloudProjection.js';

const COMPANY_ROWS = [
  ['Oracle', 216, 95.01, 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20'],
  ['CoreWeave', 800, 90.01, 'COREWEI.SNRFOR.USD.XR14.500.2031-06-20'],
  ['NVIDIA', 87, 100.55, 'NVIDIA.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Amazon', 66, 101.46, 'AMZN.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Google', 60, 101.74, 'ALPHINC.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Microsoft', 49, 102.2, 'MSFT.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Meta', 97, 100.12, 'METAPL.SNRFOR.USD.XR14.100.2031-06-20'],
];
const batch = (asOf = '2026-08-24', oracleBp = 216) => ({
  asOf,
  batchId: `ice-${asOf.replaceAll('-', '')}-cloud`,
  revision: 1,
  sourceKind: 'ice_eod_isda',
  publishedAt: '2026-08-25T00:00:00.000Z',
  companies: COMPANY_ROWS.map(([company, spreadBp, eodPrice, instrumentName]) => ({
    company, spreadBp: company === 'Oracle' ? oracleBp : spreadBp, eodPrice, instrumentName, qualityStatus: 'model-derived',
  })),
});

const screenshotPrevious = {
  asOf: '2026-08-21', sourceKind: 'ice_eod_isda', sourceLabel: 'ICE EOD Price · ISDA 换算值',
  companies: [{
    company: 'Oracle', latestBp: 214, latestEodPrice: 95, latestInstrumentName: 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20', qualityStatus: 'model-derived', changes: {},
    history: [{ date: '2026-08-21', valueBp: 214, sourceKind: 'screenshot_backfill', qualityStatus: 'stale' }],
  }],
};

const health = {
  lastAlarmAt: '2026-08-25T00:30:00.000Z', lastSourceSuccessAt: '2026-08-25T00:30:00.000Z',
  lastPublishedDate: '2026-08-24', nextAlarmAt: '2026-08-25T01:00:00.000Z', consecutiveFailures: 0, stale: false, partialDates: [],
};

test('projects complete cloud batches into the existing cards while retaining screenshot history and absolute bp changes', () => {
  const cds5y = projectIceCdsCloud({ previous: screenshotPrevious, latest: batch(), history: { data: [batch()] }, health, checkedAt: '2026-08-25T00:35:00.000Z' });
  const oracle = cds5y.companies.find((company) => company.company === 'Oracle');

  assert.equal(cds5y.asOf, '2026-08-24');
  assert.equal(cds5y.batchId, 'ice-20260824-cloud');
  assert.equal(cds5y.companies.length, 7);
  assert.equal(oracle.latestBp, 216);
  assert.equal(oracle.changes.oneDayBp, 2);
  assert.deepEqual(oracle.history, [
    { date: '2026-08-21', valueBp: 214, qualityStatus: 'stale', sourceKind: 'screenshot_backfill' },
    { date: '2026-08-24', valueBp: 216, eodPrice: 95.01, instrumentName: 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20', qualityStatus: 'model-derived', sourceKind: 'ice_eod_isda' },
  ]);
  assert.deepEqual(cds5y.collection, {
    lastCollectedAt: '2026-08-25T00:30:00.000Z', lastPublishedDate: '2026-08-24', nextAlarmAt: '2026-08-25T01:00:00.000Z',
    partialDates: [], consecutiveFailures: 0, state: 'healthy',
  });
});

test('deduplicates a cloud point by date company and source kind without inventing values for incomplete batches', () => {
  const revised = batch('2026-08-24', 218);
  const cds5y = projectIceCdsCloud({ previous: screenshotPrevious, latest: revised, history: { data: [batch(), revised] }, health: { ...health, partialDates: [{ clearingDate: '2026-08-25', missingCompanies: ['Meta'] }] } });
  const oracle = cds5y.companies.find((company) => company.company === 'Oracle');

  assert.equal(oracle.history.filter((point) => point.date === '2026-08-24' && point.sourceKind === 'ice_eod_isda').length, 1);
  assert.equal(oracle.latestBp, 218);
  assert.equal(cds5y.collection.state, 'partial');
  assert.throws(() => projectIceCdsCloud({ previous: screenshotPrevious, latest: { ...batch(), companies: batch().companies.slice(0, 6) }, history: { data: [] }, health }), /complete seven-company batch/);
});
