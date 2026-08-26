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
    publishedBatches: [{ batchId: 'seed-20260824-v1', clearingDate: '2026-08-24', revision: 1, publishedAt: generatedAt, sourceKind: 'ice_eod_isda', qualityStatus: 'model-derived', rows: observations.map((row) => ({ company: row.company, icePayloadHash: row.payloadHash, curveId: curve.curveId, modelVersion: derivedSpreads.find((spread) => spread.company === row.company)!.modelVersion, instrumentName: row.instrumentName })) }] };
};

const hashObservation = async (row: { clearingDate: string; company: string; iceName: string; instrumentName: string; eodPrice: number; couponBp: number }) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ clearingDate: row.clearingDate, company: row.company, name: row.iceName.trim(), instrumentName: row.instrumentName.trim().toUpperCase(), eodPrice: row.eodPrice, couponBp: row.couponBp })));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const correctedSeed = async () => {
  const seed = await liveSeed();
  seed.iceObservations = await Promise.all(seed.iceObservations.map(async (row) => {
    if (row.company !== 'Oracle') return row;
    const corrected = { ...row, eodPrice: row.eodPrice - 0.01, retrievedAt: '2026-08-25T01:00:00.000Z' };
    return { ...corrected, payloadHash: await hashObservation(corrected) };
  }));
  const oracle = seed.iceObservations.find((row) => row.company === 'Oracle')!;
  const curve = seed.treasuryCurves[0];
  const result = cleanPriceToParSpread({ couponBp: oracle.couponBp, cleanPrice: oracle.eodPrice, clearingDate: oracle.clearingDate, maturityDate: parseIceInstrumentName(oracle.instrumentName).maturityDate, recoveryRate: 0.4, discountCurve: curve });
  seed.derivedSpreads = seed.derivedSpreads.map((row) => row.company === 'Oracle' ? { ...row, icePayloadHash: oracle.payloadHash, eodPrice: oracle.eodPrice, spreadBp: result.spreadBp, roundTripPrice: result.roundTripPrice, priceResidual: result.priceResidual, hazardRate: result.hazardRate, createdAt: '2026-08-25T01:00:00.000Z' } : row);
  seed.publishedBatches[0] = { ...seed.publishedBatches[0], batchId: 'seed-20260824-v2', revision: 2, publishedAt: '2026-08-25T01:00:00.000Z', rows: seed.publishedBatches[0].rows.map((row) => row.company === 'Oracle' ? { ...row, icePayloadHash: oracle.payloadHash } : row) };
  return seed;
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

  it('rejects tampered model provenance before D1 writes', async () => {
    const invalid = await liveSeed(); invalid.publishedBatches[0].batchId = 'bad-provenance-v1'; invalid.derivedSpreads[0].spreadBp += 1;
    const badHash = await liveSeed(); badHash.treasuryCurves[0].payloadHash = '0'.repeat(64);
    const missingNode = await liveSeed(); missingNode.treasuryCurves[0].nodes.pop();
    const badResidual = await liveSeed(); badResidual.derivedSpreads[0].priceResidual = 0.006;
    for (const candidate of [invalid, badHash, missingNode, badResidual]) await expect(parseSeedPackage(candidate)).rejects.toThrow('Seed package is invalid');
    expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM published_batches WHERE batch_id = 'bad-provenance-v1'`).first<{ count: number }>()).toEqual({ count: 0 });
  });

  it('does not rewind current pointers when an old seed replays after a newer batch', async () => {
    const first = await parseSeedPackage(await liveSeed());
    await applySeedPackage(env.DB, first);
    const newer = await parseSeedPackage(await correctedSeed());
    await applySeedPackage(env.DB, newer);
    await applySeedPackage(env.DB, first);
    expect(await env.DB.prepare(`SELECT revision FROM published_batches AS batches JOIN published_batch_current AS current USING (batch_id) WHERE current.clearing_date = '2026-08-24'`).first<{ revision: number }>()).toEqual({ revision: 2 });
    expect(await env.DB.prepare(`SELECT revisions.eod_price FROM ice_eod_current AS current JOIN ice_eod_revisions AS revisions USING (revision_id) WHERE current.clearing_date = '2026-08-24' AND current.company = 'Oracle'`).first<{ eod_price: number }>()).toEqual({ eod_price: (await correctedSeed()).iceObservations.find((row) => row.company === 'Oracle')!.eodPrice });
  });

  it('rejects natural-key conflicts for screenshot, derived and batch records before writes', async () => {
    const screenshot = screenshotSeed(); screenshot.screenshotHistory[0].observationDate = '2026-08-23';
    await applySeedPackage(env.DB, await parseSeedPackage(screenshot));
    const changedScreenshot = structuredClone(screenshot); changedScreenshot.screenshotHistory[0].note = 'changed';
    await expect(applySeedPackage(env.DB, await parseSeedPackage(changedScreenshot))).rejects.toThrow('Seed package is invalid');
    const existing = await parseSeedPackage(await liveSeed()); await applySeedPackage(env.DB, existing);
    const changedCurve = structuredClone(existing); changedCurve.treasuryCurves[0].retrievedAt = '2026-08-25T02:00:00.000Z';
    await expect(applySeedPackage(env.DB, await parseSeedPackage(changedCurve))).rejects.toThrow('Seed package is invalid');
    const changedDerived = structuredClone(existing); changedDerived.derivedSpreads[0].createdAt = '2026-08-25T02:00:00.000Z';
    await expect(applySeedPackage(env.DB, await parseSeedPackage(changedDerived))).rejects.toThrow('Seed package is invalid');
    const changedBatch = structuredClone(existing); changedBatch.publishedBatches[0].batchId = 'different-batch-id';
    await expect(applySeedPackage(env.DB, await parseSeedPackage(changedBatch))).rejects.toThrow('Seed package is invalid');
    const beforeReuse = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ice_eod_revisions WHERE retrieved_at = '2026-08-25T01:00:00.000Z'`).first<{ count: number }>();
    const reusedBatchId = await correctedSeed(); reusedBatchId.publishedBatches[0].batchId = 'seed-20260824-v1';
    await expect(applySeedPackage(env.DB, await parseSeedPackage(reusedBatchId))).rejects.toThrow('Seed package is invalid');
    expect(await env.DB.prepare(`SELECT COUNT(*) AS count FROM ice_eod_revisions WHERE retrieved_at = '2026-08-25T01:00:00.000Z'`).first<{ count: number }>()).toEqual(beforeReuse);
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

  it('reconstructs every seeded audit section through full export pagination', async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM published_batch_current'), env.DB.prepare('DELETE FROM published_batch_rows'), env.DB.prepare('DELETE FROM published_batches'),
      env.DB.prepare('DELETE FROM cds_spread_revisions'), env.DB.prepare('DELETE FROM ice_eod_current'), env.DB.prepare('DELETE FROM ice_eod_revisions'),
      env.DB.prepare('DELETE FROM treasury_curve_nodes'), env.DB.prepare('DELETE FROM treasury_curves'), env.DB.prepare('DELETE FROM seed_history'),
    ]);
    const screenshot = screenshotSeed(); screenshot.screenshotHistory[0].observationDate = '2026-08-23';
    const live = await liveSeed();
    await applySeedPackage(env.DB, await parseSeedPackage(screenshot));
    await applySeedPackage(env.DB, await parseSeedPackage(live));
    const request = (cursor?: string) => exports.default.fetch(`https://collector.test/v1/cds/export-source?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { authorization: 'Bearer read-test-token' } });
    const entries: Array<{ section: string; record: any }> = []; let cursor: string | null = null;
    do {
      const response = await request(cursor ?? undefined); expect(response.status).toBe(200);
      const page = await response.json<{ data: Array<{ section: string; record: any }>; nextCursor: string | null }>();
      entries.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    const section = (name: string) => entries.filter((entry) => entry.section === name).map((entry) => entry.record);
    expect(section('seed_history')).toEqual([expect.objectContaining({ observationDate: '2026-08-23', company: 'Oracle', sourceKind: 'screenshot_backfill' })]);
    const raw = section('ice_eod_revisions'); const current = section('ice_eod_current'); const curves = section('treasury_curves'); const derived = section('cds_spread_revisions'); const batches = section('published_batches'); const batchCurrent = section('published_batch_current');
    expect([raw.length, current.length, curves.length, derived.length, batches.length, batchCurrent.length]).toEqual([7, 7, 1, 7, 1, 1]);
    expect(curves[0]).toMatchObject({ curveId: live.treasuryCurves[0].curveId, payloadHash: live.treasuryCurves[0].payloadHash }); expect(curves[0].nodes).toHaveLength(14);
    expect(current.map((row) => row.revisionId).sort((a, b) => a - b)).toEqual(raw.map((row) => row.revisionId).sort((a, b) => a - b));
    expect(derived.every((row) => raw.some((source) => source.revisionId === row.iceRevisionId && source.payloadHash === live.iceObservations.find((observation) => observation.company === row.company)!.payloadHash) && row.curveId === curves[0].curveId)).toBe(true);
    expect(batches[0]).toMatchObject({ batchId: live.publishedBatches[0].batchId, clearingDate: '2026-08-24', revision: 1, sourceKind: 'ice_eod_isda' }); expect(batches[0].rows).toHaveLength(7);
    expect((batches[0].rows as Array<{ spreadRevisionId: number }>).map((row) => row.spreadRevisionId).sort((a, b) => a - b)).toEqual(derived.map((row) => row.spreadRevisionId).sort((a, b) => a - b));
    expect(batchCurrent).toEqual([{ clearingDate: '2026-08-24', batchId: batches[0].batchId }]);
  });
});
