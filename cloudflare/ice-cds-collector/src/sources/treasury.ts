import type { TreasuryCurve, TreasuryCurveNode } from '../types';
import { FixedSourceError, fetchFixedSource } from './http';

export const TREASURY_CURVE_SOURCE_URL = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates';
const TREASURY_MAX_BYTES = 2 * 1024 * 1024;
const CURVE_COLUMNS: ReadonlyArray<readonly [string, number]> = [
  ['1 Mo', 1 / 12], ['1.5 Month', 0.125], ['2 Mo', 1 / 6], ['3 Mo', 0.25], ['4 Mo', 1 / 3], ['6 Mo', 0.5], ['1 Yr', 1], ['2 Yr', 2], ['3 Yr', 3], ['5 Yr', 5], ['7 Yr', 7], ['10 Yr', 10], ['20 Yr', 20], ['30 Yr', 30],
];

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const treasuryCsvUrl = (year: number): string => `${TREASURY_CURVE_SOURCE_URL}/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page=&_format=csv`;
const parseCsvLine = (line: string): string[] => {
  const values: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) { const character = line[index]; if (quoted) { if (character === '"' && line[index + 1] === '"') { value += '"'; index += 1; } else if (character === '"') quoted = false; else value += character; } else if (character === '"' && value.length === 0) quoted = true; else if (character === ',') { values.push(value.trim()); value = ''; } else value += character; }
  if (quoted) throw new FixedSourceError('TREASURY_CSV_INVALID', 'Treasury CSV has invalid quoting'); values.push(value.trim()); return values;
};
const treasuryDate = (value: string | undefined): string | null => {
  const match = String(value ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!match) return null;
  const iso = `${match[3]}-${match[1]}-${match[2]}`; return validDate(iso) ? iso : null;
};
const sha256 = async (value: unknown): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export async function fetchTreasuryCurve(fetchImpl: typeof fetch, clearingDate: string, now: Date): Promise<TreasuryCurve> {
  if (!validDate(clearingDate)) throw new FixedSourceError('TREASURY_CLEARING_DATE_INVALID', 'Treasury clearing date is invalid');
  const sourceUrl = treasuryCsvUrl(Number(clearingDate.slice(0, 4)));
  const csv = await fetchFixedSource(fetchImpl, sourceUrl, { acceptedContentTypes: ['text/csv'], maxBytes: TREASURY_MAX_BYTES, allowedHost: 'home.treasury.gov' });
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new FixedSourceError('TREASURY_CSV_INVALID', 'Treasury CSV is empty');
  const headers = parseCsvLine(lines[0]); const headerIndex = new Map(headers.map((header, index) => [header, index]));
  if (!headerIndex.has('Date') || CURVE_COLUMNS.some(([column]) => !headerIndex.has(column))) throw new FixedSourceError('TREASURY_CSV_INVALID', 'Treasury CSV is missing required maturities');
  const dateIndex = headerIndex.get('Date');
  if (dateIndex === undefined) throw new FixedSourceError('TREASURY_CSV_INVALID', 'Treasury CSV is missing its date column');
  const candidates = lines.slice(1).flatMap((line) => {
    const values = parseCsvLine(line); const asOf = treasuryDate(values[dateIndex]); if (!asOf || asOf > clearingDate) return [];
    const nodes: TreasuryCurveNode[] = CURVE_COLUMNS.map(([column, years]) => {
      const token = values[headerIndex.get(column)!]?.trim();
      return { years, zeroRate: token ? Number(token) / 100 : Number.NaN };
    });
    return nodes.some((node) => !Number.isFinite(node.zeroRate)) ? [] : [{ asOf, nodes }];
  }).sort((left, right) => right.asOf.localeCompare(left.asOf));
  if (candidates.length === 0) throw new FixedSourceError('TREASURY_CURVE_UNAVAILABLE', 'No Treasury curve is available on or before the clearing date');
  const selected = candidates[0]; const payloadHash = await sha256({ asOf: selected.asOf, nodes: selected.nodes });
  return { curveId: `ust-par-zero-proxy-${selected.asOf}-${payloadHash}`, asOf: selected.asOf, currency: 'USD', sourceLabel: 'U.S. Treasury par yields · continuous-zero proxy', sourceUrl: TREASURY_CURVE_SOURCE_URL, retrievedAt: now.toISOString(), payloadHash, nodes: selected.nodes };
}
