import { parseIceInstrumentName } from './domain/contracts';
import { ICE_CDS_CONTRACT_REGISTRY, TRACKED_COMPANIES } from './domain/registry';
import type { Company, IceObservation, ManualImportInput, TreasuryCurve } from './types';

export class ManualImportValidationError extends Error {}

const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const stringValue = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const validIsoTimestamp = (value: unknown): value is string => stringValue(value) && !Number.isNaN(Date.parse(value));

const allowedSource = (value: unknown, host: string): value is string => {
  if (!stringValue(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host;
  } catch {
    return false;
  }
};

const isCompany = (value: unknown): value is Company => TRACKED_COMPANIES.includes(value as Company);

const validateObservation = (value: unknown, clearingDate: string): IceObservation => {
  const row = value as Record<string, unknown> | null;
  if (!row || row.clearingDate !== clearingDate || !isCompany(row.company)
    || !stringValue(row.iceName) || !stringValue(row.instrumentName)
    || !Number.isFinite(row.eodPrice) || Number(row.eodPrice) < 0
    || !Number.isFinite(row.couponBp) || Number(row.couponBp) <= 0
    || !stringValue(row.payloadHash) || !validIsoTimestamp(row.retrievedAt)
    || !allowedSource(row.sourceUrl, 'www.ice.com')) {
    throw new ManualImportValidationError('Manual import is invalid');
  }
  const contract = parseIceInstrumentName(row.instrumentName);
  const registry = ICE_CDS_CONTRACT_REGISTRY.find((definition) => definition.company === row.company);
  const tenorYears = (Date.parse(`${contract.maturityDate}T00:00:00.000Z`) - Date.parse(`${clearingDate}T00:00:00.000Z`)) / (365.25 * 24 * 60 * 60 * 1000);
  if (!registry || contract.couponBp !== Number(row.couponBp)
    || contract.couponBp !== registry.couponBp || !registry.symbols.includes(contract.symbol)
    || contract.currency !== registry.currency || contract.tier !== registry.tier
    || contract.restructuring !== registry.restructuring || tenorYears < 4.5 || tenorYears > 5.5) {
    throw new ManualImportValidationError('Manual import is invalid');
  }
  return {
    clearingDate,
    company: row.company,
    iceName: row.iceName.trim(),
    instrumentName: row.instrumentName.trim().toUpperCase(),
    eodPrice: Number(row.eodPrice),
    couponBp: Number(row.couponBp),
    payloadHash: row.payloadHash.trim(),
    retrievedAt: row.retrievedAt,
    sourceUrl: row.sourceUrl,
  };
};

const validateCurve = (value: unknown, clearingDate: string): TreasuryCurve => {
  const curve = value as Record<string, unknown> | null;
  const nodes = Array.isArray(curve?.nodes) ? curve.nodes : null;
  if (!curve || !stringValue(curve.curveId) || !validDate(curve.asOf) || curve.asOf > clearingDate
    || curve.currency !== 'USD' || !stringValue(curve.sourceLabel) || !allowedSource(curve.sourceUrl, 'home.treasury.gov')
    || !validIsoTimestamp(curve.retrievedAt) || !stringValue(curve.payloadHash) || !nodes || nodes.length === 0) {
    throw new ManualImportValidationError('Manual import is invalid');
  }
  const parsedNodes = nodes.map((node) => {
    const valueNode = node as Record<string, unknown> | null;
    if (!valueNode || !Number.isFinite(valueNode.years) || Number(valueNode.years) <= 0 || !Number.isFinite(valueNode.zeroRate)) {
      throw new ManualImportValidationError('Manual import is invalid');
    }
    return { years: Number(valueNode.years), zeroRate: Number(valueNode.zeroRate) };
  });
  if (new Set(parsedNodes.map((node) => node.years)).size !== parsedNodes.length) {
    throw new ManualImportValidationError('Manual import is invalid');
  }
  return {
    curveId: curve.curveId.trim(), asOf: curve.asOf, currency: 'USD', sourceLabel: curve.sourceLabel.trim(),
    sourceUrl: curve.sourceUrl, retrievedAt: curve.retrievedAt, payloadHash: curve.payloadHash.trim(), nodes: parsedNodes,
  };
};

/** Validates the only accepted emergency-import shape: one previewed seven-company date and its Treasury curve. */
export function parseManualImport(value: unknown): ManualImportInput {
  const body = value as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.observations) || body.observations.length !== TRACKED_COMPANIES.length) {
    throw new ManualImportValidationError('Manual import is invalid');
  }
  const dates = [...new Set(body.observations.map((row) => (row as Record<string, unknown> | null)?.clearingDate))];
  const clearingDate = dates[0];
  if (dates.length !== 1 || !validDate(clearingDate)) throw new ManualImportValidationError('Manual import is invalid');
  const observations = body.observations.map((row) => validateObservation(row, clearingDate));
  if (new Set(observations.map((row) => row.company)).size !== TRACKED_COMPANIES.length
    || !TRACKED_COMPANIES.every((company) => observations.some((row) => row.company === company))) {
    throw new ManualImportValidationError('Manual import is invalid');
  }
  const byCompany = new Map(observations.map((row) => [row.company, row]));
  return {
    observations: TRACKED_COMPANIES.map((company) => byCompany.get(company)!),
    treasuryCurve: validateCurve(body.treasuryCurve, clearingDate),
  };
}
