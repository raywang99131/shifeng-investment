import type { PriceEvent, TokenPrice } from './types.ts';

export type PricingRegion = 'all' | 'domestic' | 'overseas';

// A dated comparison rate, not a live FX quote. SAFE publishes 677.87 CNY per 100 USD.
export const TOKEN_PRICE_FX = Object.freeze({
  cnyPerUsd: 6.7787,
  asOf: '2026-09-04',
  sourceLabel: '国家外汇管理局',
  sourceUrl: 'https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do',
});

const PRICE_FIELDS = ['inputPrice', 'cacheReadPrice', 'cacheWritePrice', 'outputPrice'] as const;
type PriceValues = Pick<TokenPrice, typeof PRICE_FIELDS[number]>;

export interface UsdTokenPrice extends TokenPrice {
  originalCurrency: string;
  originalPrices: PriceValues;
  marketLabel: string | null;
}

const DOMESTIC_VENDORS = new Set([
  'deepseek', 'kimi', 'moonshot', '月之暗面', 'minimax', 'mimo', 'xiaomi', '小米',
  'qwen', '通义', 'alibaba', '阿里云', '智谱', 'zhipu', 'z.ai', 'glm',
  'doubao', '豆包', 'bytedance', '字节跳动', 'baidu', '百度', 'tencent', '腾讯', 'hunyuan', '混元',
]);

function modelOrigin(row: TokenPrice): Exclude<PricingRegion, 'all'> {
  return DOMESTIC_VENDORS.has(row.vendor.trim().toLowerCase()) ? 'domestic' : 'overseas';
}

function modelTierKey(row: TokenPrice): string {
  return [row.vendor, row.model, row.contextTier, row.serviceTier].join('|');
}

export function filterUsdTokenPrices(
  prices: TokenPrice[],
  region: PricingRegion = 'all',
  cnyPerUsd = TOKEN_PRICE_FX.cnyPerUsd,
): UsdTokenPrice[] {
  const markets = new Map<string, Set<string>>();
  for (const row of prices) {
    const key = modelTierKey(row);
    if (!markets.has(key)) markets.set(key, new Set());
    markets.get(key)!.add(`${row.region}|${row.currency}`);
  }
  return prices.filter(row => region === 'all' || modelOrigin(row) === region).map(row => {
    const currency = row.currency.toUpperCase();
    const multiplier = currency === 'USD' ? 1
      : currency === 'CNY' && Number.isFinite(cnyPerUsd) && cnyPerUsd > 0 ? 1 / cnyPerUsd : null;
    const originalPrices = Object.fromEntries(PRICE_FIELDS.map(field => [field, row[field] ?? null])) as PriceValues;
    const converted = Object.fromEntries(PRICE_FIELDS.map(field => [field,
      multiplier !== null && row[field] !== null && Number.isFinite(row[field]) ? row[field]! * multiplier : null,
    ])) as PriceValues;
    const regionLabel = ({ china: '中国区', beijing: '北京区', global: '全球区' } as Record<string, string>)[row.region.toLowerCase()] || row.region;
    return {
      ...row,
      ...converted,
      currency: 'USD',
      originalCurrency: row.currency,
      originalPrices,
      marketLabel: (markets.get(modelTierKey(row))?.size || 0) > 1 ? `${regionLabel} · ${currency} 报价` : null,
    };
  });
}

export function tokenPriceChartLabel(row: UsdTokenPrice): string {
  return [row.model,
    row.contextTier && row.contextTier !== 'standard' ? row.contextTier : null,
    row.serviceTier && row.serviceTier !== 'standard' ? row.serviceTier : null,
    row.marketLabel,
  ].filter(Boolean).join(' · ');
}

export interface PricingNewsItem {
  id: string;
  vendor: string;
  kind: 'announcement' | 'observation';
  title: string;
  publishedAt: string;
  effectiveAt?: string;
  paragraphs: string[];
  details: string[];
  sourceLabel: string;
  sourceUrl: string;
  pricingUrl?: string;
}

// Verified official announcement and current price schedule, checked 2026-09-06.
const OFFICIAL_PRICING_NEWS: PricingNewsItem[] = [{
  id: 'deepseek-v4-pricing-20260813',
  vendor: 'DeepSeek',
  kind: 'announcement',
  title: 'DeepSeek V4 API 调价，新增峰谷两档',
  publishedAt: '2026-08-13',
  effectiveAt: '2026-08-17T00:00:00+08:00',
  paragraphs: [
    'DeepSeek 随 V4-Pro 正式版发布调整 V4 系列 API 价格，引入高峰与非高峰计费；非高峰价格为高峰的一半。',
    '按每百万 Token 计，V4-Flash 输入价为 $0.22–$0.44、输出价为 $0.66–$1.32；V4-Pro 输入价为 $0.66–$1.32、输出价为 $1.98–$3.96。输入价指缓存未命中。',
    '高峰时段为北京时间工作日 09:00–12:00、14:00–18:00，其余时段按非高峰价格计费。',
  ],
  details: [],
  sourceLabel: 'DeepSeek 官方公告',
  sourceUrl: 'https://api-docs.deepseek.com/zh-cn/news/news260813/',
  pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing/',
}];

const PRICE_FIELD_LABELS: Record<PriceEvent['priceField'], string> = {
  inputPrice: '输入', cacheReadPrice: '缓存读取', cacheWritePrice: '缓存写入', outputPrice: '输出',
};

export function buildPricingNews(events: PriceEvent[]): PricingNewsItem[] {
  const grouped = new Map<string, PriceEvent[]>();
  for (const event of events) {
    const key = [event.vendor, event.model, event.contextTier, event.serviceTier, event.region, event.currency, event.asOf, event.sourceUrl].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(event);
  }
  const observations: PricingNewsItem[] = [...grouped.entries()].map(([id, changes]) => {
    const row = changes[0];
    const money = (value: number) => new Intl.NumberFormat('en-US', {
      style: 'currency', currency: row.currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
    }).format(value);
    return {
      id, vendor: row.vendor, kind: 'observation',
      title: `${row.model} API 价格更新`,
      publishedAt: row.asOf,
      paragraphs: [`官网价格跟踪发现${changes.map(change => PRICE_FIELD_LABELS[change.priceField]).join('、')}发生变化${row.contextTier !== 'standard' ? `，适用于 ${row.contextTier} 档` : ''}。以下金额均按每百万 Token 计。`],
      details: changes.map(change => `${PRICE_FIELD_LABELS[change.priceField]}：${money(change.oldPrice)} → ${money(change.newPrice)}`),
      sourceLabel: row.sourceLabel, sourceUrl: row.sourceUrl,
    };
  });
  return [...OFFICIAL_PRICING_NEWS, ...observations].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
