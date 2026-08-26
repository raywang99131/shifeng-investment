import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import completeFixture from './fixtures/ice-complete.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import { selectTrackedFiveYearContracts, normalizeIcePayload, toIceObservation } from '../src/domain/contracts';
import { TRACKED_COMPANIES } from '../src/domain/registry';
import { createBatchId, publishReadyDates } from '../src/publisher';
import { CollectorRepository } from '../src/repository';
import { FixedSourceError } from '../src/sources/http';
import { fetchTreasuryCurve } from '../src/sources/treasury';
import type { IceObservation, StoredIceObservation, TreasuryCurve } from '../src/types';
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

const deferred = () => {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
};

const pauseNextRevision = (repository: CollectorRepository, clearingDate: string) => {
  const original = repository.nextBatchRevision.bind(repository);
  const reached = deferred();
  const release = deferred();
  let paused = false;
  repository.nextBatchRevision = async (date) => {
    const revision = await original(date);
    if (date === clearingDate && !paused) {
      paused = true;
      reached.resolve();
      await release.promise;
    }
    return revision;
  };
  return { reached, release };
};

const pauseAfterCurrentObservations = (repository: CollectorRepository, clearingDate: string) => {
  const original = repository.getCurrentObservations.bind(repository);
  const reached = deferred();
  const release = deferred();
  let paused = false;
  let snapshot: StoredIceObservation[] | null = null;
  repository.getCurrentObservations = async (date) => {
    const observations = await original(date);
    if (date === clearingDate && !paused) {
      paused = true;
      snapshot = observations;
      reached.resolve();
      await release.promise;
    }
    return observations;
  };
  return { reached, release, snapshot: () => snapshot };
};

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

    const returned = [...first.published, ...second.published].filter((batch) => batch.clearingDate === date);
    expect(returned.length).toBeGreaterThan(0);
    expect(returned.every((batch) => batch.clearingDate === date && batch.revision === 1)).toBe(true);
    const batches = await env.DB.prepare('SELECT revision, batch_id FROM published_batches WHERE clearing_date = ?')
      .bind(date).all<{ revision: number; batch_id: string }>();
    expect(batches.results).toHaveLength(1);
    expect(batches.results[0].revision).toBe(1);
    expect((await publish(repository)).published).toEqual([]);
  });

  it('marks a true same-revision ICE conflict for retry, then a fresh cycle appends the correction', async () => {
    const date = '2026-12-01';
    const originalRepository = new CollectorRepository(env.DB);
    const correctedRepository = new CollectorRepository(env.DB);
    await originalRepository.upsertIceObservations(observations(date));
    const originalGate = pauseNextRevision(originalRepository, date);
    const correctedGate = pauseNextRevision(correctedRepository, date);

    const originalPublish = publish(originalRepository);
    await originalGate.reached.promise;
    await correctedRepository.upsertIceObservations(observations(date, '2026-08-25T13:00:00.000Z').map((row) => row.company === 'Oracle'
      ? { ...row, eodPrice: 95.1309, payloadHash: 'competing-corrected-oracle' }
      : row));
    const correctedPublish = publish(correctedRepository);
    await correctedGate.reached.promise;
    originalGate.release.resolve();
    const originalResult = await originalPublish;
    correctedGate.release.resolve();
    const correctedResult = await correctedPublish;

    expect(originalResult.published).toContainEqual(expect.objectContaining({ clearingDate: date, revision: 1 }));
    expect(correctedResult.published.some((batch) => batch.clearingDate === date)).toBe(false);
    expect(correctedResult.partial).toContainEqual({ clearingDate: date, missingCompanies: [], reason: 'publish-race-retry' });
    const beforeFresh = await env.DB.prepare('SELECT revision FROM published_batches WHERE clearing_date = ?').bind(date).all<{ revision: number }>();
    expect(beforeFresh.results).toEqual([{ revision: 1 }]);

    const freshResult = await publish(new CollectorRepository(env.DB));
    expect(freshResult.published).toContainEqual(expect.objectContaining({ clearingDate: date, revision: 2 }));
    const batches = await env.DB.prepare(`
      SELECT batches.revision, rows.company, spreads.ice_revision_id, spreads.eod_price
      FROM published_batches AS batches
      JOIN published_batch_rows AS rows USING (batch_id)
      JOIN cds_spread_revisions AS spreads USING (spread_revision_id)
      WHERE batches.clearing_date = ?
      ORDER BY batches.revision ASC, rows.company ASC
    `).bind(date).all<{ revision: number; company: string; ice_revision_id: number; eod_price: number }>();
    const firstRevision = batches.results.filter((row) => row.revision === 1);
    const secondRevision = batches.results.filter((row) => row.revision === 2);
    expect([...new Set(batches.results.map((row) => row.revision))]).toEqual([1, 2]);
    expect(firstRevision).toHaveLength(7);
    expect(secondRevision).toHaveLength(7);
    expect(firstRevision.find((row) => row.company === 'Oracle')?.eod_price).toBe(95.0309);
    expect(secondRevision.find((row) => row.company === 'Oracle')?.eod_price).toBe(95.1309);
    expect(secondRevision.filter((row) => row.company !== 'Oracle').map((row) => row.ice_revision_id))
      .toEqual(firstRevision.filter((row) => row.company !== 'Oracle').map((row) => row.ice_revision_id));
  });

  it('rejects old observed rows when a newer input publishes before their calculation can continue', async () => {
    const date = '2026-12-04';
    const oldRepository = new CollectorRepository(env.DB);
    const newRepository = new CollectorRepository(env.DB);
    await oldRepository.upsertIceObservations(observations(date));
    const oldRead = pauseAfterCurrentObservations(oldRepository, date);

    const oldRun = publish(oldRepository);
    await oldRead.reached.promise;
    expect(oldRead.snapshot()?.find((row) => row.company === 'Oracle')?.eodPrice).toBe(95.0309);
    await newRepository.upsertIceObservations(observations(date, '2026-08-25T13:00:00.000Z').map((row) => row.company === 'Oracle'
      ? { ...row, eodPrice: 95.1309, payloadHash: 'cas-corrected-oracle' }
      : row));
    const newResult = await publish(newRepository);
    oldRead.release.resolve();
    const oldResult = await oldRun;

    expect(newResult.published).toContainEqual(expect.objectContaining({ clearingDate: date, revision: 1 }));
    expect(oldResult.published.some((batch) => batch.clearingDate === date)).toBe(false);
    expect(oldResult.partial).toContainEqual({ clearingDate: date, missingCompanies: [], reason: 'publish-race-retry' });
    const rows = await env.DB.prepare(`
      SELECT batches.revision, rows.company, spreads.eod_price
      FROM published_batches AS batches
      JOIN published_batch_rows AS rows USING (batch_id)
      JOIN cds_spread_revisions AS spreads USING (spread_revision_id)
      WHERE batches.clearing_date = ?
      ORDER BY batches.revision, rows.company
    `).bind(date).all<{ revision: number; company: string; eod_price: number }>();
    expect(rows.results).toHaveLength(7);
    expect([...new Set(rows.results.map((row) => row.revision))]).toEqual([1]);
    expect(rows.results.find((row) => row.company === 'Oracle')?.eod_price).toBe(95.1309);
    expect(await newRepository.currentPublishedBatchId(date)).toBe(newResult.published.find((batch) => batch.clearingDate === date)?.batchId);
  });

  it.each([
    ['old', 'new', '2026-12-02'],
    ['new', 'old', '2026-12-03'],
  ] as const)('never auto-republishes the losing %s Treasury curve after %s wins revision one', async (winner, loser, date) => {
    const winnerRepository = new CollectorRepository(env.DB);
    const loserRepository = new CollectorRepository(env.DB);
    await winnerRepository.upsertIceObservations(observations(date));
    const baseCurve = await curve(date);
    const oldCurve = { ...baseCurve, curveId: `curve-old-${date}`, payloadHash: `old-${date}` };
    const newCurve = {
      ...baseCurve,
      curveId: `curve-new-${date}`,
      payloadHash: `new-${date}`,
      nodes: baseCurve.nodes.map((node, index) => index === 0 ? { ...node, zeroRate: node.zeroRate + 0.0001 } : node),
    };
    const curves = { old: oldCurve, new: newCurve };
    const winnerGate = pauseNextRevision(winnerRepository, date);
    const loserGate = pauseNextRevision(loserRepository, date);
    const winnerRun = publish(winnerRepository, async (clearingDate) => clearingDate === date ? curves[winner] : curve(clearingDate));
    const loserRun = publish(loserRepository, async (clearingDate) => clearingDate === date ? curves[loser] : curve(clearingDate));
    await Promise.all([winnerGate.reached.promise, loserGate.reached.promise]);
    winnerGate.release.resolve();
    const winnerResult = await winnerRun;
    loserGate.release.resolve();
    const loserResult = await loserRun;

    expect(winnerResult.published).toContainEqual(expect.objectContaining({ clearingDate: date, revision: 1 }));
    expect(loserResult.published.some((batch) => batch.clearingDate === date)).toBe(false);
    expect(loserResult.partial).toContainEqual({ clearingDate: date, missingCompanies: [], reason: 'publish-race-retry' });
    const batches = await env.DB.prepare(`
      SELECT batches.revision, rows.company, spreads.curve_id
      FROM published_batches AS batches
      JOIN published_batch_rows AS rows USING (batch_id)
      JOIN cds_spread_revisions AS spreads USING (spread_revision_id)
      WHERE batches.clearing_date = ?
      ORDER BY rows.company ASC
    `).bind(date).all<{ revision: number; company: string; curve_id: string }>();
    expect(batches.results).toHaveLength(7);
    expect([...new Set(batches.results.map((row) => row.revision))]).toEqual([1]);
    expect([...new Set(batches.results.map((row) => row.curve_id))]).toEqual([curves[winner].curveId]);
  });

  it('derives batch IDs only from canonical date, revision, and registry-ordered spread revisions', async () => {
    await expect(createBatchId('2026-12-01', 2, [11, 12, 13, 14, 15, 16, 17]))
      .resolves.toBe('cds-2026-12-01-2-6f802a91b4a1c6f5');
    await expect(createBatchId('2026-12-01', 2, [17, 16, 15, 14, 13, 12, 11]))
      .resolves.not.toBe('cds-2026-12-01-2-6f802a91b4a1c6f5');
  });

  it('does not publish a Treasury curve dated after its ICE clearing date', async () => {
    const repository = new CollectorRepository(env.DB);
    const date = '2026-08-26';
    await repository.upsertIceObservations(observations(date));
    const futureCurve = await curve(date);
    const result = await publish(repository, async () => ({ ...futureCurve, asOf: '2027-01-01', curveId: 'future-curve' }));

    expect(result.published).toEqual([]);
    expect(result.partial).toContainEqual({ clearingDate: date, missingCompanies: [], reason: 'treasury-curve-after-clearing-date' });
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM published_batches WHERE clearing_date = ?').bind(date).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it('rethrows source transport failures so the collector can retry them', async () => {
    const repository = new CollectorRepository(env.DB);
    const date = '2026-08-31';
    await repository.upsertIceObservations(observations(date));
    await expect(publish(repository, async () => {
      throw new FixedSourceError('SOURCE_TIMEOUT', 'Source request timed out');
    })).rejects.toMatchObject({ code: 'SOURCE_TIMEOUT' });
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
    const current = await env.DB.prepare(`
      SELECT batches.revision
      FROM published_batch_current AS pointer
      JOIN published_batches AS batches USING (batch_id)
      WHERE pointer.clearing_date = ?
    `).bind(date).first<{ revision: number }>();
    expect(current).toEqual({ revision: 2 });
  });

  it('leaves an unavailable Treasury date partial while a later complete date still publishes', async () => {
    const repository = new CollectorRepository(env.DB);
    const unavailableDate = '2026-08-29';
    const publishableDate = '2026-08-30';
    await repository.upsertIceObservations([...observations(unavailableDate), ...observations(publishableDate)]);
    const baseCurve = await curve();
    const result = await publish(repository, async (clearingDate) => {
      if (clearingDate === unavailableDate) {
        throw new FixedSourceError('TREASURY_CURVE_UNAVAILABLE', 'No Treasury curve is available on or before the clearing date');
      }
      return baseCurve;
    });

    expect(result.partial).toContainEqual({ clearingDate: unavailableDate, missingCompanies: [], reason: 'treasury-curve-unavailable' });
    expect(result.published).toContainEqual(expect.objectContaining({ clearingDate: publishableDate, revision: 1 }));
    const unavailable = await env.DB.prepare('SELECT COUNT(*) AS count FROM published_batches WHERE clearing_date = ?').bind(unavailableDate).first<{ count: number }>();
    expect(unavailable?.count).toBe(0);
  });
});
