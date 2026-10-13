import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLatestTokenPriceSupplements } from '../src/pages/AIDashboard/latestTokenPriceSupplements.ts';
import { LATEST_FLAGSHIP_ROWS } from '../src/pages/AIDashboard/flagshipLatestSnapshot.ts';
import type { FlagshipPriceRow } from '../src/pages/AIDashboard/flagshipPriceSnapshot.ts';

const rows = buildLatestTokenPriceSupplements();
const modelRows = (model: string) => rows.filter(row => row.model === model);
const values = (model: string) => modelRows(model).map(row => [row.inputPrice, row.cacheReadPrice, row.outputPrice]);

test('20 single-tier rows cover the 13 requested models with first-party USD sources and original model names', () => {
  assert.equal(rows.length, 20);
  assert.deepEqual(new Set(rows.map(row => row.model)), new Set([
    'GPT-6 Astra', 'GPT-6 Sol', 'GPT-6 Luna', 'GPT-6.1 Sol', 'Claude Opus 5.5', 'Claude Sonnet 5.5',
    'Claude Haiku 5.5', 'Grok 4.7', 'Gemini 3.8 Flash', 'GLM-5.3', 'Qwen3.8-Max(0902)',
    'MiniMax M3', 'DeepSeek V4.1-Flash',
  ]));
  const keys = rows.map(row => [row.vendor, row.model, row.region, row.contextTier, row.serviceTier, row.currency].join('|'));
  assert.equal(new Set(keys).size, rows.length);
  for (const row of rows) {
    const chart = LATEST_FLAGSHIP_ROWS.find(candidate => candidate.model === row.model)!;
    assert.equal(row.sourceUrl, chart.priceSourceUrl);
    assert.equal(row.releasedAt, chart.releasedAt ?? null);
    assert.equal(row.asOf, '2026-10-13');
    assert.equal(row.retrievedAt, '2026-10-13');
    assert.equal(row.currency, 'USD');
    assert.equal(row.priceUnit, 'per_million_tokens');
    assert.equal(row.sourceKind, 'official');
    assert.equal(row.provenance.sourceUrl, row.sourceUrl);
    assert.equal(row.publicPrice, true);
    assert.ok(row.inputPrice! > 0 && row.outputPrice! > 0);
    assert.equal(row.cacheWritePrice, null);
  }
});

test('context tiers keep corresponding input, cache and output prices together', () => {
  assert.deepEqual(values('GPT-6 Astra'), [[10, 1, 50], [20, 2, 75]]);
  assert.deepEqual(values('GPT-6 Sol'), [[2, 0.2, 10]]);
  assert.deepEqual(values('GPT-6 Luna'), [[0.1, 0.01, 0.5], [0.2, 0.02, 0.75]]);
  assert.deepEqual(values('GPT-6.1 Sol'), [[2, 0.1, 10], [4, 0.2, 15]]);
  assert.deepEqual(values('Claude Haiku 5.5'), [[0.1, 0.01, 0.5], [0.5, 0.05, 2.5]]);
  assert.deepEqual(values('Grok 4.7'), [[2, 0.5, 6], [4, 1, 12]]);
  assert.deepEqual(values('MiniMax M3'), [[0.3, 0.06, 1.2], [0.6, 0.12, 2.4]]);
  assert.match(modelRows('GPT-6 Astra')[0].contextTier, /≤272K/);
  assert.match(modelRows('GPT-6 Astra')[1].contextTier, />272K/);
  assert.match(modelRows('Claude Haiku 5.5')[1].contextTier, /缓存读写合计 >100K/);
  assert.ok(modelRows('Grok 4.7').every(row => /边界/.test(row.contextTier) && /等号边界/.test(row.note!)));
});

test('peak-hour and promotional quotes retain their effective conditions', () => {
  assert.deepEqual(values('DeepSeek V4.1-Flash'), [[0.15, 0.003, 0.6], [0.3, 0.006, 1.2]]);
  assert.deepEqual(modelRows('DeepSeek V4.1-Flash').map(row => row.serviceTier), ['off-peak', 'peak']);
  assert.ok(modelRows('DeepSeek V4.1-Flash').every(row => /北京时间09–12、14–18/.test(row.note!)));
  assert.deepEqual(values('Gemini 3.8 Flash'), [[0.75, 0.075, 3.75]]);
  assert.match(modelRows('Gemini 3.8 Flash')[0].note!, /优惠至 2026-12-31/);
  assert.equal(modelRows('Qwen3.8-Max(0902)')[0].cacheReadPrice, null);
  assert.equal(modelRows('Qwen3.8-Max(0902)')[0].region, 'singapore');
  assert.equal(modelRows('GPT-6 Astra')[0].releasedAt, null);
  assert.equal(modelRows('MiniMax M3')[0].releasedAt, null);
});

test('missing or unexplained quotes remain null and do not become free API prices', () => {
  const qwen = structuredClone(LATEST_FLAGSHIP_ROWS.find(row => row.id === 'qwen-3-8-max-0902')!);
  qwen.input = { raw: '', lower: null, upper: null, kind: 'missing' };
  qwen.output = { raw: 'unknown range', lower: 1, upper: 3, kind: 'range' };
  qwen.releasedAt = undefined;
  const before = structuredClone(qwen);
  const [unpublished] = buildLatestTokenPriceSupplements([qwen]);
  assert.deepEqual([unpublished.inputPrice, unpublished.cacheReadPrice, unpublished.cacheWritePrice, unpublished.outputPrice], [null, null, null, null]);
  assert.equal(unpublished.publicPrice, false);
  assert.equal(unpublished.releasedAt, null);
  assert.deepEqual(qwen, before);
  const noSource: FlagshipPriceRow = { ...qwen, priceSourceUrl: undefined };
  assert.deepEqual(buildLatestTokenPriceSupplements([noSource]), []);
});

test('manual supplements, restricted previews and self-hosted models are not duplicated', () => {
  const excluded = new Set(['muse-wonder', 'muse-wonder-full', 'glm-5-3-flash', 'glm-5-3-flashx',
    'mimo-v2-6-pro', 'mimo-v2-6-flash', 'step-5', 'mercury-2-5', 'solar-mini4', 'longcat-2-5-preview',
    'ling-3-1-flash', 'mistral-large-4', 'kimi-k3', 'kimi-k2-8-preview', 'gemini-4-argon',
    'k2-horizon-375b-a23b', 'minicpm5-2b']);
  assert.deepEqual(buildLatestTokenPriceSupplements(LATEST_FLAGSHIP_ROWS.filter(row => excluded.has(row.id))), []);
});
