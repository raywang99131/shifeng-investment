// Dated editorial research, kept separate from observed rental-price history.
// Notification prices remain reported until a first-party notice is available.
export const NEBIUS_RESEARCH = {
  id: 'nebius-pricing-2026-09-17',
  checkedAt: '2026-09-17',
  reportedEffectiveDate: '2026-10-01',
  sources: {
    prices: { label: 'Nebius 官网价目表', url: 'https://nebius.com/prices', status: '官方 · 核验时仍为旧价' },
    notice: { label: 'Reddit 客户通知转述', url: 'https://www.reddit.com/r/NBIS_Stock/comments/1wi91jl/nebius_updating_prices_starting_october_1/', status: '2026-09-16 · 非原始邮件' },
    report: { label: 'Stocktwits 报道', url: 'https://stocktwits.com/news-articles/markets/equity/nbis-stock-rallies-as-neocloud-operator-hikes-prices-peers-iren-crwv-jump-as-well/cZtrBwmRB5R', status: '2026-09-16 美东 · 引用客户转述' },
    shareholderLetter: { label: 'Nebius Q2 股东信 · 第 2–3 页', url: 'https://www.sec.gov/Archives/edgar/data/1513845/000110465926094568/tm2622968d1_ex99-2.htm', status: '2026-08-12 · 官方 SEC 申报' },
    nvidiaCall: { label: 'NVIDIA FY2027 Q2 电话会 · 第 4 页', url: 'https://investor.nvidia.com/files/content_files/TRANSCRIPT_-NVIDIA-Corp-NVDA-US-Q2-2027-Earnings-Call-26-August-2026-5_00-PM-ET.pdf#page=4', status: '2026-08-26 · 官方 IR 纪要' },
    dgxSpecs: { label: 'NVIDIA DGX B200 规格', url: 'https://docs.nvidia.com/dgx/dgxb200-user-guide/introduction-to-dgxb200.html', status: '官方规格 · 非 Nebius 实际配置' },
  },
  priceChanges: [
    { gpu: 'H100', current: 3.85, announced: 4.5, regions: 'eu-north1' },
    { gpu: 'H200', current: 4.5, announced: 5.4, regions: 'eu-north1 / eu-north2 / eu-west1 / us-central1' },
    { gpu: 'B200', current: 7.15, announced: 8.5, regions: 'us-central1 / me-west1' },
    { gpu: 'B300', current: 7.85, announced: 9.5, regions: 'uk-south1 / eu-west2 / us-north1' },
  ],
  scenario: {
    facilityPowerKw: 1_000_000,
    // Backsolved assumption, including host, network, storage and facility overhead.
    facilityKwPerGpu: 2.2,
    realizedPriceRatio: 0.6,
    hoursPerYear: 8_760,
    billedUtilizations: [0.8, 0.9, 1],
  },
} as const;

const { scenario, priceChanges } = NEBIUS_RESEARCH;
const b200 = priceChanges[2];
const gpuCount = scenario.facilityPowerKw / scenario.facilityKwPerGpu;
const annualRevenue = (price: number, utilization: number) => (
  gpuCount * price * scenario.realizedPriceRatio * scenario.hoursPerYear * utilization / 1e8
);

export const NEBIUS_REVENUE_SCENARIOS = scenario.billedUtilizations.map(utilization => ({
  utilization,
  gpuCount,
  previousRevenueYiUsd: annualRevenue(b200.current, utilization),
  announcedRevenueYiUsd: annualRevenue(b200.announced, utilization),
  incrementalRevenueYiUsd: annualRevenue(b200.announced - b200.current, utilization),
}));
