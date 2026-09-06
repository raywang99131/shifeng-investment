import type { OpenRouterWeeklyHistory } from './types';

export type WeeklyChartScale = 'linear' | 'log';

export function weeklyChartGeometry(history: OpenRouterWeeklyHistory, scale: WeeklyChartScale) {
  const totals = history.weeks.map((week) => week.segments.reduce((sum, segment) => sum + segment.tokens, 0));
  const peak = Math.max(...totals.map((value, index) => value + (history.weeks[index].pace?.additionalTokens ?? 0)));
  const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
  const step = ([1, 2, 3, 5, 10].find((value) => value * magnitude >= peak / 4) ?? 10) * magnitude;
  const minimum = scale === 'log' ? Math.min(1e12, 10 ** Math.floor(Math.log10(Math.min(...totals)))) : 0;
  const maximum = scale === 'log' ? 10 ** Math.ceil(Math.log10(peak)) : Math.ceil(peak / step) * step;
  const position = (value: number) => scale === 'linear' ? value / maximum
    : (Math.log10(Math.max(minimum, value)) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum));
  const ticks: number[] = [];
  if (scale === 'log') {
    for (let value = minimum; value <= maximum; value *= 10) ticks.push(value);
  } else {
    for (let value = step; value <= maximum; value += step) ticks.push(value);
  }
  const columns = history.weeks.map((week) => {
    let accumulated = 0;
    const byModel = new Map(week.segments.map((segment) => [segment.modelId, segment]));
    const segments = history.models.flatMap((model) => {
      const segment = byModel.get(model.id);
      if (!segment) return [];
      const bottom = position(accumulated);
      accumulated += segment.tokens;
      return [{ ...segment, color: model.color, bottom, top: position(accumulated) }];
    });
    const pace = week.pace ? { bottom: position(accumulated), top: position(accumulated + week.pace.additionalTokens) } : null;
    return { segments, pace };
  });
  return { minimum, maximum, ticks, position, columns };
}
