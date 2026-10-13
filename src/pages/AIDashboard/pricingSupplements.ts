import type { CodingPlan, MetricProvenance, TokenPrice } from './types.ts';

const VERIFIED_AT = '2026-10-13';
const META_PRICING_URL = 'https://dev.meta.ai/docs/pricing-rate-limits';
const META_MODEL_URL = 'https://dev.meta.ai/models/muse-wonder';
const META_DATE_NOTE = '官方发布页日期为 2026-10-12；财通海外纪要日期为 2026-10-13。';

function officialProvenance(sourceLabel: string, sourceUrl: string): MetricProvenance {
  return {
    sourceLabel, sourceUrl, sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
    methodology: '按厂商官方页面人工核对；API 单价与月度订阅分别列示，未公开的价格保留为空。',
    stale: false,
  };
}

const metaTokenBase: Omit<TokenPrice, 'model' | 'inputPrice' | 'cacheReadPrice' | 'outputPrice'> = {
  vendor: 'Meta', region: 'global', generation: 'Muse Wonder 1.0', releasedAt: '2026-10-12',
  category: 'text', contextTier: 'standard', serviceTier: 'standard', currency: 'USD',
  priceUnit: 'per_million_tokens', originalUnit: 'USD / 1M Tokens', currentGeneration: true,
  cacheWritePrice: null, sourceLabel: 'Meta 官方价目表', sourceUrl: META_PRICING_URL,
  sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
  provenance: officialProvenance('Meta 官方价目表', META_PRICING_URL),
};

// Dated additions to the original pricing tables. Later collected quotes take precedence.
export const TOKEN_PRICE_SUPPLEMENTS: readonly TokenPrice[] = [
  {
    ...metaTokenBase, model: 'Muse Wonder', publicPrice: true,
    inputPrice: 4, cacheReadPrice: 0.2, outputPrice: 20,
    note: `Preview；模型 ID：muse-wonder-1.0；上下文 1,048,576 Tokens。${META_DATE_NOTE}`,
  },
  {
    ...metaTokenBase, model: 'Muse Wonder Full', publicPrice: false,
    inputPrice: null, cacheReadPrice: null, outputPrice: null,
    sourceLabel: 'Meta 官方模型页', sourceUrl: META_MODEL_URL,
    provenance: officialProvenance('Meta 官方模型页', META_MODEL_URL),
    note: `模型 ID：muse-wonder-full-1.0；上下文 1M Tokens。仅通过 Muse Code 订阅提供，未列示模型 API 单价；两档月费见 Coding Plan。${META_DATE_NOTE}`,
  },
  {
    vendor: '智谱', model: 'GLM-5.3-Flash', generation: 'GLM-5.3', releasedAt: '2026-08-26',
    region: 'global', category: 'text', contextTier: 'standard', serviceTier: 'standard',
    currency: 'USD', priceUnit: 'per_million_tokens', originalUnit: 'USD / 1M Tokens',
    publicPrice: true, currentGeneration: true,
    inputPrice: 0.15, cacheReadPrice: 0.03, cacheWritePrice: null, outputPrice: 0.5,
    sourceLabel: 'Z.ai 官方价目表', sourceUrl: 'https://docs.z.ai/guides/overview/pricing',
    sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
    note: '官方更新日志标注 2026-08-26；2026-10-13 核对当前价目表，此日期不代表重新发布。',
    provenance: officialProvenance('Z.ai 官方价目表', 'https://docs.z.ai/guides/overview/pricing'),
  },
  {
    vendor: '智谱', model: 'GLM-5.3-FlashX', generation: 'GLM-5.3', releasedAt: null,
    region: 'global', category: 'text', contextTier: 'standard', serviceTier: 'standard',
    currency: 'USD', priceUnit: 'per_million_tokens', originalUnit: 'USD / 1M Tokens',
    publicPrice: true, currentGeneration: true,
    inputPrice: 0.37, cacheReadPrice: 0.075, cacheWritePrice: null, outputPrice: 1.25,
    sourceLabel: 'Z.ai 官方价目表', sourceUrl: 'https://docs.z.ai/guides/overview/pricing',
    sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
    note: '上下文 1M Tokens；最大输出 128K Tokens；Coding Plan 暂未开放。官网更新日志未单列该型号发布日期。',
    provenance: officialProvenance('Z.ai 官方价目表', 'https://docs.z.ai/guides/overview/pricing'),
  },
];

const metaPlanBase: Omit<CodingPlan, 'plan' | 'monthlyPrice' | 'allowanceText'> = {
  vendor: 'Meta', pricingMode: 'fixed', currency: 'USD', annualPrice: null, annualMonthlyPrice: null,
  overage: null, region: 'global', sourceLabel: 'Meta 官方模型页', sourceUrl: META_MODEL_URL,
  sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
  note: `包含 Muse Wonder Full；订阅用量倍数不折算为 API Token 单价。${META_DATE_NOTE}`,
  provenance: officialProvenance('Meta 官方模型页', META_MODEL_URL),
};

export const CODING_PLAN_SUPPLEMENTS: readonly CodingPlan[] = [
  { ...metaPlanBase, plan: 'Muse Code Power Usage', monthlyPrice: 50, allowanceText: 'Everyday Usage 基础档的 20x 用量' },
  { ...metaPlanBase, plan: 'Muse Code Maximum Usage', monthlyPrice: 200, allowanceText: 'Everyday Usage 基础档的 80x 用量' },
];
