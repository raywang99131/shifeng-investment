import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPricingNews, filterUsdTokenPrices, tokenPriceChartLabel } from '../src/pages/AIDashboard/pricingViewModel.ts';
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
