import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSpotRefreshState, staleRefreshDescription } from '../src/pages/TMTMargin/spotRefreshState.ts';

test('failed refresh keeps stale data and exposes its old trading date', () => {
  const state = deriveSpotRefreshState({
    success: false,
    cached: true,
    stale: true,
    staleDataDate: '20260717',
    generatedAt: '2026-07-17T09:57:46.000Z',
    refreshError: '东方财富上游连接超时',
    data: {
      trading_congestion: { date: '20260717' },
    },
  });

  assert.equal(state.stale, true);
  assert.equal(state.staleDataDate, '20260717');
  assert.equal(state.refreshError, '东方财富上游连接超时');
  assert.deepEqual(state.data, { trading_congestion: { date: '20260717' } });
  assert.match(staleRefreshDescription(state), /2026-07-17/);
  assert.match(staleRefreshDescription(state), /东方财富上游连接超时/);
});

test('successful refresh clears stale metadata', () => {
  const state = deriveSpotRefreshState({
    success: true,
    cached: false,
    stale: false,
    generatedAt: '2026-07-21T07:00:00.000Z',
    data: { trading_congestion: { date: '20260721' } },
  });

  assert.equal(state.stale, false);
  assert.equal(state.refreshError, '');
  assert.equal(state.staleDataDate, '');
  assert.equal(staleRefreshDescription(state), '');
});
