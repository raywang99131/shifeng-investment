import { parseIceInstrumentName } from './domain/contracts';
import { ICE_CDS_CONTRACT_REGISTRY, TRACKED_COMPANIES } from './domain/registry';
import type { Company, DerivedSpread, IceObservation, PublishBatchInput, TreasuryCurve } from './types';

type ScreenshotHistory = {
  observationDate: string; company: Company; valueBp: number; sourceKind: 'screenshot_backfill';
  sourceLabel: string; note: string; importedAt: string;
};
type SeedDerivedSpread = Omit<DerivedSpread, 'iceRevisionId'> & { icePayloadHash: string };
type SeedPublishedBatch = Omit<PublishBatchInput, 'rows'> & { rows: Array<{ company: Company; icePayloadHash: string }> };
export type SeedPackage = {
  schemaVersion: 1; generatedAt: string; screenshotHistory: ScreenshotHistory[]; iceObservations: IceObservation[];
  treasuryCurves: TreasuryCurve[]; derivedSpreads: SeedDerivedSpread[]; publishedBatches: SeedPublishedBatch[];
};
export type SeedSectionCounts = { inserted: number; existing: number; rejected: number };
export type SeedResult = Record<'screenshotHistory' | 'iceObservations' | 'treasuryCurves' | 'derivedSpreads' | 'publishedBatches', SeedSectionCounts>;

const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => typeof value === 'object' && value !== null
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const validTimestamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const company = (value: unknown): value is Company => TRACKED_COMPANIES.includes(value as Company);
const invalid = (): never => { throw new Error('Seed package is invalid'); };
const normalizedName = (value: string): string => value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const sha256 = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const exactSeven = <T extends { company: Company }>(rows: T[]): boolean => rows.length === TRACKED_COMPANIES.length
  && new Set(rows.map((row) => row.company)).size === TRACKED_COMPANIES.length
  && TRACKED_COMPANIES.every((name) => rows.some((row) => row.company === name));

async function parseObservation(value: unknown): Promise<IceObservation> {
  if (!exactKeys(value, ['clearingDate', 'company', 'iceName', 'instrumentName', 'eodPrice', 'couponBp', 'payloadHash', 'retrievedAt', 'sourceUrl'])) invalid();
  const row = value as Record<string, any>;
  if (!validDate(row.clearingDate) || !company(row.company) || !nonBlank(row.iceName) || !nonBlank(row.instrumentName)
    || !finite(row.eodPrice) || row.eodPrice < 0 || !finite(row.couponBp) || row.couponBp <= 0 || !nonBlank(row.payloadHash)
    || !validTimestamp(row.retrievedAt) || !nonBlank(row.sourceUrl) || !row.sourceUrl.startsWith('https://www.ice.com/')) invalid();
  const parsed = parseIceInstrumentName(row.instrumentName);
  const registry = ICE_CDS_CONTRACT_REGISTRY.find((definition) => definition.company === row.company);
  if (!registry || parsed.couponBp !== row.couponBp || parsed.couponBp !== registry.couponBp || !registry.symbols.includes(parsed.symbol)
    || parsed.currency !== registry.currency || parsed.tier !== registry.tier || parsed.restructuring !== registry.restructuring
    || !new Set([registry.company, ...registry.aliases].map(normalizedName)).has(normalizedName(row.iceName))) invalid();
  const payloadHash = await sha256({ clearingDate: row.clearingDate, company: row.company, name: row.iceName.trim(), instrumentName: row.instrumentName.trim().toUpperCase(), eodPrice: row.eodPrice, couponBp: row.couponBp });
  if (payloadHash !== row.payloadHash) invalid();
  return { ...row, iceName: row.iceName.trim(), instrumentName: row.instrumentName.trim().toUpperCase() } as IceObservation;
}

function parseScreenshot(value: unknown): ScreenshotHistory {
  if (!exactKeys(value, ['observationDate', 'company', 'valueBp', 'sourceKind', 'sourceLabel', 'note', 'importedAt'])) invalid();
  const row = value as Record<string, any>;
  if (!validDate(row.observationDate) || !company(row.company) || !finite(row.valueBp) || row.valueBp <= 0
    || row.sourceKind !== 'screenshot_backfill' || !nonBlank(row.sourceLabel) || !nonBlank(row.note) || !validTimestamp(row.importedAt)) invalid();
  return row as ScreenshotHistory;
}

function parseCurve(value: unknown): TreasuryCurve {
  if (!exactKeys(value, ['curveId', 'asOf', 'currency', 'sourceLabel', 'sourceUrl', 'retrievedAt', 'payloadHash', 'nodes'])) invalid();
  const row = value as Record<string, any>;
  if (!nonBlank(row.curveId) || !validDate(row.asOf) || row.currency !== 'USD' || !nonBlank(row.sourceLabel)
    || !nonBlank(row.sourceUrl) || !row.sourceUrl.startsWith('https://home.treasury.gov/') || !validTimestamp(row.retrievedAt)
    || !nonBlank(row.payloadHash) || !Array.isArray(row.nodes) || row.nodes.length === 0) invalid();
  const nodes = row.nodes.map((node: unknown) => {
    if (!exactKeys(node, ['years', 'zeroRate']) || !finite(node.years) || node.years <= 0 || !finite(node.zeroRate)) invalid();
    const parsed = node as Record<string, any>;
    return { years: parsed.years, zeroRate: parsed.zeroRate };
  });
  if (new Set(nodes.map((node: { years: number; zeroRate: number }) => node.years)).size !== nodes.length) invalid();
  return { ...(row as Omit<TreasuryCurve, 'nodes'>), nodes };
}

function parseDerived(value: unknown, observations: IceObservation[], curves: TreasuryCurve[]): SeedDerivedSpread {
  const keys = ['clearingDate', 'company', 'icePayloadHash', 'curveId', 'instrumentName', 'maturityDate', 'eodPrice', 'couponBp', 'spreadBp', 'roundTripPrice', 'priceResidual', 'hazardRate', 'recoveryRate', 'modelVersion', 'qualityStatus', 'createdAt'];
  if (!exactKeys(value, keys)) invalid(); const row = value as Record<string, any>;
  if (!validDate(row.clearingDate) || !company(row.company) || !nonBlank(row.icePayloadHash)
    || !nonBlank(row.curveId) || !nonBlank(row.instrumentName) || !validDate(row.maturityDate) || !finite(row.eodPrice)
    || !finite(row.couponBp) || !finite(row.spreadBp) || row.spreadBp <= 0 || !finite(row.roundTripPrice)
    || !finite(row.priceResidual) || !finite(row.hazardRate) || !finite(row.recoveryRate) || !nonBlank(row.modelVersion)
    || row.qualityStatus !== 'model-derived' || !validTimestamp(row.createdAt)) invalid();
  const raw = observations.find((observation) => observation.clearingDate === row.clearingDate && observation.company === row.company
    && observation.instrumentName === row.instrumentName && observation.payloadHash === row.icePayloadHash);
  if (!raw || raw.eodPrice !== row.eodPrice || raw.couponBp !== row.couponBp || !curves.some((curve) => curve.curveId === row.curveId && curve.asOf <= row.clearingDate)) invalid();
  return row as SeedDerivedSpread;
}

function parseBatch(value: unknown, derived: SeedDerivedSpread[]): SeedPublishedBatch {
  if (!exactKeys(value, ['batchId', 'clearingDate', 'revision', 'publishedAt', 'sourceKind', 'qualityStatus', 'rows'])) invalid();
  const batch = value as Record<string, any>;
  if (!nonBlank(batch.batchId) || !validDate(batch.clearingDate) || !Number.isSafeInteger(batch.revision) || batch.revision < 1
    || !validTimestamp(batch.publishedAt) || batch.sourceKind !== 'ice_eod_isda' || batch.qualityStatus !== 'model-derived' || !Array.isArray(batch.rows)) invalid();
  const rows: Array<{ company: Company; icePayloadHash: string }> = batch.rows.map((row: unknown) => {
    if (!exactKeys(row, ['company', 'icePayloadHash']) || !company(row.company) || !nonBlank(row.icePayloadHash)) invalid();
    return row as { company: Company; icePayloadHash: string };
  });
  if (!exactSeven(rows) || !rows.every((row) => derived.some((spread) => spread.clearingDate === batch.clearingDate && spread.company === row.company && spread.icePayloadHash === row.icePayloadHash))) invalid();
  return { ...(batch as Omit<SeedPublishedBatch, 'rows'>), rows };
}

/** Validates the entire package before any D1 statement is constructed. */
export async function parseSeedPackage(value: unknown): Promise<SeedPackage> {
  const keys = ['schemaVersion', 'generatedAt', 'screenshotHistory', 'iceObservations', 'treasuryCurves', 'derivedSpreads', 'publishedBatches'];
  if (!exactKeys(value, keys)) invalid(); const seed = value as Record<string, any>;
  if (seed.schemaVersion !== 1 || !validTimestamp(seed.generatedAt)
    || !Array.isArray(seed.screenshotHistory) || !Array.isArray(seed.iceObservations) || !Array.isArray(seed.treasuryCurves)
    || !Array.isArray(seed.derivedSpreads) || !Array.isArray(seed.publishedBatches)) invalid();
  const screenshotHistory = (seed.screenshotHistory as unknown[]).map(parseScreenshot);
  if (new Set(screenshotHistory.map((row) => `${row.observationDate}|${row.company}`)).size !== screenshotHistory.length) invalid();
  const iceObservations = await Promise.all(seed.iceObservations.map(parseObservation));
  if (iceObservations.length > 0 && (!exactSeven(iceObservations) || new Set(iceObservations.map((row) => row.clearingDate)).size !== 1)) invalid();
  const treasuryCurves = (seed.treasuryCurves as unknown[]).map(parseCurve);
  if (new Set(treasuryCurves.map((row) => row.curveId)).size !== treasuryCurves.length) invalid();
  const derivedSpreads = (seed.derivedSpreads as unknown[]).map((row: unknown) => parseDerived(row, iceObservations, treasuryCurves));
  if (derivedSpreads.length > 0 && (!exactSeven(derivedSpreads) || new Set(derivedSpreads.map((row) => row.clearingDate)).size !== 1)) invalid();
  const publishedBatches = (seed.publishedBatches as unknown[]).map((row: unknown) => parseBatch(row, derivedSpreads));
  if (iceObservations.length === 0 && (treasuryCurves.length || derivedSpreads.length || publishedBatches.length)) invalid();
  if (iceObservations.length > 0 && (treasuryCurves.length === 0 || !exactSeven(derivedSpreads) || publishedBatches.length !== 1)) invalid();
  return { schemaVersion: 1, generatedAt: seed.generatedAt, screenshotHistory, iceObservations, treasuryCurves, derivedSpreads, publishedBatches };
}

const count = async (db: D1Database, sql: string, bindings: unknown[]): Promise<number> => (await db.prepare(sql).bind(...bindings).first<{ count: number }>())?.count ?? 0;
const section = (inserted: number, total: number): SeedSectionCounts => ({ inserted, existing: total - inserted, rejected: 0 });

/** Applies a validated package as one D1 batch. Call only from the fixed Durable Object. */
export async function applySeedPackage(db: D1Database, seed: SeedPackage): Promise<SeedResult> {
  const existing = {
    screenshotHistory: await Promise.all(seed.screenshotHistory.map((row) => count(db, 'SELECT COUNT(*) AS count FROM seed_history WHERE observation_date = ? AND company = ? AND source_kind = ?', [row.observationDate, row.company, row.sourceKind]))),
    iceObservations: await Promise.all(seed.iceObservations.map((row) => count(db, 'SELECT COUNT(*) AS count FROM ice_eod_revisions WHERE clearing_date = ? AND company = ? AND instrument_name = ? AND payload_hash = ?', [row.clearingDate, row.company, row.instrumentName, row.payloadHash]))),
    treasuryCurves: await Promise.all(seed.treasuryCurves.map((row) => count(db, 'SELECT COUNT(*) AS count FROM treasury_curves WHERE curve_id = ?', [row.curveId]))),
    derivedSpreads: await Promise.all(seed.derivedSpreads.map((row) => count(db, `SELECT COUNT(*) AS count FROM cds_spread_revisions AS spreads JOIN ice_eod_revisions AS ice ON ice.revision_id = spreads.ice_revision_id WHERE spreads.clearing_date = ? AND spreads.company = ? AND ice.payload_hash = ? AND spreads.curve_id = ? AND spreads.model_version = ?`, [row.clearingDate, row.company, row.icePayloadHash, row.curveId, row.modelVersion]))),
    publishedBatches: await Promise.all(seed.publishedBatches.map((row) => count(db, 'SELECT COUNT(*) AS count FROM published_batches WHERE clearing_date = ? AND revision = ?', [row.clearingDate, row.revision]))),
  };
  const statements: D1PreparedStatement[] = [
    ...seed.screenshotHistory.map((row) => db.prepare(`INSERT INTO seed_history (observation_date, company, value_bp, source_kind, source_label, note, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(observation_date, company, source_kind) DO NOTHING`).bind(row.observationDate, row.company, row.valueBp, row.sourceKind, row.sourceLabel, row.note, row.importedAt)),
    ...seed.iceObservations.flatMap((row) => [
      db.prepare(`INSERT INTO ice_eod_revisions (clearing_date, company, ice_name, instrument_name, eod_price, coupon_bp, payload_hash, retrieved_at, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(clearing_date, company, instrument_name, payload_hash) DO NOTHING`).bind(row.clearingDate, row.company, row.iceName, row.instrumentName, row.eodPrice, row.couponBp, row.payloadHash, row.retrievedAt, row.sourceUrl),
      db.prepare(`INSERT INTO ice_eod_current (clearing_date, company, revision_id) SELECT ?, ?, revision_id FROM ice_eod_revisions WHERE clearing_date = ? AND company = ? AND instrument_name = ? AND payload_hash = ? ON CONFLICT(clearing_date, company) DO UPDATE SET revision_id = excluded.revision_id WHERE (SELECT retrieved_at FROM ice_eod_revisions WHERE revision_id = excluded.revision_id) >= (SELECT retrieved_at FROM ice_eod_revisions WHERE revision_id = ice_eod_current.revision_id)`).bind(row.clearingDate, row.company, row.clearingDate, row.company, row.instrumentName, row.payloadHash),
    ]),
    ...seed.treasuryCurves.flatMap((curve) => [
      db.prepare(`INSERT INTO treasury_curves (curve_id, as_of, currency, source_label, source_url, retrieved_at, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(curve_id) DO NOTHING`).bind(curve.curveId, curve.asOf, curve.currency, curve.sourceLabel, curve.sourceUrl, curve.retrievedAt, curve.payloadHash),
      ...curve.nodes.map((node) => db.prepare(`INSERT INTO treasury_curve_nodes (curve_id, years, zero_rate) VALUES (?, ?, ?) ON CONFLICT(curve_id, years) DO NOTHING`).bind(curve.curveId, node.years, node.zeroRate)),
    ]),
    ...seed.derivedSpreads.map((row) => db.prepare(`INSERT INTO cds_spread_revisions (clearing_date, company, ice_revision_id, curve_id, instrument_name, maturity_date, eod_price, coupon_bp, spread_bp, round_trip_price, price_residual, hazard_rate, recovery_rate, model_version, quality_status, created_at) SELECT ?, ?, revision_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM ice_eod_revisions WHERE clearing_date = ? AND company = ? AND instrument_name = ? AND payload_hash = ? ON CONFLICT(clearing_date, company, ice_revision_id, curve_id, model_version) DO NOTHING`).bind(row.clearingDate, row.company, row.curveId, row.instrumentName, row.maturityDate, row.eodPrice, row.couponBp, row.spreadBp, row.roundTripPrice, row.priceResidual, row.hazardRate, row.recoveryRate, row.modelVersion, row.qualityStatus, row.createdAt, row.clearingDate, row.company, row.instrumentName, row.icePayloadHash)),
    ...seed.publishedBatches.flatMap((batch) => [
      db.prepare(`INSERT INTO published_batches (batch_id, clearing_date, revision, published_at, source_kind, quality_status) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(clearing_date, revision) DO NOTHING`).bind(batch.batchId, batch.clearingDate, batch.revision, batch.publishedAt, batch.sourceKind, batch.qualityStatus),
      ...batch.rows.map((row) => db.prepare(`INSERT INTO published_batch_rows (batch_id, company, spread_revision_id) SELECT batches.batch_id, ?, spreads.spread_revision_id FROM published_batches AS batches JOIN cds_spread_revisions AS spreads ON spreads.clearing_date = batches.clearing_date AND spreads.company = ? JOIN ice_eod_revisions AS ice ON ice.revision_id = spreads.ice_revision_id WHERE batches.clearing_date = ? AND batches.revision = ? AND ice.payload_hash = ? ON CONFLICT(batch_id, company) DO NOTHING`).bind(row.company, row.company, batch.clearingDate, batch.revision, row.icePayloadHash)),
      db.prepare(`INSERT INTO published_batch_current (clearing_date, batch_id) SELECT clearing_date, batch_id FROM published_batches WHERE clearing_date = ? AND revision = ? ON CONFLICT(clearing_date) DO UPDATE SET batch_id = excluded.batch_id`).bind(batch.clearingDate, batch.revision),
    ]),
  ];
  if (statements.length > 0) await db.batch(statements);
  return {
    screenshotHistory: section(seed.screenshotHistory.length - existing.screenshotHistory.filter(Boolean).length, seed.screenshotHistory.length),
    iceObservations: section(seed.iceObservations.length - existing.iceObservations.filter(Boolean).length, seed.iceObservations.length),
    treasuryCurves: section(seed.treasuryCurves.length - existing.treasuryCurves.filter(Boolean).length, seed.treasuryCurves.length),
    derivedSpreads: section(seed.derivedSpreads.length - existing.derivedSpreads.filter(Boolean).length, seed.derivedSpreads.length),
    publishedBatches: section(seed.publishedBatches.length - existing.publishedBatches.filter(Boolean).length, seed.publishedBatches.length),
  };
}
