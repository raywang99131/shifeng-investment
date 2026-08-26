import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { ICE_CDS_CONTRACT_REGISTRY } from './iceCdsRegistry.js';
import { readIceCdsWorkbook } from './iceCdsWorkbook.js';

const SCREENSHOT_MODEL = 'screenshot-backfill-v1';
const SCREENSHOT_LABEL = 'User screenshot curve backfill (approximate)';
const SCREENSHOT_NOTE = 'Digitized from the supplied chart image; this is not an ICE observation or settlement spread.';

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
  const identity = { curveId: String(curve.curveId), asOf: String(curve.asOf), currency: String(curve.currency), sourceLabel: String(curve.sourceLabel), sourceUrl: String(curve.sourceUrl), nodes };
  return { ...identity, retrievedAt: generatedAt, payloadHash: sha256(identity) };
}

/**
 * Builds a deterministic, reviewable seed package.  It reads local projections only;
 * it never contacts ICE, Treasury, or a Cloudflare endpoint.
 */
export async function buildIceCdsCloudSeed({ workbookFile, snapshotFile, generatedAt } = {}) {
  if (!workbookFile) throw new Error('workbookFile is required');
  const state = await readIceCdsWorkbook(await fs.readFile(workbookFile));
  const at = normalizeGeneratedAt(generatedAt ?? state.generatedAt);
  // Snapshot is intentionally optional during bootstrap, but when supplied it must
  // be readable JSON so an operator cannot silently seed a mismatched projection.
  if (snapshotFile) {
    try { JSON.parse(await fs.readFile(snapshotFile, 'utf8')); } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('snapshotFile must be valid JSON');
    }
  }

  const screenshotHistory = state.derivedRows
    .filter((row) => row.modelVersion === SCREENSHOT_MODEL)
    .map((row) => ({ observationDate: row.clearingDate, company: row.company, valueBp: Number(row.spreadBp),
      sourceKind: 'screenshot_backfill', sourceLabel: SCREENSHOT_LABEL, note: SCREENSHOT_NOTE, importedAt: at }))
    .sort((left, right) => left.observationDate.localeCompare(right.observationDate) || canonicalCompanies.indexOf(left.company) - canonicalCompanies.indexOf(right.company));

  const live = state.derivedRows.filter((row) => row.modelVersion !== SCREENSHOT_MODEL);
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
  const curvesById = new Map(state.curves.map((curve) => [curve.curveId, canonicalCurve(curve, at)]));
  const derivedSpreads = live.map((row) => {
    const observation = iceByKey.get(`${row.clearingDate}|${row.company}|${row.instrumentName}`);
    if (!observation || !curvesById.has(row.curveId)) throw new Error(`derived row ${row.company} has no source observation or curve`);
    return {
      clearingDate: row.clearingDate, company: row.company, icePayloadHash: observation.payloadHash, curveId: row.curveId,
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
    rows: canonicalCompanies.map((company) => ({ company, icePayloadHash: derivedSpreads.find((row) => row.company === company).icePayloadHash })),
  }];
  return {
    schemaVersion: 1, generatedAt: at, screenshotHistory, iceObservations: raw,
    treasuryCurves: [...curvesById.values()].sort((left, right) => left.curveId.localeCompare(right.curveId)),
    derivedSpreads, publishedBatches,
  };
}

/** Splits only independent screenshot rows; the ICE package always remains atomic. */
export function prepareIceCdsCloudSeedUploads(seed, maxRows = 200) {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 500) throw new Error('maxRows must be between 1 and 500');
  const empty = { iceObservations: [], treasuryCurves: [], derivedSpreads: [], publishedBatches: [] };
  const uploads = [];
  for (let index = 0; index < seed.screenshotHistory.length; index += maxRows) {
    uploads.push({ schemaVersion: 1, generatedAt: seed.generatedAt, screenshotHistory: seed.screenshotHistory.slice(index, index + maxRows), ...empty });
  }
  const liveRows = seed.iceObservations.length + seed.treasuryCurves.length + seed.derivedSpreads.length + seed.publishedBatches.length;
  if (liveRows > maxRows) throw new Error('ICE seed core exceeds the maximum atomic upload size');
  if (liveRows > 0) uploads.push({
    schemaVersion: 1, generatedAt: seed.generatedAt, screenshotHistory: [], iceObservations: seed.iceObservations,
    treasuryCurves: seed.treasuryCurves, derivedSpreads: seed.derivedSpreads, publishedBatches: seed.publishedBatches,
  });
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
        if (!response.ok) throw new Error(`Seed upload failed with HTTP ${response.status}`);
        results.push(await response.json()); lastError = undefined; break;
      } catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
  }
  return results;
}

const nonEmpty = (value) => typeof value === 'string' && value.length > 0;
