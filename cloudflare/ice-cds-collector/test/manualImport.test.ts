import { describe, expect, it } from 'vitest';
import completeFixture from './fixtures/ice-complete.json';
import treasuryFixture from './fixtures/treasury-2026.csv?raw';
import { parseManualImport } from '../src/manualImport';
import { fetchIceObservations } from '../src/sources/ice';
import { fetchTreasuryCurve, TREASURY_CURVE_GRID, TREASURY_CURVE_SOURCE_LABEL } from '../src/sources/treasury';

const now = new Date('2026-08-25T12:00:00.000Z');
const fetchFixture: typeof fetch = async (input) => String(input).includes('icc-single-names')
  ? new Response(JSON.stringify(completeFixture), { headers: { 'content-type': 'application/json' } })
  : new Response(treasuryFixture, { headers: { 'content-type': 'text/csv' } });

describe('manual Treasury curve canonicalization', () => {
  it('replays automatic Treasury content with the exact same canonical identity and full maturity grid', async () => {
    const observations = (await fetchIceObservations(fetchFixture, now)).rows;
    const automatic = await fetchTreasuryCurve(fetchFixture, '2026-08-24', now);
    const manual = await parseManualImport({ observations, treasuryCurve: automatic }, now);
    expect(manual.treasuryCurve).toMatchObject({
      curveId: automatic.curveId, payloadHash: automatic.payloadHash, sourceLabel: TREASURY_CURVE_SOURCE_LABEL,
    });
    expect(manual.treasuryCurve.nodes.map((node) => node.years)).toEqual(TREASURY_CURVE_GRID.map(([, years]) => years));
  });

  it('rejects a changed label or a fabricated/incomplete maturity grid before writing', async () => {
    const observations = (await fetchIceObservations(fetchFixture, now)).rows;
    const automatic = await fetchTreasuryCurve(fetchFixture, '2026-08-24', now);
    await expect(parseManualImport({ observations, treasuryCurve: { ...automatic, sourceLabel: 'Other label' } }, now)).rejects.toThrow('Manual import is invalid');
    await expect(parseManualImport({ observations, treasuryCurve: { ...automatic, nodes: automatic.nodes.slice(0, 1) } }, now)).rejects.toThrow('Manual import is invalid');
  });
});
