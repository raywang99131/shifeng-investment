import test from 'node:test';
import assert from 'node:assert/strict';

test('final time gate removes explicitly dated articles outside the requested window', async () => {
  const moduleUrl = new URL(`./newsIntelligenceTimeWindow.js?test=${Date.now()}`, import.meta.url);
  const timeModule = await import(moduleUrl.href).catch(() => ({}));

  assert.equal(typeof timeModule.filterNewsItemsSince, 'function');
  const filtered = timeModule.filterNewsItemsSince([
    { title: 'latest', published_at: 'Wed, 26 Aug 2026 10:00:00 GMT' },
    { title: 'old fallback', published_at: 'Aug 14, 2026' },
    { title: 'undated official item' },
  ], '24h', { nowMs: Date.parse('2026-08-27T08:36:24.000Z') });

  assert.deepEqual(filtered.map((item) => item.title), ['latest', 'undated official item']);
});
