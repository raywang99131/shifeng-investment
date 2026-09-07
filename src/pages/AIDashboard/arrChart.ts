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
      smooth: false, connectNulls: false, showSymbol: true, showAllSymbol: true,
      symbolSize: 10, symbol: company === 'Anthropic' ? 'circle' : 'diamond',
      data: points.flatMap((point, index) => {
        const timestamp = Date.parse(`${point.observedAt}T00:00:00Z`);
        const observation = { value: [timestamp, point.value], point };
        // An unreconciled vintage is still an observation, but its connecting line
        // would imply a like-for-like change that the supplied report does not support.
        return index > 0 && point.comparisonNote ? [
          { value: [timestamp, null], point, symbolSize: 0, label: { show: false }, tooltip: { show: false } },
          observation,
        ] : [observation];
      }),
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

export type LatestCompanyValuation = ValuationMetric & {
  arrPoint: ArrPoint | null;
  parrUpperBound: boolean;
};

export function latestCompanyValuations(valuations: ValuationMetric[], metrics: ArrCompanyMetric[]): LatestCompanyValuation[] {
  const latestValuations = new Map<string, ValuationMetric>();
  for (const row of valuations) {
    if (row.valuationBasis === 'formula-assumption') continue;
    const previous = latestValuations.get(row.company);
    if (!previous || row.asOf >= previous.asOf) latestValuations.set(row.company, row);
  }
  const latestArr = new Map<string, ArrPoint>();
  for (const point of metrics.flatMap((metric) => metric.actualPoints)) {
    if (point.kind !== 'actual') continue;
    const previous = latestArr.get(point.company);
    if (!previous || point.observedAt >= previous.observedAt) latestArr.set(point.company, point);
  }
  return [...latestValuations.values()].map((row) => {
    const point = latestArr.get(row.company) || null;
    const arrLow = point?.valueLow ?? point?.value ?? null;
    const arrHigh = point?.valueHigh ?? point?.value ?? null;
    const valid = arrLow !== null && arrHigh !== null && Number.isFinite(arrLow) && Number.isFinite(arrHigh) && arrLow > 0 && arrHigh > 0;
    return {
      ...row, arrPoint: point, arrValue: point?.value ?? null, arrAsOf: point?.observedAt ?? null,
      arrSourceLabel: point?.sourceLabel ?? null,
      parrLow: valid ? row.valuationLow / arrHigh : null,
      parrHigh: valid ? row.valuationHigh / arrLow : null,
      parrUpperBound: point?.valueQualifier === 'lower-bound',
    };
  }).sort((a, b) => {
    const order = ['Anthropic', 'OpenAI'];
    const priority = (company: string) => order.includes(company) ? order.indexOf(company) : order.length;
    return priority(a.company) - priority(b.company) || a.company.localeCompare(b.company);
  });
}
