import { describe, expect, it } from 'vitest';
import completeFixture from './fixtures/ice-complete.json';
import partialFixture from './fixtures/ice-partial.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import incompleteTreasuryFixture from './fixtures/treasury-incomplete.csv?raw';
import { fetchIceObservations } from '../src/sources/ice';
import { fetchTreasuryCurve } from '../src/sources/treasury';
import { fetchFixedSource } from '../src/sources/http';
import { normalizeIcePayload, selectTrackedFiveYearContracts } from '../src/domain/contracts';

const response = (body: BodyInit, contentType: string, status = 200, headers: HeadersInit = {}) => new Response(body, {
  status,
  headers: { 'content-type': contentType, ...headers },
});

const fetchFixture = (iceBody: BodyInit = JSON.stringify(completeFixture), treasuryBody: BodyInit = treasuryFixture) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return url.includes('icc-single-names')
      ? response(iceBody, 'application/json; charset=utf-8')
      : response(treasuryBody, 'text/csv; charset=utf-8');
  };
  return { fetchImpl, calls };
};

describe('fixed source boundary', () => {
  it('rejects non-HTTPS URLs, redirects, and unsafe content types with stable codes', async () => {
    await expect(fetchFixedSource(async () => response('{}', 'application/json'), 'http://www.ice.com/path', {
      acceptedContentTypes: ['application/json'], maxBytes: 100,
    })).rejects.toMatchObject({ code: 'SOURCE_URL_NOT_ALLOWED' });

    await expect(fetchFixedSource(async () => response('{}', 'text/html'), 'https://www.ice.com/path', {
      acceptedContentTypes: ['application/json'], maxBytes: 100,
    })).rejects.toMatchObject({ code: 'SOURCE_CONTENT_TYPE_INVALID' });

    await expect(fetchFixedSource(async () => response('', 'application/json', 302, { location: 'https://evil.test' }), 'https://www.ice.com/path', {
      acceptedContentTypes: ['application/json'], maxBytes: 100,
    })).rejects.toMatchObject({ code: 'SOURCE_HTTP_STATUS' });
  });

  it('uses redirect errors, abort signals, and streaming byte ceilings without exposing body text', async () => {
    const largeIce = new Uint8Array(8 * 1024 * 1024 + 1);
    const secret = 'private-upstream-body';
    await expect(fetchFixedSource(async () => response(largeIce, 'application/json'), 'https://www.ice.com/path', {
      acceptedContentTypes: ['application/json'], maxBytes: 8 * 1024 * 1024,
    })).rejects.toMatchObject({ code: 'SOURCE_RESPONSE_TOO_LARGE' });
    await expect(fetchFixedSource(async () => response(secret, 'application/json', 500), 'https://www.ice.com/path', {
      acceptedContentTypes: ['application/json'], maxBytes: 100,
    })).rejects.not.toThrow(secret);

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return response('{}', 'application/json');
    };
    await fetchFixedSource(fetchImpl, 'https://www.ice.com/path', {
      acceptedContentTypes: ['application/json'], maxBytes: 100, timeoutMs: 50,
    });
    expect(calls[0].init?.redirect).toBe('error');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a source request at its deadline and returns the stable timeout code', async () => {
    let observedAbort = false;
    const neverResponds: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        observedAbort = true;
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });
    await expect(fetchFixedSource(neverResponds, 'https://www.ice.com/path', {
      acceptedContentTypes: ['application/json'], maxBytes: 100, timeoutMs: 1,
    })).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT' });
    expect(observedAbort).toBe(true);
  });
});

describe('ICE and Treasury sources', () => {
  it('normalizes complete ICE data, selects one canonical five-year contract per tracked company, and hashes rows', async () => {
    const { fetchImpl } = fetchFixture();
    const result = await fetchIceObservations(fetchImpl, new Date('2026-08-25T00:00:00.000Z'));
    expect(result.rows).toHaveLength(7);
    expect(result.rows.map((row) => row.company)).toEqual([
      'Oracle', 'CoreWeave', 'NVIDIA', 'Amazon', 'Google', 'Microsoft', 'Meta',
    ]);
    expect(result.rows.every((row) => /^[a-f0-9]{64}$/.test(row.payloadHash))).toBe(true);
    expect(result.rows.find((row) => row.company === 'Oracle')?.instrumentName).toContain('2031-06-20');
  });

  it('records currently visible partial ICE days rather than requiring a seven-company batch', async () => {
    const { fetchImpl } = fetchFixture(JSON.stringify(partialFixture));
    const result = await fetchIceObservations(fetchImpl, new Date('2026-08-26T00:00:00.000Z'));
    expect(result.rows.map((row) => row.company)).toEqual(['Oracle', 'NVIDIA']);
    expect(result.partialDates).toEqual([{ clearingDate: '2026-08-25', missingCompanies: [
      'CoreWeave', 'Amazon', 'Google', 'Microsoft', 'Meta',
    ] }]);
  });

  it('rejects malformed ICE payload fields and reports selection ambiguity', () => {
    expect(() => normalizeIcePayload([{ ...completeFixture[0], clearingDate: '2026-02-30' }], '2026-08-25T00:00:00.000Z')).toThrow(/invalid/i);
    const rows = normalizeIcePayload([
      ...completeFixture.slice(0, 1),
      { ...completeFixture[0], instrumentName: 'ORCLE.SNRFOR.USD.XR14.100.2031-06-21' },
    ], '2026-08-25T00:00:00.000Z');
    expect(selectTrackedFiveYearContracts(rows, '2026-08-24').errors).toContainEqual(
      expect.objectContaining({ company: 'Oracle', code: 'ambiguous-contract' }),
    );
  });

  it('chooses the latest Treasury curve not after the clearing date, hashes ordered nodes, and rejects future-only curves', async () => {
    const { fetchImpl } = fetchFixture();
    const curve = await fetchTreasuryCurve(fetchImpl, '2026-08-24', new Date('2026-08-25T00:00:00.000Z'));
    expect(curve.asOf).toBe('2026-08-24');
    expect(curve.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(curve.nodes[0]).toEqual({ years: 1 / 12, zeroRate: 0.0379 });
    const onlyFuture = treasuryFixture.replace('08/24/2026', '08/25/2026').replace('08/21/2026', '08/25/2026');
    await expect(fetchTreasuryCurve(fetchFixture(JSON.stringify(completeFixture), onlyFuture).fetchImpl, '2026-08-24', new Date()))
      .rejects.toMatchObject({ code: 'TREASURY_CURVE_UNAVAILABLE' });
  });

  it('enforces the two MiB Treasury CSV limit', async () => {
    const hugeCsv = `${treasuryFixture}\n${'x'.repeat(2 * 1024 * 1024)}`;
    await expect(fetchTreasuryCurve(fetchFixture(JSON.stringify(completeFixture), hugeCsv).fetchImpl, '2026-08-24', new Date()))
      .rejects.toMatchObject({ code: 'SOURCE_RESPONSE_TOO_LARGE' });
  });

  it('does not turn blank required Treasury maturity cells into zero-rate nodes', async () => {
    await expect(fetchTreasuryCurve(
      fetchFixture(JSON.stringify(completeFixture), incompleteTreasuryFixture).fetchImpl,
      '2026-08-24', new Date(),
    )).rejects.toMatchObject({ code: 'TREASURY_CURVE_UNAVAILABLE' });
  });

  it('makes Treasury curve identity reproducible by full same-day content', async () => {
    const first = await fetchTreasuryCurve(fetchFixture().fetchImpl, '2026-08-24', new Date('2026-08-25T00:00:00.000Z'));
    const replay = await fetchTreasuryCurve(fetchFixture().fetchImpl, '2026-08-24', new Date('2026-08-25T01:00:00.000Z'));
    const revisedCsv = treasuryFixture.replace('08/24/2026,3.79,3.78,3.80,3.87,3.90,3.96,4.04,4.24,4.31,4.41', '08/24/2026,3.79,3.78,3.80,3.87,3.90,3.96,4.04,4.24,4.31,4.99');
    const revised = await fetchTreasuryCurve(fetchFixture(JSON.stringify(completeFixture), revisedCsv).fetchImpl, '2026-08-24', new Date('2026-08-25T02:00:00.000Z'));
    expect(replay.curveId).toBe(first.curveId);
    expect(revised.asOf).toBe(first.asOf);
    expect(revised.curveId).not.toBe(first.curveId);
    expect(revised.payloadHash).not.toBe(first.payloadHash);
  });
});
