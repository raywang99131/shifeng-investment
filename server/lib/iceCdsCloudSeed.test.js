import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildIceCdsCloudSeed, importIceCdsCloudSeed, prepareIceCdsCloudSeedUploads } from './iceCdsCloudSeed.js';
import { applyScreenshotBackfill } from './iceCdsScreenshotBackfill.js';
import { buildIceCdsWorkbook } from './iceCdsWorkbook.js';
import { ICE_CDS_CONTRACT_REGISTRY } from './iceCdsRegistry.js';

test('builds a deterministic, source-separated cloud seed from the workbook', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-seed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'ice-cds');
  await fs.mkdir(dataDir, { recursive: true });
  const base = applyScreenshotBackfill({
    schemaVersion: 1, batchId: 'ice-20260824-test', generatedAt: '2026-08-25T00:00:00.000Z', rawRows: [], curves: [{
      curveId: 'ust-par-zero-proxy-2026-08-24', asOf: '2026-08-24', currency: 'USD',
      sourceLabel: 'U.S. Treasury par yields · continuous-zero proxy', sourceUrl: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates',
      nodes: [{ years: 1, zeroRate: 0.04 }, { years: 5, zeroRate: 0.04 }],
    }], registry: ICE_CDS_CONTRACT_REGISTRY, validationLog: [], methodology: {},
  });
  const liveRows = ICE_CDS_CONTRACT_REGISTRY.map((definition, index) => ({
    batchId: 'ice-20260824-test', clearingDate: '2026-08-24', company: definition.company,
    instrumentName: `${definition.symbols[0]}.SNRFOR.USD.XR14.${definition.couponBp}.2031-06-20`, eodPrice: 95 + index,
    couponBp: definition.couponBp, spreadBp: 100 + index, maturityDate: '2031-06-20', roundTripPrice: 95 + index,
    priceResidual: 0, hazardRate: 0.01, curveId: 'ust-par-zero-proxy-2026-08-24', recoveryRate: 0.4,
    modelVersion: 'ice-isda-compatible-v1', qualityStatus: 'model-derived', officialSpreadBp: null, relativeError: null,
    sourceUrl: 'https://www.ice.com/cds-settlement-prices/icc/single-name-instruments',
  }));
  const state = { ...base, batchId: 'ice-20260824-test', generatedAt: '2026-08-25T00:00:00.000Z', derivedRows: [...base.derivedRows, ...liveRows], rawRows: liveRows.map((row) => ({
    batchId: row.batchId, clearingDate: row.clearingDate, company: row.company, name: definitionName(row.company), instrumentName: row.instrumentName,
    eodPrice: row.eodPrice, sourceUrl: row.sourceUrl, importedAt: '2026-08-25T00:00:00.000Z',
  })) };
  const workbook = path.join(dataDir, 'ice-cds-history.xlsx');
  await fs.writeFile(workbook, await buildIceCdsWorkbook(state));

  const first = await buildIceCdsCloudSeed({ workbookFile: workbook, generatedAt: '2026-08-25T00:00:00.000Z' });
  const second = await buildIceCdsCloudSeed({ workbookFile: workbook, generatedAt: '2026-08-25T00:00:00.000Z' });
  assert.deepEqual(second, first);
  assert.equal(first.screenshotHistory.length > 0, true);
  assert.equal(first.screenshotHistory.every((row) => row.sourceKind === 'screenshot_backfill'), true);
  assert.equal(first.iceObservations.length, 7);
  assert.equal(first.derivedSpreads.length, 7);
  assert.equal(first.publishedBatches[0].sourceKind, 'ice_eod_isda');
  assert.equal(first.screenshotHistory.some((row) => row.observationDate === '2026-08-24'), false);
});

test('chunks only independent screenshot history and retries a failed idempotent upload without logging credentials', async () => {
  const seed = {
    schemaVersion: 1, generatedAt: '2026-08-25T00:00:00.000Z',
    screenshotHistory: Array.from({ length: 501 }, (_, index) => ({ observationDate: `2026-08-${String((index % 25) + 1).padStart(2, '0')}`, company: 'Oracle', valueBp: 100 + index, sourceKind: 'screenshot_backfill', sourceLabel: 'Screenshot', note: 'seed', importedAt: '2026-08-25T00:00:00.000Z' })),
    iceObservations: [], treasuryCurves: [], derivedSpreads: [], publishedBatches: [],
  };
  const uploads = prepareIceCdsCloudSeedUploads(seed);
  assert.deepEqual(uploads.map((upload) => upload.screenshotHistory.length), [200, 200, 101]);
  let attempts = 0;
  const results = await importIceCdsCloudSeed({ seed, baseUrl: 'https://collector.example.test/', writeToken: 'do-not-log', maxAttempts: 2, fetchImpl: async (url, options) => {
    attempts += 1;
    assert.equal(url, 'https://collector.example.test/internal/v1/cds/seed');
    assert.equal(options.headers.authorization, 'Bearer do-not-log');
    if (attempts === 1) throw new Error('temporary failure');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } });
  assert.equal(attempts, 4);
  assert.equal(results.length, 3);
});

function definitionName(company) {
  return ({ Oracle: 'Oracle Cop', CoreWeave: 'CoreWeave Inc', NVIDIA: 'NVIDIA Corp', Amazon: 'Amazon.com Inc', Google: 'Alphabet Inc', Microsoft: 'Microsoft Corp', Meta: 'Meta Platforms Inc' })[company];
}
