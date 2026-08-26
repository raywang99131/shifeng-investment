import { describe, expect, it } from 'vitest';
import curveFixture from './fixtures/treasury-2026.csv?raw';
import { cleanPriceToParSpread, validateDiscountCurve } from '../src/domain/spread';
import { fetchTreasuryCurve } from '../src/sources/treasury';
// Existing Node source intentionally has no TypeScript declaration; this test is its parity boundary.
// @ts-expect-error JavaScript server module has no declaration file.
import { cleanPriceToParSpread as serverCleanPriceToParSpread } from '../../../server/lib/isdaCdsSpread.js';

describe('Worker spread parity', () => {
  it('matches the existing server estimator on the same ICE/Treasury fixture with a small round-trip residual', async () => {
    const curve = await fetchTreasuryCurve(
      async () => new Response(curveFixture, { headers: { 'content-type': 'text/csv' } }),
      '2026-08-24',
      new Date('2026-08-25T00:00:00.000Z'),
    );
    const input = {
      couponBp: 100,
      cleanPrice: 95.0309,
      clearingDate: '2026-08-24',
      maturityDate: '2031-06-20',
      recoveryRate: 0.4,
      discountCurve: curve,
    };
    const workerResult = cleanPriceToParSpread(input);
    const serverResult = serverCleanPriceToParSpread(input) as { spreadBp: number; roundTripPrice: number };
    expect(workerResult.spreadBp).toBeCloseTo(serverResult.spreadBp, 8);
    expect(workerResult.roundTripPrice).toBeCloseTo(serverResult.roundTripPrice, 8);
    expect(workerResult.priceResidual).toBeLessThanOrEqual(0.005);
  });

  it('validates strictly ascending USD curves before pricing', () => {
    expect(() => validateDiscountCurve({
      curveId: 'bad', asOf: '2026-08-24', currency: 'USD', nodes: [
        { years: 1, zeroRate: 0.04 }, { years: 1, zeroRate: 0.05 },
      ],
    } as never)).toThrow(/ascending|unique/i);
  });
});
