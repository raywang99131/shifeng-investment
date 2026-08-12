import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DATA_PATH = path.resolve('server/data/funds.json');
const TARGETS = new Map([
  ['2026-07-24', '2026-07-23'],
  ['2026-07-30', '2026-07-29'],
]);

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const stockCode = (position) => {
  const raw = String(position.symbol ?? position.code ?? position.ticker ?? '').trim();
  const match = raw.match(/\d{6}/);
  return match?.[0] ?? '';
};

const eastmoneySecid = (position, code) => {
  const raw = String(position.symbol ?? position.code ?? '').toUpperCase();
  if (/\.(SH|SS)$/.test(raw)) return `1.${code}`;
  if (/\.(SZ|BJ)$/.test(raw)) return `0.${code}`;
  return /^[569]/.test(code) ? `1.${code}` : `0.${code}`;
};

const fetchDailyCloses = async (position) => {
  const code = stockCode(position);
  if (!code) throw new Error(`Invalid A-share symbol: ${position.symbol ?? position.code ?? ''}`);

  const parseEastmoneyRows = (rows) => Object.fromEntries(rows.map((row) => {
    const [date, , close] = String(row).split(',');
    return [date, Number(close)];
  }).filter(([, close]) => Number.isFinite(close) && close > 0));

  const params = new URLSearchParams({
    secid: eastmoneySecid(position, code),
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101',
    fqt: '0',
    beg: '20260720',
    end: '20260731',
    ut: '7eea3edcaed734bea9cbfc24409ed989',
  });
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`;

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = payload?.data?.klines;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('No kline data');

      return parseEastmoneyRows(rows);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  const secid = eastmoneySecid(position, code);
  const tencentSymbol = `${secid.startsWith('1.') ? 'sh' : 'sz'}${code}`;
  const tencentParams = `${tencentSymbol},day,2026-07-20,2026-07-31,20,qfq`;
  const tencentUrl = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(tencentParams)}`;

  try {
    const response = await fetch(tencentUrl, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://gu.qq.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const quote = payload?.data?.[tencentSymbol];
    const rows = quote?.qfqday ?? quote?.day;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('No kline data');

    return Object.fromEntries(rows.map((row) => [String(row[0]), Number(row[2])])
      .filter(([, close]) => Number.isFinite(close) && close > 0));
  } catch (tencentError) {
    throw new Error(`${code}: Eastmoney ${lastError?.message ?? 'unknown error'}; Tencent ${tencentError.message}`);
  }
};

const raw = await fs.readFile(DATA_PATH, 'utf8');
const document = JSON.parse(raw);
const funds = Array.isArray(document) ? document : document.funds;
if (!Array.isArray(funds)) throw new Error('Unexpected funds.json structure');

const affectedFunds = funds.filter((fund) => fund.market === 'a' &&
  Array.isArray(fund.navHistory) && fund.navHistory.some((entry) =>
    TARGETS.has(entry.date) && Number(entry.nav) === 0));

const representativePositions = new Map();
for (const fund of affectedFunds) {
  for (const position of fund.positions ?? []) {
    const code = stockCode(position);
    if (code && !representativePositions.has(code)) representativePositions.set(code, position);
  }
}

const priceByCode = new Map();
const priceFailures = new Map();
const queue = [...representativePositions.entries()];
const workerCount = Math.min(8, Math.max(1, queue.length));
await Promise.all(Array.from({ length: workerCount }, async () => {
  while (queue.length > 0) {
    const [code, position] = queue.shift();
    try {
      priceByCode.set(code, await fetchDailyCloses(position));
    } catch (error) {
      priceFailures.set(code, error.message);
    }
  }
}));

const repaired = [];
const unrepaired = [];
let fallbackPositions = 0;

for (const fund of affectedFunds) {
  const history = [...fund.navHistory].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const [targetDate, previousTradingDate] of TARGETS) {
    const entry = history.find((item) => item.date === targetDate && Number(item.nav) === 0);
    if (!entry) continue;

    const previousEntry = [...history].reverse().find((item) =>
      item.date < targetDate && Number.isFinite(Number(item.nav)) && Number(item.nav) > 0);
    if (!previousEntry) {
      unrepaired.push(`${fund.name} ${targetDate}: no previous valid NAV`);
      continue;
    }

    let previousValue = 0;
    let targetValue = 0;
    let directPriceCount = 0;
    let usablePositionCount = 0;

    for (const position of fund.positions ?? []) {
      const shares = Number(position.shares);
      if (!Number.isFinite(shares) || shares <= 0) continue;
      const code = stockCode(position);
      const closes = priceByCode.get(code);
      const previousClose = Number(closes?.[previousTradingDate]);
      const targetClose = Number(closes?.[targetDate]);

      if (previousClose > 0 && targetClose > 0) {
        previousValue += shares * previousClose;
        targetValue += shares * targetClose;
        directPriceCount += 1;
        usablePositionCount += 1;
        continue;
      }

      const fallbackPrice = Number(position.currentPrice) > 0
        ? Number(position.currentPrice)
        : Number(position.prevClose) > 0
          ? Number(position.prevClose)
          : Number(position.costPrice);
      if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
        previousValue += shares * fallbackPrice;
        targetValue += shares * fallbackPrice;
        fallbackPositions += 1;
        usablePositionCount += 1;
      }
    }

    if (!(previousValue > 0 && targetValue > 0 && directPriceCount > 0)) {
      unrepaired.push(`${fund.name} ${targetDate}: insufficient historical prices`);
      continue;
    }

    const ratio = targetValue / previousValue;
    const previousNav = Number(previousEntry.nav);
    const previousCumulativeNav = Number(previousEntry.cumulativeNav) > 0
      ? Number(previousEntry.cumulativeNav)
      : previousNav;
    const previousMarketValue = Number(previousEntry.marketValue) > 0
      ? Number(previousEntry.marketValue)
      : Number(fund.initialCapital) > 0
        ? Number(fund.initialCapital) * previousNav
        : previousValue;

    entry.nav = round(previousNav * ratio, 6);
    entry.cumulativeNav = round(previousCumulativeNav * ratio, 6);
    entry.marketValue = round(previousMarketValue * ratio, 2);
    repaired.push({
      fund: fund.name,
      date: targetDate,
      nav: entry.nav,
      ratio: round(ratio, 8),
      directPrices: directPriceCount,
      positions: usablePositionCount,
    });
  }
}

if (unrepaired.length > 0) {
  throw new Error(`Repair aborted; no data was written:\n${unrepaired.join('\n')}`);
}

const backupDir = path.join(os.homedir(), '.codex', 'backups', 'shifeng-investment');
await fs.mkdir(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `funds-before-nav-repair-${stamp}.json`);
await fs.writeFile(backupPath, raw, 'utf8');

const output = `${JSON.stringify(document, null, 2)}\n`;
const temporaryPath = `${DATA_PATH}.${process.pid}.tmp`;
await fs.writeFile(temporaryPath, output, 'utf8');
await fs.rename(temporaryPath, DATA_PATH);

process.stdout.write(`${JSON.stringify({
  affectedFunds: affectedFunds.length,
  repairedRecords: repaired.length,
  uniqueSymbols: representativePositions.size,
  priceFailures: Object.fromEntries(priceFailures),
  fallbackPositions,
  backupPath,
}, null, 2)}\n`);
