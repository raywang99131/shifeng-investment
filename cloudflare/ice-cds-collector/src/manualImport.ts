import { parseIceInstrumentName } from './domain/contracts';
import { ICE_CDS_CONTRACT_REGISTRY, TRACKED_COMPANIES } from './domain/registry';
import { ICE_PUBLIC_URL } from './sources/ice';
import { TREASURY_CURVE_SOURCE_URL } from './sources/treasury';
import type { Company, IceObservation, ManualImportInput, TreasuryCurve } from './types';

export class ManualImportValidationError extends Error {}

const dayMs = 24 * 60 * 60 * 1000;
const maxImportAgeMs = 7 * dayMs;
const encoder = new TextEncoder();
const sha256 = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number); const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const stringValue = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validTimestamp = (value: unknown, now: Date): value is string => {
  if (!stringValue(value)) return false;
  const at = new Date(value);
  return !Number.isNaN(at.getTime()) && at.toISOString() === value && at.getTime() <= now.getTime() && at.getTime() >= now.getTime() - maxImportAgeMs;
};
const normalizedName = (value: string): string => value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const isCompany = (value: unknown): value is Company => TRACKED_COMPANIES.includes(value as Company);
const invalid = (): never => { throw new ManualImportValidationError('Manual import is invalid'); };

const validateObservation = async (value: unknown, clearingDate: string, now: Date): Promise<IceObservation> => {
  const row = value as Record<string, unknown> | null;
  if (!row || !exactKeys(row, ['clearingDate', 'company', 'iceName', 'instrumentName', 'eodPrice', 'couponBp', 'payloadHash', 'retrievedAt', 'sourceUrl'])
    || row.clearingDate !== clearingDate || !isCompany(row.company) || !stringValue(row.iceName) || !stringValue(row.instrumentName)
    || !Number.isFinite(row.eodPrice) || Number(row.eodPrice) < 0 || !Number.isFinite(row.couponBp) || Number(row.couponBp) <= 0
    || !stringValue(row.payloadHash) || !validTimestamp(row.retrievedAt, now) || row.sourceUrl !== ICE_PUBLIC_URL) invalid();
  const safe = row! as unknown as IceObservation;
  const contract = parseIceInstrumentName(safe.instrumentName);
  const registry = ICE_CDS_CONTRACT_REGISTRY.find((definition) => definition.company === safe.company);
  const tenorYears = (Date.parse(`${contract.maturityDate}T00:00:00.000Z`) - Date.parse(`${clearingDate}T00:00:00.000Z`)) / (365.25 * dayMs);
  const acceptedNames = new Set(registry ? [registry.company, ...registry.aliases].map((name) => normalizedName(name)) : []);
  if (!registry || !acceptedNames.has(normalizedName(safe.iceName)) || contract.couponBp !== Number(safe.couponBp)
    || contract.couponBp !== registry.couponBp || !registry.symbols.includes(contract.symbol) || contract.currency !== registry.currency
    || contract.tier !== registry.tier || contract.restructuring !== registry.restructuring || tenorYears < 4.5 || tenorYears > 5.5) invalid();
  const instrumentName = safe.instrumentName.trim().toUpperCase(); const eodPrice = Number(safe.eodPrice); const couponBp = Number(safe.couponBp);
  return { clearingDate, company: safe.company, iceName: safe.iceName.trim(), instrumentName, eodPrice, couponBp,
    payloadHash: await sha256({ clearingDate, company: safe.company, name: safe.iceName.trim(), instrumentName, eodPrice, couponBp }),
    retrievedAt: safe.retrievedAt, sourceUrl: ICE_PUBLIC_URL };
};

const validateCurve = async (value: unknown, clearingDate: string, now: Date): Promise<TreasuryCurve> => {
  const curve = value as Record<string, unknown> | null; const nodes = Array.isArray(curve?.nodes) ? curve.nodes : null;
  if (!curve || !exactKeys(curve, ['curveId', 'asOf', 'currency', 'sourceLabel', 'sourceUrl', 'retrievedAt', 'payloadHash', 'nodes'])
    || !stringValue(curve.curveId) || !validDate(curve.asOf) || curve.asOf > clearingDate || curve.currency !== 'USD'
    || !stringValue(curve.sourceLabel) || curve.sourceUrl !== TREASURY_CURVE_SOURCE_URL || !validTimestamp(curve.retrievedAt, now)
    || !stringValue(curve.payloadHash) || !nodes || nodes.length === 0) invalid();
  const parsedNodes = nodes!.map((node) => {
    const valueNode = node as Record<string, unknown> | null;
    if (!valueNode || !exactKeys(valueNode, ['years', 'zeroRate']) || !Number.isFinite(valueNode.years)
      || Number(valueNode.years) <= 0 || !Number.isFinite(valueNode.zeroRate)) invalid();
    const safeNode = valueNode! as { years: number; zeroRate: number };
    return { years: Number(safeNode.years), zeroRate: Number(safeNode.zeroRate) };
  }).sort((left, right) => left.years - right.years);
  if (new Set(parsedNodes.map((node) => node.years)).size !== parsedNodes.length) invalid();
  const safe = curve! as unknown as TreasuryCurve;
  const payloadHash = await sha256({ asOf: safe.asOf, nodes: parsedNodes });
  return { curveId: `ust-par-zero-proxy-${safe.asOf}-${payloadHash}`, asOf: safe.asOf, currency: 'USD', sourceLabel: safe.sourceLabel.trim(),
    sourceUrl: TREASURY_CURVE_SOURCE_URL, retrievedAt: safe.retrievedAt, payloadHash, nodes: parsedNodes };
};

/** Validates and canonicalizes the only accepted emergency-import shape. */
export async function parseManualImport(value: unknown, now: Date): Promise<ManualImportInput> {
  const body = value as Record<string, unknown> | null;
  if (!body || !exactKeys(body, ['observations', 'treasuryCurve']) || !Array.isArray(body.observations) || body.observations.length !== TRACKED_COMPANIES.length) invalid();
  const safe = body! as { observations: unknown[]; treasuryCurve: unknown };
  const dates = [...new Set(safe.observations.map((row) => (row as Record<string, unknown> | null)?.clearingDate))];
  const clearingDate = dates[0]; if (dates.length !== 1 || !validDate(clearingDate)) invalid();
  const safeDate = clearingDate as string;
  const observations = await Promise.all(safe.observations.map((row) => validateObservation(row, safeDate, now)));
  if (new Set(observations.map((row) => row.company)).size !== TRACKED_COMPANIES.length || !TRACKED_COMPANIES.every((company) => observations.some((row) => row.company === company))) invalid();
  const byCompany = new Map(observations.map((row) => [row.company, row]));
  return { observations: TRACKED_COMPANIES.map((company) => byCompany.get(company)!), treasuryCurve: await validateCurve(safe.treasuryCurve, safeDate, now) };
}
