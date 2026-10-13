import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPricingNews, filterUsdTokenPrices, mergeCodingPlanSupplements, mergeTokenPriceSupplements, tokenPriceChartLabel, tokenPriceHasQuote } from '../src/pages/AIDashboard/pricingViewModel.ts';
import type { PriceEvent, TokenPrice } from '../src/pages/AIDashboard/types.ts';

const price = (overrides: Partial<TokenPrice> = {}): TokenPrice => ({
  vendor: 'MiniMax', model: 'MiniMax M3', region: 'global', contextTier: 'standard', serviceTier: 'standard',
  currency: 'CNY', priceUnit: 'per_million_tokens', inputPrice: 7, cacheReadPrice: 0, cacheWritePrice: null, outputPrice: 14,
  sourceLabel: '官网', sourceUrl: 'https://example.test/pricing', sourceKind: 'official', asOf: '2026-09-06',
  retrievedAt: '2026-09-06T00:00:00Z', provenance: {} as TokenPrice['provenance'], ...overrides,
});

test('CNY prices divide by CNY per USD, USD stays unchanged, and source values remain intact', () => {
  const original = price();
  const usd = price({ vendor: 'OpenAI', model: 'GPT', currency: 'USD', inputPrice: 5 });
  const rows = filterUsdTokenPrices([original, usd], 'all', 7);
  assert.deepEqual([rows[0].inputPrice, rows[0].cacheReadPrice, rows[0].cacheWritePrice, rows[0].outputPrice], [1, 0, null, 2]);
  assert.equal(rows[1].inputPrice, 5);
  assert.equal(rows[0].currency, 'USD');
  assert.equal(rows[0].originalCurrency, 'CNY');
  assert.equal(rows[0].originalPrices.inputPrice, 7);
  assert.equal(original.currency, 'CNY');
  assert.equal(original.inputPrice, 7);
  assert.equal(filterUsdTokenPrices([original], 'all', 0)[0].inputPrice, null);
  assert.equal(filterUsdTokenPrices([price({ currency: 'EUR' })], 'all', 7)[0].inputPrice, null);
});

test('domestic models are classified by vendor origin even when they have global USD prices', () => {
  const prices = ['DeepSeek', 'Kimi', '智谱', 'Qwen', 'MiniMax', 'MiMo', 'OpenAI', 'Anthropic', 'Gemini', 'xAI']
    .map(vendor => price({ vendor, model: vendor, currency: 'USD', region: 'global' }));
  assert.deepEqual(filterUsdTokenPrices(prices, 'domestic').map(row => row.vendor), ['DeepSeek', 'Kimi', '智谱', 'Qwen', 'MiniMax', 'MiMo']);
  assert.deepEqual(filterUsdTokenPrices(prices, 'overseas').map(row => row.vendor), ['OpenAI', 'Anthropic', 'Gemini', 'xAI']);
  assert.equal(filterUsdTokenPrices(prices, 'all').length, 10);
});

test('different regional prices for the same model are retained and clearly distinguished', () => {
  const prices = filterUsdTokenPrices([
    price({ vendor: 'MiMo', model: 'MiMo V2.5 Pro', region: 'China' }),
    price({ vendor: 'MiMo', model: 'MiMo V2.5 Pro', region: 'global', currency: 'USD' }),
  ]);
  assert.equal(prices.length, 2);
  assert.match(tokenPriceChartLabel(prices[0]), /中国区/);
  assert.match(tokenPriceChartLabel(prices[1]), /全球区/);
  assert.notEqual(tokenPriceChartLabel(prices[0]), tokenPriceChartLabel(prices[1]));
});

test('official news keeps its publication date separate from effective date and price observations', () => {
  const event = {
    id: 'input', vendor: 'OpenAI', model: 'GPT', contextTier: 'standard', serviceTier: 'standard', region: 'global',
    currency: 'USD', priceUnit: 'per_million_tokens', priceField: 'inputPrice', oldPrice: 1, newPrice: 2,
    absoluteDelta: 1, percentDelta: 100, previousAsOf: '2026-09-01', asOf: '2026-09-06',
    sourceLabel: 'OpenAI 官网', sourceUrl: 'https://example.test/pricing', provenance: {},
  } as PriceEvent;
  const news = buildPricingNews([event, { ...event, id: 'output', priceField: 'outputPrice', oldPrice: 2, newPrice: 4 }]);
  assert.equal(news.length, 2);
  assert.equal(news[0].kind, 'observation');
  assert.equal(news[0].details.length, 2);
  assert.equal(news[0].publishedAt, '2026-09-06');
  const deepseek = news.find(item => item.vendor === 'DeepSeek')!;
  assert.equal(deepseek.kind, 'announcement');
  assert.equal(deepseek.publishedAt, '2026-08-13');
  assert.equal(deepseek.effectiveAt, '2026-08-17T00:00:00+08:00');
  assert.match(deepseek.sourceUrl, /^https:\/\/api-docs\.deepseek\.com\//);
});

test('dated additions retain newer or undated collected quotes, distinct markets and tiers, and do not mutate input', () => {
  const old = price({ vendor: 'Meta', model: 'Muse Wonder', currency: 'USD', asOf: '2026-10-01', inputPrice: 9 });
  const current = { ...old, asOf: '2026-10-14', inputPrice: 3 };
  const manual = { ...old, asOf: '2026-10-13', inputPrice: 4 };
  const regional = { ...old, region: 'china', currency: 'CNY' };
  const tier = { ...old, contextTier: '>1M' };
  const rows = mergeTokenPriceSupplements([old, regional, tier], [manual]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].inputPrice, 4);
  assert.equal(rows[1], regional);
  assert.equal(rows[2], tier);
  assert.equal(old.inputPrice, 9);
  for (const existing of [current, { ...old, asOf: '' }, { ...manual, inputPrice: 5 }]) {
    assert.equal(mergeTokenPriceSupplements([existing], [manual])[0], existing);
  }
});

test('official supplements put newly added models in the original price table without inventing Full API bars', () => {
  const existing = price();
  const rows = mergeTokenPriceSupplements([existing]);
  assert.equal(rows.length, 5);
  assert.equal(rows.at(-1), existing);
  const wonder = rows.find(row => row.model === 'Muse Wonder')!;
  assert.deepEqual([wonder.inputPrice, wonder.cacheReadPrice, wonder.outputPrice], [4, 0.2, 20]);
  assert.equal(wonder.releasedAt, '2026-10-12');
  assert.equal(wonder.asOf, '2026-10-13');
  assert.equal(wonder.sourceKind, 'official');
  const full = rows.find(row => row.model === 'Muse Wonder Full')!;
  assert.deepEqual([full.inputPrice, full.cacheReadPrice, full.cacheWritePrice, full.outputPrice], [null, null, null, null]);
  assert.equal(full.publicPrice, false);
  assert.equal(tokenPriceHasQuote(full), false);
  assert.equal(tokenPriceHasQuote(price({ inputPrice: 0, cacheReadPrice: null, outputPrice: null })), true);
  const flash = rows.find(row => row.model === 'GLM-5.3-Flash')!;
  assert.deepEqual([flash.inputPrice, flash.cacheReadPrice, flash.outputPrice], [0.15, 0.03, 0.5]);
  assert.equal(flash.releasedAt, '2026-08-26');
  const flashX = rows.find(row => row.model === 'GLM-5.3-FlashX')!;
  assert.deepEqual([flashX.inputPrice, flashX.cacheReadPrice, flashX.outputPrice], [0.37, 0.075, 1.25]);
  assert.equal(flashX.releasedAt, null);
});

test('Muse Code plans preserve monthly subscription units, separate allowances and later collected prices', () => {
  const rows = mergeCodingPlanSupplements([]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.monthlyPrice), [50, 200]);
  assert.match(rows[0].allowanceText!, /20x/);
  assert.match(rows[1].allowanceText!, /80x/);
  assert.ok(rows.every(row => row.annualPrice === null && row.currency === 'USD' && row.sourceKind === 'official'));
  const current = { ...rows[0], monthlyPrice: 45, asOf: '2026-10-14' };
  assert.equal(mergeCodingPlanSupplements([current]).find(row => row.plan === current.plan), current);
});
