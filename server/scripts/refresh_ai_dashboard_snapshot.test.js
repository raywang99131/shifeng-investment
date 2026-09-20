import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeComputeQuote } from '../lib/aiComputeData.js';
import {
  refreshDashboardSnapshot,
  seedDashboardSnapshot,
} from './refresh_ai_dashboard_snapshot.mjs';

test('ledger seeding preserves the last-good ICE CDS batch', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-dashboard-seed-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataFile = path.join(root, 'snapshot.json');
  const ledgerFile = path.join(root, 'research-ledger.json');
  const creditRiskSource = {
    status: 'ready',
    stale: false,
    asOf: '2026-08-26',
    syncedAt: '2026-08-27T05:18:01.341Z',
    url: 'https://www.ice.com/cds-settlement-prices/icc/single-name-instruments',
    message: 'ICE EOD Price 导入成功；ice-preserve-me',
  };
  const creditRisk = {
    cds5y: {
      asOf: '2026-08-26',
      sourceKind: 'ice_eod_isda',
      batchId: 'ice-preserve-me',
      companies: [{ company: 'Oracle', latestBp: 211.73 }],
    },
  };
  await fs.promises.writeFile(dataFile, `${JSON.stringify({
    schemaVersion: 2,
    generatedAt: '2026-08-27T05:18:01.341Z',
    sources: { creditRisk: creditRiskSource },
    creditRisk,
  }, null, 2)}\n`);
  await fs.promises.writeFile(ledgerFile, '{"records":[]}\n');

  const seeded = await seedDashboardSnapshot({
    dataFile,
    ledgerFile,
    now: new Date('2026-08-27T06:00:00.000Z'),
  });

  assert.deepEqual(seeded.creditRisk, creditRisk);
  assert.deepEqual(seeded.sources.creditRisk, creditRiskSource);
  const persisted = JSON.parse(await fs.promises.readFile(dataFile, 'utf8'));
  assert.equal(persisted.creditRisk.cds5y.batchId, 'ice-preserve-me');
});

test('normal dashboard refresh does not run a seed write before collectors', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ai-dashboard-refresh-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataFile = path.join(root, 'snapshot.json');
  const preserved = {
    schemaVersion: 2,
    generatedAt: '2026-08-27T05:18:01.341Z',
    sources: { creditRisk: { status: 'ready' } },
    creditRisk: { cds5y: { batchId: 'ice-survives-refresh' } },
  };
  await fs.promises.writeFile(dataFile, `${JSON.stringify(preserved)}\n`);

  await refreshDashboardSnapshot({
    argv: ['--sources=growth'],
    seed: async () => fs.promises.writeFile(dataFile, `${JSON.stringify({
      schemaVersion: 2,
      generatedAt: '2026-08-27T06:00:00.000Z',
      sources: { creditRisk: { status: 'error' } },
      creditRisk: { cds5y: { batchId: null } },
    })}\n`),
    createService: () => ({
      refresh: async () => JSON.parse(await fs.promises.readFile(dataFile, 'utf8')),
    }),
    output: { write() {} },
  });

  const persisted = JSON.parse(await fs.promises.readFile(dataFile, 'utf8'));
  assert.equal(persisted.creditRisk.cds5y.batchId, 'ice-survives-refresh');
});

test('reseeding retains every collected compute day instead of replacing history with the ledger', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'compute-history-seed-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataFile = path.join(root, 'snapshot.json');
  const ledgerFile = path.join(root, 'ledger.json');
  const computeRental = ['2026-09-09', '2026-09-10'].map(asOf => normalizeComputeQuote({
    platform: 'AWS', gpu: 'H100', instanceSpec: 'p5.48xlarge', gpuCount: 8, region: 'us-east-1',
    billingMode: 'on_demand', currency: 'USD', instanceHourlyPrice: 40, asOf,
    sourceLabel: 'AWS', sourceUrl: 'https://aws.amazon.com/', retrievedAt: `${asOf}T01:00:00Z`,
  }));
  const computeSourceReports = [{ sourceId: 'aws-ec2-pricing', status: 'ready', asOf: '2026-09-10', rows: 1 }];
  await fs.promises.writeFile(dataFile, JSON.stringify({ computeRental, computeSourceReports }));
  await fs.promises.writeFile(ledgerFile, '{"records":[]}');
  await seedDashboardSnapshot({ dataFile, ledgerFile });
  const saved = JSON.parse(await fs.promises.readFile(dataFile, 'utf8'));
  assert.deepEqual(saved.computeRental.map(row => row.asOf), ['2026-09-10', '2026-09-09']);
  assert.equal(saved.computeRental.filter(row => row.latest).length, 1);
  assert.deepEqual(saved.computeSourceReports, computeSourceReports);
});
