import { normalizeIcePayload, selectTrackedFiveYearContracts, toIceObservation } from '../domain/contracts';
import { TRACKED_COMPANIES } from '../domain/registry';
import type { Company, IceObservation } from '../types';
import { FixedSourceError, fetchFixedSource } from './http';

export const ICE_PUBLIC_URL = 'https://www.ice.com/api/cds-settlement-prices/icc-single-names';
const ICE_MAX_BYTES = 8 * 1024 * 1024;

export interface IceFetchResult {
  rows: IceObservation[];
  partialDates: Array<{ clearingDate: string; missingCompanies: Company[] }>;
  retrievedAt: string;
}

const sha256 = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export async function fetchIceObservations(fetchImpl: typeof fetch, now: Date): Promise<IceFetchResult> {
  const retrievedAt = now.toISOString();
  const body = await fetchFixedSource(fetchImpl, ICE_PUBLIC_URL, {
    acceptedContentTypes: ['application/json'], maxBytes: ICE_MAX_BYTES, allowedHost: 'www.ice.com',
  });
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { throw new FixedSourceError('ICE_PAYLOAD_INVALID', 'ICE payload is not valid JSON'); }
  const normalized = normalizeIcePayload(payload, retrievedAt);
  const dates = [...new Set(normalized.map((row) => row.clearingDate))].sort();
  const rows: IceObservation[] = [];
  const partialDates: IceFetchResult['partialDates'] = [];
  for (const clearingDate of dates) {
    const selection = selectTrackedFiveYearContracts(normalized, clearingDate);
    const selectedCompanies = new Set(selection.selected.map((row) => row.company));
    const missingCompanies = TRACKED_COMPANIES.filter((company) => !selectedCompanies.has(company));
    if (missingCompanies.length > 0) partialDates.push({ clearingDate, missingCompanies });
    for (const selected of selection.selected) {
      const payloadHash = await sha256({
        clearingDate: selected.clearingDate,
        company: selected.company,
        name: selected.name,
        instrumentName: selected.instrumentName,
        eodPrice: selected.eodPrice,
        couponBp: selected.contract.couponBp,
      });
      rows.push(toIceObservation(selected, payloadHash, ICE_PUBLIC_URL));
    }
  }
  return { rows, partialDates, retrievedAt };
}
