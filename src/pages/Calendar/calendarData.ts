import dayjs from 'dayjs';
import type { CalendarEvent, CalendarEventStatus, CalendarTrack } from './types';

type UnknownRecord = Record<string, unknown>;

const TRACK_ALIASES: Record<string, CalendarTrack> = {
  macro: 'macro',
  macros: 'macro',
  economy: 'macro',
  economic: 'macro',
  '中美宏观': 'macro',
  '宏观': 'macro',
  earnings: 'earnings',
  earning: 'earnings',
  financials: 'earnings',
  '美股财报': 'earnings',
  '财报': 'earnings',
  'a-share': 'a-share',
  ashare: 'a-share',
  a_share: 'a-share',
  astock: 'a-share',
  'a股': 'a-share',
  'a股事件': 'a-share',
};

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstValue = (record: UnknownRecord, keys: string[]): unknown => {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const stringValue = (record: UnknownRecord, keys: string[], fallback = ''): string => {
  const value = firstValue(record, keys);
  return value === undefined ? fallback : String(value).trim();
};

const booleanValue = (record: UnknownRecord, keys: string[]): boolean | undefined => {
  const value = firstValue(record, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', '是', '命中'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', '否', '未命中'].includes(normalized)) return false;
  }
  return undefined;
};

const numberValue = (record: UnknownRecord, keys: string[], fallback: number): number => {
  const value = Number(firstValue(record, keys));
  return Number.isFinite(value) ? value : fallback;
};

const stringArrayValue = (record: UnknownRecord, keys: string[]): string[] => {
  const value = firstValue(record, keys);
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[，,、;；|｜/]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeDate = (value: unknown): string => {
  if (!value) return '';
  const parsed = dayjs(String(value));
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '';
};

const sourceDisplayName = (value: string): string => {
  const names: Record<string, string> = {
    jin10: '金十数据',
    nasdaq: 'Nasdaq',
    earningshub: 'EarningsHub',
    wechat: 'A股投资日历',
    company_ir: '公司公告',
    official: '官方',
  };
  return names[value.toLowerCase()] || value;
};

const formatMetric = (value: unknown, unit: string): string => {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (!unit || text.endsWith(unit)) return text;
  return text + unit;
};

const currencyPrefix = (currency: string): string => {
  const normalized = currency.toUpperCase();
  if (normalized === 'USD') return '$';
  if (normalized === 'CNY' || normalized === 'RMB') return '¥';
  if (normalized === 'EUR') return '€';
  return currency ? currency + ' ' : '';
};

const formatEstimate = (value: unknown, currency: string, compact: boolean): string => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string' && !Number.isFinite(Number(value))) return value.trim();
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const prefix = currencyPrefix(currency);
  if (!compact) return prefix + numeric.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const absolute = Math.abs(numeric);
  if (absolute >= 1_000_000_000) {
    return prefix + Number((numeric / 1_000_000_000).toFixed(2)) + 'B';
  }
  if (absolute >= 1_000_000) {
    return prefix + Number((numeric / 1_000_000).toFixed(2)) + 'M';
  }
  return prefix + numeric.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

const formatStartAtInBeijing = (value: string): string => {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
};

const formatDateRange = (date: string, endDate: string): string => {
  if (!endDate || endDate === date) return '';
  const start = dayjs(date);
  const end = dayjs(endDate);
  if (!start.isValid() || !end.isValid()) return '';
  if (start.month() === end.month()) return start.format('M月D日') + '–' + end.format('D日');
  return start.format('M月D日') + '–' + end.format('M月D日');
};

const sessionLabel = (session: string): string => {
  const labels: Record<string, string> = {
    before_market: '盘前',
    after_market: '盘后',
    premarket: '盘前',
    postmarket: '盘后',
    unknown: '待定',
  };
  return labels[session.toLowerCase()] || session;
};

const eventStatus = (value: string): CalendarEventStatus | undefined => {
  const normalized = value.trim().toLowerCase();
  return ['scheduled', 'estimated', 'confirmed', 'released', 'cancelled'].includes(normalized)
    ? normalized as CalendarEventStatus
    : undefined;
};

const inferTrack = (record: UnknownRecord, forcedTrack?: CalendarTrack): CalendarTrack => {
  if (forcedTrack) return forcedTrack;
  const explicit = stringValue(record, ['track', 'kind', 'calendarType', 'calendar_type']).toLowerCase();
  if (TRACK_ALIASES[explicit]) return TRACK_ALIASES[explicit];
  if (/宏观|macro|economic/.test(explicit)) return 'macro';
  if (/财报|earnings|financial/.test(explicit)) return 'earnings';
  if (/a股|a-share|ashare|a_share/.test(explicit)) return 'a-share';

  const market = stringValue(record, ['market', 'exchange', '市场']).toLowerCase();
  const hasEarningsFields = firstValue(record, ['epsEstimate', 'eps_estimate', 'revenueEstimate', 'revenue_estimate']) !== undefined;
  const hasMacroFields = firstValue(record, ['previous', 'forecast', 'actual', '前值', '预测值', '公布值']) !== undefined;
  if (hasEarningsFields || /nasdaq|nyse|us|美股/.test(market)) return 'earnings';
  if (hasMacroFields) return 'macro';
  return 'a-share';
};

const normalizeEvent = (
  value: unknown,
  index: number,
  forcedTrack?: CalendarTrack,
): CalendarEvent | null => {
  if (!isRecord(value)) return null;
  const track = inferTrack(value, forcedTrack);
  const date = normalizeDate(firstValue(value, ['date', 'eventDate', 'event_date', 'reportDate', '日期']));
  const endDate = normalizeDate(firstValue(value, ['endDate', 'end_date', '结束日期']));
  const title = stringValue(value, ['title', 'name', 'event', 'eventName', 'companyName', '事件名称', '公司名称']);
  if (!date || !title) return null;

  const metrics = isRecord(value.metrics) ? value.metrics : {};
  const earnings = isRecord(value.earnings) ? value.earnings : {};
  const source = isRecord(value.source) ? value.source : {};
  const tags = stringArrayValue(value, ['tags']);
  const currency = stringValue(earnings, ['currency']);
  const code = stringValue(
    earnings,
    ['symbol'],
    stringValue(value, ['code', 'ticker', 'symbol', 'stockCode', '股票代码']),
  );
  const importance = Math.max(1, Math.min(5, Math.round(numberValue(value, ['importance', 'priority', 'stars', '重要度'], 3))));
  const explicitId = stringValue(value, ['id', 'eventId', 'event_id']);
  const directSubsets = stringArrayValue(value, ['subsets', 'subset', 'watchlists', 'watchlist', '子集']);
  const rawSubsetHits = value.subsetHits;
  const subsetHitsProvided = Array.isArray(rawSubsetHits);
  const hitSubsets = subsetHitsProvided
    ? rawSubsetHits
      .filter(isRecord)
      .map((hit) => stringValue(hit, ['fundName', 'name']))
      .filter(Boolean)
    : [];
  const subsets = [...new Set(subsetHitsProvided ? hitSubsets : directSubsets)];
  const directSubsetHit = booleanValue(value, ['subsetHit', 'subset_hit', 'watchlistHit', 'watchlist_hit', 'inSubset', '子集命中']);
  const subsetHit = subsetHitsProvided ? subsets.length > 0 : directSubsetHit ?? subsets.length > 0;
  const startAt = stringValue(value, ['startAt', 'start_at']);
  const sourceName = sourceDisplayName(
    stringValue(source, ['name'], stringValue(value, ['source', 'provider', '来源'])),
  );
  const sourceUrl = stringValue(source, ['url'], stringValue(value, ['url', 'link', 'sourceUrl', 'source_url']));
  const unit = stringValue(metrics, ['unit']);
  const directTime = stringValue(value, ['time', 'eventTime', 'event_time', 'publishTime', '时间']);
  const rangeTime = formatDateRange(date, endDate);
  const time = directTime
    || rangeTime
    || formatStartAtInBeijing(startAt)
    || (stringValue(value, ['timePrecision']) === 'date' ? '全天' : '');
  const rawSession = stringValue(
    earnings,
    ['session'],
    stringValue(value, ['timing', 'session', 'releaseTiming', 'release_timing', '盘前盘后']),
  );

  return {
    id: explicitId || [track, date, code || title, index].join('-'),
    date,
    endDate: endDate || undefined,
    startAt: startAt || undefined,
    timezone: stringValue(value, ['timezone']) || undefined,
    track,
    title,
    time,
    timing: rawSession ? sessionLabel(rawSession) : '',
    country: stringValue(value, ['country', '国家'])
      || ({ CN: '中国', US: '美国' }[stringValue(value, ['region']).toUpperCase()] || stringValue(value, ['region'])),
    code,
    period: stringValue(earnings, ['period'], stringValue(value, ['period', 'fiscalPeriod', 'fiscal_period', '报告期'])),
    category: stringValue(value, ['category', 'sector', 'industry', '类别']) || tags[0] || '',
    description: stringValue(value, ['description', 'summary', 'note', '摘要']),
    source: sourceName,
    url: sourceUrl,
    importance,
    status: eventStatus(stringValue(value, ['status', 'eventStatus', 'event_status', '状态'])),
    important: booleanValue(value, ['important', 'isImportant', 'is_important', '重要']),
    subsetHit,
    subsets,
    previous: formatMetric(firstValue(metrics, ['previous']) ?? firstValue(value, ['previous', 'prior', '前值']), unit),
    forecast: formatMetric(firstValue(metrics, ['forecast']) ?? firstValue(value, ['forecast', 'consensus', '预测值']), unit),
    actual: formatMetric(firstValue(metrics, ['actual']) ?? firstValue(value, ['actual', '公布值']), unit),
    impact: stringValue(
      metrics,
      ['impact', 'influence', 'marketImpact', 'market_impact', '影响'],
      stringValue(value, ['impact', 'influence', 'marketImpact', 'market_impact', '影响']),
    ),
    epsEstimate: formatEstimate(
      firstValue(earnings, ['epsEstimate']) ?? firstValue(value, ['epsEstimate', 'eps_estimate', 'epsForecast', 'EPS预期']),
      currency,
      false,
    ),
    revenueEstimate: formatEstimate(
      firstValue(earnings, ['revenueEstimate']) ?? firstValue(value, ['revenueEstimate', 'revenue_estimate', 'revenueForecast', '营收预期']),
      currency,
      true,
    ),
    currency,
  };
};

const appendGroup = (
  output: Array<{ value: unknown; track?: CalendarTrack }>,
  record: UnknownRecord,
  keys: string[],
  track: CalendarTrack,
) => {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    value.forEach((item) => output.push({ value: item, track }));
  }
};

const extractEventInputs = (payload: unknown): Array<{ value: unknown; track?: CalendarTrack }> => {
  if (Array.isArray(payload)) return payload.map((value) => ({ value }));
  if (!isRecord(payload)) return [];

  const directEvents = firstValue(payload, ['events', 'items', 'calendar']);
  if (Array.isArray(directEvents)) return directEvents.map((value) => ({ value }));

  const data = payload.data;
  if (Array.isArray(data)) return data.map((value) => ({ value }));
  const container = isRecord(data) ? data : payload;
  const nestedEvents = firstValue(container, ['events', 'items', 'calendar']);
  if (Array.isArray(nestedEvents)) return nestedEvents.map((value) => ({ value }));

  const grouped: Array<{ value: unknown; track?: CalendarTrack }> = [];
  appendGroup(grouped, container, ['macro', 'macros', 'macroEvents', 'economic', '中美宏观'], 'macro');
  appendGroup(grouped, container, ['earnings', 'earningEvents', 'usEarnings', '美股财报'], 'earnings');
  appendGroup(grouped, container, ['aShare', 'a_share', 'ashare', 'aShareEvents', 'aStock', 'A股事件'], 'a-share');
  return grouped;
};

export const normalizeCalendarResponse = (payload: unknown): CalendarEvent[] =>
  extractEventInputs(payload)
    .map((entry, index) => normalizeEvent(entry.value, index, entry.track))
    .filter((event): event is CalendarEvent => Boolean(event));
