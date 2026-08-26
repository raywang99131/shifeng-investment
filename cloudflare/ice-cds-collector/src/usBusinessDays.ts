const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (kind: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === kind)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

const parseDate = (date: string): Date => new Date(`${date}T00:00:00.000Z`);
const formatDate = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

const nthWeekday = (year: number, monthIndex: number, weekday: number, occurrence: number): string => {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return formatDate(addDays(first, offset + (occurrence - 1) * 7));
};

const lastWeekday = (year: number, monthIndex: number, weekday: number): string => {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return formatDate(addDays(last, -((last.getUTCDay() - weekday + 7) % 7)));
};

const observedFixedDate = (year: number, monthIndex: number, day: number): string => {
  const holiday = new Date(Date.UTC(year, monthIndex, day));
  if (holiday.getUTCDay() === 6) return formatDate(addDays(holiday, -1));
  if (holiday.getUTCDay() === 0) return formatDate(addDays(holiday, 1));
  return formatDate(holiday);
};

const federalHolidaysForYear = (year: number): Set<string> => new Set([
  observedFixedDate(year, 0, 1),
  nthWeekday(year, 0, 1, 3),
  nthWeekday(year, 1, 1, 3),
  lastWeekday(year, 4, 1),
  ...(year >= 2021 ? [observedFixedDate(year, 5, 19)] : []),
  observedFixedDate(year, 6, 4),
  nthWeekday(year, 8, 1, 1),
  nthWeekday(year, 9, 1, 2),
  observedFixedDate(year, 10, 11),
  nthWeekday(year, 10, 4, 4),
  observedFixedDate(year, 11, 25),
]);

const federalHolidaysAround = (year: number): Set<string> => new Set([
  ...federalHolidaysForYear(year - 1),
  ...federalHolidaysForYear(year),
  ...federalHolidaysForYear(year + 1),
]);

export function isUsFederalBusinessDay(date: string): boolean {
  const parsed = parseDate(date);
  if (Number.isNaN(parsed.getTime()) || formatDate(parsed) !== date) return false;
  const weekday = parsed.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !federalHolidaysAround(parsed.getUTCFullYear()).has(date);
}

export function completedUsBusinessDaysBetween(lastPublishedDate: string, now: Date): number {
  const currentNewYorkDate = isoDate(now);
  const start = addDays(parseDate(lastPublishedDate), 1);
  const endExclusive = parseDate(currentNewYorkDate);
  let completed = 0;
  for (let cursor = start; cursor.getTime() < endExclusive.getTime(); cursor = addDays(cursor, 1)) {
    if (isUsFederalBusinessDay(formatDate(cursor))) completed += 1;
  }
  return completed;
}

export function isCollectorStale(lastPublishedDate: string | null, now: Date): boolean {
  return lastPublishedDate === null || completedUsBusinessDaysBetween(lastPublishedDate, now) >= 2;
}
