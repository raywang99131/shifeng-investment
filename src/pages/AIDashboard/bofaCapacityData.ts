type CapacityGroupId = 'hyperscaler' | 'neocloud' | 'sovereign';

interface CapacityGroup {
  id: CapacityGroupId;
  label: string;
  totals: (number | null)[];
  increments: (number | null)[];
}

interface CapacityOperator {
  id: string;
  label: string;
  group: CapacityGroupId;
  values: (number | null)[];
  tweetIncrement: number | null;
  note: string;
}

export const BOFA_CAPACITY_RESEARCH = {
  checkedAt: '2026-10-16',
  publishedAt: '2026-10-14',
  sourceLabel: 'StockSavvyShay 转引 BofA 研究附图',
  sourceUrl: 'https://x.com/StockSavvyShay/status/2110345541322481973',
  imageUrl: 'https://x.com/StockSavvyShay/status/2110345541322481973/photo/1',
  years: [2025, 2026, 2027, 2028, 2029, 2030],
  groups: [
    { id: 'hyperscaler', label: 'Hyperscaler', totals: [38.6, 56.9, 83, 110.2, 136.3, 161.2], increments: [null, 18.3, 26.1, 27.2, 26.1, 24.9] },
    { id: 'neocloud', label: 'Neocloud', totals: [2.2, 5.5, 11.2, 18.7, 31.1, 49.1], increments: [null, 3.3, 5.7, 7.5, 12.5, 17.9] },
    { id: 'sovereign', label: 'Sovereign', totals: [0.1, 0.5, 1.3, 3.9, 6.6, 9.2], increments: [null, 0.4, 0.8, 2.7, 2.7, 2.6] },
  ] as CapacityGroup[],
  totals: [40.9, 62.8, 95.4, 132.8, 174, 219.4],
  increments: [null, 21.9, 32.6, 37.4, 41.2, 45.4] as (number | null)[],
  operators: [
    { id: 'alphabet', label: 'Alphabet', group: 'hyperscaler', values: [5.5, 8.9, 14.7, 20.7, 26.6, 32.4], tweetIncrement: 27, note: '附图净新增 26.9GW；推文以整数列 +27GW。基期及预测均为研究估计。' },
    { id: 'amazon', label: 'Amazon', group: 'hyperscaler', values: [16.2, 22.6, 31.3, 40.5, 49.5, 58.1], tweetIncrement: 42, note: '附图净新增 41.9GW；推文以整数列 +42GW。基期及预测均为研究估计。' },
    { id: 'meta', label: 'Meta', group: 'hyperscaler', values: [5, 7.6, 11.2, 15, 18.8, 22.8], tweetIncrement: 18, note: '附图净新增 17.8GW；推文以整数列 +18GW。基期及预测均为研究估计。' },
    { id: 'microsoft', label: 'Microsoft', group: 'hyperscaler', values: [10.3, 13.7, 19.1, 24.7, 29.8, 34.4], tweetIncrement: 24, note: '附图净新增 24.1GW；推文以整数列 +24GW。基期及预测均为研究估计。' },
    { id: 'oracle', label: 'Oracle', group: 'hyperscaler', values: [1.6, 4.1, 6.6, 9.3, 11.6, 13.5], tweetIncrement: 12, note: '附图净新增 11.9GW；推文以整数列 +12GW。基期及预测均为研究估计。' },
    { id: 'coreweave', label: 'CoreWeave', group: 'neocloud', values: [0.9, 1.9, 3, 4.2, 6.1, 8], tweetIncrement: 7, note: '2030存量预测 8.0GW，附图净新增 7.1GW；推文写 +7GW。基期及预测均为研究估计。' },
    { id: 'nebius', label: 'Nebius', group: 'neocloud', values: [0.2, 0.7, 1.5, 2.4, 3.7, 5], tweetIncrement: 5, note: '2030存量预测 5.0GW，附图净新增 4.8GW；推文写 +5GW。基期及预测均为研究估计。' },
    { id: 'spacex-xai', label: 'SPCX / xAI', group: 'neocloud', values: [0.7, 1.5, 3, 5.4, 12.4, 24.7], tweetIncrement: 24, note: '按原图归入Neocloud；图注称NVDA将其视为Hyperscaler。附图净新增 24.0GW，推文写 +24GW；分类影响份额。' },
    { id: 'iren', label: 'IREN', group: 'neocloud', values: [0, 0.3, 0.8, 1.2, 1.7, 2.3], tweetIncrement: 3, note: '2025原图明确为0，附图净新增 2.3GW；推文写 +3GW，差异单列保留，未据此改写原图。' },
    { id: 'lambda', label: 'Lambda', group: 'neocloud', values: [0.1, 0.1, 0.2, 0.4, 0.7, 1], tweetIncrement: null, note: '基期及预测均为研究估计；推文未单列新增值，空值不代表零。' },
    { id: 'fluidstack', label: 'Fluidstack', group: 'neocloud', values: [0.1, 0.4, 1, 1.1, 1.3, 1.4], tweetIncrement: null, note: '基期及预测均为研究估计；推文未单列新增值，空值不代表零。' },
    { id: 'other-neoclouds', label: 'Other Neoclouds', group: 'neocloud', values: [0.3, 0.6, 1.7, 3.9, 5.3, 6.7], tweetIncrement: null, note: '原图其他Neocloud合计，非单一运营商；推文未单列新增值。' },
    { id: 'humain', label: 'HUMAIN (Saudi)', group: 'sovereign', values: [0, 0.1, 0.4, 0.8, 1.3, 1.8], tweetIncrement: null, note: '2025原图明确为0；基期及预测均为研究估计，推文未单列新增值。' },
    { id: 'g42', label: 'G42 (UAE)', group: 'sovereign', values: [0.1, 0.3, 0.5, 0.8, 1.1, 1.3], tweetIncrement: null, note: '基期及预测均为研究估计；推文未单列新增值，空值不代表零。' },
    { id: 'sk-telecom', label: 'SK Telecom (South Korea)', group: 'sovereign', values: [null, null, null, 1.5, 2.5, 3], tweetIncrement: null, note: '2025–2027原图为破折号，保留缺失，不推断为0；2025基期缺失，净新增不可计算。' },
    { id: 'other-sovereign', label: 'Other', group: 'sovereign', values: [0, 0.1, 0.4, 0.9, 1.8, 3.1], tweetIncrement: null, note: '原图其他Sovereign合计，非单一运营商；2025明确为0，推文未单列新增值。' },
  ] as CapacityOperator[],
  methodology: [
    '附图范围为全球 AI/cloud 数据中心容量，单位 GW，不等同于纯 AI 负载、GPU 装机、芯片功率或年度资本开支。',
    'CY25 为研究估计基期，CY26–CY30E 为研究预测；全部数字均非公司实际值或公司指引。',
    '全球容量由 2025 年 40.9GW 至 2030 年预测 219.4GW，约 5.4 倍；推文概述为约 41GW 至约 219GW、约 5 倍。',
    '分组、全球总容量及年度新增按附图分别保留。原图仅显示一位小数，加总和年度差额可能有约 0.1GW 舍入差，不强行改写原值。',
    'Neocloud 约 40% 指 2030 当年新增容量的 17.9÷45.4=39.4%；2030 存量份额另为 49.1÷219.4=22.4%，不是累计新增份额。',
    'SPCX / xAI 按原图归入 Neocloud；图注称 NVIDIA 将其视为 Hyperscaler，因此上述 Neocloud 份额依赖原图分类。',
    '推文所述九家公司新增值单独保留；附图净新增仅按 2030 预测减 2025 基期计算，不用推文整数覆盖附图，IREN 附图为 2.3GW 而推文写 3GW。',
    '原图破折号保持缺失，不作为零；IREN 的 2025 年 0 是原图明确零值。推文发布于北京时间 2026-10-14 20:22，收到及核验日为 2026-10-16，收到日不替代预测基期。',
    '附图标题为 Top-down GW analysis by DC operator，表内说明为各运营商累计在线GW研究估计；图底来源列BofA Global Research、Company Commentary、Media Reports，完整报告及详细方法未取得。',
  ],
  sourceStatus: '已核对 StockSavvyShay 推文及其转引附图；BofA 原报告标题、报告日期及完整方法未取得，保留第三方转引研究口径。',
};

export function capacityNetAddition(values: readonly (number | null)[]): number | null {
  const first = values[0];
  const last = values.at(-1);
  if (typeof first !== 'number' || typeof last !== 'number' || !Number.isFinite(first) || !Number.isFinite(last)) return null;
  return Math.round((last - first) * 10) / 10;
}

const baseCapacity = BOFA_CAPACITY_RESEARCH.totals[0];
const forecastCapacity = BOFA_CAPACITY_RESEARCH.totals.at(-1)!;
const neocloud = BOFA_CAPACITY_RESEARCH.groups.find(group => group.id === 'neocloud')!;
const annual2030Total = BOFA_CAPACITY_RESEARCH.increments.at(-1)!;
const annual2030Neocloud = neocloud.increments.at(-1)!;

export const BOFA_CAPACITY_METRICS = {
  baseCapacity,
  forecastCapacity,
  capacityMultiple: forecastCapacity / baseCapacity,
  netAddition: capacityNetAddition(BOFA_CAPACITY_RESEARCH.totals)!,
  annual2030Total,
  annual2030Neocloud,
  annual2030NeocloudShare: annual2030Neocloud / annual2030Total,
  stock2030NeocloudShare: neocloud.totals.at(-1)! / forecastCapacity,
};
