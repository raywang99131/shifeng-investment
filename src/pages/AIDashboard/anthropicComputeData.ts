// Static editorial snapshot checked on 2026-10-12; no API or automatic refresh.
// All monetary values ending in B are billions of US dollars.
// The supplied graphic and subsequent reporting use different scopes and must
// remain separate: neither is a schedule of annual cash payments or GPU share.
export interface AnthropicResearchSource {
  label: string;
  url: string;
  status: string;
}

export const ANTHROPIC_RESEARCH = {
  checkedAt: '2026-10-12',
  originalImageUrl: '/assets/research/anthropic-compute-commitments-william-blair.png',
  originalSourceLabel: 'William Blair Equity Research · 用户提供原图（发布日期未注明）',
  latestReportedAt: '2026-09-29',
  latestHeadlineB: 518,
  latestPartnerCount: 6,
  nonCancelableApproxPercent: 80,
  sources: {
    reutersLatest: {
      label: 'Reuters · 六家合作方算力承诺及解约条款',
      url: 'https://www.investing.com/news/stock-market-news/anthropics-518-billion-ai-buildout-hinges-largely-on-deals-that-cannot-be-canceled-filing-shows-4922031',
      status: '2026-09-29 · 媒体查阅保密 IPO 文件；未独立核验官方公开申报',
    },
    googleReport: {
      label: 'Reuters 转述 The Information · Google 200B 美元承诺',
      url: 'https://www.investing.com/news/stock-market-news/anthropic-commits-to-spending-200-billion-on-googles-cloud-and-chips-the-information-reports-4661029',
      status: '2026-05-05 · 媒体报道；Reuters 未独立核实',
    },
    googleOfficial: {
      label: 'Anthropic 官方 · Google / Broadcom 算力合作',
      url: 'https://www.anthropic.com/news/google-broadcom-partnership-compute',
      status: '2026-04-06 · 官方合作公告；未披露 200B 美元金额',
    },
    awsOfficial: {
      label: 'Anthropic 官方 · Amazon 算力合作',
      url: 'https://www.anthropic.com/news/anthropic-amazon-compute',
      status: '2026-04-20 · 官方披露未来十年超过 100B 美元承诺',
    },
    metaReport: {
      label: 'Reuters 转述《纽约时报》· Meta 10B 美元合作洽谈',
      url: 'https://www.investing.com/news/stock-market-news/meta-in-talks-for-10-billion-anthropic-compute-deal-nyt-reports-4798826',
      status: '2026-07 · 媒体报道洽谈；不代表已签订合同',
    },
    akamaiOfficial: {
      label: 'Akamai 官方 · 11.6B 美元专用云协议',
      url: 'https://www.akamai.com/newsroom/press-release/2026/akamai-announces-11-6-billion-multi-year-agreement-with-anthropic-to-support-growing-demand',
      status: '2026-09-24 · 七年协议，主要支持 CPU 负载；潜在扩展另计',
    },
    terawulfFiling: {
      label: 'TeraWulf SEC 公告 · Justified 数据中心租赁',
      url: 'https://www.sec.gov/Archives/edgar/data/1083301/000110465926080583/tm2619468d1_ex99-1.htm',
      status: '2026-07-06 · 401MW、20 年、约 19B 美元租赁收入',
    },
    amdOfficial: {
      label: 'AMD 官方 · Anthropic 最高 2GW GPU 合作',
      url: 'https://ir.amd.com/news-events/press-releases/detail/1292/amd-and-anthropic-announce-strategic-partnership-to-deploy-up-to-2-gigawatts-of-amd-instinct-mi450-series-gpus',
      status: '2026-07-22 · 首 1GW 预计 2027 年上半年起部署；当时未披露 20B 美元金额',
    },
  } satisfies Record<string, AnthropicResearchSource>,
} as const;

export type AnthropicResearchSourceId = keyof typeof ANTHROPIC_RESEARCH.sources;

export interface AnthropicOriginalCommitment {
  id: string;
  supplier: string;
  reportedMonth: string;
  amountB: number | null;
  note: string;
}

// Months and amounts reproduce the supplied graphic, rather than independently
// verified contract dates, maturities, or incremental commitments.
export const ANTHROPIC_ORIGINAL_COMMITMENTS: AnthropicOriginalCommitment[] = [
  {
    id: 'coreweave',
    supplier: 'CoreWeave',
    reportedMonth: '2026-04',
    amountB: null,
    note: '原图转录；金额未披露，不计入已披露金额加总；期限未知。',
  },
  {
    id: 'riot-platforms',
    supplier: 'Riot Platforms',
    reportedMonth: '2026-08',
    amountB: 9.1,
    note: '原图转录；公开披露为未具名客户，不能独立确认为 Anthropic 承诺；期限未知。',
  },
  {
    id: 'meta',
    supplier: 'Meta',
    reportedMonth: '2026-07',
    amountB: 10,
    note: '原图转录；媒体报道仍在洽谈，不代表已签订合同；期限未知。',
  },
  {
    id: 'volta-infra',
    supplier: 'Volta Infra',
    reportedMonth: '2026-08',
    amountB: 10,
    note: '原图转录；公开披露为未具名客户，不能独立确认为 Anthropic 承诺；期限未知。',
  },
  {
    id: 'akamai',
    supplier: 'Akamai',
    reportedMonth: '2026-09',
    amountB: 11.6,
    note: '原图金额；Akamai 官方披露 11.6B 美元、七年，主要为 CPU 负载；潜在扩展不计入此值。',
  },
  {
    id: 'terawulf',
    supplier: 'TeraWulf',
    reportedMonth: '2026-07',
    amountB: 19,
    note: '原图金额；官方披露为 Justified 401MW 数据中心、20 年租赁收入，不能视为 GPU 采购金额。',
  },
  {
    id: 'amd',
    supplier: 'AMD',
    reportedMonth: '2026-07',
    amountB: 20,
    note: '原图转录；与最新报道中的预计超过 20B 美元算力安排分开呈现；期限未知。',
  },
  {
    id: 'microsoft-nvidia',
    supplier: 'Microsoft / NVIDIA',
    reportedMonth: '2025-11',
    amountB: 30,
    note: '原图转录；为合作金额口径，不据此推算年度付款或 GPU 份额；期限未知。',
  },
  {
    id: 'lambda',
    supplier: 'Lambda',
    reportedMonth: '2026-09',
    amountB: 35,
    note: '原图转录；该行金额与归属未逐项独立核验；期限未知。',
  },
  {
    id: 'spacex-xai',
    supplier: 'SpaceX / xAI',
    reportedMonth: '2026-05',
    amountB: 45,
    note: '原图转录；与最新报道中的最高 84.5B 美元安排采用不同口径；期限未知。',
  },
  {
    id: 'nscale',
    supplier: 'Nscale',
    reportedMonth: '2026-08',
    amountB: 45,
    note: '原图转录；公开披露为未具名客户，不能独立确认为 Anthropic 承诺；期限未知。',
  },
  {
    id: 'fluidstack',
    supplier: 'Fluidstack',
    reportedMonth: '2025-11',
    amountB: 50,
    note: '原图转录；与 Google 合作可能重叠，尚未证实具体重叠金额，不能视为独立新增承诺；期限未知。',
  },
  {
    id: 'aws',
    supplier: 'AWS',
    reportedMonth: '2026-04',
    amountB: 100,
    note: '原图转录为 100B 美元；官方口径为未来十年超过 100B 美元；实际年度付款未知。',
  },
  {
    id: 'google-broadcom',
    supplier: 'Google / Broadcom',
    reportedMonth: '2026-04',
    amountB: 200,
    note: '原图转录；200B 美元、五年为媒体报道口径，官方未确认金额；官方称扩展 2025 年 11 月合作，存在重叠风险。',
  },
];

// A mechanical sum of disclosed graphic values, including discussed deals and
// possible overlaps; this is not a verified total of signed obligations.
export const ANTHROPIC_ORIGINAL_SUM_B = Math.round(
  ANTHROPIC_ORIGINAL_COMMITMENTS.reduce((sum, row) => sum + (row.amountB ?? 0), 0) * 10,
) / 10;

export interface AnthropicLatestCommitment {
  id: string;
  supplier: string;
  amountB: number;
  qualifier: string;
  obligation: string;
  term: string;
  architecture: string;
  cancellation: string;
  sourceId: AnthropicResearchSourceId;
}

// Reuters' later six-partner document reporting is a separate snapshot. Its
// rounded headline and qualified component amounts do not replace the graphic.
export const ANTHROPIC_LATEST_COMMITMENTS: AnthropicLatestCommitment[] = [
  {
    id: 'google',
    supplier: 'Google',
    amountB: 111.1,
    qualifier: '至少',
    obligation: '基础设施最低付款义务，不论是否使用',
    term: '2026-04 至 2033-07',
    architecture: 'Google TPU',
    cancellation: '最低付款义务；报道未逐项披露其他解约例外',
    sourceId: 'reutersLatest',
  },
  {
    id: 'broadcom',
    supplier: 'Broadcom',
    amountB: 161.2,
    qualifier: '约',
    obligation: '设备租赁义务',
    term: '到期日未披露',
    architecture: 'TPU 相关设备',
    cancellation: '除违约外，双方均不可取消',
    sourceId: 'reutersLatest',
  },
  {
    id: 'aws',
    supplier: 'AWS',
    amountB: 110,
    qualifier: '最低承诺',
    obligation: '基础设施及最低使用付款义务，不论是否实际使用',
    term: '2026-05 至 2036-04',
    architecture: 'AWS 基础设施 / Trainium；不能将全部金额归为 Trainium',
    cancellation: '最低付款义务；报道未逐项披露其他解约例外',
    sourceId: 'reutersLatest',
  },
  {
    id: 'microsoft',
    supplier: 'Microsoft',
    amountB: 31.4,
    qualifier: '承诺金额',
    obligation: 'Azure 算力付款义务',
    term: '2026-11 至 2033-05',
    architecture: 'Azure 上的 NVIDIA GPU',
    cancellation: '不可取消，Microsoft 未补救的重大违约除外',
    sourceId: 'reutersLatest',
  },
  {
    id: 'spacex-xai',
    supplier: 'SpaceX / xAI',
    amountB: 84.5,
    qualifier: '最高',
    obligation: '算力采购上限，并非全部不可取消义务',
    term: '截至 2029 年',
    architecture: 'NVIDIA GPU',
    cancellation: '大部分可提前 90 天通知取消',
    sourceId: 'reutersLatest',
  },
  {
    id: 'amd',
    supplier: 'AMD',
    amountB: 20,
    qualifier: '预计超过',
    obligation: '预计 AI 算力价值；具体付款安排未披露',
    term: '期限未披露',
    architecture: 'AMD GPU',
    cancellation: '解约条款未披露',
    sourceId: 'reutersLatest',
  },
];

export interface AnthropicAnnualComparison {
  supplier: string;
  totalB: number;
  years: number;
  annualB: number;
  qualifier: string;
  sourceId: AnthropicResearchSourceId;
}

// These are simple averages of two source-specific figures, not actual annual
// payment schedules or relative spending / compute shares.
export const ANTHROPIC_ANNUAL_COMPARISON: AnthropicAnnualComparison[] = [
  {
    supplier: 'Google',
    totalB: 200,
    years: 5,
    annualB: 200 / 5,
    qualifier: '媒体报道 · 简单年均',
    sourceId: 'googleReport',
  },
  {
    supplier: 'AWS',
    totalB: 100,
    years: 10,
    annualB: 100 / 10,
    qualifier: '官方超过该值 · 简单年均下限',
    sourceId: 'awsOfficial',
  },
];
