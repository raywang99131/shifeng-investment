import test from 'node:test';
import assert from 'node:assert/strict';

test('cross-channel deduplication keeps the more authoritative source', async () => {
  const moduleUrl = new URL(`./newsIntelligence.js?dedup-test=${Date.now()}`, import.meta.url);
  const newsModule = await import(moduleUrl.href);

  assert.equal(typeof newsModule.dedupeSkillNews, 'function');
  const result = newsModule.dedupeSkillNews([
    {
      title: 'A major model release',
      url: 'https://example.test/releases/model?utm_source=media',
      source: 'Industry Media',
      sourceCategory: 'media',
    },
    {
      title: 'A major model release',
      url: 'https://example.test/releases/model',
      source: 'Official Lab',
      sourceCategory: 'official',
    },
    {
      title: 'A separate academic paper',
      url: 'https://example.test/papers/1',
      source: 'Academic Archive',
      sourceCategory: 'academic',
    },
  ]);

  assert.deepEqual(result.map((item) => item.source), ['Official Lab', 'Academic Archive']);
});
