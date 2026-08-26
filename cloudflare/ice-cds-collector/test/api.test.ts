import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import completeFixture from './fixtures/ice-complete.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import { collectOnce } from '../src/collector';
import { fetchIceObservations } from '../src/sources/ice';
import { fetchTreasuryCurve } from '../src/sources/treasury';
import { constantTimeBearerEquals } from '../src/auth';
import { handleApiRequest } from '../src/api';
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

const decodeExportCursor = (cursor: string): Record<string, unknown> => {
  const value = cursor.slice(3).replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(value.padEnd(value.length + (4 - value.length % 4) % 4, '='))) as Record<string, unknown>;
};
const encodeExportCursor = (value: unknown): string => `v1.${btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;

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
    expect(firstPage).toEqual({ data: [expect.objectContaining({ revision: 1, companies: expect.arrayContaining([
      expect.objectContaining({ company: 'Oracle' }),
    ]) })], nextCursor: '2026-08-24|1' });

    const second = await request(`/v1/cds/history?from=2026-08-24&to=2026-08-24&limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`, {
      headers: authorise(READ_TOKEN),
    });
    expect(await second.json()).toEqual({ data: [expect.objectContaining({ revision: 2, companies: expect.any(Array) })], nextCursor: null });
  });

  it('paginates all reconstructable audit sections with an opaque section/key cursor', async () => {
    await seed();
    await env.DB.prepare(`
      INSERT INTO seed_history (observation_date, company, value_bp, source_kind, source_label, note, imported_at)
      VALUES ('2026-08-21', 'Oracle', 160, 'screenshot_backfill', 'Screenshot', 'seed', '2026-08-25T00:00:00.000Z')
    `).run();
    const first = await request('/v1/cds/export-source?limit=3', { headers: authorise(READ_TOKEN) });
    expect(first.status).toBe(200);
    const firstPage = await first.json<{ data: Array<{ section: string; record: { revisionId?: number } }>; nextCursor: string | null }>();
    expect(firstPage.data).toHaveLength(3);
    expect(firstPage.data.every((entry) => entry.section === 'ice_eod_revisions')).toBe(true);
    expect(firstPage.nextCursor).toMatch(/^v1\./);
    const second = await request(`/v1/cds/export-source?limit=3&cursor=${firstPage.nextCursor}`, { headers: authorise(READ_TOKEN) });
    const secondPage = await second.json<{ data: Array<{ section: string; record: { revisionId?: number } }>; nextCursor: string | null }>();
    expect(secondPage.data).toHaveLength(3);
    expect(new Set([...firstPage.data, ...secondPage.data].map((row) => row.record.revisionId)).size).toBe(6);

    const sections = new Set(firstPage.data.map((entry) => entry.section));
    let cursor = secondPage.nextCursor;
    while (cursor) {
      const page = await request(`/v1/cds/export-source?limit=500&cursor=${encodeURIComponent(cursor)}`, { headers: authorise(READ_TOKEN) });
      const body = await page.json<{ data: Array<{ section: string }>; nextCursor: string | null }>();
      body.data.forEach((entry) => sections.add(entry.section));
      cursor = body.nextCursor;
    }
    expect(sections).toEqual(new Set([
      'ice_eod_revisions', 'ice_eod_current', 'treasury_curves', 'cds_spread_revisions',
      'published_batches', 'published_batch_current', 'seed_history',
    ]));
  });

  it('rejects malformed decoded export cursors as invalid requests before any data-store failure', async () => {
    const response = await request(`/v1/cds/export-source?cursor=v1.${btoa('{}')}`, { headers: authorise(READ_TOKEN) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
  });

  it('requires exact typed export cursor objects and rejects keys beyond their snapshot watermark', async () => {
    await seed();
    const initial = await request('/v1/cds/export-source?limit=1', { headers: authorise(READ_TOKEN) });
    const { nextCursor } = await initial.json<{ nextCursor: string }>();
    const valid = decodeExportCursor(nextCursor);
    const watermarks = valid.watermarks as Record<string, number>;
    const section = valid.section as string;
    const malformed = [
      { ...valid, extra: true },
      { ...valid, pointers: { ...(valid.pointers as Record<string, unknown>), extra: true } },
      { ...valid, watermarks: { ...watermarks, extra: 0 } },
      { ...valid, key: watermarks[section] + 1 },
      { ...valid, key: '1' },
    ];
    for (const cursor of malformed) {
      const response = await request(`/v1/cds/export-source?cursor=${encodeURIComponent(encodeExportCursor(cursor))}`, { headers: authorise(READ_TOKEN) });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
    }
  });

  it('keeps an export page sequence pinned to its first-page append-only watermark', async () => {
    await seed();
    const first = await request('/v1/cds/export-source?limit=1', { headers: authorise(READ_TOKEN) });
    const firstPage = await first.json<{ data: Array<{ section: string; record: { revisionId?: number } }>; nextCursor: string }>();
    await env.DB.prepare(`
      INSERT INTO ice_eod_revisions (clearing_date, company, ice_name, instrument_name, eod_price, coupon_bp, payload_hash, retrieved_at, source_url)
      VALUES ('2026-08-26', 'Oracle', 'Oracle Cop', 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20', 95, 100, 'late-export-row', '2026-08-25T12:00:00.000Z', 'https://www.ice.com/api/cds-settlement-prices/icc-single-names')
    `).run();
    const inserted = await env.DB.prepare(`SELECT MAX(revision_id) AS id FROM ice_eod_revisions`).first<{ id: number }>();
    const entries = [...firstPage.data];
    let cursor: string | null = firstPage.nextCursor;
    while (cursor) {
      const page = await request(`/v1/cds/export-source?limit=500&cursor=${encodeURIComponent(cursor)}`, { headers: authorise(READ_TOKEN) });
      expect(page.status).toBe(200);
      const body = await page.json<{ data: Array<{ section: string; record: { revisionId?: number } }>; nextCursor: string | null }>();
      entries.push(...body.data); cursor = body.nextCursor;
    }
    const rawIds = entries.filter((entry) => entry.section === 'ice_eod_revisions').map((entry) => entry.record.revisionId);
    expect(rawIds).not.toContain(inserted?.id);
    expect(new Set(rawIds).size).toBe(rawIds.length);
  });

  it('requires a fresh export when current-pointer state changes between pages', async () => {
    await seedTwoRevisions();
    const first = await request('/v1/cds/export-source?limit=1', { headers: authorise(READ_TOKEN) });
    const firstPage = await first.json<{ nextCursor: string }>();
    const current = await env.DB.prepare(`
      SELECT current.clearing_date, MIN(revisions.revision_id) AS revision_id
      FROM ice_eod_current AS current
      JOIN ice_eod_revisions AS revisions ON revisions.clearing_date = current.clearing_date AND revisions.company = current.company
      WHERE current.company = 'Oracle' GROUP BY current.clearing_date HAVING COUNT(*) > 1 ORDER BY current.clearing_date DESC LIMIT 1
    `).first<{ clearing_date: string; revision_id: number }>();
    await env.DB.prepare(`UPDATE ice_eod_current SET revision_id = ? WHERE clearing_date = ? AND company = 'Oracle'`)
      .bind(current!.revision_id, current!.clearing_date).run();
    const response = await request(`/v1/cds/export-source?cursor=${encodeURIComponent(firstPage.nextCursor)}`, { headers: authorise(READ_TOKEN) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: 'EXPORT_SNAPSHOT_CHANGED', message: 'Export snapshot changed' } });
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
    const canonical = await env.DB.prepare(`SELECT payload_hash FROM ice_eod_revisions WHERE clearing_date = ? AND company = 'Oracle' ORDER BY revision_id DESC LIMIT 1`)
      .bind('2026-08-25').first<{ payload_hash: string }>();
    expect(canonical?.payload_hash).not.toContain('-manual');
  });

  it('rejects manual imports with future timestamps, aliases or source paths outside the canonical preview', async () => {
    const fetchImpl = fixtureFetch();
    const observations = (await fetchIceObservations(fetchImpl, NOW)).rows;
    const treasuryCurve = await fetchTreasuryCurve(fetchImpl, '2026-08-24', NOW);
    const attempts = [
      { observations: observations.map((row, index) => index === 0 ? { ...row, retrievedAt: '2099-01-01T00:00:00.000Z' } : row), treasuryCurve },
      { observations: observations.map((row, index) => index === 0 ? { ...row, iceName: 'NOT ORACLE' } : row), treasuryCurve },
      { observations: observations.map((row, index) => index === 0 ? { ...row, sourceUrl: 'https://www.ice.com/not-the-fixed-feed' } : row), treasuryCurve },
      { observations, treasuryCurve, ignored: true },
    ];
    for (const body of attempts) {
      const response = await request('/internal/v1/cds/import', {
        method: 'POST', headers: new Headers({ ...Object.fromEntries(authorise(WRITE_TOKEN)), 'content-type': 'application/json' }), body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
    }
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

  it('fails closed when a configured token is empty or both configured roles are identical', async () => {
    expect(await constantTimeBearerEquals(new Request('https://collector.test', { headers: authorise(READ_TOKEN) }), '')).toBe(false);
    const response = await handleApiRequest(new Request('https://collector.test/v1/cds/latest', {
      headers: authorise('same-token'),
    }), { ...(env as unknown as Env), READ_TOKEN: 'same-token', WRITE_TOKEN: 'same-token' });
    expect(response.status).toBe(401);
  });

  it('does not expose a corrupted latest batch with duplicate or misaligned companies', async () => {
    await seed();
    const batch = await env.DB.prepare(`
      SELECT current.batch_id FROM published_batch_current AS current
      JOIN published_batches AS batches USING (batch_id)
      ORDER BY batches.clearing_date DESC, batches.revision DESC LIMIT 1
    `).first<{ batch_id: string }>();
    await env.DB.prepare(`UPDATE published_batch_rows SET company = 'Duplicate' WHERE batch_id = ? AND company = 'Meta'`)
      .bind(batch!.batch_id).run();
    const response = await request('/v1/cds/latest', { headers: authorise(READ_TOKEN) });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' } });
  });

  it('rejects a cross-date linked spread in both latest and history snapshots', async () => {
    await seedTwoRevisions();
    const batch = await env.DB.prepare(`
      SELECT batches.batch_id, batches.clearing_date FROM published_batch_current AS current
      JOIN published_batches AS batches USING (batch_id)
      ORDER BY batches.clearing_date DESC, batches.revision DESC LIMIT 1
    `).first<{ batch_id: string; clearing_date: string }>();
    await env.DB.prepare(`
      UPDATE cds_spread_revisions SET clearing_date = '1900-01-01'
      WHERE spread_revision_id = (SELECT spread_revision_id FROM published_batch_rows WHERE batch_id = ? LIMIT 1)
    `).bind(batch!.batch_id).run();
    expect((await request('/v1/cds/latest', { headers: authorise(READ_TOKEN) })).status).toBe(503);
    const history = await request(`/v1/cds/history?from=${batch!.clearing_date}&to=${batch!.clearing_date}&limit=10`, { headers: authorise(READ_TOKEN) });
    expect(history.status).toBe(503);
  });

  it('rejects a non-model-derived linked batch in both latest and history snapshots', async () => {
    await seedTwoRevisions();
    const batch = await env.DB.prepare(`
      SELECT batches.batch_id, batches.clearing_date FROM published_batch_current AS current
      JOIN published_batches AS batches USING (batch_id)
      ORDER BY batches.clearing_date DESC, batches.revision DESC LIMIT 1
    `).first<{ batch_id: string; clearing_date: string }>();
    await env.DB.prepare('UPDATE published_batches SET quality_status = ? WHERE batch_id = ?')
      .bind('other', batch!.batch_id).run();
    expect((await request('/v1/cds/latest', { headers: authorise(READ_TOKEN) })).status).toBe(503);
    const history = await request(`/v1/cds/history?from=${batch!.clearing_date}&to=${batch!.clearing_date}&limit=10`, { headers: authorise(READ_TOKEN) });
    expect(history.status).toBe(503);
  });
});
