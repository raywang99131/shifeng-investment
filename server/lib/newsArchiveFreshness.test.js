import test from 'node:test';
import assert from 'node:assert/strict';

test('news freshness ignores newer price-watch entries', async () => {
  const moduleUrl = new URL(`./newsArchiveFreshness.js?test=${Date.now()}`, import.meta.url);
  const freshnessModule = await import(moduleUrl.href).catch(() => ({}));

  assert.equal(typeof freshnessModule.getNewsArchiveFreshness, 'function');
  const freshness = freshnessModule.getNewsArchiveFreshness({
    lastCheckedAt: '2026-08-27T08:14:07.296Z',
    entries: [
      {
        type: 'news-intelligence',
        createdAt: '2026-08-27T08:20:00.000Z',
        news: [{ collectionChannel: 'rss', title: 'undated item' }],
      },
      {
        type: 'price-watch',
        createdAt: '2026-08-27T07:44:06.440Z',
        news: [{ collectionChannel: 'price-watch', time: '2026-08-27T15:00:00+08:00' }],
      },
      {
        type: 'news-intelligence',
        createdAt: '2026-08-18T14:43:54.767Z',
        news: [{ collectionChannel: 'rss', time: 'Tue, 18 Aug 2026 22:03:55 +0800' }],
      },
    ],
  }, {
    nowMs: Date.parse('2026-08-27T08:30:00.000Z'),
    staleAfterMs: 24 * 60 * 60 * 1000,
  });

  assert.deepEqual(freshness, {
    latestNewsAt: '2026-08-18T14:03:55.000Z',
    lastCheckedAt: '2026-08-27T08:14:07.296Z',
    contentStale: true,
  });
});

test('stale content expands the next incremental refresh window', async () => {
  const { getNewsIncrementalSince } = await import('./newsArchiveFreshness.js');
  assert.equal(typeof getNewsIncrementalSince, 'function');
  const since = getNewsIncrementalSince({
    lastCheckedAt: '2026-08-27T08:14:07.296Z',
    entries: [{
      type: 'news-intelligence',
      createdAt: '2026-08-18T14:43:54.767Z',
      news: [{ collectionChannel: 'rss', time: 'Tue, 18 Aug 2026 22:03:55 +0800' }],
    }],
  }, { nowMs: Date.parse('2026-08-27T08:36:24.000Z') });

  assert.equal(since, '7d');
});
