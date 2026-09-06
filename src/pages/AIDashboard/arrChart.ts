import type { ArrCompanyMetric, ArrPoint, ValuationMetric } from './types';

export function arrValueLabel(point: Pick<ArrPoint, 'value' | 'valueLow' | 'valueHigh' | 'valueQualifier'>): string {
  const format = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
  if (point.valueLow !== undefined && point.valueHigh !== undefined) return `${format(point.valueLow)}–${format(point.valueHigh)}`;
  return `${format(point.value)}${point.valueQualifier === 'lower-bound' ? '+' : ''}`;
}

export function primaryArrMetrics(metrics: ArrCompanyMetric[]) {
  return metrics.filter((m) => ['Anthropic', 'OpenAI'].includes(m.company));
}

export function arrSourceCategory(point: ArrPoint): 'official' | 'yipit' | 'unspecified' {
  if (point.seriesKind === 'official' || point.methodology?.includes('官方口径')) return 'official';
  if (point.sourceLabel === 'Yipit' || /yipit/i.test(`${point.commentary || ''} ${point.methodology || ''}`)) return 'yipit';
  return 'unspecified';
}

export function arrChartSeries(metrics: ArrCompanyMetric[]) {
  return ['Anthropic', 'OpenAI'].flatMap((company) => {
    const points = metrics.filter((m) => m.company === company).flatMap((m) => m.actualPoints)
      .toSorted((a, b) => a.observedAt.localeCompare(b.observedAt));
    if (!points.length) return [];
    return [{
      name: company, company, type: 'line',
      smooth: false, showSymbol: true, showAllSymbol: true,
      symbolSize: 10, symbol: company === 'Anthropic' ? 'circle' : 'diamond',
      data: points.map((point) => ({ value: [Date.parse(`${point.observedAt}T00:00:00Z`), point.value], point })),
    }];
  });
}

export function historicalValuations(valuations: ValuationMetric[]): ValuationMetric[] {
  return valuations.filter((row) => row.multipleKind !== 'P/S' && row.valuationBasis !== 'formula-assumption')
    .map((row) => row.valuationBasis === 'reference' ? {
      ...row, arrValue: row.historicalArrValue ?? null, arrAsOf: row.historicalArrAsOf ?? null,
      parrLow: row.historicalParrLow ?? null, parrHigh: row.historicalParrHigh ?? null,
      arrSourceLabel: '月度跟踪 · 同月或此前', note: '按原表月份匹配同月或此前的历史 ARR；原表未提供融资日，不视作精确到日的同期估值。',
    } : row);
}
