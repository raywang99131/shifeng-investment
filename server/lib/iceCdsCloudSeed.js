import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { ICE_CDS_CONTRACT_REGISTRY } from './iceCdsRegistry.js';
import { readIceCdsWorkbook } from './iceCdsWorkbook.js';

const SCREENSHOT_MODEL = 'screenshot-backfill-v1';
const SCREENSHOT_LABEL = 'User screenshot curve backfill (approximate)';
const SCREENSHOT_NOTE = 'Digitized from the supplied chart image; this is not an ICE observation or settlement spread.';
const TREASURY_CURVE_SOURCE_URL = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates';
const TREASURY_CURVE_SOURCE_LABEL = 'U.S. Treasury par yields · continuous-zero proxy';
const TREASURY_GRID = [1 / 12, 0.125, 1 / 6, 0.25, 1 / 3, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];

const sha256 = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonicalCompanies = ICE_CDS_CONTRACT_REGISTRY.map((row) => row.company);

const isIsoTimestamp = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

function normalizeGeneratedAt(value) {
  if (!isIsoTimestamp(value)) throw new Error('generatedAt must be an ISO timestamp');
  return value;
}

function assertSeven(rows, label) {
  if (rows.length !== canonicalCompanies.length || new Set(rows.map((row) => row.company)).size !== canonicalCompanies.length
    || !canonicalCompanies.every((company) => rows.some((row) => row.company === company))) {
    throw new Error(`${label} must contain exactly the canonical seven companies`);
  }
}

function canonicalCurve(curve, generatedAt) {
  const nodes = [...curve.nodes].map((node) => ({ years: Number(node.years), zeroRate: Number(node.zeroRate) }))
    .sort((left, right) => left.years - right.years);
  if (curve.currency !== 'USD' || curve.sourceLabel !== TREASURY_CURVE_SOURCE_LABEL || curve.sourceUrl !== TREASURY_CURVE_SOURCE_URL
    || nodes.length !== TREASURY_GRID.length || nodes.some((node, index) => node.years !== TREASURY_GRID[index] || !Number.isFinite(node.zeroRate))) {
    throw new Error('workbook curve is not the canonical Treasury curve');
  }
  const payloadHash = sha256({ asOf: String(curve.asOf), nodes });
  return { curveId: `ust-par-zero-proxy-${curve.asOf}-${payloadHash}`, asOf: String(curve.asOf), currency: 'USD', sourceLabel: TREASURY_CURVE_SOURCE_LABEL, sourceUrl: TREASURY_CURVE_SOURCE_URL, retrievedAt: generatedAt, payloadHash, nodes };
}

function snapshotCds5y(value) {
  const cds5y = value?.creditRisk?.cds5y;
  if (!cds5y || typeof cds5y !== 'object' || !Array.isArray(cds5y.companies) || typeof cds5y.asOf !== 'string') throw new Error('snapshot does not contain creditRisk.cds5y');
  return cds5y;
}

function assertSnapshotMatches(state, live, snapshot) {
  const cds5y = snapshotCds5y(snapshot);
  if (cds5y.batchId !== state.batchId) throw new Error('snapshot batchId does not match workbook batchId');
  const dates = [...new Set(live.map((row) => row.clearingDate))];
  if (dates.length !== 1 || cds5y.asOf !== dates[0]) throw new Error('snapshot asOf does not match workbook clearing date');
  assertSeven(cds5y.companies, 'snapshot companies');
  for (const row of live) {
    const snapshotRow = cds5y.companies.find((candidate) => candidate.company === row.company);
    const point = Array.isArray(snapshotRow?.history) ? snapshotRow.history.find((candidate) => candidate?.date === row.clearingDate) : snapshotRow;
    const eodPrice = point?.eodPrice ?? snapshotRow?.latestEodPrice;
    const spreadBp = point?.valueBp ?? point?.spreadBp ?? snapshotRow?.latestBp ?? snapshotRow?.spreadBp;
    if (!point || Number(eodPrice) !== Number(row.eodPrice) || Number(spreadBp) !== Number(row.spreadBp)) throw new Error(`snapshot ${row.company} values do not match workbook`);
  }
}

/**
 * Builds a deterministic, reviewable seed package.  It reads local projections only;
 * it never contacts ICE, Treasury, or a Cloudflare endpoint.
 */
export async function buildIceCdsCloudSeed({ workbookFile, snapshotFile, generatedAt } = {}) {
  if (!workbookFile) throw new Error('workbookFile is required');
  const state = await readIceCdsWorkbook(await fs.readFile(workbookFile));
  const at = normalizeGeneratedAt(generatedAt ?? state.generatedAt);
  if (!snapshotFile) throw new Error('snapshotFile is required');
  let snapshot;
  try { snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('snapshotFile is required and was not found');
    throw new Error('snapshotFile must be valid JSON');
  }

  const screenshotHistory = state.derivedRows
    .filter((row) => row.modelVersion === SCREENSHOT_MODEL)
    .map((row) => ({ observationDate: row.clearingDate, company: row.company, valueBp: Number(row.spreadBp),
      sourceKind: 'screenshot_backfill', sourceLabel: SCREENSHOT_LABEL, note: SCREENSHOT_NOTE, importedAt: at }))
    .sort((left, right) => left.observationDate.localeCompare(right.observationDate) || canonicalCompanies.indexOf(left.company) - canonicalCompanies.indexOf(right.company));

  const live = state.derivedRows.filter((row) => row.modelVersion !== SCREENSHOT_MODEL);
  assertSnapshotMatches(state, live, snapshot);
  const liveByKey = new Map(live.map((row) => [`${row.clearingDate}|${row.company}|${row.instrumentName}`, row]));
  const raw = state.rawRows.map((row) => {
    const derived = liveByKey.get(`${row.clearingDate}|${row.company}|${row.instrumentName}`);
    if (!derived) throw new Error(`raw row ${row.company} ${row.clearingDate} has no live derived spread`);
    const observation = {
      clearingDate: row.clearingDate, company: row.company, iceName: row.name, instrumentName: row.instrumentName,
      eodPrice: Number(row.eodPrice), couponBp: Number(derived.couponBp), retrievedAt: at, sourceUrl: row.sourceUrl,
    };
    return { ...observation, payloadHash: sha256({ clearingDate: observation.clearingDate, company: observation.company, name: observation.iceName, instrumentName: observation.instrumentName, eodPrice: observation.eodPrice, couponBp: observation.couponBp }) };
  });
  const dates = [...new Set(raw.map((row) => row.clearingDate))].sort();
  if (dates.length !== 1) throw new Error('seed workbook must contain exactly one ICE clearing date');
  assertSeven(raw, 'ICE observations');
  const iceByKey = new Map(raw.map((row) => [`${row.clearingDate}|${row.company}|${row.instrumentName}`, row]));
  const curves = state.curves.map((curve) => canonicalCurve(curve, at));
  const curvesByOriginalId = new Map(state.curves.map((curve, index) => [curve.curveId, curves[index]]));
  const derivedSpreads = live.map((row) => {
    const observation = iceByKey.get(`${row.clearingDate}|${row.company}|${row.instrumentName}`);
    const curve = curvesByOriginalId.get(row.curveId);
    if (!observation || !curve) throw new Error(`derived row ${row.company} has no source observation or curve`);
    return {
      clearingDate: row.clearingDate, company: row.company, icePayloadHash: observation.payloadHash, curveId: curve.curveId,
      instrumentName: row.instrumentName, maturityDate: row.maturityDate, eodPrice: Number(row.eodPrice), couponBp: Number(row.couponBp),
      spreadBp: Number(row.spreadBp), roundTripPrice: Number(row.roundTripPrice), priceResidual: Number(row.priceResidual),
      hazardRate: Number(row.hazardRate), recoveryRate: Number(row.recoveryRate), modelVersion: row.modelVersion,
      qualityStatus: row.qualityStatus, createdAt: at,
    };
  });
  assertSeven(derivedSpreads, 'derived spreads');
  const publishedBatches = [{
    batchId: `seed-${state.batchId}`, clearingDate: dates[0], revision: 1, publishedAt: at,
    sourceKind: 'ice_eod_isda', qualityStatus: 'model-derived',
    rows: canonicalCompanies.map((company) => { const row = derivedSpreads.find((candidate) => candidate.company === company); return { company, icePayloadHash: row.icePayloadHash, curveId: row.curveId, modelVersion: row.modelVersion, instrumentName: row.instrumentName }; }),
  }];
  return {
    schemaVersion: 1, generatedAt: at, screenshotHistory, iceObservations: raw,
    treasuryCurves: curves.sort((left, right) => left.curveId.localeCompare(right.curveId)),
    derivedSpreads, publishedBatches,
  };
}

/** Splits only independent screenshot rows; the ICE package always remains atomic. */
export function prepareIceCdsCloudSeedUploads(seed, maxRows = 200, maxBytes = 120 * 1024) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 500) throw new Error('maxRows must be between 1 and 500');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes >= 128 * 1024) throw new Error('maxBytes must be below the Worker body limit');
  const empty = { iceObservations: [], treasuryCurves: [], derivedSpreads: [], publishedBatches: [] };
  const uploads = [];
  let screenshotHistory = [];
  for (const row of seed.screenshotHistory) {
    const candidate = { schemaVersion: 1, generatedAt: seed.generatedAt, screenshotHistory: [...screenshotHistory, row], ...empty };
    if (screenshotHistory.length === maxRows || Buffer.byteLength(JSON.stringify(candidate)) > maxBytes) {
      if (screenshotHistory.length === 0) throw new Error('a screenshot seed row exceeds the Worker body limit');
      uploads.push({ schemaVersion: 1, generatedAt: seed.generatedAt, screenshotHistory, ...empty }); screenshotHistory = [row];
    } else screenshotHistory.push(row);
  }
  if (screenshotHistory.length > 0) uploads.push({ schemaVersion: 1, generatedAt: seed.generatedAt, screenshotHistory, ...empty });
  const liveRows = seed.iceObservations.length + seed.treasuryCurves.length + seed.derivedSpreads.length + seed.publishedBatches.length;
  if (liveRows > maxRows) throw new Error('ICE seed core exceeds the maximum atomic upload size');
  if (liveRows > 0) uploads.push({
    schemaVersion: 1, generatedAt: seed.generatedAt, screenshotHistory: [], iceObservations: seed.iceObservations,
    treasuryCurves: seed.treasuryCurves, derivedSpreads: seed.derivedSpreads, publishedBatches: seed.publishedBatches,
  });
  if (uploads.some((upload) => upload.screenshotHistory.length > 500 || Buffer.byteLength(JSON.stringify(upload)) > maxBytes)) throw new Error('seed upload exceeds safe request limits');
  return uploads;
}

export async function importIceCdsCloudSeed({ seed, baseUrl, writeToken, fetchImpl = fetch, maxAttempts = 3 }) {
  if (!/^https:\/\/.+/.test(baseUrl || '') || !nonEmpty(writeToken) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('ICE_CDS_COLLECTOR_BASE_URL and ICE_CDS_COLLECTOR_WRITE_TOKEN are required');
  }
  const url = new URL('/internal/v1/cds/seed', baseUrl).toString();
  const results = [];
  for (const upload of prepareIceCdsCloudSeedUploads(seed)) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${writeToken}`, 'content-type': 'application/json' }, body: JSON.stringify(upload) });
        if (!response.ok) {
          const error = new Error(`Seed upload failed with HTTP ${response.status}`);
          if (response.status < 429 || (response.status > 429 && response.status < 500)) error.permanent = true;
          throw error;
        }
        results.push(await response.json()); lastError = undefined; break;
      } catch (error) { if (error?.permanent) throw error; lastError = error; }
    }
    if (lastError) throw lastError;
  }
  return results;
}

const nonEmpty = (value) => typeof value === 'string' && value.length > 0;
