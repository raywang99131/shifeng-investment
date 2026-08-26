import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ICE_CDS_CONTRACT_REGISTRY } from './iceCdsRegistry.js';
import { createIceCdsCloudClient } from './iceCdsCloudClient.js';
import { buildIceCdsWorkbook, readIceCdsWorkbook } from './iceCdsWorkbook.js';

const COMPANY_ORDER = ICE_CDS_CONTRACT_REGISTRY.map((row) => row.company);
const LAST_GOOD_WORKBOOK = 'ice-cds-history.last-good.xlsx';
const SOURCE_DEFINITION = '截图历史回填 + ICE EOD Price · 模型换算';
const promotionQueues = new Map();

export class IceCdsCloudExportError extends Error {
  constructor(message, code = 'cloud-export-failed') {
    super(message);
    this.name = 'IceCdsCloudExportError';
    this.code = code;
  }
}

function mapById(entries, section, key) {
  return new Map(entries.filter((entry) => entry.section === section).map((entry) => [entry.record[key], entry.record]));
}

export function archiveState(entries, generatedAt) {
  const rawByRevision = mapById(entries, 'ice_eod_revisions', 'revisionId');
  const derivedByRevision = mapById(entries, 'cds_spread_revisions', 'spreadRevisionId');
  const curves = entries.filter((entry) => entry.section === 'treasury_curves').map((entry) => entry.record);
  const batches = mapById(entries, 'published_batches', 'batchId');
  const currentBatchIds = new Map(entries.filter((entry) => entry.section === 'published_batch_current').map((entry) => [entry.record.clearingDate, entry.record.batchId]));
  const selected = [...currentBatchIds.entries()].map(([clearingDate, batchId]) => {
    const batch = batches.get(batchId);
    if (!batch || batch.clearingDate !== clearingDate || batch.sourceKind !== 'ice_eod_isda' || batch.rows.length !== COMPANY_ORDER.length) {
      throw new IceCdsCloudExportError('Cloud export is missing a current published batch', 'invalid-cloud-export');
    }
    const rows = batch.rows.map((row) => {
      const derived = derivedByRevision.get(row.spreadRevisionId);
      const raw = derived && rawByRevision.get(derived.iceRevisionId);
      if (!derived || !raw || derived.clearingDate !== clearingDate || raw.clearingDate !== clearingDate
        || derived.company !== row.company || raw.company !== row.company || derived.iceRevisionId !== raw.revisionId
        || derived.instrumentName !== raw.instrumentName || derived.eodPrice !== raw.eodPrice || derived.couponBp !== raw.couponBp) {
        throw new IceCdsCloudExportError('Cloud export contains mismatched current values', 'invalid-cloud-export');
      }
      return { raw, derived };
    });
    if (!COMPANY_ORDER.every((company) => rows.some((row) => row.derived.company === company))) {
      throw new IceCdsCloudExportError('Cloud export batch is incomplete', 'invalid-cloud-export');
    }
    return { batch, rows };
  }).sort((left, right) => left.batch.clearingDate.localeCompare(right.batch.clearingDate));
  if (selected.length === 0) throw new IceCdsCloudExportError('Cloud export has no published batches', 'invalid-cloud-export');
  const rawRows = [];
  const derivedRows = [];
  for (const { batch, rows } of selected) {
    for (const { raw, derived } of rows) {
      rawRows.push({ batchId: batch.batchId, clearingDate: raw.clearingDate, company: raw.company, name: raw.iceName, instrumentName: raw.instrumentName, eodPrice: raw.eodPrice, sourceUrl: raw.sourceUrl, importedAt: raw.retrievedAt });
      derivedRows.push({ batchId: batch.batchId, clearingDate: derived.clearingDate, company: derived.company, instrumentName: derived.instrumentName, eodPrice: derived.eodPrice, couponBp: derived.couponBp, maturityDate: derived.maturityDate, spreadBp: derived.spreadBp, roundTripPrice: derived.roundTripPrice, priceResidual: derived.priceResidual, hazardRate: derived.hazardRate, curveId: derived.curveId, recoveryRate: derived.recoveryRate, modelVersion: derived.modelVersion, qualityStatus: derived.qualityStatus, officialSpreadBp: null, relativeError: null, sourceKind: 'ice_eod_isda', sourceLabel: SOURCE_DEFINITION, sourceUrl: raw.sourceUrl });
    }
  }
  const latest = selected.at(-1).batch;
  const screenshotHistory = entries.filter((entry) => entry.section === 'seed_history').map((entry) => entry.record);
  const screenshotRows = screenshotHistory.length;
  const screenshotBackfillSource = [...new Set(screenshotHistory.map((row) => row.sourceLabel))].join('；') || null;
  for (const row of screenshotHistory) {
    derivedRows.push({ batchId: `screenshot-backfill-${row.observationDate}`, clearingDate: row.observationDate, company: row.company,
      instrumentName: 'Screenshot history backfill (approximate)', eodPrice: null, couponBp: null, maturityDate: null,
      spreadBp: row.valueBp, roundTripPrice: null, priceResidual: null, hazardRate: null, curveId: 'screenshot-backfill',
      recoveryRate: null, modelVersion: 'screenshot-backfill-v1', qualityStatus: 'stale', officialSpreadBp: null,
      relativeError: null, sourceKind: 'screenshot_backfill', sourceLabel: row.sourceLabel, sourceUrl: null });
  }
  return {
    schemaVersion: 1,
    batchId: latest.batchId,
    generatedAt,
    rawRows,
    derivedRows,
    curves,
    registry: ICE_CDS_CONTRACT_REGISTRY,
    validationLog: [{ batchId: latest.batchId, createdAt: generatedAt, level: 'info', code: 'cloud-export', company: null, message: `Cloud D1 export snapshot; ${screenshotRows} screenshot backfill rows projected into history.` }],
    methodology: {
      modelVersion: 'ice-isda-compatible-v1', priceTolerance: 0.005, relativeBenchmarkTolerance: 0.01,
      note: 'ICE EOD Price is the raw input. 5Y spread is model-derived and is not an official ICE spread settlement.',
      sourceDefinition: SOURCE_DEFINITION,
      cloudDataState: 'cloud-current',
      cloudExportedAt: generatedAt,
      cloudLatestPublishedAt: latest.publishedAt,
      cloudLatestClearingDate: latest.clearingDate,
      cloudLatestRevision: latest.revision,
      ...(screenshotBackfillSource ? { screenshotBackfillSource } : {}),
    },
  };
}

function comparePromotion(left, right) {
  return String(left.clearingDate).localeCompare(String(right.clearingDate))
    || Number(left.revision) - Number(right.revision)
    || String(left.publishedAt).localeCompare(String(right.publishedAt));
}

function enqueuePromotion(file, work) {
  const prior = promotionQueues.get(file) || Promise.resolve();
  const current = prior.catch(() => undefined).then(work);
  promotionQueues.set(file, current);
  current.finally(() => { if (promotionQueues.get(file) === current) promotionQueues.delete(file); }).catch(() => undefined);
  return current;
}

async function writeAtomically(fsImpl, file, buffer) {
  await fsImpl.mkdir(path.dirname(file), { recursive: true });
  const staged = `${file}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  try {
    await fsImpl.writeFile(staged, buffer);
    await fsImpl.rename(staged, file);
  } finally {
    await fsImpl.rm(staged, { force: true });
  }
}

async function promoteLastGood({ fsImpl, file, buffer, promotion }) {
  return enqueuePromotion(file, async () => {
    try {
      const existingBuffer = await fsImpl.readFile(file);
      let existing;
      try { existing = await readIceCdsWorkbook(existingBuffer); } catch { existing = null; }
      if (!existing) {
        await writeAtomically(fsImpl, file, buffer);
        return true;
      }
      const previous = {
        clearingDate: existing.methodology?.cloudLatestClearingDate,
        revision: existing.methodology?.cloudLatestRevision,
        publishedAt: existing.methodology?.cloudLatestPublishedAt,
      };
      if (previous.clearingDate && previous.publishedAt && Number.isSafeInteger(Number(previous.revision)) && comparePromotion(promotion, previous) <= 0) return false;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await writeAtomically(fsImpl, file, buffer);
    return true;
  });
}

export function createIceCdsCloudExport({
  cloudClient,
  dataDir = process.env.ICE_CDS_DATA_DIR || path.resolve('server/data/ai-dashboard/ice-cds'),
  fsImpl = fs,
  now = () => new Date(),
} = {}) {
  if (!cloudClient || typeof cloudClient.exportSource !== 'function') throw new IceCdsCloudExportError('Cloud collector export client is required', 'invalid-configuration');
  const lastGoodFile = path.join(dataDir, LAST_GOOD_WORKBOOK);
  return {
    async exportWorkbook() {
      try {
        const entries = [];
        const seenCursors = new Set();
        let cursor = null;
        do {
          const page = await cloudClient.exportSource({ limit: 500, ...(cursor ? { cursor } : {}) });
          if (!page || !Array.isArray(page.data) || !(page.nextCursor === null || typeof page.nextCursor === 'string') || (page.nextCursor && seenCursors.has(page.nextCursor))) {
            throw new IceCdsCloudExportError('Cloud export paging is invalid', 'invalid-cloud-export');
          }
          entries.push(...page.data);
          cursor = page.nextCursor;
          if (cursor) seenCursors.add(cursor);
        } while (cursor);
        const generatedAt = now().toISOString();
        const state = archiveState(entries, generatedAt);
        const buffer = await buildIceCdsWorkbook(state);
        await promoteLastGood({ fsImpl, file: lastGoodFile, buffer, promotion: {
          clearingDate: state.methodology.cloudLatestClearingDate,
          revision: state.methodology.cloudLatestRevision,
          publishedAt: state.methodology.cloudLatestPublishedAt,
        } });
        return { buffer, dataState: 'cloud-current' };
      } catch (error) {
        try {
          const buffer = await fsImpl.readFile(lastGoodFile);
          await readIceCdsWorkbook(buffer);
          return { buffer, dataState: 'stale-last-good' };
        } catch (fallbackError) {
          if (fallbackError?.code === 'ENOENT' || fallbackError) throw new IceCdsCloudExportError('Cloud export failed and no valid last-good workbook is available', 'workbook-unavailable');
        }
      }
    },
  };
}

export function createIceCdsCloudExportFromEnv(options = {}) {
  return createIceCdsCloudExport({ ...options, cloudClient: options.cloudClient || createIceCdsCloudClient(options) });
}
