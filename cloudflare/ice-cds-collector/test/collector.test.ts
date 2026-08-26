import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import completeFixture from './fixtures/ice-complete.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import { COLLECTOR_OBJECT_NAME, collectOnce } from '../src/collector';
import { CollectorRepository } from '../src/repository';
import { CdsCollector } from '../src/index';
import worker from '../src/index';
import type { Env } from '../src/types';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const REGULAR_INTERVAL_MS = 30 * 60 * 1000;
const FAILURE_INTERVAL_MS = 5 * 60 * 1000;

const fixtureFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.startsWith('https://www.ice.com/api/cds-settlement-prices/icc-single-names')) {
    return new Response(JSON.stringify(completeFixture), { headers: { 'content-type': 'application/json' } });
  }
  if (url.startsWith('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/')) {
    return new Response(treasuryFixture, { headers: { 'content-type': 'text/csv' } });
  }
  throw new Error(`Unexpected fixture URL: ${url}`);
};

const globalCollectorStub = () => env.CDS_COLLECTOR.get(
  env.CDS_COLLECTOR.idFromName(COLLECTOR_OBJECT_NAME),
);

const alarmWithin = (actual: number | null, expected: number, toleranceMs = 5_000) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(toleranceMs);
};

describe('durable collector lifecycle', () => {
  it('collectOnce persists ICE rows before complete-only publication and records a successful run', async () => {
    const before = await env.DB.prepare(`
      SELECT last_alarm_at FROM collector_state WHERE state_key = 'singleton'
    `).first<{ last_alarm_at: string | null }>();
    const result = await collectOnce({ env: env as unknown as Env, triggerKind: 'manual', now: NOW, fetchImpl: fixtureFetch });

    expect(result.rawWriteCount).toBe(7);
    expect(result.publishedDates).toEqual(['2026-08-24']);
    const currentRows = await new CollectorRepository(env.DB).getCurrentObservations('2026-08-24');
    expect(currentRows).toHaveLength(7);
    const run = await env.DB.prepare(`
      SELECT status, raw_write_count, published_dates_json, error_code
      FROM collector_runs
    `).first<{ status: string; raw_write_count: number; published_dates_json: string; error_code: string | null }>();
    expect(run).toEqual({
      status: 'success', raw_write_count: 7, published_dates_json: '["2026-08-24"]', error_code: null,
    });
    const after = await env.DB.prepare(`
      SELECT last_alarm_at FROM collector_state WHERE state_key = 'singleton'
    `).first<{ last_alarm_at: string | null }>();
    expect(after?.last_alarm_at).toBe(before?.last_alarm_at);
  });

  it('keeps immediately persisted ICE rows and their audit count when later publication fails', async () => {
    const clearingDate = '2026-08-25';
    const treasuryFailure: typeof fetch = async (input) => {
      const url = String(input);
      if (url.startsWith('https://www.ice.com/api/cds-settlement-prices/icc-single-names')) {
        return new Response(JSON.stringify(completeFixture.map((row) => ({ ...row, clearingDate }))), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('unavailable', { status: 500, headers: { 'content-type': 'text/csv' } });
    };

    await expect(collectOnce({ env: env as unknown as Env, triggerKind: 'manual', now: NOW, fetchImpl: treasuryFailure }))
      .rejects.toMatchObject({ code: 'SOURCE_HTTP_STATUS' });
    expect(await new CollectorRepository(env.DB).getCurrentObservations(clearingDate)).toHaveLength(7);
    const run = await env.DB.prepare(`
      SELECT status, raw_write_count, error_code FROM collector_runs
      WHERE status = 'failed'
      ORDER BY rowid DESC LIMIT 1
    `).first<{ status: string; raw_write_count: number; error_code: string }>();
    expect(run).toEqual({ status: 'failed', raw_write_count: 7, error_code: 'SOURCE_HTTP_STATUS' });
  });

  it('keeps raw-write audit at zero when a third raw D1 statement fails atomically', async () => {
    const clearingDate = '2026-10-01';
    const source: typeof fetch = async () => new Response(JSON.stringify(completeFixture.map((row) => ({
      ...row, clearingDate,
    }))), { headers: { 'content-type': 'application/json' } });
    const previousRun = await env.DB.prepare('SELECT COALESCE(MAX(rowid), 0) AS row_id FROM collector_runs')
      .first<{ row_id: number }>();
    const originalUpsert = CollectorRepository.prototype.upsertIceObservations;
    CollectorRepository.prototype.upsertIceObservations = async function injectThirdRawFailure(rows) {
      return originalUpsert.call(this, rows.map((row, index) => index === 2
        ? { ...row, eodPrice: -1 }
        : row));
    };
    try {
      await expect(collectOnce({
        env: env as unknown as Env, triggerKind: 'manual', now: NOW, fetchImpl: source,
      })).rejects.toThrow();
    } finally {
      CollectorRepository.prototype.upsertIceObservations = originalUpsert;
    }

    const run = await env.DB.prepare(`
      SELECT status, raw_write_count, candidate_dates_json FROM collector_runs
      WHERE rowid > ? ORDER BY rowid ASC LIMIT 1
    `).bind(previousRun?.row_id ?? 0).first<{
      status: string;
      raw_write_count: number;
      candidate_dates_json: string;
    }>();
    const persistedRows = await new CollectorRepository(env.DB).getCurrentObservations(clearingDate);
    expect(run).toEqual({
      status: 'failed', raw_write_count: 0, candidate_dates_json: '["2026-10-01"]',
    });
    expect(persistedRows).toEqual([]);
  });

  it('records parsed source-only partial dates as candidates and returns them without inventing observations', async () => {
    const sourceOnlyDate = '2026-09-30';
    const sourceOnlyPartial: typeof fetch = async (input) => {
      if (String(input).startsWith('https://www.ice.com/')) {
        return new Response(JSON.stringify(completeFixture.map((row) => ({
          ...row, clearingDate: sourceOnlyDate, name: 'UNTRACKED ISSUER',
        }))), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(treasuryFixture, { headers: { 'content-type': 'text/csv' } });
    };

    const result = await collectOnce({
      env: env as unknown as Env, triggerKind: 'manual', now: NOW, fetchImpl: sourceOnlyPartial,
    });
    expect(result.rawWriteCount).toBe(0);
    expect(result.partialDates).toContainEqual({
      clearingDate: sourceOnlyDate,
      missingCompanies: ['Oracle', 'CoreWeave', 'NVIDIA', 'Amazon', 'Google', 'Microsoft', 'Meta'],
    });
    const run = await env.DB.prepare(`
      SELECT candidate_dates_json, status FROM collector_runs
      WHERE run_id = ?
    `).bind(result.runId).first<{ candidate_dates_json: string; status: string }>();
    expect(run).toEqual({ candidate_dates_json: '["2026-09-30"]', status: 'partial' });
  });

  it('schedules the regular successor before source I/O, retries failures in five minutes, then resets on recovery', async () => {
    const stub = globalCollectorStub();
    await runInDurableObject(stub, async (instance: CdsCollector, state) => {
      const previousRun = await env.DB.prepare('SELECT COALESCE(MAX(rowid), 0) AS row_id FROM collector_runs')
        .first<{ row_id: number }>();
      const beforeFailure = await env.DB.prepare(`
        SELECT consecutive_failures FROM collector_state WHERE state_key = 'singleton'
      `).first<{ consecutive_failures: number }>();
      let sourceSawScheduledSuccessor = false;
      (instance as unknown as { fetchImpl: typeof fetch }).fetchImpl = async () => {
        const scheduled = await state.storage.getAlarm();
        sourceSawScheduledSuccessor = scheduled !== null && scheduled > Date.now();
        return new Response('unavailable', { status: 500, headers: { 'content-type': 'application/json' } });
      };

      await expect(instance.alarm()).rejects.toMatchObject({ code: 'SOURCE_HTTP_STATUS' });
      expect(sourceSawScheduledSuccessor).toBe(true);
      const retryAlarm = await state.storage.getAlarm();
      alarmWithin(retryAlarm, Date.now() + FAILURE_INTERVAL_MS);

      const failedState = await env.DB.prepare(`
        SELECT consecutive_failures, next_alarm_at FROM collector_state WHERE state_key = 'singleton'
      `).first<{ consecutive_failures: number; next_alarm_at: string }>();
      expect(failedState?.consecutive_failures).toBe((beforeFailure?.consecutive_failures ?? 0) + 1);
      expect(failedState?.next_alarm_at).toBe(new Date(retryAlarm!).toISOString());
      const failedRun = await env.DB.prepare(`
        SELECT status, error_code, next_alarm_at FROM collector_runs
        WHERE rowid > ?
        ORDER BY rowid ASC LIMIT 1
      `).bind(previousRun?.row_id ?? 0).first<{ status: string; error_code: string; next_alarm_at: string }>();
      expect(failedRun).toEqual({
        status: 'failed', error_code: 'SOURCE_HTTP_STATUS', next_alarm_at: new Date(retryAlarm!).toISOString(),
      });

      (instance as unknown as { fetchImpl: typeof fetch }).fetchImpl = fixtureFetch;
      await expect(instance.alarm()).resolves.toBeUndefined();
      alarmWithin(await state.storage.getAlarm(), Date.now() + REGULAR_INTERVAL_MS);
      const recoveredState = await env.DB.prepare(`
        SELECT consecutive_failures, last_source_success_at, last_published_date
        FROM collector_state WHERE state_key = 'singleton'
      `).first<{ consecutive_failures: number; last_source_success_at: string | null; last_published_date: string | null }>();
      expect(recoveredState?.consecutive_failures).toBe(0);
      expect(recoveredState?.last_published_date).not.toBeNull();
      expect(recoveredState?.last_source_success_at).not.toBeNull();
    });
  });

  it('writes the manual retry timestamp without pretending manual collection was an Alarm', async () => {
    const stub = globalCollectorStub();
    await runInDurableObject(stub, async (instance: CdsCollector, state) => {
      const previousRun = await env.DB.prepare('SELECT COALESCE(MAX(rowid), 0) AS row_id FROM collector_runs')
        .first<{ row_id: number }>();
      const before = await env.DB.prepare(`
        SELECT last_alarm_at FROM collector_state WHERE state_key = 'singleton'
      `).first<{ last_alarm_at: string | null }>();
      (instance as unknown as { fetchImpl: typeof fetch }).fetchImpl = async () => (
        new Response('unavailable', { status: 500, headers: { 'content-type': 'application/json' } })
      );

      await expect(instance.fetch(new Request('https://collector.internal/collect-now', { method: 'POST' })))
        .rejects.toMatchObject({ code: 'SOURCE_HTTP_STATUS' });
      const retryAlarm = await state.storage.getAlarm();
      alarmWithin(retryAlarm, Date.now() + FAILURE_INTERVAL_MS);
      const failedManualRun = await env.DB.prepare(`
        SELECT trigger_kind, next_alarm_at FROM collector_runs
        WHERE rowid > ?
        ORDER BY rowid ASC LIMIT 1
      `).bind(previousRun?.row_id ?? 0).first<{ trigger_kind: string; next_alarm_at: string }>();
      expect(failedManualRun).toEqual({
        trigger_kind: 'manual', next_alarm_at: new Date(retryAlarm!).toISOString(),
      });
      const after = await env.DB.prepare(`
        SELECT last_alarm_at, next_alarm_at FROM collector_state WHERE state_key = 'singleton'
      `).first<{ last_alarm_at: string | null; next_alarm_at: string }>();
      expect(after?.last_alarm_at).toBe(before?.last_alarm_at);
      expect(after?.next_alarm_at).toBe(new Date(retryAlarm!).toISOString());
    });
  });

  it('allows only internal POST routes and Cron repeatedly ensures the one fixed collector alarm', async () => {
    const stub = globalCollectorStub();
    await runInDurableObject(stub, async (instance: CdsCollector, state) => {
      await state.storage.deleteAlarm();
      const beforeEnsure = Date.now();
      const denied = await instance.fetch(new Request('https://collector.internal/ensure-alarm'));
      expect(denied.status).toBe(404);
      const ensured = await instance.fetch(new Request('https://collector.internal/ensure-alarm', { method: 'POST' }));
      expect(ensured.status).toBe(200);
      const ensuredBody = await ensured.json<{ nextAlarmAt: string }>();
      const firstAlarm = await state.storage.getAlarm();
      alarmWithin(firstAlarm, beforeEnsure + REGULAR_INTERVAL_MS);
      expect(ensuredBody.nextAlarmAt).toBe(new Date(firstAlarm!).toISOString());
    });

    const waits: Promise<unknown>[] = [];
    const context = { waitUntil(promise: Promise<unknown>) { waits.push(promise); } } as ExecutionContext;
    await worker.scheduled!({} as ScheduledController, env as unknown as Env, context);
    await Promise.all(waits);
    const firstAlarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());

    const secondWaits: Promise<unknown>[] = [];
    const secondContext = { waitUntil(promise: Promise<unknown>) { secondWaits.push(promise); } } as ExecutionContext;
    await worker.scheduled!({} as ScheduledController, env as unknown as Env, secondContext);
    await Promise.all(secondWaits);
    const secondAlarm = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());

    expect(secondAlarm).toBe(firstAlarm);
  });
});
