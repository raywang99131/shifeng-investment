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

  it('schedules the regular successor before source I/O, retries failures in five minutes, then resets on recovery', async () => {
    const stub = globalCollectorStub();
    await runInDurableObject(stub, async (instance: CdsCollector, state) => {
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
      alarmWithin(await state.storage.getAlarm(), Date.now() + FAILURE_INTERVAL_MS);

      const failedState = await env.DB.prepare(`
        SELECT consecutive_failures FROM collector_state WHERE state_key = 'singleton'
      `).first<{ consecutive_failures: number }>();
      expect(failedState?.consecutive_failures).toBe((beforeFailure?.consecutive_failures ?? 0) + 1);
      const failedRun = await env.DB.prepare(`
        SELECT status, error_code FROM collector_runs
        WHERE status = 'failed'
        ORDER BY rowid DESC LIMIT 1
      `).first<{ status: string; error_code: string }>();
      expect(failedRun).toEqual({ status: 'failed', error_code: 'SOURCE_HTTP_STATUS' });

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

  it('allows only internal POST routes and Cron repeatedly ensures the one fixed collector alarm', async () => {
    const stub = globalCollectorStub();
    await runInDurableObject(stub, async (instance: CdsCollector, state) => {
      const denied = await instance.fetch(new Request('https://collector.internal/ensure-alarm'));
      expect(denied.status).toBe(404);
      const ensured = await instance.fetch(new Request('https://collector.internal/ensure-alarm', { method: 'POST' }));
      expect(ensured.status).toBe(200);
      expect(await state.storage.getAlarm()).not.toBeNull();
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
