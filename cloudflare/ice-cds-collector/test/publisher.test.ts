import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import completeFixture from './fixtures/ice-complete.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import { selectTrackedFiveYearContracts, normalizeIcePayload, toIceObservation } from '../src/domain/contracts';
import { TRACKED_COMPANIES } from '../src/domain/registry';
import { publishReadyDates } from '../src/publisher';
import { CollectorRepository } from '../src/repository';
import { fetchTreasuryCurve } from '../src/sources/treasury';
import type { IceObservation, TreasuryCurve } from '../src/types';
import * as spread from '../src/domain/spread';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const DATE = '2026-08-24';

const observations = (clearingDate = DATE, retrievedAt = NOW.toISOString()): IceObservation[] => {
  const normalized = normalizeIcePayload(completeFixture.map((row) => ({ ...row, clearingDate })), retrievedAt);
  return selectTrackedFiveYearContracts(normalized, clearingDate).selected.map((row, index) => toIceObservation(
    row,
    `fixture-${index}-${row.eodPrice}`,
    'https://www.ice.com/api/cds-settlement-prices/icc-single-names',
  ));
};

const curve = (clearingDate = DATE): Promise<TreasuryCurve> => fetchTreasuryCurve(
  async () => new Response(treasuryFixture, { headers: { 'content-type': 'text/csv' } }),
  clearingDate,
  NOW,
);

const publish = (repository: CollectorRepository, fetchTreasuryCurve = curve) => publishReadyDates({
  repository,
  fetchTreasuryCurve,
  now: NOW,
});

describe('publishReadyDates', () => {
  it('keeps three ICE arrivals partial until all seven companies can publish as one batch', async () => {
    const repository = new CollectorRepository(env.DB);
    const rows = observations(DATE);

    await repository.upsertIceObservations(rows.slice(0, 2));
    expect(await publish(repository)).toMatchObject({ published: [], partial: [{ clearingDate: DATE, missingCompanies: TRACKED_COMPANIES.slice(2) }] });
    expect(await repository.getCurrentObservations(DATE)).toHaveLength(2);
    expect(await repository.latestBatch()).toBeNull();

    await repository.upsertIceObservations(rows.slice(2, 4));
    expect((await publish(repository)).published).toEqual([]);
    expect(await repository.getCurrentObservations(DATE)).toHaveLength(4);
    expect(await repository.latestBatch()).toBeNull();

    await repository.upsertIceObservations(rows.slice(4));
    const result = await publish(repository);
    expect(result.published).toHaveLength(1);
    expect(result.published[0]).toMatchObject({ clearingDate: DATE, revision: 1 });
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM published_batch_rows WHERE batch_id = ?')
      .bind(result.published[0].batchId).first<{ count: number }>();
    expect(count?.count).toBe(7);
  });

  it('is deterministic under concurrent replays and does not create duplicate revisions', async () => {
    const repository = new CollectorRepository(env.DB);
    const date = '2026-08-25';
    await repository.upsertIceObservations(observations(date));
    const [first, second] = await Promise.all([publish(repository), publish(repository)]);

    expect([...first.published, ...second.published].every((batch) => batch.clearingDate === date)).toBe(true);
    const batches = await env.DB.prepare('SELECT revision, batch_id FROM published_batches WHERE clearing_date = ?')
      .bind(date).all<{ revision: number; batch_id: string }>();
    expect(batches.results).toHaveLength(1);
    expect(batches.results[0].revision).toBe(1);
    expect((await publish(repository)).published).toEqual([]);
  });

  it('does not publish a Treasury curve dated after its ICE clearing date', async () => {
    const repository = new CollectorRepository(env.DB);
    const date = '2026-08-26';
    await repository.upsertIceObservations(observations(date));
    const futureCurve = await curve(date);
    const result = await publish(repository, async () => ({ ...futureCurve, asOf: '2026-08-27', curveId: 'future-curve' }));

    expect(result.published).toEqual([]);
    expect(result.partial).toContainEqual({ clearingDate: date, missingCompanies: [], reason: 'treasury-curve-after-clearing-date' });
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM published_batches WHERE clearing_date = ?').bind(date).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it('rejects the complete batch when any calculated price residual exceeds the threshold', async () => {
    const repository = new CollectorRepository(env.DB);
    const date = '2026-08-27';
    await repository.upsertIceObservations(observations(date));
    const original = spread.cleanPriceToParSpread;
    vi.spyOn(spread, 'cleanPriceToParSpread').mockImplementation((input) => ({ ...original(input), priceResidual: input.cleanPrice === 95.0309 ? 0.006 : 0 }));
    const result = await publish(repository);
    vi.restoreAllMocks();

    expect(result.published).toEqual([]);
    expect(result.partial).toContainEqual({ clearingDate: date, missingCompanies: [], reason: 'price-residual-exceeded' });
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM published_batches WHERE clearing_date = ?').bind(date).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it('appends revision two and advances the current pointer after an ICE correction', async () => {
    const repository = new CollectorRepository(env.DB);
    const date = '2026-08-28';
    await repository.upsertIceObservations(observations(date));
    const first = await publish(repository);
    await repository.upsertIceObservations(observations(date, '2026-08-25T13:00:00.000Z').map((row) => row.company === 'Oracle'
      ? { ...row, eodPrice: 95.1309, payloadHash: 'corrected-oracle' }
      : row));
    const second = await publish(repository);

    expect(first.published[0]).toMatchObject({ revision: 1 });
    expect(second.published[0]).toMatchObject({ revision: 2 });
    expect(await repository.latestBatch()).toMatchObject({ clearingDate: date, revision: 2 });
  });
});
