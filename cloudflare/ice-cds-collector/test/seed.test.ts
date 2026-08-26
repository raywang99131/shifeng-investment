import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { applySeedPackage, parseSeedPackage } from '../src/seed';
import completeFixture from './fixtures/ice-complete.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import { fetchIceObservations } from '../src/sources/ice';
import { fetchTreasuryCurve } from '../src/sources/treasury';
import { cleanPriceToParSpread } from '../src/domain/spread';
import { parseIceInstrumentName } from '../src/domain/contracts';
import type { Env } from '../src/types';

const generatedAt = '2026-08-25T00:00:00.000Z';
const screenshotSeed = () => ({
  schemaVersion: 1,
  generatedAt,
  screenshotHistory: [{
    observationDate: '2026-08-21', company: 'Oracle', valueBp: 214,
    sourceKind: 'screenshot_backfill', sourceLabel: 'User screenshot curve backfill (approximate)',
    note: 'Digitized screenshot', importedAt: generatedAt,
  }],
  iceObservations: [], treasuryCurves: [], derivedSpreads: [], publishedBatches: [],
});

const fixtureFetch: typeof fetch = async (input) => String(input).includes('icc-single-names')
  ? new Response(JSON.stringify(completeFixture), { headers: { 'content-type': 'application/json' } })
  : new Response(treasuryFixture, { headers: { 'content-type': 'text/csv' } });

const liveSeed = async () => {
  const observations = (await fetchIceObservations(fixtureFetch, new Date(generatedAt))).rows;
  const curve = await fetchTreasuryCurve(fixtureFetch, '2026-08-24', new Date(generatedAt));
  const derivedSpreads = observations.map((observation) => {
    const result = cleanPriceToParSpread({ couponBp: observation.couponBp, cleanPrice: observation.eodPrice, clearingDate: observation.clearingDate, maturityDate: parseIceInstrumentName(observation.instrumentName).maturityDate, recoveryRate: 0.4, discountCurve: curve });
    return { clearingDate: observation.clearingDate, company: observation.company, icePayloadHash: observation.payloadHash, curveId: curve.curveId,
      instrumentName: observation.instrumentName, maturityDate: parseIceInstrumentName(observation.instrumentName).maturityDate, eodPrice: observation.eodPrice,
      couponBp: observation.couponBp, spreadBp: result.spreadBp, roundTripPrice: result.roundTripPrice, priceResidual: result.priceResidual,
      hazardRate: result.hazardRate, recoveryRate: result.recoveryRate, modelVersion: result.modelVersion, qualityStatus: 'model-derived', createdAt: generatedAt };
  });
  return { schemaVersion: 1 as const, generatedAt, screenshotHistory: [], iceObservations: observations, treasuryCurves: [curve], derivedSpreads,
    publishedBatches: [{ batchId: 'seed-20260824-v1', clearingDate: '2026-08-24', revision: 1, publishedAt: generatedAt, sourceKind: 'ice_eod_isda', qualityStatus: 'model-derived', rows: observations.map((row) => ({ company: row.company, icePayloadHash: row.payloadHash })) }] };
};

describe('cloud history seed', () => {
  it('keeps screenshot backfill isolated and idempotent when replayed', async () => {
    const seed = await parseSeedPackage(screenshotSeed());
    const first = await applySeedPackage(env.DB, seed);
    const second = await applySeedPackage(env.DB, seed);
    expect(first.screenshotHistory).toEqual({ inserted: 1, existing: 0, rejected: 0 });
    expect(second.screenshotHistory).toEqual({ inserted: 0, existing: 1, rejected: 0 });
    const row = await env.DB.prepare('SELECT source_kind, value_bp FROM seed_history').first<{ source_kind: string; value_bp: number }>();
    expect(row).toEqual({ source_kind: 'screenshot_backfill', value_bp: 214 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM ice_eod_revisions').first<{ count: number }>()).toEqual({ count: 0 });
  });

  it('rejects an entire package before writes when screenshot data pretends to be ICE', async () => {
    const invalid = screenshotSeed();
    invalid.screenshotHistory[0].observationDate = '2026-08-22';
    invalid.screenshotHistory[0].sourceKind = 'ice_eod_isda';
    await expect(parseSeedPackage(invalid)).rejects.toThrow('Seed package is invalid');
    expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM seed_history WHERE observation_date = '2026-08-22'`).first<{ count: number }>()).toEqual({ count: 0 });
  });

  it('imports a complete seven-company ICE batch into revision, curve, derived and published tables without relabeling screenshots', async () => {
    const seed = await parseSeedPackage(await liveSeed());
    const result = await applySeedPackage(env.DB, seed);
    expect(result).toMatchObject({
      iceObservations: { inserted: 7, existing: 0, rejected: 0 }, treasuryCurves: { inserted: 1, existing: 0, rejected: 0 },
      derivedSpreads: { inserted: 7, existing: 0, rejected: 0 }, publishedBatches: { inserted: 1, existing: 0, rejected: 0 },
    });
    expect(await env.DB.prepare(`SELECT source_kind FROM published_batches WHERE clearing_date = '2026-08-24'`).first<{ source_kind: string }>()).toEqual({ source_kind: 'ice_eod_isda' });
    expect(await applySeedPackage(env.DB, seed)).toMatchObject({ iceObservations: { inserted: 0, existing: 7 }, derivedSpreads: { inserted: 0, existing: 7 }, publishedBatches: { inserted: 0, existing: 1 } });
  });

  it('requires WRITE_TOKEN and routes seeds through the fixed Durable Object', async () => {
    const request = (token: string) => exports.default.fetch('https://collector.test/internal/v1/cds/seed', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(screenshotSeed()),
    });
    expect((await request('read-test-token')).status).toBe(401);
    const response = await request('write-test-token');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ screenshotHistory: { inserted: expect.any(Number), rejected: 0 } });
  });
});
