import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import completeFixture from './fixtures/ice-complete.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import { collectOnce } from '../src/collector';
import { fetchIceObservations } from '../src/sources/ice';
import { fetchTreasuryCurve } from '../src/sources/treasury';
import type { Env } from '../src/types';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const READ_TOKEN = 'read-test-token';
const WRITE_TOKEN = 'write-test-token';

const authorise = (token: string): Headers => new Headers({ authorization: `Bearer ${token}` });

const fixtureFetch = (rows = completeFixture, treasury = treasuryFixture): typeof fetch => async (input) => {
  const url = String(input);
  if (url.startsWith('https://www.ice.com/api/cds-settlement-prices/icc-single-names')) {
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
  }
  if (url.startsWith('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/')) {
    return new Response(treasury, { headers: { 'content-type': 'text/csv' } });
  }
  throw new Error(`Unexpected fixture URL: ${url}`);
};

const request = (path: string, init?: RequestInit) => exports.default.fetch(`https://collector.test${path}`, init);

const seed = async () => {
  await collectOnce({ env: env as unknown as Env, triggerKind: 'manual', now: NOW, fetchImpl: fixtureFetch() });
};

const seedTwoRevisions = async () => {
  await seed();
  const corrected = completeFixture.map((row) => row.name === 'Oracle Cop'
    ? { ...row, eodPrice: '95.1309' }
    : row);
  await collectOnce({
    env: env as unknown as Env,
    triggerKind: 'manual',
    now: new Date('2026-08-25T13:00:00.000Z'),
    fetchImpl: fixtureFetch(corrected),
  });
};

describe('collector HTTP API', () => {
  it('leaves only liveness anonymous and never accepts a missing or malformed Bearer token', async () => {
    expect((await request('/healthz')).status).toBe(200);
    for (const headers of [undefined, new Headers({ authorization: 'read-test-token' }), new Headers({ authorization: 'Basic abc' })]) {
      const response = await request('/v1/cds/latest', { headers });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }
  });

  it('keeps read and write bearer roles separate', async () => {
    const readWithWriteToken = await request('/v1/cds/latest', { headers: authorise(WRITE_TOKEN) });
    expect(readWithWriteToken.status).toBe(401);

    const writeWithReadToken = await request('/internal/v1/cds/collect-now', {
      method: 'POST', headers: authorise(READ_TOKEN),
    });
    expect(writeWithReadToken.status).toBe(401);
  });

  it('returns the current complete batch in the fixed latest response shape', async () => {
    await seed();
    const response = await request('/v1/cds/latest', { headers: authorise(READ_TOKEN) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        asOf: '2026-08-24',
        revision: 1,
        sourceKind: 'ice_eod_isda',
        companies: [
          { company: 'Oracle', qualityStatus: 'model-derived' },
          { company: 'CoreWeave', qualityStatus: 'model-derived' },
          { company: 'NVIDIA', qualityStatus: 'model-derived' },
          { company: 'Amazon', qualityStatus: 'model-derived' },
          { company: 'Google', qualityStatus: 'model-derived' },
          { company: 'Microsoft', qualityStatus: 'model-derived' },
          { company: 'Meta', qualityStatus: 'model-derived' },
        ],
      },
    });
  });

  it('rejects invalid query parameters with a stable safe error', async () => {
    const response = await request('/v1/cds/history?from=2026-08-99&to=2026-08-24&limit=999&cursor=bad', {
      headers: authorise(READ_TOKEN),
    });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toBe('{"error":{"code":"INVALID_REQUEST","message":"Invalid request"}}');
    expect(text).not.toContain(READ_TOKEN);
    expect(text).not.toContain('SELECT');
    expect(text).not.toContain('upstream-body');
  });

  it('caps history at 366 settlement dates and validates its composite cursor', async () => {
    for (const path of [
      '/v1/cds/history?from=2026-01-01&to=2026-12-31&limit=367',
      '/v1/cds/history?from=2026-01-01&to=2026-12-31&limit=1&cursor=2026-08-24',
      '/v1/cds/history?from=2026-12-31&to=2026-01-01&limit=1',
    ]) {
      expect((await request(path, { headers: authorise(READ_TOKEN) })).status).toBe(400);
    }
  });

  it('paginates all batch revisions without losing equal-date corrections', async () => {
    await seedTwoRevisions();
    const first = await request('/v1/cds/history?from=2026-08-24&to=2026-08-24&limit=1', {
      headers: authorise(READ_TOKEN),
    });
    expect(first.status).toBe(200);
    const firstPage = await first.json<{ data: Array<{ revision: number }>; nextCursor: string | null }>();
    expect(firstPage).toEqual({ data: [expect.objectContaining({ revision: 1 })], nextCursor: '2026-08-24|1' });

    const second = await request(`/v1/cds/history?from=2026-08-24&to=2026-08-24&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`, {
      headers: authorise(READ_TOKEN),
    });
    expect(await second.json()).toEqual({ data: [expect.objectContaining({ revision: 2 })], nextCursor: null });
  });

  it('paginates raw audit export with an opaque numeric cursor', async () => {
    await seed();
    const first = await request('/v1/cds/export-source?limit=3', { headers: authorise(READ_TOKEN) });
    expect(first.status).toBe(200);
    const firstPage = await first.json<{ data: Array<{ revisionId: number }>; nextCursor: string | null }>();
    expect(firstPage.data).toHaveLength(3);
    expect(firstPage.nextCursor).toMatch(/^\d+$/);
    const second = await request(`/v1/cds/export-source?limit=3&cursor=${firstPage.nextCursor}`, { headers: authorise(READ_TOKEN) });
    const secondPage = await second.json<{ data: Array<{ revisionId: number }>; nextCursor: string | null }>();
    expect(secondPage.data).toHaveLength(3);
    expect(new Set([...firstPage.data, ...secondPage.data].map((row) => row.revisionId)).size).toBe(6);
  });

  it('forwards a validated seven-company manual import through the fixed durable object', async () => {
    const fetchImpl = fixtureFetch();
    const observations = (await fetchIceObservations(fetchImpl, NOW)).rows.map((row) => ({
      ...row, clearingDate: '2026-08-25', payloadHash: `${row.payloadHash}-manual`,
    }));
    const treasuryCurve = await fetchTreasuryCurve(fetchImpl, '2026-08-25', NOW);
    const response = await request('/internal/v1/cds/import', {
      method: 'POST',
      headers: new Headers({ ...Object.fromEntries(authorise(WRITE_TOKEN)), 'content-type': 'application/json' }),
      body: JSON.stringify({ observations, treasuryCurve }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rawWriteCount: 7, publishedDates: ['2026-08-25'] });
    const run = await env.DB.prepare(`SELECT trigger_kind, status FROM collector_runs ORDER BY rowid DESC LIMIT 1`)
      .first<{ trigger_kind: string; status: string }>();
    expect(run).toEqual({ trigger_kind: 'manual', status: 'success' });
  });

  it('rejects malformed and oversized internal import bodies before they can write data', async () => {
    const malformed = await request('/internal/v1/cds/import', {
      method: 'POST', headers: new Headers({ ...Object.fromEntries(authorise(WRITE_TOKEN)), 'content-type': 'application/json' }), body: '{}',
    });
    expect(malformed.status).toBe(400);

    const oversized = await request('/internal/v1/cds/import', {
      method: 'POST',
      headers: new Headers({ ...Object.fromEntries(authorise(WRITE_TOKEN)), 'content-length': '131073' }),
      body: '{}',
    });
    expect(oversized.status).toBe(400);
  });
});
