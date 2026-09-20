import test from 'node:test';
import assert from 'node:assert/strict';

test('news feed keeps content time separate from check time', async () => {
  const moduleUrl = new URL(`../src/hooks/newsFeedFreshness.ts?test=${Date.now()}`, import.meta.url);
  const freshnessModule = await import(moduleUrl.href).catch(() => ({}));

  assert.equal(typeof freshnessModule.readNewsFeedFreshness, 'function');
  assert.deepEqual(freshnessModule.readNewsFeedFreshness({
    lastUpdated: '2026-08-18T14:43:54.767Z',
    lastCheckedAt: '2026-08-27T08:14:07.296Z',
    latestNewsAt: '2026-08-18T14:03:55.000Z',
    contentStale: true,
  }), {
    lastUpdated: '2026-08-18T14:43:54.767Z',
    lastCheckedAt: '2026-08-27T08:14:07.296Z',
    latestNewsAt: '2026-08-18T14:03:55.000Z',
    contentStale: true,
  });
});
