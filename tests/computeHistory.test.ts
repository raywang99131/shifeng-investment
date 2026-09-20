import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComputeHistory } from '../src/pages/AIDashboard/computeHistory.ts';
import type { ComputeRentalQuote } from '../src/pages/AIDashboard/types.ts';

const quote = (overrides = {}) => ({
  quoteKey: 'aws-h100', platform: 'AWS', gpu: 'H100', instanceSpec: 'p5.48xlarge',
  region: 'US', billingMode: 'on_demand', currency: 'USD', asOf: '2026-08-24',
  pricePerGpuHour: 4, retrievedAt: '2026-08-24T01:00:00Z', ...overrides,
}) as ComputeRentalQuote;

test('history shows every quote series, including those beyond the old fourteen-series cutoff', () => {
  const result = buildComputeHistory(Array.from({ length: 18 }, (_, i) => quote({ quoteKey: `quote-${i}`, instanceSpec: `instance-${i}` })));
  assert.equal(result.series.length, 18);
  assert.equal(new Set(result.series.map(row => row.name)).size, 18);
});

test('history preserves daily observations and leaves missing calendar days empty', () => {
  const result = buildComputeHistory([quote({ asOf: '2026-08-27', pricePerGpuHour: 5 }), quote(), quote({ asOf: '2026-08-25' })]);
  assert.deepEqual(result.dates, ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27']);
  assert.deepEqual(result.series[0].data, [4, 4, null, 5]);
  assert.equal(result.series[0].connectNulls, false);
});

test('history keeps the last actual observation when the same day is supplied out of order', () => {
  const result = buildComputeHistory([quote({ pricePerGpuHour: 6, retrievedAt: '2026-08-24T10:00:00Z' }), quote()]);
  assert.deepEqual(result.series[0].data, [6]);
});
