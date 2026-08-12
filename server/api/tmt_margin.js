import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const TMT_SCRIPT = path.join(__dirname, '../../macd screener/tmt_margin.py');
const EASTMONEY_BACKFILL_SCRIPT = path.join(__dirname, '../../scripts/backfill_trading_congestion_eastmoney.py');
const TMT_CACHE_DIR = path.join(__dirname, '../data/tmt-margin');
const TMT_CACHE_FILE = path.join(TMT_CACHE_DIR, 'latest.json');
const EASTMONEY_KLINE_CACHE_FILE = path.join(TMT_CACHE_DIR, 'eastmoney-kline-cache.json');
const EASTMONEY_LONG_HISTORY_FILE = path.join(TMT_CACHE_DIR, 'eastmoney-long-history.json');
const EASTMONEY_SPOT_SNAPSHOT_FILE = path.join(TMT_CACHE_DIR, 'eastmoney-spot-snapshots.json');
const EASTMONEY_UNIVERSE_CACHE_FILE = path.join(TMT_CACHE_DIR, 'eastmoney-universe.json');
const EASTMONEY_LONG_HISTORY_MIN_STOCK_COUNT = 4500;
const EASTMONEY_KLINE_SOURCE_COOLDOWN_MINUTES = 30;
const TMT_SCRIPT_TIMEOUT_MS = 180000;
const TMT_SCRIPT_HISTORY_TIMEOUT_MS = 900000;
const EASTMONEY_SPOT_ATTEMPT_TIMEOUT_MS = 160000;
const EASTMONEY_SPOT_PRIMARY_TIMEOUT_MS = 15000;
const EASTMONEY_SPOT_TOTAL_TIMEOUT_MS = 180000;
const EASTMONEY_SPOT_MAX_ATTEMPTS = 2;
const EASTMONEY_SPOT_RETRY_DELAY_MS = 500;
export const STANDARD_TMT_DEFINITION_ID = 'sw2021_l1_tmt_v1';
export const STANDARD_TMT_DEFINITION_NAME = '申万2021一级行业TMT（电子+计算机+传媒+通信）';
const STANDARD_TMT_MEMBERSHIP_MODES = new Set(['point_in_time', 'current_components_backfill']);
const STANDARD_TMT_INDUSTRIES = Object.freeze({
  '801080': { name: '电子', universeMin: 400, universeMax: 1000 },
  '801750': { name: '计算机', universeMin: 250, universeMax: 800 },
  '801760': { name: '传媒', universeMin: 100, universeMax: 400 },
  '801770': { name: '通信', universeMin: 90, universeMax: 400 },
});
const LEGACY_CUSTOM_MARGIN_KEYS = [
  'core_stocks',
  'dynamic_stocks',
  'category_summary',
  'thresholds',
  'tmt_sz_yy',
];

let tmtMemoryCache = null;
let tmtMemoryCacheMtimeMs = 0;
let tmtInFlightQuick = null;
let tmtInFlightHistory = null;
let eastmoneyBackfillInFlight = null;
let eastmoneyKlineCrawlInFlight = null;

function hasFullYearTradingHistory(payload) {
  const trading = payload?.data?.trading_congestion;
  const trend = trading?.trend || [];
  const availableTop100Dates = trading?.available_top100_dates || [];
  const sampleCount = trading?.percentile_sample_count || 0;
  return (
    Array.isArray(trend)
    && trend.length >= 240
    && Array.isArray(availableTop100Dates)
    && availableTop100Dates.length >= 240
    && sampleCount >= 240
  );
}

function readCache() {
  try {
    if (!fs.existsSync(TMT_CACHE_FILE)) return null;
    const stat = fs.statSync(TMT_CACHE_FILE);
    if (tmtMemoryCache && tmtMemoryCacheMtimeMs === stat.mtimeMs) return tmtMemoryCache;
    tmtMemoryCache = JSON.parse(fs.readFileSync(TMT_CACHE_FILE, 'utf-8'));
    tmtMemoryCacheMtimeMs = stat.mtimeMs;
    return tmtMemoryCache;
  } catch (err) {
    console.error('Read TMT margin cache failed:', err);
    return null;
  }
}

function writeCache(payload) {
  fs.mkdirSync(TMT_CACHE_DIR, { recursive: true });
  const nextPayload = {
    ...payload,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(TMT_CACHE_FILE, JSON.stringify(nextPayload, null, 2), 'utf-8');
  tmtMemoryCache = nextPayload;
  tmtMemoryCacheMtimeMs = fs.statSync(TMT_CACHE_FILE).mtimeMs;
  return nextPayload;
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error(`Read JSON failed: ${filePath}`, err);
    return fallback;
  }
}

function shanghaiDateKey(value = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function needsDailySpotRefresh() {
  const spotArchive = readJsonFile(EASTMONEY_SPOT_SNAPSHOT_FILE, { updatedAt: null, snapshots: {} });
  const updatedAt = spotArchive?.updatedAt ? new Date(spotArchive.updatedAt) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return true;
  return shanghaiDateKey(updatedAt) !== shanghaiDateKey();
}

function normalizeDateKey(value) {
  const digits = String(value || '').replaceAll('-', '').slice(0, 8);
  return /^\d{8}$/.test(digits) ? digits : null;
}

function strictDateKey(value) {
  const text = String(value || '').trim();
  if (!/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return text;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value, { min = -Infinity, max = Infinity, integer = false } = {}) {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max
    && (!integer || Number.isInteger(value))
  );
}

function isNullableFiniteNumber(value, options) {
  return value === null || isFiniteNumber(value, options);
}

function contractIssue(code, reason) {
  return { code, reason };
}

function validateExactIndustryRows(rows, label, validateRow) {
  if (!Array.isArray(rows) || rows.length !== Object.keys(STANDARD_TMT_INDUSTRIES).length) {
    return contractIssue('MARGIN_INDUSTRY_SET_INVALID', `${label}必须恰好包含申万TMT四行业`);
  }
  const seen = new Set();
  for (const row of rows) {
    if (!isRecord(row)) {
      return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}包含无效记录`);
    }
    const code = row.industry_code;
    const expected = STANDARD_TMT_INDUSTRIES[code];
    if (!expected || seen.has(code) || row.industry_name !== expected.name) {
      return contractIssue('MARGIN_INDUSTRY_SET_INVALID', `${label}行业代码、名称或唯一性不符合标准口径`);
    }
    seen.add(code);
    const rowIssue = validateRow(row, expected);
    if (rowIssue) return rowIssue;
  }
  if (seen.size !== Object.keys(STANDARD_TMT_INDUSTRIES).length) {
    return contractIssue('MARGIN_INDUSTRY_SET_INVALID', `${label}申万TMT四行业不完整`);
  }
  return null;
}

function validateTurnoverBreakdown(rows, total, label = 'tmt_turnover_by_industry') {
  const issue = validateExactIndustryRows(rows, label, (row) => (
    isFiniteNumber(row.turnover_pct, { min: 0, max: 100 })
      ? null
      : contractIssue('MARGIN_PAYLOAD_INVALID', `${label}成交额占比无效`)
  ));
  if (issue) return issue;
  const breakdownTotal = rows.reduce((sum, row) => sum + row.turnover_pct, 0);
  if (!isFiniteNumber(total, { min: 0, max: 100 }) || Math.abs(breakdownTotal - total) > 0.06) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}与TMT成交额占比合计不一致`);
  }
  return null;
}

function validateCoreMarginNumbers(item, label) {
  const nonNegative = ['tmt_yy', 'tmt_buy'];
  const positive = ['market_yy', 'market_buy'];
  const percentages = ['pct', 'tmt_buy_pct', 'tmt_turnover_pct'];
  if (nonNegative.some((key) => !isFiniteNumber(item[key], { min: 0 }))) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}两融数值缺失或无效`);
  }
  if (positive.some((key) => !isFiniteNumber(item[key], { min: Number.EPSILON }))) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}全市场两融数值缺失或无效`);
  }
  if (percentages.some((key) => !isFiniteNumber(item[key], { min: 0, max: 100 }))) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}占比数值缺失或无效`);
  }
  if (
    !isFiniteNumber(item.tmt_universe_count, { min: 1, integer: true })
    || !isFiniteNumber(item.tmt_margin_count, { min: 0, integer: true })
    || item.tmt_margin_count > item.tmt_universe_count
  ) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}成分数量缺失或无效`);
  }
  if (item.tmt_count !== item.tmt_margin_count) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}两融覆盖数量别名不一致`);
  }
  if (item.tmt_yy > item.market_yy || item.tmt_buy > item.market_buy) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}TMT数值不能超过全市场`);
  }
  const expectedPct = item.tmt_yy / item.market_yy * 100;
  const expectedBuyPct = item.tmt_buy / item.market_buy * 100;
  if (Math.abs(expectedPct - item.pct) > 0.1 || Math.abs(expectedBuyPct - item.tmt_buy_pct) > 0.1) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}两融占比与金额不一致`);
  }
  return validateTurnoverBreakdown(item.tmt_turnover_by_industry, item.tmt_turnover_pct, `${label}.tmt_turnover_by_industry`);
}

function validateTrendRow(row) {
  if (!isRecord(row)) return contractIssue('MARGIN_PAYLOAD_INVALID', 'trend包含无效记录');
  if (
    row.definition_id !== STANDARD_TMT_DEFINITION_ID
    || row.definition_name !== STANDARD_TMT_DEFINITION_NAME
    || !strictDateKey(row.date)
    || !strictDateKey(row.classification_asof)
    || !/^[a-f0-9]{64}$/i.test(String(row.membership_hash || ''))
    || !STANDARD_TMT_MEMBERSHIP_MODES.has(row.membership_mode)
  ) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', 'trend包含非标准或元数据残缺记录');
  }
  return validateCoreMarginNumbers(row, `trend[${row.date}]`);
}

function validateStockRanking(rows, label, requireNonEmpty) {
  if (!Array.isArray(rows) || (requireNonEmpty && rows.length === 0)) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}必须是有效数组`);
  }
  const seen = new Set();
  for (const row of rows) {
    const industry = STANDARD_TMT_INDUSTRIES[row?.sw_industry_code];
    if (
      !isRecord(row)
      || !/^\d{6}$/.test(String(row.code || ''))
      || !String(row.name || '').trim()
      || !industry
      || row.sw_industry_name !== industry.name
      || seen.has(row.code)
      || !isFiniteNumber(row.yy, { min: 0 })
      || !isFiniteNumber(row.buy, { min: 0 })
      || !isNullableFiniteNumber(row.repay)
      || !isNullableFiniteNumber(row.net)
      || !isNullableFiniteNumber(row.yy_chg_1d)
    ) {
      return contractIssue('MARGIN_PAYLOAD_INVALID', `${label}包含无效或非标准TMT股票`);
    }
    seen.add(row.code);
  }
  return null;
}

function validateIndustrySummary(data) {
  const rows = data.industry_summary;
  const issue = validateExactIndustryRows(rows, 'industry_summary', (row, expected) => {
    if (
      !isFiniteNumber(row.universe_count, {
        min: expected.universeMin,
        max: expected.universeMax,
        integer: true,
      })
      || !isFiniteNumber(row.margin_count, { min: 0, max: row.universe_count, integer: true })
      || !isFiniteNumber(row.yy, { min: 0 })
      || !isFiniteNumber(row.buy, { min: 0 })
      || !isNullableFiniteNumber(row.yy_chg_1d)
      || !isFiniteNumber(row.pct, { min: 0, max: 100 })
      || !isFiniteNumber(row.tmt_share_pct, { min: 0, max: 100 })
    ) {
      return contractIssue('MARGIN_PAYLOAD_INVALID', 'industry_summary包含无效数值');
    }
    return null;
  });
  if (issue) return issue;

  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  if (sum('universe_count') !== data.tmt_universe_count || sum('margin_count') !== data.tmt_margin_count) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', 'industry_summary行业数量合计与总数不一致');
  }
  if (
    Math.abs(sum('yy') - data.tmt_yy) > 0.5
    || Math.abs(sum('buy') - data.tmt_buy) > 0.5
    || Math.abs(sum('pct') - data.pct) > 0.06
    || (data.tmt_yy > 0 && Math.abs(sum('tmt_share_pct') - 100) > 0.1)
  ) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', 'industry_summary行业金额或占比合计与总数不一致');
  }
  return null;
}

function validateStandardMarginContract(payload) {
  if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', '标准TMT缓存结构无效');
  }
  const data = payload.data;
  if (payload.definition_id === undefined && data.definition_id === undefined) {
    return contractIssue('MARGIN_DEFINITION_MISMATCH', `缓存口径不是标准申万TMT（${STANDARD_TMT_DEFINITION_ID}）`);
  }
  if (payload.definition_id === undefined || data.definition_id === undefined) {
    return contractIssue('MARGIN_METADATA_MISSING', '标准TMT根级或data缺少definition_id');
  }
  if (payload.definition_id !== data.definition_id) {
    return contractIssue('MARGIN_METADATA_CONFLICT', '标准TMT根级与data的definition_id冲突');
  }
  if (payload.definition_id !== STANDARD_TMT_DEFINITION_ID) {
    return contractIssue('MARGIN_DEFINITION_MISMATCH', `缓存口径不是标准申万TMT（${STANDARD_TMT_DEFINITION_ID}）`);
  }
  const rootAndDataFields = [
    'definition_name',
    'classification_asof',
    'membership_hash',
    'membership_mode',
    'date',
  ];
  for (const key of rootAndDataFields) {
    if (payload[key] === undefined || data[key] === undefined) {
      return contractIssue('MARGIN_METADATA_MISSING', `标准TMT根级或data缺少${key}`);
    }
    if (payload[key] !== data[key]) {
      return contractIssue('MARGIN_METADATA_CONFLICT', `标准TMT根级与data的${key}冲突`);
    }
  }
  if (payload.definition_name !== STANDARD_TMT_DEFINITION_NAME) {
    return contractIssue('MARGIN_DEFINITION_MISMATCH', '标准TMT定义名称不匹配');
  }
  if (!strictDateKey(payload.classification_asof) || !strictDateKey(payload.date)) {
    return contractIssue('MARGIN_METADATA_MISSING', '标准TMT分类日期或数据日期无效');
  }
  if (!/^[a-f0-9]{64}$/i.test(payload.membership_hash)) {
    return contractIssue('MARGIN_METADATA_MISSING', '标准TMT成分版本哈希无效');
  }
  if (!STANDARD_TMT_MEMBERSHIP_MODES.has(payload.membership_mode)) {
    return contractIssue('MARGIN_MEMBERSHIP_MODE_INVALID', '标准TMT成分模式不受支持');
  }
  const legacyKey = LEGACY_CUSTOM_MARGIN_KEYS.find((key) => Object.hasOwn(data, key));
  if (legacyKey) {
    return contractIssue('MARGIN_LEGACY_PAYLOAD_REJECTED', `标准TMT缓存仍包含旧自定义字段${legacyKey}`);
  }

  const numberIssue = validateCoreMarginNumbers(data, 'data');
  if (numberIssue) return numberIssue;
  const industryIssue = validateIndustrySummary(data);
  if (industryIssue) return industryIssue;
  const balanceIssue = validateStockRanking(data.top_balance_stocks, 'top_balance_stocks', data.tmt_margin_count > 0);
  if (balanceIssue) return balanceIssue;
  const changeIssue = validateStockRanking(data.top_change_stocks, 'top_change_stocks', false);
  if (changeIssue) return changeIssue;
  if (!Array.isArray(data.trend) || data.trend.length === 0) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', '标准TMT trend为空或无效');
  }
  for (const row of data.trend) {
    const rowIssue = validateTrendRow(row);
    if (rowIssue) return rowIssue;
  }
  if (!data.trend.some((row) => row.date === data.date)) {
    return contractIssue('MARGIN_PAYLOAD_INVALID', '标准TMT trend缺少当前数据日期');
  }
  for (const key of ['incr_pct_3d', 'incr_pct_5d', 'incr_pct_10d']) {
    if (!isNullableFiniteNumber(data[key])) {
      return contractIssue('MARGIN_PAYLOAD_INVALID', `标准TMT ${key}无效`);
    }
  }
  return null;
}

export function getMarginFreshness(payload) {
  const dataDate = strictDateKey(payload?.data?.date) || normalizeDateKey(payload?.data?.date || payload?.date);
  const definitionId = String(payload?.definition_id || '').trim() || null;
  const classificationAsof = strictDateKey(payload?.classification_asof);
  const membershipHash = String(payload?.membership_hash || '').trim() || null;
  const membershipMode = String(payload?.membership_mode || '').trim() || null;
  const definitionMatches = (
    payload?.definition_id === STANDARD_TMT_DEFINITION_ID
    && payload?.data?.definition_id === STANDARD_TMT_DEFINITION_ID
  );
  const membershipMetadataValid = Boolean(
    classificationAsof
    && /^[a-f0-9]{64}$/i.test(membershipHash || '')
    && STANDARD_TMT_MEMBERSHIP_MODES.has(membershipMode)
    && payload?.classification_asof === payload?.data?.classification_asof
    && payload?.membership_hash === payload?.data?.membership_hash
    && payload?.membership_mode === payload?.data?.membership_mode
  );
  const contract = validateStandardMarginContract(payload);
  const tradingDates = [...new Set(
    (payload?.data?.trading_congestion?.trend || [])
      .filter((item) => item?.date && ['top1_ratio', 'top3_ratio', 'top5_ratio'].some((key) => item[key] !== null && item[key] !== undefined))
      .map((item) => normalizeDateKey(item.date))
      .filter(Boolean),
  )].sort((a, b) => b.localeCompare(a));
  // 沪深个股两融明细通常比当日行情晚一个交易日发布。
  const tradingExpectedDate = tradingDates[1] || tradingDates[0] || null;
  const todayDate = normalizeDateKey(shanghaiDateKey());
  const dateToUtc = (date) => Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
  );
  // Without an independent trading calendar, fail obviously ancient data
  // closed while tolerating weekends and long public-holiday gaps.
  const obviouslyOldWithoutTradingReference = Boolean(
    dataDate
    && !tradingExpectedDate
    && todayDate
    && dateToUtc(todayDate) - dateToUtc(dataDate) > 10 * 24 * 60 * 60 * 1000
  );
  const expectedDate = tradingExpectedDate || (obviouslyOldWithoutTradingReference ? todayDate : null);
  const lagTradingDays = dataDate
    ? tradingDates.filter((date) => date > dataDate).length
    : tradingDates.length;
  const dateOutdated = Boolean(dataDate && expectedDate && dataDate < expectedDate);
  const reasonCode = contract?.code || (dateOutdated ? 'MARGIN_CACHE_OUTDATED' : null);
  const reason = contract?.reason || (dateOutdated ? '标准TMT两融数据日期滞后' : null);
  return {
    stale: Boolean(reasonCode),
    reasonCode,
    reason,
    compatible: !contract,
    contractValid: !contract,
    definitionMatches,
    membershipMetadataValid,
    definitionId,
    expectedDefinitionId: STANDARD_TMT_DEFINITION_ID,
    classificationAsof,
    membershipHash,
    membershipMode,
    dataDate,
    expectedDate,
    lagTradingDays,
    dateCheckSource: tradingExpectedDate ? 'trading_calendar' : (expectedDate ? 'calendar_age_guard' : null),
  };
}

function preserveTradingCongestion(payload, cached) {
  if (!payload?.data || payload.data.trading_congestion || !cached?.data?.trading_congestion) {
    return payload;
  }
  return {
    ...payload,
    data: {
      ...payload.data,
      trading_congestion: cached.data.trading_congestion,
    },
  };
}

function standardMarginPayloadError(freshness) {
  const error = new Error(freshness.reason || '标准TMT数据校验失败');
  error.code = freshness.reasonCode || 'STANDARD_TMT_DATA_INVALID';
  error.marginFreshness = freshness;
  return error;
}

function ensureStandardMarginPayload(payload) {
  const freshness = getMarginFreshness(payload);
  if (!freshness.compatible) throw standardMarginPayloadError(freshness);
  return freshness;
}

function buildBackfillStatus(payload) {
  const trading = payload?.data?.trading_congestion || {};
  const top100ByDate = trading.top100_by_date || {};
  const recentDates = Object.keys(top100ByDate)
    .filter((date) => Array.isArray(top100ByDate[date]) && top100ByDate[date].length > 0)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 100);

  let top100Rows = 0;
  let turnoverFilled = 0;
  let volumeRatioFilled = 0;
  recentDates.forEach((date) => {
    const rows = top100ByDate[date] || [];
    top100Rows += rows.length;
    rows.forEach((row) => {
      if (row.turnover_rate !== null && row.turnover_rate !== undefined && !Number.isNaN(Number(row.turnover_rate))) {
        turnoverFilled += 1;
      }
      if (row.volume_ratio !== null && row.volume_ratio !== undefined && !Number.isNaN(Number(row.volume_ratio))) {
        volumeRatioFilled += 1;
      }
    });
  });

  const klineCache = readJsonFile(EASTMONEY_KLINE_CACHE_FILE, { stocks: {}, failures: {}, updatedAt: null });
  const longHistory = readJsonFile(EASTMONEY_LONG_HISTORY_FILE, { rows: [], generatedAt: null, since: null });
  const spotArchive = readJsonFile(EASTMONEY_SPOT_SNAPSHOT_FILE, { snapshots: {} });
  const universe = readJsonFile(EASTMONEY_UNIVERSE_CACHE_FILE, { stocks: [] });
  const longRows = Array.isArray(longHistory.rows) ? longHistory.rows : [];
  const longDates = longRows.map((row) => String(row.date || '')).filter(Boolean).sort();
  const spotArchiveDates = Object.keys(spotArchive.snapshots || {}).filter(Boolean).sort();
  const spotArchiveRecentDays = spotArchiveDates.slice(-100).length;
  const universeCount = universe.source === 'eastmoney_clist' && Array.isArray(universe.stocks) ? universe.stocks.length : 0;
  const klineCachedStocks = Object.keys(klineCache.stocks || {}).length;
  const failureEntries = Object.entries(klineCache.failures || {})
    .map(([code, failure]) => ({
      code,
      at: Number(failure?.at || 0),
      error: failure?.error || null,
    }))
    .sort((a, b) => b.at - a.at);
  const latestFailure = failureEntries[0] || null;
  const spotSnapshot = klineCache.spotSnapshot || {};
  const klineHealth = klineCache.sourceHealth?.kline || {};
  const klineCooldownRemainingSeconds = (() => {
    if (klineHealth.ok !== false || !klineHealth.updatedAt) return 0;
    const updatedAt = new Date(klineHealth.updatedAt).getTime();
    if (Number.isNaN(updatedAt)) return 0;
    const remainingMs = EASTMONEY_KLINE_SOURCE_COOLDOWN_MINUTES * 60 * 1000 - (Date.now() - updatedAt);
    return Math.max(0, Math.ceil(remainingMs / 1000));
  })();
  const klineCooldownUntil = (() => {
    if (klineCooldownRemainingSeconds <= 0) return null;
    return new Date(Date.now() + klineCooldownRemainingSeconds * 1000).toISOString();
  })();

  return {
    top100_recent_days: recentDates.length,
    top100_rows: top100Rows,
    turnover_filled: turnoverFilled,
    volume_ratio_filled: volumeRatioFilled,
    turnover_progress: top100Rows > 0 ? Number((turnoverFilled / top100Rows * 100).toFixed(2)) : 0,
    volume_ratio_progress: top100Rows > 0 ? Number((volumeRatioFilled / top100Rows * 100).toFixed(2)) : 0,
    kline_cached_stocks: klineCachedStocks,
    kline_universe_stocks: universeCount,
    kline_coverage_progress: universeCount > 0 ? Number((klineCachedStocks / universeCount * 100).toFixed(2)) : 0,
    kline_long_history_min_stocks: EASTMONEY_LONG_HISTORY_MIN_STOCK_COUNT,
    kline_long_history_remaining_stocks: Math.max(0, EASTMONEY_LONG_HISTORY_MIN_STOCK_COUNT - klineCachedStocks),
    kline_long_history_ready_progress: Number((Math.min(klineCachedStocks, EASTMONEY_LONG_HISTORY_MIN_STOCK_COUNT) / EASTMONEY_LONG_HISTORY_MIN_STOCK_COUNT * 100).toFixed(2)),
    kline_failed_stocks: Object.keys(klineCache.failures || {}).length,
    kline_last_failed_code: latestFailure?.code || null,
    kline_last_error: latestFailure?.error || null,
    kline_last_failed_at: latestFailure?.at ? new Date(latestFailure.at * 1000).toISOString() : null,
    kline_spot_snapshot_date: spotSnapshot.date || null,
    kline_spot_snapshot_matched: spotSnapshot.matched ?? null,
    kline_spot_snapshot_updated_rows: spotSnapshot.updatedRows ?? null,
    kline_spot_snapshot_reason: spotSnapshot.reason || spotSnapshot.error || null,
    kline_health_ok: klineHealth.ok ?? null,
    kline_health_code: klineHealth.code || null,
    kline_health_error: klineHealth.error || null,
    kline_health_updated_at: klineHealth.updatedAt || null,
    kline_source_cooldown_remaining_seconds: klineCooldownRemainingSeconds,
    kline_source_cooldown_until: klineCooldownUntil,
    kline_updated_at: klineCache.updatedAt || null,
    long_history_rows: longRows.length,
    long_history_since: longHistory.since || '20120101',
    long_history_start: longDates[0] || null,
    long_history_end: longDates[longDates.length - 1] || null,
    long_history_generated_at: longHistory.generatedAt || null,
    spot_archive_days: spotArchiveDates.length,
    spot_archive_recent_days: spotArchiveRecentDays,
    spot_archive_progress: Number((Math.min(spotArchiveRecentDays, 100) / 100 * 100).toFixed(2)),
    spot_archive_start: spotArchiveDates[0] || null,
    spot_archive_end: spotArchiveDates[spotArchiveDates.length - 1] || null,
  };
}

function compactTradingCongestion(trading) {
  if (!trading) return trading;

  const top100ByDate = trading.top100_by_date || {};
  const volumeTop100ByDate = trading.volume_top100_by_date || {};
  const latestDate = trading.date || (trading.trend || []).find((item) => item?.date)?.date;
  const latestTop100 = (latestDate && Array.isArray(top100ByDate[latestDate]) && top100ByDate[latestDate].length > 0)
    ? top100ByDate[latestDate]
    : (trading.top100 || []);
  const latestVolumeTop100 = (latestDate && Array.isArray(volumeTop100ByDate[latestDate]) && volumeTop100ByDate[latestDate].length > 0)
    ? volumeTop100ByDate[latestDate]
    : (trading.volume_top100 || []);

  return {
    ...trading,
    trend: (trading.trend || []).map(({ top100, volume_top100, ...item }) => item),
    top100: latestTop100,
    top100_by_date: top100ByDate,
    volume_top100: latestVolumeTop100,
    volume_top100_by_date: volumeTop100ByDate,
    top100_cache_mode: 'full',
  };
}

function compactPayload(payload) {
  if (!payload?.data?.trading_congestion) return payload;
  return {
    ...payload,
    data: {
      ...payload.data,
      trading_congestion: compactTradingCongestion(payload.data.trading_congestion),
    },
  };
}

function runTmtScript(includeHistory = false, historyDays = null) {
  const args = ['--api'];
  if (includeHistory) {
    args.push('--history');
    if (Number.isInteger(historyDays) && historyDays > 0) {
      args.push('--history-days', String(historyDays));
    }
  }
  const inFlight = includeHistory ? tmtInFlightHistory : tmtInFlightQuick;
  if (inFlight) return inFlight;
  const setInFlight = (promise) => {
    if (includeHistory) {
      tmtInFlightHistory = promise;
    } else {
      tmtInFlightQuick = promise;
    }
  };

  const promise = new Promise((resolve, reject) => {
    const timeoutMs = includeHistory ? TMT_SCRIPT_HISTORY_TIMEOUT_MS : TMT_SCRIPT_TIMEOUT_MS;
    const proc = spawn('python3', [TMT_SCRIPT, ...args]);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`TMT margin script timeout (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `exit code ${code}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout.trim());
        if (!payload.success) {
          reject(new Error(payload.error || 'TMT margin script failed'));
          return;
        }
        // The margin script owns the standard-TMT payload. The independent
        // trading-congestion archive is kept when the script does not emit it.
        const candidate = preserveTradingCongestion(payload, readCache());
        ensureStandardMarginPayload(candidate);
        resolve(writeCache(candidate));
      } catch (err) {
        reject(err);
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  }).finally(() => {
    if (includeHistory) {
      tmtInFlightHistory = null;
    } else {
      tmtInFlightQuick = null;
    }
  });

  setInFlight(promise);
  return promise;
}

function runEastmoneyBackfill({ recentDays = 100, maxCodes = 1 } = {}) {
  if (eastmoneyBackfillInFlight) return eastmoneyBackfillInFlight;
  const safeRecentDays = Number.isInteger(recentDays) && recentDays > 0 ? Math.min(recentDays, 100) : 100;
  const safeMaxCodes = Number.isInteger(maxCodes) && maxCodes > 0 ? Math.min(maxCodes, 3) : 1;
  const args = [
    EASTMONEY_BACKFILL_SCRIPT,
    'top100-fields',
    '--recent-days',
    String(safeRecentDays),
    '--max-codes',
    String(safeMaxCodes),
    '--delay',
    '5',
    '--retries',
    '0',
    '--stop-after-failures',
    '2',
    '--fail-cooldown-minutes',
    '120',
    '--host-limit',
    '2',
    '--request-timeout',
    '3',
    '--source-cooldown-minutes',
    '30',
  ];

  const promise = new Promise((resolve, reject) => {
    const proc = spawn('python3', args, { cwd: path.join(__dirname, '../..') });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Eastmoney backfill timeout'));
    }, 120000);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  }).finally(() => {
    eastmoneyBackfillInFlight = null;
  });

  eastmoneyBackfillInFlight = promise;
  return promise;
}

function runEastmoneyKlineCrawl({ maxCodes = 3 } = {}) {
  if (eastmoneyKlineCrawlInFlight) return eastmoneyKlineCrawlInFlight;
  const safeMaxCodes = Number.isInteger(maxCodes) && maxCodes > 0 ? Math.min(maxCodes, 5) : 3;
  const args = [
    EASTMONEY_BACKFILL_SCRIPT,
    'crawl-history',
    '--since',
    '20120101',
    '--end',
    shanghaiDateKey().replaceAll('-', ''),
    '--max-codes',
    String(safeMaxCodes),
    '--delay',
    '8',
    '--retries',
    '0',
    '--stop-after-failures',
    '2',
    '--fail-cooldown-minutes',
    '120',
    '--host-limit',
    '2',
    '--request-timeout',
    '3',
    '--source-cooldown-minutes',
    '30',
    '--min-stock-count',
    '4500',
  ];

  const promise = new Promise((resolve, reject) => {
    const proc = spawn('python3', args, { cwd: path.join(__dirname, '../..') });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Eastmoney kline crawl timeout'));
    }, 120000);

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  }).finally(() => {
    eastmoneyKlineCrawlInFlight = null;
  });

  eastmoneyKlineCrawlInFlight = promise;
  return promise;
}

function isTransientSpotFailure(value) {
  if (value?.signal === 'SIGKILL' || value?.signal === 'SIGTERM') return true;
  const message = String(value?.message || value?.stderr || value?.stdout || value || '');
  return /timed?\s*out|timeout|temporary failure|name resolution|eai_again|enotfound|econnreset|connection reset|remote end closed|empty (reply|diff)|http (429|5\d\d)|network is unreachable|connection refused/i.test(message);
}

function runSpotSnapshotAttempt({ spawnProcess, command, args, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let proc;
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };

    try {
      proc = spawnProcess(command, args, { cwd });
    } catch (cause) {
      const error = new Error(`Eastmoney spot snapshot process failed to start: ${cause.message}`);
      error.code = 'UPSTREAM_PROCESS_ERROR';
      error.retryable = true;
      reject(error);
      return;
    }

    const timer = setTimeout(() => {
      const error = new Error(`Eastmoney spot snapshot timed out after ${timeoutMs}ms`);
      error.code = 'UPSTREAM_TIMEOUT';
      error.retryable = true;
      try {
        proc.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* process already exited */ }
        }, 1000);
        killTimer.unref?.();
      } catch {
        // The timeout response still wins even if the child already exited.
      }
      finish(reject, error);
    }, timeoutMs);
    timer.unref?.();

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });
    proc.on('close', (code, signal) => {
      const result = {
        success: code === 0,
        exitCode: code,
        signal: signal || null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
      finish(resolve, result);
    });
    proc.on('error', (cause) => {
      const error = new Error(`Eastmoney spot snapshot process error: ${cause.message}`);
      error.code = 'UPSTREAM_PROCESS_ERROR';
      error.retryable = true;
      finish(reject, error);
    });
  });
}

export function createEastmoneySpotSnapshotRunner({
  spawnProcess = spawn,
  scriptPath = EASTMONEY_BACKFILL_SCRIPT,
  cwd = path.join(__dirname, '../..'),
  attemptTimeoutMs = EASTMONEY_SPOT_ATTEMPT_TIMEOUT_MS,
  primaryTimeoutMs = EASTMONEY_SPOT_PRIMARY_TIMEOUT_MS,
  totalTimeoutMs = EASTMONEY_SPOT_TOTAL_TIMEOUT_MS,
  maxAttempts = EASTMONEY_SPOT_MAX_ATTEMPTS,
  retryDelayMs = EASTMONEY_SPOT_RETRY_DELAY_MS,
} = {}) {
  let inFlight = null;
  const safeMaxAttempts = Math.max(1, Math.min(Number(maxAttempts) || 1, 2));
  const safeAttemptTimeoutMs = Math.max(1, Number(attemptTimeoutMs) || EASTMONEY_SPOT_ATTEMPT_TIMEOUT_MS);
  const safePrimaryTimeoutMs = Math.max(1, Math.min(safeAttemptTimeoutMs, Number(primaryTimeoutMs) || safeAttemptTimeoutMs));
  const safeTotalTimeoutMs = Math.max(1, Number(totalTimeoutMs) || EASTMONEY_SPOT_TOTAL_TIMEOUT_MS);
  const safeRetryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
  const execute = async () => {
    const deadline = Date.now() + safeTotalTimeoutMs;
    let lastFailure = null;

    for (let attempt = 1; attempt <= safeMaxAttempts; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        const error = new Error(`Eastmoney spot snapshot exceeded total timeout (${safeTotalTimeoutMs}ms)`);
        error.code = 'UPSTREAM_TIMEOUT';
        error.retryable = true;
        error.attempts = attempt - 1;
        throw error;
      }

      try {
        const provider = attempt === 1 ? 'eastmoney' : 'sina';
        const args = [
          scriptPath,
          'spot-snapshot',
          '--page-size',
          '100',
          '--request-timeout',
          provider === 'eastmoney' ? '3' : '8',
          '--workers',
          provider === 'eastmoney' ? '8' : '4',
          '--host-limit',
          '1',
          '--provider',
          provider,
        ];
        const result = await runSpotSnapshotAttempt({
          spawnProcess,
          command: 'python3',
          args,
          cwd,
          timeoutMs: Math.min(attempt === 1 ? safePrimaryTimeoutMs : safeAttemptTimeoutMs, remainingMs),
        });
        if (result.success) return { ...result, attempts: attempt };

        const message = result.stderr || result.stdout || `exit code ${result.exitCode}`;
        const retryable = isTransientSpotFailure(result);
        lastFailure = {
          ...result,
          attempts: attempt,
          retryable,
          errorCode: retryable ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_FAILED',
          error: message,
        };
        if (!retryable || attempt >= safeMaxAttempts) return lastFailure;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        error.retryable = error.retryable ?? isTransientSpotFailure(error);
        error.attempts = attempt;
        lastFailure = error;
        if (!error.retryable || attempt >= safeMaxAttempts) throw error;
      }

      const delayMs = Math.min(safeRetryDelayMs, Math.max(0, deadline - Date.now()));
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return lastFailure;
  };

  return () => {
    if (inFlight) return inFlight;
    const promise = execute().finally(() => {
      if (inFlight === promise) inFlight = null;
    });
    inFlight = promise;
    return promise;
  };
}

const runEastmoneySpotSnapshot = createEastmoneySpotSnapshotRunner();

function staleDataDate(cached) {
  return cached?.data?.trading_congestion?.date || null;
}

function spotRefreshFailurePayload(cached, failure, buildStatus) {
  const code = failure?.errorCode || failure?.code || 'UPSTREAM_FAILED';
  const detail = failure?.error || failure?.message || failure?.stderr || failure?.stdout || '';
  const message = (() => {
    if (code === 'UPSTREAM_TIMEOUT') return '行情数据源响应超时，请稍后重试';
    if (code === 'UPSTREAM_UNAVAILABLE') return '行情数据源暂时不可用，请稍后重试';
    if (code === 'UPSTREAM_PROCESS_ERROR') return '拥挤度刷新任务启动失败';
    return detail || '东财实时快照刷新失败';
  })();
  const attempts = Number(failure?.attempts || 1);
  return {
    success: false,
    error: message,
    errorCode: code,
    refreshError: message,
    refresh: {
      status: 'failed',
      code,
      message,
      detail,
      attempts,
      retryable: Boolean(failure?.retryable),
    },
    spot: failure && !(failure instanceof Error) ? failure : null,
    data: cached?.data || null,
    generatedAt: cached?.generatedAt || null,
    cached: Boolean(cached),
    stale: Boolean(cached),
    staleDataDate: staleDataDate(cached),
    status: cached ? buildStatus(cached) : null,
  };
}

export function createSpotRefreshHandler({
  runSpotSnapshot = runEastmoneySpotSnapshot,
  readCached = readCache,
  buildStatus = buildBackfillStatus,
} = {}) {
  return async (_req, res) => {
    try {
      const result = await runSpotSnapshot();
      const cached = readCached();
      if (!result.success) {
        res.status(502).json(spotRefreshFailurePayload(cached, result, buildStatus));
        return;
      }
      res.json({
        success: true,
        spot: result,
        data: cached?.data || null,
        generatedAt: cached?.generatedAt || null,
        cached: false,
        stale: false,
        staleDataDate: null,
        refresh: {
          status: 'success',
          attempts: result.attempts || 1,
        },
        status: cached ? buildStatus(cached) : null,
      });
    } catch (failure) {
      const cached = readCached();
      const statusCode = failure?.code === 'UPSTREAM_TIMEOUT' ? 504 : 502;
      res.status(statusCode).json(spotRefreshFailurePayload(cached, failure, buildStatus));
    }
  };
}

function publicSpotRefreshFailure(failure) {
  const payload = spotRefreshFailurePayload(null, failure, () => null);
  return {
    status: 'failed',
    code: payload.refresh.code,
    message: payload.refresh.message,
    detail: payload.refresh.detail,
    attempts: payload.refresh.attempts,
    retryable: payload.refresh.retryable,
  };
}

export function createSpotRefreshController({
  runSpotSnapshot = runEastmoneySpotSnapshot,
  readCached = readCache,
  needsRefresh = needsDailySpotRefresh,
  now = () => new Date(),
} = {}) {
  let inFlight = null;
  let state = {
    status: 'idle',
    startedAt: null,
    completedAt: null,
    attempts: 0,
  };

  const launch = () => {
    if (inFlight) return inFlight;
    state = {
      status: 'running',
      startedAt: now().toISOString(),
      completedAt: null,
      attempts: 0,
    };
    const promise = runSpotSnapshot()
      .then((result) => {
        if (!result?.success) {
          throw result || new Error('东财实时快照刷新失败');
        }
        state = {
          status: 'success',
          startedAt: state.startedAt,
          completedAt: now().toISOString(),
          attempts: result.attempts || 1,
          provider: result.stdout?.includes('sina_fallback') ? 'sina_fallback' : 'eastmoney',
        };
        return result;
      })
      .catch((failure) => {
        state = {
          ...publicSpotRefreshFailure(failure),
          startedAt: state.startedAt,
          completedAt: now().toISOString(),
        };
        return null;
      })
      .finally(() => {
        if (inFlight === promise) inFlight = null;
      });
    inFlight = promise;
    return promise;
  };

  const responsePayload = ({ includeData = false } = {}) => {
    const cached = readCached();
    const running = state.status === 'running';
    const failed = state.status === 'failed';
    return {
      success: !failed,
      accepted: running,
      cached: Boolean(cached),
      stale: running || failed || needsRefresh(),
      staleDataDate: staleDataDate(cached),
      generatedAt: cached?.generatedAt || null,
      refreshError: failed ? state.message : null,
      refresh: state,
      data: includeData ? safeSpotStatusData(cached) : null,
    };
  };

  return {
    postHandler(_req, res) {
      if (!inFlight && !needsRefresh()) {
        state = {
          status: 'success',
          startedAt: null,
          completedAt: now().toISOString(),
          attempts: 0,
          alreadyFresh: true,
        };
        res.json(responsePayload({ includeData: false }));
        return;
      }
      launch();
      res.status(202).json(responsePayload({ includeData: false }));
    },
    statusHandler(_req, res) {
      res.json(responsePayload({ includeData: state.status === 'success' && !state.alreadyFresh }));
    },
    getState: () => ({ ...state }),
    waitForIdle: () => inFlight || Promise.resolve(),
  };
}

const spotRefreshController = createSpotRefreshController();

function marginFreshnessFields(freshness) {
  return {
    needsMarginRefresh: freshness.stale,
    marginDataDate: freshness.dataDate,
    expectedMarginDataDate: freshness.expectedDate,
    marginLagTradingDays: freshness.lagTradingDays,
    marginDefinitionId: freshness.definitionId,
    expectedMarginDefinitionId: freshness.expectedDefinitionId,
    classificationAsof: freshness.classificationAsof,
    membershipHash: freshness.membershipHash,
    membershipMode: freshness.membershipMode,
    marginFreshnessReason: freshness.reason,
  };
}

function tradingOnlyData(cached) {
  const trading = cached?.data?.trading_congestion;
  return trading ? { trading_congestion: compactTradingCongestion(trading) } : null;
}

function safeSpotStatusData(cached) {
  if (!cached) return null;
  return getMarginFreshness(cached).compatible ? cached.data : tradingOnlyData(cached);
}

export function createTmtMarginHandler({
  readCached = readCache,
  runScript = runTmtScript,
  needsSpotRefresh = needsDailySpotRefresh,
  hasFullHistory = hasFullYearTradingHistory,
} = {}) {
  return async (req, res) => {
    const query = req.query || {};
    const forceRefresh = query.refresh === '1' || query.refresh === 'true';
    const historyRefresh = query.history === '1' || query.history === 'true';
    const historyDays = (() => {
      const parsed = Number(query.historyDays);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
      return null;
    })();
    const cached = readCached();
    const cachedFreshness = cached ? getMarginFreshness(cached) : null;
    // An incompatible or date-stale cache is never treated as current margin
    // data. A normal GET proactively rebuilds it before responding.
    const marginRefreshRequired = Boolean(cached && cachedFreshness.stale);
    const shouldRefresh = forceRefresh || historyRefresh || marginRefreshRequired || !cached;
    const hasFullHistoryCache = Boolean(cached && hasFullHistory(cached));

    if (!shouldRefresh && cached) {
      const spotStale = needsSpotRefresh();
      res.json({
        ...compactPayload(cached),
        cached: true,
        stale: spotStale || cachedFreshness.stale,
        staleDataDate: cachedFreshness.stale
          ? cachedFreshness.dataDate
          : (spotStale ? staleDataDate(cached) : null),
        staleReason: cachedFreshness.reasonCode
          || (spotStale ? 'SPOT_CACHE_OUTDATED' : null),
        needsHistoryBackfill: !hasFullHistoryCache,
        needsSpotRefresh: spotStale,
        ...marginFreshnessFields(cachedFreshness),
      });
      return;
    }

    try {
      const refreshed = await runScript(historyRefresh, historyDays);
      const data = preserveTradingCongestion(refreshed, cached);
      const marginFreshness = ensureStandardMarginPayload(data);
      const spotStale = needsSpotRefresh();
      res.json({
        ...compactPayload(data),
        cached: false,
        stale: spotStale || marginFreshness.stale,
        staleDataDate: marginFreshness.stale
          ? marginFreshness.dataDate
          : (spotStale ? staleDataDate(data) : null),
        staleReason: marginFreshness.reasonCode
          || (spotStale ? 'SPOT_CACHE_OUTDATED' : null),
        needsHistoryBackfill: !hasFullHistory(data),
        needsSpotRefresh: spotStale,
        ...marginFreshnessFields(marginFreshness),
      });
    } catch (err) {
      console.error('TMT margin API error:', err);
      // A last-good fallback is safe only when it is already a fully identified
      // standard-TMT cache. An old custom-pool cache must not leak into the UI.
      if (cached && cachedFreshness.compatible) {
        const spotStale = needsSpotRefresh();
        res.json({
          ...compactPayload(cached),
          cached: true,
          stale: true,
          staleDataDate: cachedFreshness.dataDate,
          staleReason: cachedFreshness.reasonCode || 'REFRESH_FAILED',
          needsHistoryBackfill: !hasFullHistoryCache,
          needsSpotRefresh: spotStale,
          refreshError: err.message,
          refreshErrorCode: err.code || 'REFRESH_FAILED',
          ...marginFreshnessFields(cachedFreshness),
        });
        return;
      }

      const cacheIssueCode = cachedFreshness?.reasonCode || null;
      const cacheIssue = cachedFreshness?.reason || null;
      const message = cached
        ? '标准TMT数据暂不可用；旧缓存口径不兼容，已停止返回旧两融数值'
        : '标准TMT数据暂不可用，刷新失败';
      res.status(503).json({
        success: false,
        error: message,
        errorCode: 'STANDARD_TMT_DATA_UNAVAILABLE',
        cached: Boolean(cached),
        stale: true,
        staleDataDate: cachedFreshness?.dataDate || null,
        staleReason: cacheIssueCode || err.code || 'REFRESH_FAILED',
        cacheIssue,
        cacheIssueCode,
        needsHistoryBackfill: !hasFullHistoryCache,
        needsSpotRefresh: needsSpotRefresh(),
        needsMarginRefresh: true,
        marginDataAvailable: false,
        refreshError: err.message,
        refreshErrorCode: err.code || 'REFRESH_FAILED',
        generatedAt: cached?.generatedAt || null,
        data: tradingOnlyData(cached),
        ...(cachedFreshness ? marginFreshnessFields(cachedFreshness) : {}),
      });
    }
  };
}

// GET /api/tmt-margin/trading-top100?date=YYYYMMDD
// 按需返回单日成交额Top100，避免主面板一次性加载全年明细
router.get('/trading-top100', (req, res) => {
  const cached = readCache();
  const trading = cached?.data?.trading_congestion;
  if (!trading) {
    res.status(404).json({ success: false, error: '暂无交易拥挤度缓存' });
    return;
  }

  const date = String(req.query.date || trading.date || '');
  const kind = req.query.kind === 'volume' ? 'volume' : 'amount';
  const byDate = kind === 'volume'
    ? (trading.volume_top100_by_date || {})
    : (trading.top100_by_date || {});
  const fallback = kind === 'volume' ? (trading.volume_top100 || []) : (trading.top100 || []);
  const items = date
    ? (Array.isArray(byDate[date]) ? byDate[date] : [])
    : fallback;
  const row = (trading.trend || []).find((item) => String(item.date) === date) || null;

  res.json({
    success: true,
    date,
    kind,
    items,
    row,
    source: trading.source,
  });
});

// GET /api/tmt-margin/backfill-status
// 返回东财渐进回溯状态，便于前端展示慢任务进度
router.get('/backfill-status', (req, res) => {
  const cached = readCache();
  if (!cached) {
    res.status(404).json({ success: false, error: '暂无交易拥挤度缓存' });
    return;
  }
  res.json({
    success: true,
    status: buildBackfillStatus(cached),
  });
});

// POST /api/tmt-margin/backfill-run
// 安全触发一次东财小批量回溯：限量、失败冷却、不中断主页面
router.post('/backfill-run', async (req, res) => {
  const maxCodes = Number(req.query.maxCodes || req.body?.maxCodes || 1);
  const recentDays = Number(req.query.recentDays || req.body?.recentDays || 100);
  try {
    const result = await runEastmoneyBackfill({
      maxCodes: Number.isInteger(maxCodes) ? maxCodes : 1,
      recentDays: Number.isInteger(recentDays) ? recentDays : 100,
    });
    const cached = readCache();
    res.json({
      success: true,
      backfill: result,
      status: cached ? buildBackfillStatus(cached) : null,
      inFlight: false,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tmt-margin/kline-crawl-run
// 小批量渐进抓取东财历史K线，用于2012年至今长历史缓存
router.post('/kline-crawl-run', async (req, res) => {
  const maxCodes = Number(req.query.maxCodes || req.body?.maxCodes || 3);
  try {
    const result = await runEastmoneyKlineCrawl({
      maxCodes: Number.isInteger(maxCodes) ? maxCodes : 3,
    });
    const cached = readCache();
    res.json({
      success: true,
      crawl: result,
      status: cached ? buildBackfillStatus(cached) : null,
      inFlight: false,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tmt-margin/spot-refresh
// 只刷新东财实时横截面快照，不触发慢速历史K线回溯
router.post('/spot-refresh', spotRefreshController.postHandler);
router.get('/spot-refresh-status', spotRefreshController.statusHandler);

// GET /api/tmt-margin
// 返回申万2021一级行业口径的标准TMT两融集中度数据
router.get('/', createTmtMarginHandler());

export default router;
