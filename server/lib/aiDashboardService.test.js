import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createAiDashboardService,
  createAiDashboardServiceFromEnv,
  createIceCdsCloudCollector,
  createEmptyAiDashboardSnapshot,
  createOpenRouterClient,
  startAiDashboardAutoRefresh,
} from './aiDashboardService.js';
import { createIceCdsPipeline } from './iceCdsPipeline.js';
import { enqueueIceCdsSnapshotWrite } from './iceCdsSnapshotWriteQueue.js';
import { readIceCdsWorkbook } from './iceCdsWorkbook.js';

const ALL_PUBLIC_SLICES = [
  'growth',
  'openRouter',
  'pricing',
  'capital',
  'benchmarks',
  'artificialAnalysis',
  'compute',
  'creditRisk',
];

async function tempDashboard(t, prefix = 'ai-dashboard-') {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  return { dir, dataFile: path.join(dir, 'snapshot.json') };
}

function readySource(asOf, message = '公开来源同步成功') {
  return {
    status: 'ready',
    stale: false,
    asOf,
    url: 'https://example.test/source',
    message,
  };
}

test('empty dashboard snapshot uses the eight public-source schema-v2 slices', () => {
  const snapshot = createEmptyAiDashboardSnapshot('2026-08-23T00:00:00.000Z');

  assert.equal(snapshot.schemaVersion, 2);
  assert.equal('feishu' in snapshot.sources, false);
  assert.deepEqual(Object.keys(snapshot.sources).sort(), ALL_PUBLIC_SLICES.toSorted());
});

test('public-slice refresh replaces successful growth and preserves last-good pricing on failure', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-slices-');
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-19T00:00:00.000Z',
    sources: {
      feishu: { status: 'ready', stale: false, asOf: '2026-08-19' },
      pricing: { status: 'ready', stale: false, asOf: '2026-08-19' },
    },
    arrAndValuation: { companies: [], valuations: [] },
    modelPricing: { token: [{ vendor: 'OpenAI', model: 'last-good' }], video: [], codingPlans: [] },
  }), 'utf8');
  const collectors = {
    async growth() {
      return {
        payload: {
          arrAndValuation: {
            companies: [{ company: 'Anthropic', latestActual: { value: 650 } }],
            valuations: [],
          },
        },
        source: readySource('2026-08-22', '增长数据同步成功'),
      };
    },
    async pricing() {
      throw new Error('official pricing page unavailable');
    },
  };
  const service = createAiDashboardService({
    dataFile,
    collectors,
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['growth', 'pricing'], force: true });

  assert.equal('feishu' in snapshot.sources, false);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.sources.growth.status, 'ready');
  assert.equal(snapshot.arrAndValuation.companies[0].latestActual.value, 650);
  assert.equal(snapshot.sources.pricing.status, 'error');
  assert.equal(snapshot.sources.pricing.stale, true);
  assert.match(snapshot.sources.pricing.message, /official pricing page unavailable/);
  assert.equal(snapshot.modelPricing.token[0].model, 'last-good');
  assert.equal(JSON.parse(await fs.promises.readFile(dataFile, 'utf8')).schemaVersion, 2);
});

test('collector cannot overwrite fields outside its public slice', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-slice-boundary-');
  const service = createAiDashboardService({
    dataFile,
    collectors: {
      async growth() {
        return {
          payload: { modelPricing: { token: [{ model: 'injected' }], video: [], codingPlans: [] } },
          source: readySource('2026-08-22'),
        };
      },
    },
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['growth'], force: true });

  assert.equal(snapshot.sources.growth.status, 'error');
  assert.equal(snapshot.sources.growth.stale, true);
  assert.match(snapshot.sources.growth.message, /unsupported payload field/i);
  assert.deepEqual(snapshot.modelPricing.token, []);
});

test('missing collectors return an empty public-source snapshot instead of fabricated values', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-empty-');
  const service = createAiDashboardService({
    dataFile,
    now: () => new Date('2026-08-20T00:00:00.000Z'),
  });

  const snapshot = await service.getSnapshot();

  assert.equal('feishu' in snapshot.sources, false);
  assert.equal(snapshot.sources.growth.status, 'error');
  assert.equal(snapshot.sources.openRouter.status, 'authorization_required');
  assert.deepEqual(snapshot.arrAndValuation.companies, []);
  assert.deepEqual(snapshot.openRouter.topModels, []);
});

test('legacy screenshot CDS file cannot overlay the production snapshot', async (t) => {
  const { dir, dataFile } = await tempDashboard(t, 'ai-dashboard-cds-');
  const cdsFile = path.join(dir, 'cds-5y.json');
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-08-22T00:00:00.000Z',
    debtFinancing: [],
  }), 'utf8');
  await fs.promises.writeFile(cdsFile, JSON.stringify({
    asOf: '2026-08-19',
    sourceLabel: 'ICE ICC（用户截图）',
    historyEstimated: true,
    companies: [{
      company: 'Oracle',
      latestBp: 207,
      changes: { oneDayBp: 2, sevenDayBp: 14, oneMonthBp: 6 },
      history: [{ date: '2026-08-19', valueBp: 207 }],
    }],
  }), 'utf8');
  const service = createAiDashboardService({
    dataFile,
    cdsFile,
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  const snapshot = await service.getSnapshot();

  assert.equal(snapshot.creditRisk.cds5y.asOf, null);
  assert.deepEqual(snapshot.creditRisk.cds5y.companies, []);
  assert.match(snapshot.sources.creditRisk.message, /ICE EOD Price/);
});

test('legacy DTCC CDS embedded in an old snapshot is quarantined during migration', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-cds-legacy-snapshot-');
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-08-24T00:00:00.000Z',
    sources: {
      creditRisk: { status: 'ready', stale: false, asOf: '2026-08-24', message: 'DTCC sync ready' },
    },
    creditRisk: {
      cds5y: {
        sourceKind: 'dtcc_public_trade_estimate',
        asOf: '2026-08-24',
        sourceLabel: 'DTCC SEC PPD',
        historyEstimated: true,
        companies: [{ company: 'Oracle', latestBp: 221, changes: {}, history: [{ date: '2026-08-24', valueBp: 221 }] }],
      },
    },
  }), 'utf8');
  const service = createAiDashboardService({ dataFile, now: () => new Date('2026-08-25T00:00:00.000Z') });

  const snapshot = await service.getSnapshot();

  assert.equal(snapshot.creditRisk.cds5y.sourceKind, 'ice_eod_isda');
  assert.equal(snapshot.creditRisk.cds5y.asOf, null);
  assert.deepEqual(snapshot.creditRisk.cds5y.companies, []);
  assert.match(snapshot.sources.creditRisk.message, /等待导入 ICE EOD Price/);
});

test('explicit ICE collector failure preserves the last-good ICE batch and marks it stale', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-cds-public-failure-');
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-08-24T01:00:00.000Z',
    sources: {
      creditRisk: { status: 'ready', stale: false, asOf: '2026-08-24', url: 'https://www.ice.com/cds-settlement-prices/icc/single-name-instruments' },
    },
    creditRisk: {
      cds5y: {
        sourceKind: 'ice_eod_isda',
        asOf: '2026-08-24',
        sourceLabel: 'ICE EOD Price · ISDA 换算值',
        historyEstimated: true,
        companies: [{ company: 'Oracle', latestBp: 221, changes: { oneDayBp: 7, sevenDayBp: 11, oneMonthBp: 11 }, history: [{ date: '2026-08-24', valueBp: 221 }] }],
      },
    },
  }), 'utf8');
  const service = createAiDashboardService({
    dataFile,
    collectors: { async creditRisk() { throw new Error('ICE batch unavailable'); } },
    now: () => new Date('2026-08-25T01:00:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['creditRisk'], force: true });

  assert.equal(snapshot.sources.creditRisk.status, 'error');
  assert.equal(snapshot.sources.creditRisk.stale, true);
  assert.match(snapshot.sources.creditRisk.message, /ICE batch unavailable/);
  assert.equal(snapshot.creditRisk.cds5y.companies[0].latestBp, 221);
});

test('cloud CDS collector projects a complete durable batch and retains the preceding last-good history', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-cds-cloud-success-');
  const names = [
    ['Oracle', 216, 95.01, 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20'], ['CoreWeave', 800, 90.01, 'COREWEI.SNRFOR.USD.XR14.500.2031-06-20'],
    ['NVIDIA', 87, 100.55, 'NVIDIA.SNRFOR.USD.XR14.100.2031-06-20'], ['Amazon', 66, 101.46, 'AMZN.SNRFOR.USD.XR14.100.2031-06-20'],
    ['Google', 60, 101.74, 'ALPHINC.SNRFOR.USD.XR14.100.2031-06-20'], ['Microsoft', 49, 102.2, 'MSFT.SNRFOR.USD.XR14.100.2031-06-20'],
    ['Meta', 97, 100.12, 'METAPL.SNRFOR.USD.XR14.100.2031-06-20'],
  ];
  const batch = {
    asOf: '2026-08-24', batchId: 'ice-20260824-cloud', revision: 1, sourceKind: 'ice_eod_isda', publishedAt: '2026-08-25T00:00:00.000Z',
    companies: names.map(([company, spreadBp, eodPrice, instrumentName]) => ({ company, spreadBp, eodPrice, instrumentName, qualityStatus: 'model-derived' })),
  };
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 2, generatedAt: '2026-08-24T00:00:00.000Z',
    creditRisk: { cds5y: { sourceKind: 'ice_eod_isda', asOf: '2026-08-21', companies: [{
      company: 'Oracle', latestBp: 214, latestEodPrice: 95, latestInstrumentName: 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20', qualityStatus: 'model-derived', changes: {},
      history: [{ date: '2026-08-21', valueBp: 214, sourceKind: 'screenshot_backfill', qualityStatus: 'stale' }],
    }] } },
  }), 'utf8');
  const collector = createIceCdsCloudCollector({ cloudClient: {
    async latest() { return { data: batch }; },
    async history() { return { data: [{ ...batch, clearingDate: batch.asOf }], nextCursor: null }; },
    async health() { return { lastAlarmAt: null, lastSourceSuccessAt: '2026-08-25T00:30:00.000Z', lastPublishedDate: '2026-08-24', nextAlarmAt: '2026-08-25T01:00:00.000Z', consecutiveFailures: 0, stale: false, partialDates: [] }; },
  } });
  const service = createAiDashboardService({
    dataFile, collectors: { creditRisk: collector }, cloudCreditRiskEnabled: true,
    now: () => new Date('2026-08-25T00:35:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['creditRisk'], force: true });

  assert.equal(snapshot.sources.creditRisk.status, 'ready');
  assert.equal(snapshot.creditRisk.cds5y.companies.length, 7);
  assert.equal(snapshot.creditRisk.cds5y.companies.find((row) => row.company === 'Oracle').changes.oneDayBp, 2);
  assert.equal(snapshot.creditRisk.cds5y.collection.state, 'healthy');
});

test('cloud CDS source failure leaves the last-good batch intact and marks collection source-error', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-cds-cloud-failure-');
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 2, generatedAt: '2026-08-24T00:00:00.000Z',
    creditRisk: { cds5y: { sourceKind: 'ice_eod_isda', asOf: '2026-08-24', companies: [{
      company: 'Oracle', latestBp: 216, latestEodPrice: 95.01, latestInstrumentName: 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20', qualityStatus: 'model-derived', changes: {}, history: [],
    }] } },
  }), 'utf8');
  const service = createAiDashboardService({
    dataFile, collectors: { async creditRisk() { throw new Error('Cloud collector returned HTTP 503'); } }, cloudCreditRiskEnabled: true,
    now: () => new Date('2026-08-25T00:35:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['creditRisk'], force: true });

  assert.equal(snapshot.creditRisk.cds5y.companies[0].latestBp, 216);
  assert.equal(snapshot.sources.creditRisk.stale, true);
  assert.equal(snapshot.creditRisk.cds5y.collection.state, 'source-error');
});

test('cloud CDS collector rejects a repeated history cursor before it can loop indefinitely', async () => {
  const names = [
    ['Oracle', 216, 95.01, 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20'], ['CoreWeave', 800, 90.01, 'COREWEI.SNRFOR.USD.XR14.500.2031-06-20'],
    ['NVIDIA', 87, 100.55, 'NVIDIA.SNRFOR.USD.XR14.100.2031-06-20'], ['Amazon', 66, 101.46, 'AMZN.SNRFOR.USD.XR14.100.2031-06-20'],
    ['Google', 60, 101.74, 'ALPHINC.SNRFOR.USD.XR14.100.2031-06-20'], ['Microsoft', 49, 102.2, 'MSFT.SNRFOR.USD.XR14.100.2031-06-20'],
    ['Meta', 97, 100.12, 'METAPL.SNRFOR.USD.XR14.100.2031-06-20'],
  ];
  const batch = {
    asOf: '2026-08-24', batchId: 'ice-20260824-cloud', revision: 1, sourceKind: 'ice_eod_isda', publishedAt: '2026-08-25T00:00:00.000Z',
    companies: names.map(([company, spreadBp, eodPrice, instrumentName]) => ({ company, spreadBp, eodPrice, instrumentName, qualityStatus: 'model-derived' })),
  };
  let historyCalls = 0;
  const collector = createIceCdsCloudCollector({ cloudClient: {
    async latest() { return { data: batch }; },
    async health() { return { lastAlarmAt: null, lastSourceSuccessAt: null, lastPublishedDate: '2026-08-24', nextAlarmAt: null, consecutiveFailures: 0, stale: false, partialDates: [] }; },
    async history() {
      historyCalls += 1;
      if (historyCalls > 16) throw new Error('unbounded history pagination');
      return { data: [{ ...batch, clearingDate: batch.asOf }], nextCursor: `cursor-${historyCalls}` };
    },
  } });

  await assert.rejects(() => collector({ previous: {}, now: new Date('2026-08-25T00:00:00.000Z'), generatedAt: '2026-08-25T00:00:00.000Z' }), /history pagination/i);
  assert.equal(historyCalls, 16);
});

test('cloud CDS collector stops immediately when the Worker repeats a valid history cursor', async () => {
  const rows = [
    ['Oracle', 216, 95.01, 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20'], ['CoreWeave', 800, 90.01, 'COREWEI.SNRFOR.USD.XR14.500.2031-06-20'],
    ['NVIDIA', 87, 100.55, 'NVIDIA.SNRFOR.USD.XR14.100.2031-06-20'], ['Amazon', 66, 101.46, 'AMZN.SNRFOR.USD.XR14.100.2031-06-20'],
    ['Google', 60, 101.74, 'ALPHINC.SNRFOR.USD.XR14.100.2031-06-20'], ['Microsoft', 49, 102.2, 'MSFT.SNRFOR.USD.XR14.100.2031-06-20'], ['Meta', 97, 100.12, 'METAPL.SNRFOR.USD.XR14.100.2031-06-20'],
  ];
  const batch = {
    asOf: '2026-08-24', batchId: 'ice-20260824-cloud', revision: 1, sourceKind: 'ice_eod_isda', publishedAt: '2026-08-25T00:00:00.000Z',
    companies: rows.map(([company, spreadBp, eodPrice, instrumentName]) => ({ company, spreadBp, eodPrice, instrumentName, qualityStatus: 'model-derived' })),
  };
  let historyCalls = 0;
  const collector = createIceCdsCloudCollector({ cloudClient: {
    async latest() { return { data: batch }; },
    async health() { return { lastAlarmAt: null, lastSourceSuccessAt: null, lastPublishedDate: '2026-08-24', nextAlarmAt: null, consecutiveFailures: 0, stale: false, partialDates: [] }; },
    async history() { historyCalls += 1; return { data: [{ ...batch, clearingDate: batch.asOf }], nextCursor: '2026-08-24|1' }; },
  } });

  await assert.rejects(() => collector({ previous: {}, now: new Date('2026-08-25T00:00:00.000Z'), generatedAt: '2026-08-25T00:00:00.000Z' }), /repeated history cursor/i);
  assert.equal(historyCalls, 2);
});

test('shared writer queue preserves a newer cloud CDS batch and unrelated snapshot slices during a delayed local import', async (t) => {
  const { dir, dataFile } = await tempDashboard(t, 'ai-dashboard-cds-shared-writer-');
  const dataDir = path.join(dir, 'ice-cds');
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 2, generatedAt: '2026-08-24T00:00:00.000Z',
    arrAndValuation: { companies: [{ company: 'Anthropic', latestActual: { value: 650 } }], valuations: [] },
  }), 'utf8');
  const pipeline = createIceCdsPipeline({ dataDir, snapshotFile: dataFile, cloudAuthoritative: true, now: () => new Date('2026-08-25T00:00:00.000Z') });
  const localRows = [
    ['ORACLE CORP', 'ORCL', 100, 95.24], ['COREWEAVE INC', 'CRWV', 500, 88.125], ['NVIDIA CORP', 'NVDA', 100, 100.42],
    ['AMAZON.COM INC', 'AMZN', 100, 100.2], ['ALPHABET INC', 'GOOGL', 100, 100.25], ['MICROSOFT CORP', 'MSFT', 100, 100.3], ['META PLATFORMS INC', 'META', 100, 99.7],
  ];
  const iceText = ['Clearing Date\tName\tInstrument Name\tEOD Price', ...localRows.map(([name, symbol, couponBp, price]) => `2026-08-24\t${name}\t${symbol}.SNRFOR.USD.XR14.${couponBp}.2031-06-20\t${price}`)].join('\n');
  const curve = {
    curveId: 'usd-sofr-2026-08-24-test', asOf: '2026-08-24', currency: 'USD', sourceLabel: 'USD SOFR zero curve', sourceUrl: 'https://example.test/curve',
    nodes: [{ years: 0.25, zeroRate: 0.041 }, { years: 1, zeroRate: 0.039 }, { years: 3, zeroRate: 0.037 }, { years: 5, zeroRate: 0.036 }, { years: 10, zeroRate: 0.038 }],
  };
  const cloudRows = [
    ['Oracle', 216, 95.01, 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20'], ['CoreWeave', 800, 90.01, 'COREWEI.SNRFOR.USD.XR14.500.2031-06-20'],
    ['NVIDIA', 87, 100.55, 'NVIDIA.SNRFOR.USD.XR14.100.2031-06-20'], ['Amazon', 66, 101.46, 'AMZN.SNRFOR.USD.XR14.100.2031-06-20'],
    ['Google', 60, 101.74, 'ALPHINC.SNRFOR.USD.XR14.100.2031-06-20'], ['Microsoft', 49, 102.2, 'MSFT.SNRFOR.USD.XR14.100.2031-06-20'], ['Meta', 97, 100.12, 'METAPL.SNRFOR.USD.XR14.100.2031-06-20'],
  ];
  const cloudBatch = {
    asOf: '2026-08-25', batchId: 'cloud-20260825', revision: 1, sourceKind: 'ice_eod_isda', publishedAt: '2026-08-25T00:00:00.000Z',
    companies: cloudRows.map(([company, spreadBp, eodPrice, instrumentName]) => ({ company, spreadBp, eodPrice, instrumentName, qualityStatus: 'model-derived' })),
  };
  const service = createAiDashboardService({
    dataFile, cloudCreditRiskEnabled: true,
    collectors: { creditRisk: createIceCdsCloudCollector({ cloudClient: {
      async latest() { return { data: cloudBatch }; },
      async history() { return { data: [{ ...cloudBatch, clearingDate: cloudBatch.asOf }], nextCursor: null }; },
      async health() { return { lastAlarmAt: null, lastSourceSuccessAt: null, lastPublishedDate: '2026-08-25', nextAlarmAt: null, consecutiveFailures: 0, stale: false, partialDates: [] }; },
    } }) },
    now: () => new Date('2026-08-25T00:00:00.000Z'),
  });
  let release;
  const hold = enqueueIceCdsSnapshotWrite(() => new Promise((resolve) => { release = resolve; }));
  const localImport = pipeline.import({ iceText, discountCurve: curve });
  await new Promise((resolve) => setImmediate(resolve));
  const cloudRefresh = service.refresh({ sources: ['creditRisk'], force: true });
  release();
  await Promise.all([hold, localImport, cloudRefresh]);

  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.creditRisk.cds5y.batchId, 'cloud-20260825');
  assert.equal(snapshot.creditRisk.cds5y.asOf, '2026-08-25');
  assert.equal(snapshot.arrAndValuation.companies[0].company, 'Anthropic');

  const olderLocalImport = await pipeline.import({ iceText, discountCurve: curve });
  const afterOlderLocalImport = await service.getSnapshot();
  assert.equal(afterOlderLocalImport.creditRisk.cds5y.batchId, 'cloud-20260825');
  assert.equal(afterOlderLocalImport.creditRisk.cds5y.asOf, '2026-08-25');
  assert.equal(afterOlderLocalImport.arrAndValuation.companies[0].company, 'Anthropic');

  const localArchivePath = path.join(dataDir, 'ice-cds-history.json');
  const backupDir = path.join(dataDir, 'backups');
  const currentWorkbook = await readIceCdsWorkbook(await fs.promises.readFile(path.join(dataDir, 'ice-cds-history.xlsx')));
  const currentLocalArchive = JSON.parse(await fs.promises.readFile(localArchivePath, 'utf8'));
  const archivedWorkbook = await readIceCdsWorkbook(await fs.promises.readFile(path.join(backupDir, `${olderLocalImport.batchId}.xlsx`)));
  const archivedLocalArchive = JSON.parse(await fs.promises.readFile(path.join(backupDir, `${olderLocalImport.batchId}.json`), 'utf8'));
  for (const localArchive of [currentLocalArchive, archivedLocalArchive]) {
    assert.equal(localArchive.creditRisk.cds5y.batchId, olderLocalImport.batchId);
    assert.equal(localArchive.creditRisk.cds5y.asOf, '2026-08-24');
    assert.equal(localArchive.creditRisk.cds5y.sourceKind, 'ice_eod_isda');
    assert.equal(localArchive.creditRisk.cds5y.sourceUrl, 'https://www.ice.com/cds-settlement-prices/icc/single-name-instruments');
  }
  assert.equal(currentWorkbook.batchId, olderLocalImport.batchId);
  assert.equal(archivedWorkbook.batchId, olderLocalImport.batchId);

  const sameDateLocalImport = await pipeline.import({ iceText: iceText.replaceAll('2026-08-24', '2026-08-25'), discountCurve: curve });
  const afterSameDateLocalImport = await service.getSnapshot();
  assert.equal(afterSameDateLocalImport.creditRisk.cds5y.batchId, 'cloud-20260825');
  assert.equal(afterSameDateLocalImport.creditRisk.cds5y.asOf, '2026-08-25');
  assert.equal(afterSameDateLocalImport.arrAndValuation.companies[0].company, 'Anthropic');
  const sameDateArchive = JSON.parse(await fs.promises.readFile(path.join(backupDir, `${sameDateLocalImport.batchId}.json`), 'utf8'));
  assert.equal(sameDateArchive.creditRisk.cds5y.batchId, sameDateLocalImport.batchId);
  assert.equal(sameDateArchive.creditRisk.cds5y.asOf, '2026-08-25');
});

test('environment service ignores legacy Feishu exports and accepts public collectors', async (t) => {
  const { dir, dataFile } = await tempDashboard(t, 'ai-dashboard-no-feishu-');
  const feishuExportFile = path.join(dir, 'feishu-export.json');
  await fs.promises.writeFile(feishuExportFile, JSON.stringify({
    workbook: { 'ARR&估值': [[null, 'Yipit'], [null, 'Anthropic'], [46215, 730]] },
  }), 'utf8');
  const service = createAiDashboardServiceFromEnv({
    dataFile,
    feishuExportFile,
    collectors: {
      async growth() {
        return {
          payload: { arrAndValuation: { companies: [{ company: 'OpenAI' }], valuations: [] } },
          source: readySource('2026-08-22'),
        };
      },
    },
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['growth'], force: true });

  assert.equal('feishu' in snapshot.sources, false);
  assert.equal(snapshot.arrAndValuation.companies[0].company, 'OpenAI');
});

test('environment service wires the registered official pricing collector by default', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-official-pricing-');
  const html = await fs.promises.readFile(new URL('./fixtures/ai-pricing/openai-pricing.html', import.meta.url), 'utf8');
  const service = createAiDashboardServiceFromEnv({
    dataFile,
    pricingSourceIds: ['openai-pricing'],
    fetchImpl: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    now: () => new Date('2026-08-23T01:02:03.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['pricing'], force: true });

  assert.equal(snapshot.sources.pricing.status, 'ready');
  assert.equal(snapshot.modelPricing.token.some((row) => row.model === 'GPT 5.6 Sol'), true);
  assert.equal(snapshot.modelPricing.token.some((row) => row.model === 'GPT 5.5'), false);
  assert.equal(snapshot.modelPricing.tokenHistory.some((row) => row.model === 'GPT 5.5'), true);
});

test('environment service wires official capital and exact-SKU compute collectors by default', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-capital-compute-');
  const capitalHtml = await fs.promises.readFile(new URL('./fixtures/ai-capital/openai-round.html', import.meta.url), 'utf8');
  const computeHtml = await fs.promises.readFile(new URL('./fixtures/ai-compute/aws-pricing.html', import.meta.url), 'utf8');
  const service = createAiDashboardServiceFromEnv({
    dataFile,
    capitalSourceIds: ['openai-capital'],
    computeSourceIds: ['aws-ec2-pricing'],
    fetchImpl: async (url) => new Response(String(url).includes('openai.com') ? capitalHtml : computeHtml, { headers: { 'content-type': 'text/html' } }),
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['capital', 'compute'], force: true });

  assert.equal(snapshot.capitalEvents[0].entity, 'OpenAI');
  assert.equal(snapshot.capitalMetrics.industry.trailing12MonthCount, 1);
  assert.equal(snapshot.computeRental.length, 2);
  assert.equal(snapshot.computeRental[0].quoteKey.includes('on_demand') || snapshot.computeRental[1].quoteKey.includes('on_demand'), true);
});

test('environment service keeps Artificial Analysis in its independent named-third-party slice', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-aa-');
  const html = await fs.promises.readFile(new URL('./fixtures/artificial-analysis/index.html', import.meta.url), 'utf8');
  const service = createAiDashboardServiceFromEnv({
    dataFile,
    fetchImpl: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['artificialAnalysis'], force: true });

  assert.equal(snapshot.sources.artificialAnalysis.status, 'ready');
  assert.equal(snapshot.artificialAnalysis.intelligenceIndex[0].sourceKind, 'named-third-party');
  assert.equal(snapshot.artificialAnalysis.taskCosts[0].totalCost, 0.26);
  assert.deepEqual(snapshot.benchmarks.metrics, []);
  assert.deepEqual(snapshot.benchmarks.winners, {});
});

test('public OpenRouter export seeds the visible weekly Top 10 without fabricating a platform total', async (t) => {
  const { dir, dataFile } = await tempDashboard(t, 'ai-dashboard-openrouter-public-');
  const openRouterPublicFile = path.join(dir, 'openrouter-public.json');
  await fs.promises.writeFile(openRouterPublicFile, JSON.stringify({
    asOf: '2026-08-22',
    startDate: '2026-08-16',
    endDate: '2026-08-22',
    topModels: [
      { rank: 1, model: 'DeepSeek V4 Flash 0731', totalTokens: '11600000000000', approximate: true },
    ],
  }), 'utf8');

  const service = createAiDashboardServiceFromEnv({
    dataFile,
    openRouterPublicFile,
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });
  const snapshot = await service.refresh({ sources: ['openRouter'] });

  assert.equal(snapshot.sources.openRouter.status, 'ready');
  assert.equal(snapshot.sources.openRouter.stale, true);
  assert.match(snapshot.sources.openRouter.message, /Data API/);
  assert.equal(snapshot.openRouter.weekTotalTokens, null);
  assert.equal(snapshot.openRouter.topModels[0].model, 'DeepSeek V4 Flash 0731');
  assert.deepEqual(snapshot.openRouter.history, []);
});

test('OpenRouter client exposes only rankings and sends the configured server-side API key', async () => {
  const calls = [];
  const client = createOpenRouterClient({
    apiKey: 'openrouter-key',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({
        data: [{ date: '2026-08-19', model_permaslug: 'vendor/model', total_tokens: '42' }],
        meta: { as_of: '2026-08-20T01:00:00.000Z', start_date: '2026-05-28', end_date: '2026-08-19' },
      });
    },
  });

  const payload = await client.fetchRankings({ startDate: '2026-05-28', endDate: '2026-08-19' });

  assert.equal(payload.meta.as_of, '2026-08-20T01:00:00.000Z');
  assert.match(calls[0].url, /start_date=2026-05-28/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer openrouter-key');
  assert.deepEqual(Object.keys(client), ['fetchRankings']);
});

test('OpenRouter rankings client reports source-specific HTTP and timeout failures', async () => {
  const failedClient = createOpenRouterClient({
    apiKey: 'key',
    fetchImpl: async () => new Response('', { status: 401 }),
  });
  await assert.rejects(
    failedClient.fetchRankings({ startDate: '2026-08-01', endDate: '2026-08-07' }),
    /OpenRouter Data API failed with HTTP 401/,
  );

  const timeoutClient = createOpenRouterClient({
    apiKey: 'key',
    timeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    }),
  });
  await assert.rejects(
    timeoutClient.fetchRankings({ startDate: '2026-08-01', endDate: '2026-08-07' }),
    /timed out/,
  );
});

test('official Benchmark collector refresh is fresh for 15 minutes and force bypasses freshness', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-benchmark-fresh-');
  let calls = 0;
  const service = createAiDashboardService({
    dataFile,
    collectors: {
      async benchmarks() {
        calls += 1;
        return {
          payload: {
            benchmarks: {
              models: [{ vendor: 'OpenAI', model: 'GPT Latest', releasedAt: '2026-08-22', scores: {} }],
              metrics: [], winners: {}, asOf: '2026-08-22', sourceMode: 'official-model-cards',
              coverage: { vendors: 1, evaluatedVendors: 0, metrics: 0 }, attributions: [],
            },
          },
          source: readySource('2026-08-22'),
        };
      },
    },
    now: () => new Date('2026-08-24T00:05:00.000Z'),
  });

  const first = await service.refresh({ sources: ['benchmarks'], force: true });
  assert.equal(first.sources.benchmarks.syncedAt, '2026-08-24T00:05:00.000Z');
  assert.equal(first.benchmarks.sourceMode, 'official-model-cards');
  await service.refresh({ sources: ['benchmarks'] });
  assert.equal(calls, 1);
  await service.refresh({ sources: ['benchmarks'], force: true });
  assert.equal(calls, 2);
});

test('official Benchmark client publishes only first-party model-card records', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-official-benchmark-');
  let rankingCalls = 0;
  const service = createAiDashboardService({
    dataFile,
    openRouterClient: { async fetchRankings() { rankingCalls += 1; throw new Error('rankings must not be called'); } },
    officialBenchmarkClient: {
      async readAll() {
        return [{
          vendor: 'OpenAI', model: 'GPT-5.6 Sol', releasedAt: '2026-07-09', status: 'ready', stale: false,
          sourceUrl: 'https://deploymentsafety.openai.com/gpt-5-6', discoveryMode: 'html-index',
          retrievedAt: '2026-08-23T00:00:00.000Z',
          scores: [{
            testName: 'Terminal-Bench', testVersion: '2.1', scoreName: 'Accuracy', value: 88.8,
            unit: 'percent-point', direction: 'higher', harness: 'Codex', effort: 'xhigh', configurationComplete: true,
          }],
        }];
      },
    },
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  const snapshot = await service.refresh({ sources: ['benchmarks'], force: true });

  assert.equal(rankingCalls, 0);
  assert.equal(snapshot.sources.benchmarks.status, 'ready');
  assert.equal(snapshot.benchmarks.sourceMode, 'official-model-cards');
  assert.equal(snapshot.benchmarks.models[0].model, 'GPT-5.6 Sol');
  assert.equal(snapshot.benchmarks.attributions.every((row) => row.source === 'official-model-card'), true);
  assert.deepEqual(Object.values(snapshot.benchmarks.winners)[0], { models: ['GPT-5.6 Sol'], value: 88.8 });
});

test('a failed official vendor retains only that vendor last-good card and becomes stale', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-benchmark-last-good-');
  let round = 0;
  const terminal = (value) => ({
    testName: 'Terminal-Bench', testVersion: '2.1', scoreName: 'Accuracy', value,
    unit: 'percent-point', direction: 'higher', harness: 'official', effort: 'xhigh', configurationComplete: true,
  });
  const service = createAiDashboardService({
    dataFile,
    officialBenchmarkClient: {
      async readAll() {
        round += 1;
        return round === 1 ? [
          { vendor: 'OpenAI', model: 'GPT-5.6 Sol', status: 'ready', stale: false, sourceUrl: 'https://openai.com/card', scores: [terminal(88)] },
          { vendor: 'Gemini', model: 'Gemini 3.7 Flash', status: 'ready', stale: false, sourceUrl: 'https://deepmind.google/card', scores: [terminal(80)] },
        ] : [
          { vendor: 'OpenAI', model: 'GPT-5.6 Sol', status: 'error', stale: true, sourceUrl: 'https://openai.com/card', scores: [], error: 'temporary failure' },
          { vendor: 'Gemini', model: 'Gemini 3.7 Flash', status: 'ready', stale: false, sourceUrl: 'https://deepmind.google/card', scores: [terminal(89)] },
        ];
      },
    },
    now: () => new Date('2026-08-23T00:00:00.000Z'),
  });

  await service.refresh({ sources: ['benchmarks'], force: true });
  const snapshot = await service.refresh({ sources: ['benchmarks'], force: true });
  const openai = snapshot.benchmarks.models.find((model) => model.vendor === 'OpenAI');
  const gemini = snapshot.benchmarks.models.find((model) => model.vendor === 'Gemini');

  assert.equal(openai.status, 'error');
  assert.equal(openai.stale, true);
  assert.equal(Object.values(openai.scores)[0].value, 88);
  assert.equal(Object.values(gemini.scores)[0].value, 89);
  assert.deepEqual(Object.values(snapshot.benchmarks.winners)[0], { models: ['Gemini 3.7 Flash'], value: 89 });
  assert.equal(snapshot.sources.benchmarks.stale, true);
});

test('overlapping forced Benchmark refreshes share a single official collector request', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-benchmark-dedupe-');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const service = createAiDashboardService({
    dataFile,
    collectors: {
      async benchmarks() {
        calls += 1;
        await gate;
        return {
          payload: { benchmarks: { ...createEmptyAiDashboardSnapshot().benchmarks, sourceMode: 'official-model-cards' } },
          source: readySource('2026-08-22'),
        };
      },
    },
    now: () => new Date('2026-08-23T00:05:00.000Z'),
  });

  const first = service.refresh({ sources: ['benchmarks'], force: true });
  const second = service.refresh({ sources: ['benchmarks'], force: true });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(firstSnapshot.generatedAt, secondSnapshot.generatedAt);
});

test('overlapping public-slice refreshes are serialized without dropping OpenRouter traffic', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-refresh-queue-');
  let releaseGrowth;
  const growthGate = new Promise((resolve) => { releaseGrowth = resolve; });
  let openRouterCalls = 0;
  const service = createAiDashboardService({
    dataFile,
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    collectors: {
      async growth() {
        await growthGate;
        return {
          payload: { arrAndValuation: { companies: [{ company: 'Anthropic' }], valuations: [] } },
          source: readySource('2026-08-19'),
        };
      },
    },
    openRouterClient: {
      async fetchRankings() {
        openRouterCalls += 1;
        return {
          data: Array.from({ length: 14 }, (_, index) => ({
            date: `2026-08-${String(6 + index).padStart(2, '0')}`,
            model_permaslug: 'vendor/model',
            total_tokens: '6',
          })),
          meta: { as_of: '2026-08-20T01:00:00.000Z', end_date: '2026-08-19' },
        };
      },
    },
  });

  const growthRefresh = service.refresh({ sources: ['growth'] });
  await new Promise((resolve) => setImmediate(resolve));
  const openRouterRefresh = service.refresh({ sources: ['openRouter'] });
  releaseGrowth();
  await growthRefresh;
  const snapshot = await openRouterRefresh;

  assert.equal(openRouterCalls, 1);
  assert.equal(snapshot.sources.growth.status, 'ready');
  assert.equal(snapshot.sources.openRouter.status, 'ready');
  assert.equal(snapshot.openRouter.weekTotalTokens, '42');
  assert.equal(snapshot.openRouter.weekOverWeekAbsolute, '0');
});

test('incomplete OpenRouter responses preserve the last-good week', async (t) => {
  const { dataFile } = await tempDashboard(t, 'ai-dashboard-openrouter-sparse-');
  await fs.promises.writeFile(dataFile, JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-08-19T00:00:00.000Z',
    sources: { openRouter: { status: 'ready', stale: false, asOf: '2026-08-19T01:00:00.000Z' } },
    openRouter: { weekTotalTokens: '123', topModels: [], history: [] },
  }), 'utf8');
  const service = createAiDashboardService({
    dataFile,
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    openRouterClient: {
      async fetchRankings() {
        return {
          data: [{ date: '2026-08-19', model_permaslug: 'vendor/model', total_tokens: '42' }],
          meta: { as_of: '2026-08-20T01:00:00.000Z', end_date: '2026-08-19' },
        };
      },
    },
  });

  const snapshot = await service.refresh({ sources: ['openRouter'] });

  assert.equal(snapshot.sources.openRouter.status, 'error');
  assert.equal(snapshot.sources.openRouter.stale, true);
  assert.equal(snapshot.openRouter.weekTotalTokens, '123');
});

test('auto refresh excludes import-driven ICE CDS and clears every timer', async () => {
  const timeouts = [];
  const intervals = [];
  const clearedTimeouts = [];
  const clearedIntervals = [];
  const calls = [];
  const service = {
    async refresh(options) { calls.push(options); return {}; },
  };
  const stop = startAiDashboardAutoRefresh(service, {
    setTimeoutImpl(callback, ms) {
      const id = { type: 'timeout', index: timeouts.length };
      timeouts.push({ callback, ms, id });
      return id;
    },
    setIntervalImpl(callback, ms) {
      const id = { type: 'interval', index: intervals.length };
      intervals.push({ callback, ms, id });
      return id;
    },
    clearTimeoutImpl(id) { clearedTimeouts.push(id); },
    clearIntervalImpl(id) { clearedIntervals.push(id); },
  });

  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].ms, 5_000);
  assert.deepEqual(intervals.map((timer) => timer.ms), [86_400_000, 86_400_000, 86_400_000]);
  await timeouts[0].callback();
  for (const timer of intervals) await timer.callback();
  assert.deepEqual(calls, [
    { sources: ALL_PUBLIC_SLICES.filter((source) => source !== 'creditRisk') },
    { sources: ['growth', 'pricing', 'capital', 'artificialAnalysis', 'compute'] },
    { sources: ['openRouter'] },
    { sources: ['benchmarks'] },
  ]);

  stop();
  assert.deepEqual(clearedTimeouts, [timeouts[0].id]);
  assert.deepEqual(clearedIntervals, intervals.map((timer) => timer.id));
});

test('auto refresh includes durable cloud CDS only when the opt-in feature flag is enabled', async () => {
  const timeouts = [];
  const intervals = [];
  const cleared = [];
  const calls = [];
  const service = {
    cloudCreditRiskEnabled: true,
    async refresh(options) { calls.push(options); return {}; },
  };
  const stop = startAiDashboardAutoRefresh(service, {
    setTimeoutImpl(callback) { timeouts.push(callback); return 'initial'; },
    setIntervalImpl(callback, ms) { const id = { callback, ms }; intervals.push(id); return id; },
    clearTimeoutImpl() {},
    clearIntervalImpl(id) { cleared.push(id); },
  });

  await timeouts[0]();
  assert.equal(calls[0].sources.includes('creditRisk'), true);
  assert.equal(intervals.length, 4);
  await intervals.at(-1).callback();
  assert.deepEqual(calls.at(-1), { sources: ['creditRisk'] });
  stop();
  assert.equal(cleared.includes(intervals.at(-1)), true);
});
