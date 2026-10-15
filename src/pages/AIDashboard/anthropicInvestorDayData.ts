import type { AiDashboardSnapshot, ArrCompanyMetric, ArrPoint } from './types.ts';

const quarterRevenue = [
  { period: '2026 Q1', revenue: 47 },
  { period: '2026 Q2', revenue: 116 },
  { period: '2026 Q3', revenue: 168 },
];
const quarters = quarterRevenue.map((row, index) => {
  const previous = quarterRevenue[index - 1];
  const change = previous ? row.revenue - previous.revenue : null;
  return {
    ...row, momAbsolute: change,
    momPercent: previous && previous.revenue > 0 ? change! / previous.revenue : null,
  };
});

/** All monetary values use USD 100 million; growth rates are ratios, not percentage points. */
export const ANTHROPIC_INVESTOR_DAY = {
  eventDate: '2026-10-14',
  checkedAt: '2026-10-15',
  quarters,
  nineMonthRevenue: quarters.reduce((total, row) => total + row.revenue, 0),
  q3AnnualizedRevenue: quarters[2].revenue * 4,
  septemberArrEstimate: 700,
  yipitQuotedEstimate: 740,
  highFrequencyComparisons: [
    {
      provider: 'Yipit', arr: 750, observedAt: null, receivedAt: '2026-10-15',
      methodology: '中金转引高频估算，按月收入×12年化；原始报告及观测截至日未提供，收到日不代表观测日。',
    },
    {
      provider: 'TickerTrends', arr: 768, observedAt: null, receivedAt: '2026-10-15',
      methodology: '中金转引；统计口径及观测截至日待确认，收到日不代表观测日。',
    },
  ],
  ipoValuationLow: 18000,
  ipoValuationHigh: 20000,
  sources: {
    reuters: {
      label: 'Reuters · 2026-10-14（MarketScreener转载）',
      url: 'https://uk.marketscreener.com/news/anthropic-s-q3-revenue-surges-45-to-nearly-17-billion-ce785dd2d08cf221',
      note: '援引10/14投资者日参会投资者：Q1/Q2/Q3营收分别47/116/168亿美元，Q3环比约45%，调整后口径盈利；9M331亿美元为三季加总，Q3收入年化672亿美元为季度收入乘4，均不等于9月ARR。至少5180亿美元十年云、算力与基础设施承诺为9/29已报道、10/14重述，不是当日新增资本开支。',
    },
    ft: {
      label: 'Financial Times · 2026-10-14',
      url: 'https://www.ft.com/content/11632d03-358c-454b-af95-d06d4072932b',
      note: '付费正文未完整读取；连续两季调整后盈利、Q3营业利润率11%、每1美元算力对应1.7美元收入为用户纪要转引FT。正式转载确认Q3调整后盈利及当季现金流为正，现金流具体口径未披露，不扩写为经营或自由现金流。FT转载Q2为115亿美元，与Reuters116亿美元分别归源；不视为GAAP净利润披露。',
    },
    bloomberg: {
      label: 'Bloomberg（TBS授权转载）',
      url: 'https://newsdig.tbs.co.jp/articles/withbloomberg/3010144?display=1',
      note: '原稿2026-10-01，授权转载2026-10-14；IPO安排为消息人士预期，尚非确定日程。launch指正式IPO营销启动，不是开始交易；拟议估值区间仅供独立P/ARR情景测算，未写入历史融资估值。',
    },
    memos: {
      label: '财通海外 / 建投AI互联网 / 中金 · 用户提供纪要',
      url: 'https://xcn0zaydz11m.feishu.cn/sheets/F9W3s5BBEhRRV8tdZvCchEAfnCf?sheet=0rbUAO',
      note: '三份纪要共同采用9月ARR约700亿美元的历史研究推算。中金原摘录的3Q26收入16.8亿美元与Reuters168亿美元相差10倍，单位疑误，季度收入仍按Reuters录入。财通转引的740亿美元仅为纪要转引推算，未直接查阅Yipit报告；中金另转引高频Yipit约750亿美元、TickerTrends约768亿美元，观测截至日未提供，分别保留。财通年底800–850亿美元为研究预测、非公司指导，建投年底1000亿美元单列为研究情景，各项不视为市场共识。',
    },
    cicc: {
      label: '中金 · 用户提供纪要（转引）',
      url: 'https://xcn0zaydz11m.feishu.cn/sheets/F9W3s5BBEhRRV8tdZvCchEAfnCf?sheet=0rbUAO',
      note: '原摘录“3Q26收入为16.8亿美元”与Reuters的16.8 billion美元（168亿美元）相差10倍，单位疑误；未据此改季度收入。中金给出的9月ARR约700亿美元为按月收入×12年化的历史研究推算，季度总收入不足以独立反推9月月收入。另转引高频Yipit约750亿美元，TickerTrends约768亿美元的统计口径待确认；两项均未提供原始报告或观测截至日，2026-10-15仅为收到日，不写入历史ARR或IPO估值情景。',
    },
  },
} as const;

export const INVESTOR_DAY_VALUATION_SCENARIOS: {
  id: string; label: string; period: string; arrLow: number; arrHigh: number;
  parrLow: number; parrHigh: number; note: string;
}[] = [
  {
    id: 'september-common', label: '三份纪要共同采用的9月ARR', period: '2026年9月研究估算',
    arrLow: 700, arrHigh: 700,
    note: '9月研究估算，非季度收入乘4；以拟议IPO估值区间18000–20000亿美元测算，不代表已完成融资估值。',
  },
  {
    id: 'yipit-quoted', label: '财通转引的740亿美元估算', period: '2026年9月纪要转引估算',
    arrLow: 740, arrHigh: 740,
    note: '仅财通纪要转引推算，未直接查阅Yipit报告；独立展示，不加入历史ARR观测。',
  },
  {
    id: 'caitong-year-end', label: '财通年底ARR研究预测', period: '2026年底研究预测',
    arrLow: 800, arrHigh: 850,
    note: '800–850亿美元为财通研究预计，非公司指导或市场共识；区间下界用18000÷850，上界用20000÷800。',
  },
  {
    id: 'csc-year-end', label: '建投年底ARR研究情景', period: '2026年底情景测算',
    arrLow: 1000, arrHigh: 1000,
    note: '1000亿美元为建投单独研究情景，不暗示与财通预测一致或已形成市场共识。',
  },
].map(row => ({
  ...row,
  parrLow: ANTHROPIC_INVESTOR_DAY.ipoValuationLow / row.arrHigh,
  parrHigh: ANTHROPIC_INVESTOR_DAY.ipoValuationHigh / row.arrLow,
}));

const SEPTEMBER_MONTH = '2026-09';
const SEPTEMBER_END = '2026-09-30';
const RESEARCH_SOURCE = '财通海外 / 建投AI互联网 / 中金（研究估算）';

function hasSeptemberOrLaterActual(point: ArrPoint): boolean {
  if (point.company !== 'Anthropic' || point.kind !== 'actual') return false;
  const monthly = point.datePrecision === 'month';
  return Date.parse(point.observedAt) >= Date.parse(SEPTEMBER_END)
    || (monthly && point.month >= SEPTEMBER_MONTH);
}

/** Add a separate historical estimate without rewriting source observations or IPO/capital history. */
export function withInvestorDayGrowthSupplement(data: AiDashboardSnapshot): AiDashboardSnapshot {
  if (data.arrAndValuation.companies.some(company => company.actualPoints.some(hasSeptemberOrLaterActual)
    || (company.latestActual !== null && hasSeptemberOrLaterActual(company.latestActual)))) return data;

  const methodology = '用户提供的财通海外、建投AI互联网、中金三份纪要共同给出9月ARR约700亿美元的历史研究推算；中金说明按月收入×12年化，季度总收入不足以独立反推9月单月收入；月份仅为历史观察期，不表示9月30日发生精确披露。';
  const observation: ArrPoint = {
    company: 'Anthropic', month: SEPTEMBER_MONTH, observedAt: SEPTEMBER_END,
    value: ANTHROPIC_INVESTOR_DAY.septemberArrEstimate,
    kind: 'actual', seriesKind: 'estimate', sourceKind: 'estimate', datePrecision: 'month',
    sourceLabel: RESEARCH_SOURCE, sourceUrl: ANTHROPIC_INVESTOR_DAY.sources.memos.url,
    momAbsolute: null, momPercent: null, comparisonLabel: null, consecutiveMonth: null,
    comparisonNote: '与既有月度和日度观测的来源及统计口径尚未核对一致，保留独立估算，不连线或计算跨口径环比。',
    methodology, currency: 'USD', unitScale: 100_000_000, originalValue: 700, originalUnit: 'USD 100 million',
    provenance: {
      sourceLabel: RESEARCH_SOURCE, sourceUrl: ANTHROPIC_INVESTOR_DAY.sources.memos.url, sourceKind: 'estimate',
      asOf: SEPTEMBER_END, retrievedAt: ANTHROPIC_INVESTOR_DAY.checkedAt, methodology,
      stale: Date.parse(data.generatedAt) - Date.parse(SEPTEMBER_END) > 18 * 86_400_000,
    },
  };
  const researchSeries: ArrCompanyMetric = {
    company: 'Anthropic', seriesId: `Anthropic:estimate:${RESEARCH_SOURCE}`, seriesKind: 'estimate',
    sourceLabel: RESEARCH_SOURCE, actualPoints: [observation], forecastPoints: [], latestActual: observation,
    stale: observation.provenance!.stale,
  };
  return {
    ...data,
    arrAndValuation: {
      ...data.arrAndValuation,
      companies: [...data.arrAndValuation.companies, researchSeries],
    },
  };
}
