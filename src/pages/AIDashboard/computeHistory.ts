import type { ComputeRentalQuote } from './types.ts';

export function buildComputeHistory(quotes: ComputeRentalQuote[]) {
  const observedDates = [...new Set(quotes.map(row => row.asOf))].sort();
  const dates: string[] = [];
  if (observedDates.length) {
    const last = Date.parse(observedDates.at(-1)!);
    for (let day = Date.parse(observedDates[0]); day <= last; day += 86_400_000) {
      dates.push(new Date(day).toISOString().slice(0, 10));
    }
  }
  const groups = new Map<string, ComputeRentalQuote[]>();
  for (const row of quotes) groups.set(row.quoteKey, [...(groups.get(row.quoteKey) || []), row]);
  const series = [...groups.values()].map(rows => {
    const byDate = new Map(rows.toSorted((a, b) => a.retrievedAt.localeCompare(b.retrievedAt)).map(row => [row.asOf, row]));
    const first = rows[0];
    return {
      name: `${first.platform} · ${first.gpu} · ${first.instanceSpec} · ${first.region} · ${first.billingMode}`,
      type: 'line', showSymbol: true, connectNulls: false,
      data: dates.map(date => byDate.get(date)?.pricePerGpuHour ?? null),
    };
  });
  return { dates, series, observedDays: observedDates.length, missingDays: dates.length - observedDates.length };
}
