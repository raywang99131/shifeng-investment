import type { Company, IceObservation } from '../types';
import { ICE_CDS_CONTRACT_REGISTRY } from './registry';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class ContractValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = 'INVALID_ICE_PAYLOAD') {
    super(message);
    this.name = 'ContractValidationError';
    this.code = code;
  }
}

export interface ParsedIceInstrument {
  symbol: string;
  tier: string;
  currency: string;
  restructuring: string;
  couponBp: number;
  maturityDate: string;
}

export interface NormalizedIceRow {
  clearingDate: string;
  name: string;
  instrumentName: string;
  eodPrice: number;
  retrievedAt: string;
  rowNumber: number;
}

export interface SelectedIceContract extends NormalizedIceRow {
  company: Company;
  contract: ParsedIceInstrument;
  tenorYears: number;
}

export interface ContractSelectionError {
  company: Company;
  code: 'missing-issuer' | 'no-canonical-contract' | 'ambiguous-contract';
  message: string;
  candidateRows: number[];
}

export interface ContractSelection {
  selected: SelectedIceContract[];
  errors: ContractSelectionError[];
}

const validDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const normalizeName = (value: unknown): string => String(value ?? '')
  .normalize('NFKC')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const yearsBetween = (startDate: string, endDate: string): number => (
  (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / MS_PER_DAY / 365.25
);

export function parseIceInstrumentName(value: unknown): ParsedIceInstrument {
  const instrumentName = String(value ?? '').trim().toUpperCase();
  const match = instrumentName.match(/^([^.]+)\.([^.]+)\.([A-Z]{3})\.([^.]+)\.(\d+(?:\.\d+)?)\.(\d{4}-\d{2}-\d{2})$/);
  if (!match || !validDate(match[6])) throw new ContractValidationError('ICE instrument is invalid');
  const couponBp = Number(match[5]);
  if (!Number.isFinite(couponBp) || couponBp <= 0) throw new ContractValidationError('ICE instrument coupon is invalid');
  return { symbol: match[1], tier: match[2], currency: match[3], restructuring: match[4], couponBp, maturityDate: match[6] };
}

export function normalizeIcePayload(payload: unknown, retrievedAt: string): NormalizedIceRow[] {
  if (!Array.isArray(payload)) throw new ContractValidationError('ICE payload must be an array');
  if (Number.isNaN(Date.parse(retrievedAt))) throw new ContractValidationError('ICE retrieval timestamp is invalid');
  const rows = payload.map((raw, index) => {
    const row = raw as Record<string, unknown> | null;
    const clearingDate = String(row?.clearingDate ?? '').trim();
    const name = String(row?.name ?? '').trim();
    const instrumentName = String(row?.instrumentName ?? '').trim();
    const eodPrice = Number(row?.eodPrice);
    if (!validDate(clearingDate) || !name || !instrumentName || !Number.isFinite(eodPrice) || eodPrice < 0) {
      throw new ContractValidationError(`ICE row ${index + 1} is invalid`);
    }
    parseIceInstrumentName(instrumentName);
    // The public source has no header row; preserve the server's display-row convention.
    return { clearingDate, name, instrumentName, eodPrice, retrievedAt, rowNumber: index + 2 };
  });
  if (rows.length === 0) throw new ContractValidationError('ICE payload is empty', 'EMPTY_ICE_PAYLOAD');
  return rows;
}

export function selectTrackedFiveYearContracts(rows: NormalizedIceRow[], clearingDate: string): ContractSelection {
  if (!Array.isArray(rows)) throw new ContractValidationError('ICE rows must be an array');
  if (!validDate(clearingDate)) throw new ContractValidationError('ICE clearing date is invalid');
  const selected: SelectedIceContract[] = [];
  const errors: ContractSelectionError[] = [];
  const datedRows = rows.filter((row) => row.clearingDate === clearingDate);
  for (const definition of ICE_CDS_CONTRACT_REGISTRY) {
    const acceptedNames = new Set([definition.company, ...definition.aliases].map(normalizeName));
    const issuerRows = datedRows.filter((row) => acceptedNames.has(normalizeName(row.name)));
    if (issuerRows.length === 0) {
      errors.push({ company: definition.company, code: 'missing-issuer', message: `No ${definition.company} rows for ${clearingDate}`, candidateRows: [] });
      continue;
    }
    const candidates = issuerRows.flatMap((row) => {
      let contract: ParsedIceInstrument;
      try { contract = parseIceInstrumentName(row.instrumentName); } catch { return []; }
      const tenorYears = yearsBetween(clearingDate, contract.maturityDate);
      const matches = definition.symbols.includes(contract.symbol)
        && contract.currency === definition.currency
        && contract.tier === definition.tier
        && contract.restructuring === definition.restructuring
        && contract.couponBp === definition.couponBp
        && tenorYears >= 4.5 && tenorYears <= 5.5;
      return matches ? [{ ...row, company: definition.company, contract, tenorYears }] : [];
    }).sort((left, right) => Math.abs(left.tenorYears - 5) - Math.abs(right.tenorYears - 5)
      || left.instrumentName.localeCompare(right.instrumentName) || left.rowNumber - right.rowNumber);
    if (candidates.length === 0) {
      errors.push({ company: definition.company, code: 'no-canonical-contract', message: `No ${definition.company} row matches the registered 5Y contract`, candidateRows: issuerRows.map((row) => row.rowNumber) });
    } else if (candidates.length > 1) {
      errors.push({ company: definition.company, code: 'ambiguous-contract', message: `Multiple ${definition.company} rows match the registered 5Y contract`, candidateRows: candidates.map((row) => row.rowNumber) });
    } else selected.push(candidates[0]);
  }
  return { selected, errors };
}

export const toIceObservation = (row: SelectedIceContract, payloadHash: string, sourceUrl: string): IceObservation => ({
  clearingDate: row.clearingDate,
  company: row.company,
  iceName: row.name,
  instrumentName: row.instrumentName,
  eodPrice: row.eodPrice,
  couponBp: row.contract.couponBp,
  payloadHash,
  retrievedAt: row.retrievedAt,
  sourceUrl,
});
