import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createIceCdsCloudExport } from './iceCdsCloudExport.js';
import { readIceCdsWorkbook } from './iceCdsWorkbook.js';

const companies = [
  ['Oracle', 'ORACLE INC', 'ORCL.SNRFOR.USD.XR14.100.2031-06-20', 100, 95.01, 216],
  ['CoreWeave', 'COREWEAVE INC', 'CRWV.SNRFOR.USD.XR14.500.2031-06-20', 500, 90.01, 800],
  ['NVIDIA', 'NVIDIA CORP', 'NVDA.SNRFOR.USD.XR14.100.2031-06-20', 100, 100.55, 87],
  ['Amazon', 'AMAZON.COM INC', 'AMZN.SNRFOR.USD.XR14.100.2031-06-20', 100, 101.46, 66],
  ['Google', 'ALPHABET INC', 'GOOGL.SNRFOR.USD.XR14.100.2031-06-20', 100, 101.74, 60],
  ['Microsoft', 'MICROSOFT CORP', 'MSFT.SNRFOR.USD.XR14.100.2031-06-20', 100, 102.2, 49],
  ['Meta', 'META PLATFORMS INC', 'META.SNRFOR.USD.XR14.100.2031-06-20', 100, 100.12, 97],
];
const sourceUrl = 'https://www.ice.com/cds-settlement-prices/icc/single-name-instruments';

function exportPages() {
  const records = [];
  for (const [index, [company, iceName, instrumentName, couponBp, eodPrice, spreadBp]] of companies.entries()) {
    const revisionId = index + 1;
    records.push({ section: 'ice_eod_revisions', record: { revisionId, clearingDate: '2026-08-24', company, iceName, instrumentName, eodPrice, couponBp, payloadHash: `${String(index + 1).padStart(2, '0')}`.repeat(32), retrievedAt: '2026-08-25T00:30:00.000Z', sourceUrl } });
    records.push({ section: 'ice_eod_current', record: { clearingDate: '2026-08-24', company, revisionId } });
    records.push({ section: 'cds_spread_revisions', record: { spreadRevisionId: revisionId, clearingDate: '2026-08-24', company, iceRevisionId: revisionId, curveId: 'ust-2026-08-24', instrumentName, maturityDate: '2031-06-20', eodPrice, couponBp, spreadBp, roundTripPrice: eodPrice, priceResidual: 0.00001, hazardRate: spreadBp / 6000, recoveryRate: 0.4, modelVersion: 'ice-isda-compatible-v1', qualityStatus: 'model-derived', createdAt: '2026-08-25T00:31:00.000Z' } });
  }
  records.push({ section: 'treasury_curves', record: { curveId: 'ust-2026-08-24', asOf: '2026-08-24', currency: 'USD', sourceLabel: 'U.S. Treasury par yields · continuous-zero proxy', sourceUrl: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates', retrievedAt: '2026-08-25T00:30:00.000Z', payloadHash: 'aa'.repeat(32), nodes: [{ years: 1, zeroRate: 0.04 }, { years: 5, zeroRate: 0.035 }] } });
  records.push({ section: 'published_batches', record: { batchId: 'ice-20260824-cloud', clearingDate: '2026-08-24', revision: 1, publishedAt: '2026-08-25T00:32:00.000Z', sourceKind: 'ice_eod_isda', qualityStatus: 'model-derived', rows: companies.map(([company], index) => ({ company, spreadRevisionId: index + 1 })) } });
  records.push({ section: 'published_batch_current', record: { clearingDate: '2026-08-24', batchId: 'ice-20260824-cloud' } });
  records.push({ section: 'seed_history', record: { observationDate: '2026-08-21', company: 'Oracle', valueBp: 214, sourceKind: 'screenshot_backfill', sourceLabel: 'User screenshot curve backfill (approximate)', note: 'Digitized chart', importedAt: '2026-08-25T00:00:00.000Z' } });
  return [
    { data: records.slice(0, 9), nextCursor: 'page-2' },
    { data: records.slice(9), nextCursor: null },
  ];
}

test('pages one frozen cloud export into the seven-sheet workbook with current D1 values and provenance', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const calls = [];
  const pages = exportPages();
  const cloudExport = createIceCdsCloudExport({
    dataDir,
    now: () => new Date('2026-08-25T01:00:00.000Z'),
    cloudClient: { async exportSource(query) { calls.push(query || {}); return pages[calls.length - 1]; } },
  });

  const result = await cloudExport.exportWorkbook();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.buffer);

  assert.equal(result.dataState, 'cloud-current');
  assert.deepEqual(calls, [{ limit: 500 }, { limit: 500, cursor: 'page-2' }]);
  assert.equal(workbook.worksheets.length, 7);
  const raw = workbook.getWorksheet('Raw EOD Prices');
  const derived = workbook.getWorksheet('Derived 5Y Spreads');
  assert.equal(raw.rowCount - 1, 7);
  assert.equal(derived.rowCount - 1, 8);
  assert.equal(raw.getCell('F2').value, 95.01);
  assert.equal(Array.from({ length: derived.rowCount - 1 }, (_, index) => derived.getRow(index + 2)).find((row) => row.getCell(2).value instanceof Date && row.getCell(2).value.toISOString().slice(0, 10) === '2026-08-24')?.getCell(7).value, 216);
  const methodology = workbook.getWorksheet('Methodology');
  const metadata = new Map(Array.from({ length: methodology.rowCount - 1 }, (_, index) => {
    const row = methodology.getRow(index + 2);
    return [row.getCell(1).value, row.getCell(2).value];
  }));
  assert.equal(metadata.get('sourceDefinition'), '截图历史回填 + ICE EOD Price · 模型换算');
  assert.equal(metadata.get('cloudDataState'), 'cloud-current');
  assert.equal(metadata.get('cloudExportedAt'), '2026-08-25T01:00:00.000Z');
  assert.equal(metadata.get('screenshotBackfillSource'), 'User screenshot curve backfill (approximate)');
  assert.equal(await fs.readFile(path.join(dataDir, 'ice-cds-history.last-good.xlsx')).then((value) => value.length > 0), true);
});

test('serves the atomically retained last-good workbook when cloud export fails', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-stale-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const first = createIceCdsCloudExport({ dataDir, now: () => new Date('2026-08-25T01:00:00.000Z'), cloudClient: { async exportSource(query) { return exportPages()[query?.cursor ? 1 : 0]; } } });
  const saved = await first.exportWorkbook();
  const fallback = createIceCdsCloudExport({ dataDir, cloudClient: { async exportSource() { throw new Error('collector unavailable'); } } });

  const result = await fallback.exportWorkbook();
  assert.equal(result.dataState, 'stale-last-good');
  assert.deepEqual(result.buffer, saved.buffer);
});

test('replaces a corrupt last-good workbook after a healthy cloud export', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-corrupt-recovery-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'ice-cds-history.last-good.xlsx'), 'corrupt');
  const cloudExport = createIceCdsCloudExport({ dataDir, cloudClient: { async exportSource(query) { return exportPages()[query?.cursor ? 1 : 0]; } } });
  const result = await cloudExport.exportWorkbook();
  assert.equal(result.dataState, 'cloud-current');
  assert.equal((await readIceCdsWorkbook(await fs.readFile(path.join(dataDir, 'ice-cds-history.last-good.xlsx')))).batchId, 'ice-20260824-cloud');
});

test('does not send corrupt last-good bytes when both cloud export and fallback validation fail', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-corrupt-fallback-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, 'ice-cds-history.last-good.xlsx'), 'corrupt');
  const cloudExport = createIceCdsCloudExport({ dataDir, cloudClient: { async exportSource() { throw new Error('collector unavailable'); } } });
  await assert.rejects(() => cloudExport.exportWorkbook(), (error) => error?.code === 'workbook-unavailable');
});

test('exports the published batch when a newer raw correction has not yet been republished', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-unpublished-correction-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const [first, second] = exportPages();
  const correction = { ...first.data[0].record, revisionId: 99, eodPrice: 94.5, payloadHash: 'ff'.repeat(32), retrievedAt: '2026-08-25T01:00:00.000Z' };
  first.data.push({ section: 'ice_eod_revisions', record: correction }, { section: 'ice_eod_current', record: { clearingDate: '2026-08-24', company: 'Oracle', revisionId: 99 } });
  const cloudExport = createIceCdsCloudExport({ dataDir, cloudClient: { async exportSource(query) { return query?.cursor ? second : first; } } });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await cloudExport.exportWorkbook()).buffer);
  assert.equal(workbook.getWorksheet('Raw EOD Prices').getCell('F2').value, 95.01);
  const derived = workbook.getWorksheet('Derived 5Y Spreads');
  assert.equal(Array.from({ length: derived.rowCount - 1 }, (_, index) => derived.getRow(index + 2)).find((row) => row.getCell(2).value instanceof Date && row.getCell(2).value.toISOString().slice(0, 10) === '2026-08-24')?.getCell(7).value, 216);
});

test('projects screenshot backfill into derived and daily history with its own source label', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-screenshot-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const cloudExport = createIceCdsCloudExport({ dataDir, cloudClient: { async exportSource(query) { return exportPages()[query?.cursor ? 1 : 0]; } } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load((await cloudExport.exportWorkbook()).buffer);
  const derived = workbook.getWorksheet('Derived 5Y Spreads');
  const dashboard = workbook.getWorksheet('Daily Dashboard');
  const screenshotDerived = Array.from({ length: derived.rowCount - 1 }, (_, index) => derived.getRow(index + 2)).find((row) => row.getCell(3).value === 'Oracle' && row.getCell(2).value instanceof Date && row.getCell(2).value.toISOString().slice(0, 10) === '2026-08-21');
  const screenshotDashboard = Array.from({ length: dashboard.rowCount - 1 }, (_, index) => dashboard.getRow(index + 2)).find((row) => row.getCell(2).value === 'Oracle' && row.getCell(1).value instanceof Date && row.getCell(1).value.toISOString().slice(0, 10) === '2026-08-21');
  assert.equal(screenshotDerived?.getCell(7).value, 214);
  assert.equal(screenshotDerived?.getCell(8).value, null);
  assert.equal(screenshotDerived?.getCell(18).value, 'screenshot_backfill');
  assert.equal(screenshotDerived?.getCell(19).value, 'User screenshot curve backfill (approximate)');
  assert.equal(screenshotDashboard?.getCell(12).value.result, 'User screenshot curve backfill (approximate)');
});

test('keeps the newest cloud batch as last-good when concurrent exports finish out of order', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-race-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const oldPages = exportPages();
  const newPages = structuredClone(exportPages());
  const newBatch = newPages[1].data.find((entry) => entry.section === 'published_batches').record;
  newBatch.batchId = 'ice-20260825-cloud'; newBatch.clearingDate = '2026-08-25'; newBatch.revision = 2; newBatch.publishedAt = '2026-08-26T00:32:00.000Z';
  newPages[1].data.find((entry) => entry.section === 'published_batch_current').record.clearingDate = '2026-08-25';
  newPages[1].data.find((entry) => entry.section === 'published_batch_current').record.batchId = 'ice-20260825-cloud';
  for (const page of newPages) for (const entry of page.data) {
    if (entry.record.clearingDate === '2026-08-24') entry.record.clearingDate = '2026-08-25';
    if (entry.record.asOf === '2026-08-24') entry.record.asOf = '2026-08-25';
  }
  const oldExport = createIceCdsCloudExport({ dataDir, cloudClient: { async exportSource(query) { if (!query?.cursor) await oldGate; return oldPages[query?.cursor ? 1 : 0]; } } });
  const newExport = createIceCdsCloudExport({ dataDir, cloudClient: { async exportSource(query) { return newPages[query?.cursor ? 1 : 0]; } } });
  const oldRun = oldExport.exportWorkbook();
  await newExport.exportWorkbook();
  releaseOld();
  await oldRun;
  const preserved = await readIceCdsWorkbook(await fs.readFile(path.join(dataDir, 'ice-cds-history.last-good.xlsx')));
  assert.equal(preserved.batchId, 'ice-20260825-cloud');
});

test('uses collision-proof staging when two exports promote in the same millisecond', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ice-cds-cloud-export-same-ms-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const options = () => ({ dataDir, now: () => new Date('2026-08-25T01:00:00.000Z'), cloudClient: { async exportSource(query) { return exportPages()[query?.cursor ? 1 : 0]; } } });
  await Promise.all([createIceCdsCloudExport(options()).exportWorkbook(), createIceCdsCloudExport(options()).exportWorkbook()]);
  const saved = await readIceCdsWorkbook(await fs.readFile(path.join(dataDir, 'ice-cds-history.last-good.xlsx')));
  assert.equal(saved.batchId, 'ice-20260824-cloud');
});
