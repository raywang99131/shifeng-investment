import { LATEST_FLAGSHIP_ROWS, LATEST_MODEL_REVIEW } from './flagshipLatestSnapshot.ts';
import type { FlagshipPriceRow, FlagshipPriceValue } from './flagshipPriceSnapshot.ts';
import type { TokenPrice } from './types.ts';

interface QuoteTier {
  contextTier: string;
  edge: 'lower' | 'upper';
  serviceTier?: string;
  cacheReadPrice?: number | null;
  note?: string;
}

interface ModelQuoteRule {
  id: string;
  vendor: string;
  generation: string;
  region?: string;
  tiers: readonly QuoteTier[];
  note?: string;
}

const STANDARD: QuoteTier = { contextTier: 'standard', edge: 'lower' };
const SHORT_272K: QuoteTier = { contextTier: '输入 ≤272K Tokens', edge: 'lower' };
const LONG_272K: QuoteTier = { contextTier: '输入 >272K Tokens', edge: 'upper' };

// Only verified first-party USD quotes missing from the original pricing table.
// Cache prices for split tiers are explicit verified values, not inferred ratios.
const MODEL_QUOTE_RULES: readonly ModelQuoteRule[] = [
  { id: 'gpt-6-astra', vendor: 'OpenAI', generation: 'GPT-6', tiers: [
    { ...SHORT_272K, cacheReadPrice: 1 }, { ...LONG_272K, cacheReadPrice: 2 },
  ] },
  { id: 'gpt-6-sol', vendor: 'OpenAI', generation: 'GPT-6', tiers: [SHORT_272K],
    note: '仅补充已核实的输入 ≤272K 标准服务报价；未推算更长上下文或其他服务档。' },
  { id: 'gpt-6-luna', vendor: 'OpenAI', generation: 'GPT-6', tiers: [
    { ...SHORT_272K, cacheReadPrice: 0.01 }, { ...LONG_272K, cacheReadPrice: 0.02 },
  ] },
  { id: 'gpt-6-1-sol', vendor: 'OpenAI', generation: 'GPT-6.1', tiers: [
    { ...SHORT_272K, cacheReadPrice: 0.1 }, { ...LONG_272K, cacheReadPrice: 0.2 },
  ] },
  { id: 'claude-opus-5-5', vendor: 'Anthropic', generation: 'Claude 5.5', tiers: [STANDARD] },
  { id: 'claude-sonnet-5-5', vendor: 'Anthropic', generation: 'Claude 5.5', tiers: [STANDARD] },
  { id: 'claude-haiku-5-5', vendor: 'Anthropic', generation: 'Claude 5.5', tiers: [
    { contextTier: '输入及缓存读写合计 ≤100K Tokens', edge: 'lower', cacheReadPrice: 0.01 },
    { contextTier: '输入及缓存读写合计 >100K Tokens', edge: 'upper', cacheReadPrice: 0.05 },
  ] },
  { id: 'grok-4-7', vendor: 'xAI', generation: 'Grok 4.7', tiers: [
    { contextTier: '短上下文（约200K阈值，边界见说明）', edge: 'lower', cacheReadPrice: 0.5 },
    { contextTier: '长上下文（约200K阈值，边界见说明）', edge: 'upper', cacheReadPrice: 1 },
  ] },
  { id: 'gemini-3-8-flash', vendor: 'Gemini', generation: 'Gemini 3.8', tiers: [STANDARD],
    note: '本行采用截至核对日生效、优惠至 2026-12-31 的价格。' },
  { id: 'glm-5-3', vendor: '智谱', generation: 'GLM-5.3', tiers: [STANDARD] },
  { id: 'qwen-3-8-max-0902', vendor: 'Qwen', generation: 'Qwen3.8', region: 'singapore', tiers: [STANDARD],
    note: '新加坡国际标准服务的第一方美元报价；未使用国内人民币价格换算。' },
  { id: 'minimax-m3', vendor: 'MiniMax', generation: 'MiniMax M3', tiers: [
    { contextTier: '上下文 ≤512K Tokens', edge: 'lower', cacheReadPrice: 0.06 },
    { contextTier: '上下文 >512K Tokens', edge: 'upper', cacheReadPrice: 0.12 },
  ] },
  { id: 'deepseek-v4-1-flash', vendor: 'DeepSeek', generation: 'DeepSeek V4.1', tiers: [
    { ...STANDARD, serviceTier: 'off-peak', edge: 'lower', cacheReadPrice: 0.003, note: '当前行：低谷时段。' },
    { ...STANDARD, serviceTier: 'peak', edge: 'upper', cacheReadPrice: 0.006, note: '当前行：高峰时段。' },
  ] },
];

function finitePrice(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function tierPrice(value: FlagshipPriceValue, edge: QuoteTier['edge']): number | null {
  // A continuous or unexplained range cannot be turned into a billing tier.
  return value.kind === 'fixed' || value.kind === 'tiered' ? finitePrice(value[edge]) : null;
}

export function buildLatestTokenPriceSupplements(
  snapshot: readonly FlagshipPriceRow[] = LATEST_FLAGSHIP_ROWS,
): TokenPrice[] {
  return MODEL_QUOTE_RULES.flatMap(rule => {
    const row = snapshot.find(candidate => candidate.id === rule.id);
    if (!row?.priceSourceUrl) return [];
    const sourceLabel = `${rule.vendor} 官方 API 价格说明`;
    return rule.tiers.map(tier => {
      const inputPrice = tierPrice(row.input, tier.edge);
      const outputPrice = tierPrice(row.output, tier.edge);
      const hasQuote = inputPrice !== null || outputPrice !== null;
      const cacheReadPrice = hasQuote ? finitePrice(
        Object.hasOwn(tier, 'cacheReadPrice') ? tier.cacheReadPrice : row.cacheReadPrice,
      ) : null;
      return {
        vendor: rule.vendor, model: row.model, generation: rule.generation, releasedAt: row.releasedAt ?? null,
        region: rule.region || 'global', category: 'text', contextTier: tier.contextTier,
        serviceTier: tier.serviceTier || 'standard', currency: 'USD', priceUnit: 'per_million_tokens',
        originalUnit: 'USD / 1M Tokens', publicPrice: hasQuote, currentGeneration: true,
        inputPrice, cacheReadPrice, cacheWritePrice: null, outputPrice,
        sourceLabel, sourceUrl: row.priceSourceUrl!, sourceKind: 'official',
        asOf: LATEST_MODEL_REVIEW.date, retrievedAt: LATEST_MODEL_REVIEW.date,
        note: [tier.contextTier === 'standard' ? null : `当前行：${tier.contextTier}`,
          tier.note, rule.note, row.note, row.detailNote].filter(Boolean).join('；'),
        provenance: {
          sourceLabel, sourceUrl: row.priceSourceUrl!, sourceKind: 'official',
          asOf: LATEST_MODEL_REVIEW.date, retrievedAt: LATEST_MODEL_REVIEW.date, stale: false,
          methodology: '复用最新对比图中已核实的厂商第一方 USD 报价，按明确上下文或时段拆成单档；不采用 AA 参考价格，不由人民币换算；未知日期及缓存价格保留为空。',
        },
      };
    });
  });
}
