import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CollectorRepository } from '../src/repository';
import type { IceObservation } from '../src/types';

const observation = (overrides: Partial<IceObservation> = {}): IceObservation => ({
  clearingDate: '2026-08-24',
  company: 'NVIDIA',
  iceName: 'NVIDIA CORP',
  instrumentName: 'NVIDIA CORP 5Y',
  eodPrice: 101.25,
  couponBp: 100,
  payloadHash: 'hash-a',
  retrievedAt: '2026-08-25T00:00:00.000Z',
  sourceUrl: 'https://www.ice.com/api/cds-settlement-prices/icc-single-names',
  ...overrides,
});

describe('CollectorRepository', () => {
  it('deduplicates identical ICE payloads and advances current on a revision', async () => {
    const repository = new CollectorRepository(env.DB);
    const first = observation({ eodPrice: 101.25, payloadHash: 'hash-a' });
    for (let index = 0; index < 100; index += 1) await repository.upsertIceObservations([first]);
    await repository.upsertIceObservations([
      observation({ eodPrice: 101.5, payloadHash: 'hash-b', retrievedAt: '2026-08-25T01:00:00.000Z' }),
    ]);

    expect(await repository.countIceRevisions()).toBe(2);
    expect((await repository.getCurrentObservations('2026-08-24'))[0].eodPrice).toBe(101.5);
  });

  it('keeps one current ICE row per company and never rewinds it for an older replay', async () => {
    const repository = new CollectorRepository(env.DB);
    await repository.upsertIceObservations([
      observation({ clearingDate: '2026-08-23', payloadHash: 'newer', eodPrice: 101.5, retrievedAt: '2026-08-25T02:00:00.000Z' }),
      observation({ clearingDate: '2026-08-23', payloadHash: 'older', eodPrice: 101.25, retrievedAt: '2026-08-25T00:00:00.000Z' }),
    ]);

    const current = await repository.getCurrentObservations('2026-08-23');
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ eodPrice: 101.5, payloadHash: 'newer' });
    const revisions = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM ice_eod_revisions WHERE clearing_date = ?',
    ).bind('2026-08-23').first<{ count: number }>();
    expect(revisions?.count).toBe(2);
  });

  it('appends run records instead of replacing earlier audit entries', async () => {
    const repository = new CollectorRepository(env.DB);
    await repository.startRun({
      runId: 'run-1',
      triggerKind: 'alarm',
      startedAt: '2026-08-25T00:00:00.000Z',
      candidateDates: ['2026-08-24'],
    });
    await repository.finishRun({
      runId: 'run-1',
      finishedAt: '2026-08-25T00:01:00.000Z',
      status: 'success',
      sourceStatus: 'ok',
      rawWriteCount: 1,
      publishedDates: ['2026-08-24'],
    });
    await repository.startRun({
      runId: 'run-2',
      triggerKind: 'manual',
      startedAt: '2026-08-25T01:00:00.000Z',
      candidateDates: [],
    });

    const result = await env.DB.prepare(
      'SELECT run_id, status, finished_at FROM collector_runs ORDER BY run_id',
    ).all<{ run_id: string; status: string; finished_at: string | null }>();
    expect(result.results).toEqual([
      { run_id: 'run-1', status: 'success', finished_at: '2026-08-25T00:01:00.000Z' },
      { run_id: 'run-2', status: 'running', finished_at: null },
    ]);
  });
});
