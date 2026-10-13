import type { CodingPlan, MetricProvenance, TokenPrice } from './types.ts';

const VERIFIED_AT = '2026-10-13';
const META_PRICING_URL = 'https://dev.meta.ai/docs/pricing-rate-limits';
const META_MODEL_URL = 'https://dev.meta.ai/models/muse-wonder';
const META_DATE_NOTE = '官方发布页日期为 2026-10-12；财通海外纪要日期为 2026-10-13。';
const MIMO_PRICING_URL = 'https://mimo.mi.com/docs/pricing';
const MIMO_RELEASE_URL = 'https://mimo.mi.com/docs/en-US/updates/model';
const STEP_PRICING_URL = 'https://platform.stepfun.ai/docs/en/guides/pricing/details';
const STEP_CHINA_PRICING_URL = 'https://platform.stepfun.com/docs/zh/guides/pricing/details';
const STEP_RELEASE_URL = 'https://www.stepfun.com/news/step-5-preview';
const KIMI_MODEL_URL = 'https://www.kimi.com/help/kimi-code/models';
const KIMI_MEMBERSHIP_URL = 'https://www.kimi.com/help/membership/membership-pricing';
const KIMI_RELEASE_URL = 'https://www.kimi.com/code/docs/kimi-code/whats-new.html';

function officialProvenance(sourceLabel: string, sourceUrl: string): MetricProvenance {
  return {
    sourceLabel, sourceUrl, sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
    methodology: '按厂商官方页面人工核对；API 单价与月度订阅分别列示，未公开的价格保留为空。',
    stale: false,
  };
}

type OfficialTokenSupplement = Pick<TokenPrice,
  'vendor' | 'model' | 'inputPrice' | 'cacheReadPrice' | 'outputPrice' | 'sourceLabel' | 'sourceUrl'
> & Partial<Pick<TokenPrice, 'generation' | 'releasedAt' | 'region' | 'currency' | 'publicPrice' | 'note'>>;

function officialTokenSupplement(row: OfficialTokenSupplement, releaseSourceUrl: string): TokenPrice {
  const currency = row.currency || 'USD';
  return {
    region: 'global', category: 'text', contextTier: 'standard', serviceTier: 'standard',
    publicPrice: true, currentGeneration: true, cacheWritePrice: null, releasedAt: null,
    ...row, currency, priceUnit: 'per_million_tokens', originalUnit: `${currency} / 1M Tokens`,
    sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
    provenance: {
      ...officialProvenance(row.sourceLabel, row.sourceUrl),
      commentary: `模型发布时间另按官方发布记录核对：${releaseSourceUrl}`,
    },
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
  officialTokenSupplement({
    vendor: 'MiMo', model: 'MiMo V2.6 Pro', generation: 'MiMo V2.6', releasedAt: '2026-09-22',
    inputPrice: 0.435, cacheReadPrice: 0.0036, outputPrice: 0.87,
    sourceLabel: '小米 MiMo 官方价目表', sourceUrl: MIMO_PRICING_URL,
    note: '海外 USD 标准实时 API；模型 ID：mimo-v2.6-pro；1M 上下文、128K 最大输出。Batch API 半价，UltraSpeed 为另一服务档，均未混入本行。',
  }, MIMO_RELEASE_URL),
  officialTokenSupplement({
    vendor: 'MiMo', model: 'MiMo V2.6 Pro', generation: 'MiMo V2.6', releasedAt: '2026-09-22',
    region: 'china', currency: 'CNY', inputPrice: 3, cacheReadPrice: 0.025, outputPrice: 6,
    sourceLabel: '小米 MiMo 官方价目表', sourceUrl: MIMO_PRICING_URL,
    note: '国内人民币标准实时 API 原价，未由美元报价反推；Batch API 为输入 1.50 / 缓存 0.0125 / 输出 3.00 元每百万 Tokens。',
  }, MIMO_RELEASE_URL),
  officialTokenSupplement({
    vendor: 'MiMo', model: 'MiMo V2.6 Flash', generation: 'MiMo V2.6', releasedAt: '2026-09-22',
    inputPrice: 0.14, cacheReadPrice: 0.0028, outputPrice: 0.28,
    sourceLabel: '小米 MiMo 官方价目表', sourceUrl: MIMO_PRICING_URL,
    note: '海外 USD 标准实时 API；模型 ID：mimo-v2.6-flash；1M 上下文、128K 最大输出。Batch API 半价。',
  }, MIMO_RELEASE_URL),
  officialTokenSupplement({
    vendor: 'MiMo', model: 'MiMo V2.6 Flash', generation: 'MiMo V2.6', releasedAt: '2026-09-22',
    region: 'china', currency: 'CNY', inputPrice: 1, cacheReadPrice: 0.02, outputPrice: 2,
    sourceLabel: '小米 MiMo 官方价目表', sourceUrl: MIMO_PRICING_URL,
    note: '国内人民币标准实时 API 原价，未由美元报价反推；Batch API 为输入 0.50 / 缓存 0.01 / 输出 1.00 元每百万 Tokens。',
  }, MIMO_RELEASE_URL),
  officialTokenSupplement({
    vendor: 'StepFun', model: 'Step 5 Preview', generation: 'Step 5', releasedAt: '2026-09-20',
    inputPrice: 1, cacheReadPrice: 0.1, outputPrice: 2.7,
    sourceLabel: 'StepFun 官方美元价目表', sourceUrl: STEP_PRICING_URL,
    note: '模型 ID：step-5-preview；1M 上下文。英文官网当前刊例价；未明示美元缓存调价生效日，人民币调价公告不直接套用于美元。未命中输入包含缓存写入，输出包含推理。权重计划 10-15 开放。',
  }, STEP_RELEASE_URL),
  officialTokenSupplement({
    vendor: 'StepFun', model: 'Step 5 Preview', generation: 'Step 5', releasedAt: '2026-09-20',
    region: 'china', currency: 'CNY', inputPrice: 7, cacheReadPrice: 0.35, outputPrice: 20,
    sourceLabel: '阶跃星辰官方人民币价目表', sourceUrl: STEP_CHINA_PRICING_URL,
    note: '截至 10-13 生效的按量 API 缓存价为 0.35 元；北京时间 10-14 00:30 起新用户缓存价变为 0.70 元，此前已按量调用过该模型者继续 0.35 元。输入 7 元、输出 20 元不变；Step Plan 不在本次调价范围。',
  }, STEP_RELEASE_URL),
  officialTokenSupplement({
    vendor: 'Inception', model: 'Mercury 2.5', generation: 'Mercury 2.5', releasedAt: '2026-09-08',
    inputPrice: 0.2, cacheReadPrice: 0.02, outputPrice: 0.75,
    sourceLabel: 'Inception 官方模型价目表', sourceUrl: 'https://docs.inceptionlabs.ai/get-started/models',
    note: '本行列标准刊例价；当前首发优惠按原价 20% 收费（降价 80%）：输入 0.04 / 缓存 0.004 / 输出 0.15 美元每百万 Tokens，结束日未公布。模型 ID：mercury-2.5；260K 上下文、65,536 最大输出。',
  }, 'https://www.inceptionlabs.ai/blog/introducing-mercury-2-5'),
  officialTokenSupplement({
    vendor: 'Upstage', model: 'Solar Mini 4', generation: 'Solar 4', releasedAt: '2026-09-22',
    inputPrice: 0.1, cacheReadPrice: 0.01, outputPrice: 0.4,
    sourceLabel: 'Upstage 官方 API 价目表', sourceUrl: 'https://www.upstage.ai/pricing/api',
    note: '本行列税前标准刊例价，不含 10% VAT；2026-10-11 00:00 至 10-23 00:00 UTC 半价为输入 0.05 / 缓存 0.005 / 输出 0.20 美元每百万 Tokens（北京时间 10-23 08:00 截止）。模型 ID：solar-mini4，版本 solar-mini4-260922。',
  }, 'https://console.upstage.ai/docs/models/solar-mini-4'),
  officialTokenSupplement({
    vendor: 'LongCat', model: 'LongCat 2.5 Preview', generation: 'LongCat 2.5', releasedAt: '2026-09-25',
    inputPrice: 0.3, cacheReadPrice: 0.006, outputPrice: 1.2,
    sourceLabel: 'LongCat 官方价目表', sourceUrl: 'https://longcat.ai/platform/docs/pricing/longcat-2.5',
    note: '当前美元限时优惠价，结束日及优惠后标准价未公布；模型 ID：LongCat-2.5-Preview；1M 上下文、128K 最大输出。按量 API，可选 Token Pack 并非必须订阅。',
  }, 'https://longcat.ai/platform/docs/ChangeLog.html'),
  officialTokenSupplement({
    vendor: 'LongCat', model: 'LongCat 2.5 Preview', generation: 'LongCat 2.5', releasedAt: '2026-09-25',
    region: 'china', currency: 'CNY', inputPrice: 2, cacheReadPrice: 0.04, outputPrice: 8,
    sourceLabel: 'LongCat 官方价目表', sourceUrl: 'https://longcat.ai/platform/docs/pricing/longcat-2.5',
    note: '当前人民币限时优惠价，结束日及优惠后标准价未公布；保留官方原币报价，未由美元换算。',
  }, 'https://longcat.ai/platform/docs/ChangeLog.html'),
  officialTokenSupplement({
    vendor: 'Ling', model: 'Ling 3.1 Flash', generation: 'Ling 3.1', releasedAt: '2026-09-30',
    inputPrice: 0, cacheReadPrice: 0, outputPrice: 0,
    sourceLabel: '百灵官方 API 价目表', sourceUrl: 'https://developer.ant-ling.com/en/docs/models/price',
    note: '第一方CNY输入/缓存/输出均为0；免费金额的美元值亦为0，并非汇率推算收费价。两周限时免费，精确结束日未披露，正式收费价未公布；API当前256K上下文，模型训练上下文1M。',
  }, 'https://huggingface.co/inclusionAI/Ling-3.1-flash'),
  officialTokenSupplement({
    vendor: 'Mistral', model: 'Mistral Large 4', generation: 'Mistral Large 4', releasedAt: '2026-10-06',
    inputPrice: .68, cacheReadPrice: .07, outputPrice: 2.09,
    sourceLabel: 'Mistral 官方模型价目表', sourceUrl: 'https://docs.mistral.ai/models/mistral-large-4-0',
    note: 'Public Preview；10/6起首发两周50%优惠，精确结束时刻未披露。当前优惠USD输入0.68/缓存0.07/输出2.09，常规1.36/0.14/4.18；开放权重coming soon尚未生效。',
  }, 'https://docs.mistral.ai/models/mistral-large-4-0'),
  officialTokenSupplement({
    vendor: 'Kimi', model: 'Kimi K2.8 Preview', generation: 'Kimi K2.8', releasedAt: '2026-09-11',
    publicPrice: false, inputPrice: null, cacheReadPrice: null, outputPrice: null,
    sourceLabel: 'Kimi Code 官方模型页', sourceUrl: KIMI_MODEL_URL,
    note: '仅 Kimi Code 订阅入口，未公布独立按量 API 单价。模型 ID：kimi-for-coding 原位升级；最高 1M 上下文，low / high / max。新套餐 Plus 99 元/月起，完整月付和年付价格见 Coding Plan；新 Go 无 Coding 额度。',
  }, KIMI_RELEASE_URL),
];

const metaPlanBase: Omit<CodingPlan, 'plan' | 'monthlyPrice' | 'allowanceText'> = {
  vendor: 'Meta', pricingMode: 'fixed', currency: 'USD', annualPrice: null, annualMonthlyPrice: null,
  overage: null, region: 'global', sourceLabel: 'Meta 官方模型页', sourceUrl: META_MODEL_URL,
  sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
  note: `包含 Muse Wonder Full；订阅用量倍数不折算为 API Token 单价。${META_DATE_NOTE}`,
  provenance: officialProvenance('Meta 官方模型页', META_MODEL_URL),
};

const kimiPlanBase: Omit<CodingPlan, 'plan' | 'monthlyPrice' | 'annualPrice' | 'annualMonthlyPrice' | 'allowanceText'> = {
  vendor: 'Kimi', pricingMode: 'fixed', currency: 'CNY', region: 'china', overage: null,
  sourceLabel: 'Kimi 官方会员价格', sourceUrl: KIMI_MEMBERSHIP_URL,
  sourceKind: 'official', asOf: VERIFIED_AT, retrievedAt: VERIFIED_AT,
  limits: '保留滚动 5 小时用量限制和月度共享额度；新套餐无周限额。',
  note: '含 K2.8 Preview（kimi-for-coding）；年付一次扣全年总价，折合月价不是月付价格。新套餐保留 5 小时滚动频限、无周限额，受月度共享额度限制；新 Go 无 Coding 额度；旧 Andante 等套餐按原规则使用。',
  provenance: officialProvenance('Kimi 官方会员价格', KIMI_MEMBERSHIP_URL),
};

export const CODING_PLAN_SUPPLEMENTS: readonly CodingPlan[] = [
  { ...metaPlanBase, plan: 'Muse Code Power Usage', monthlyPrice: 50, allowanceText: 'Everyday Usage 基础档的 20x 用量' },
  { ...metaPlanBase, plan: 'Muse Code Maximum Usage', monthlyPrice: 200, allowanceText: 'Everyday Usage 基础档的 80x 用量' },
  {
    ...kimiPlanBase, plan: 'Kimi Code Plus', monthlyPrice: 99, annualPrice: 948, annualMonthlyPrice: 79,
    allowanceText: 'K2.8 Preview 最高 1M 上下文；K3 最高 256K；与其他会员功能共享月度额度',
    note: `${kimiPlanBase.note} 年付 948 元，折合 79 元/月。`,
  },
  {
    ...kimiPlanBase, plan: 'Kimi Code Pro', monthlyPrice: 199, annualPrice: 1908, annualMonthlyPrice: 159,
    allowanceText: 'K2.8 Preview / K3 最高 1M；含 K2.7 Code HighSpeed；共享月度额度',
    note: `${kimiPlanBase.note} 年付 1,908 元，折合 159 元/月。`,
  },
  {
    ...kimiPlanBase, plan: 'Kimi Code Max', monthlyPrice: 699, annualPrice: 6708, annualMonthlyPrice: 559,
    allowanceText: 'K2.8 Preview / K3 最高 1M；含 K2.7 Code HighSpeed；更高共享额度',
    note: `${kimiPlanBase.note} 年付 6,708 元，折合 559 元/月。`,
  },
];
