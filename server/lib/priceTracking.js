import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ROOT = path.resolve(__dirname, '..');
const CACHE_FILE = path.join(SERVER_ROOT, 'data', 'price-tracking', 'cache.json');
const COLLECTOR_STATUS_FILE = path.join(SERVER_ROOT, 'data', 'price-tracking', 'refresh-status.json');
const REFRESH_SCRIPT = path.join(SERVER_ROOT, 'scripts', 'refresh_price_tracking.py');
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const TUNGSTEN_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const TUNGSTEN_FIRST_REFRESH_MINUTE = 10 * 60 + 45;
const TUNGSTEN_PRODUCT_IDS = new Set(['wolframite-65', 'waste-tungsten-bar', 'tungsten-powder']);

let refreshPromise = null;
let timer = null;
let tungstenTimer = null;
let refreshStatus = {
  updating: false,
  startedAt: null,
  completedAt: null,
  error: null,
};

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return { generatedAt: null, products: [] };
  }
}

function readCollectorStatus() {
  try {
    return JSON.parse(fs.readFileSync(COLLECTOR_STATUS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s（）()≥≧%._:/\\-]+/g, '');
}

function isSameProduct(item, product) {
  const haystack = normalizeText(`${item.priceProduct || ''} ${item.title || ''}`);
  return (product.aliases || [product.product]).some((alias) => {
    const needle = normalizeText(alias);
    return needle && haystack.includes(needle);
  });
}

function getShanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getShanghaiMinuteOfDay() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute) + Number(values.second) / 60;
}

function tungstenPricesAreCurrent() {
  const today = getShanghaiDate();
  const products = readCache().products || [];
  return [...TUNGSTEN_PRODUCT_IDS].every((productId) => (
    products.find((product) => product.id === productId)?.latestDate === today
  ));
}

function millisecondsUntilTungstenStart({ tomorrow = false } = {}) {
  const currentMinute = getShanghaiMinuteOfDay();
  let minuteDifference = TUNGSTEN_FIRST_REFRESH_MINUTE - currentMinute;
  if (tomorrow || minuteDifference <= 0) minuteDifference += 24 * 60;
  return Math.max(1000, Math.round(minuteDifference * 60 * 1000));
}

function tungstenRefreshMayStart() {
  return getShanghaiMinuteOfDay() >= TUNGSTEN_FIRST_REFRESH_MINUTE;
}

function getTungstenRefreshState(product, collectorStatus) {
  if (!TUNGSTEN_PRODUCT_IDS.has(product.id)) return {};
  const pending = Boolean(product.latestDate && product.latestDate < getShanghaiDate());
  const result = [...(collectorStatus?.results || [])].reverse().find((item) => item.label === '钨');
  const rawMessage = String(result?.message || '');
  const failed = pending && result?.success === false;
  const loginRequired = failed && /invalid session|登录|login/i.test(rawMessage);
  const message = loginRequired
    ? '中钨在线公众号登录已失效，当前显示上一有效价格，请重新登录后刷新。'
    : failed
      ? '中钨在线今日价格抓取失败，当前显示上一有效价格，后台会继续重试。'
      : pending
        ? '中钨在线每天10:45首次检查；当日价格尚未发布时，每30分钟重试。'
        : '';
  return {
    priceRefreshPending: pending,
    priceRefreshFailed: failed,
    priceLoginRequired: loginRequired,
    priceRefreshMessage: message,
  };
}

function toNewsItem(product, collectorStatus = null) {
  const latest = product.latestPrice;
  const move = Number(product.movePercent || 0);
  const direction = move > 0 ? '上涨' : move < 0 ? '下跌' : '持平';
  const date = product.latestDate || product.generatedAt || new Date().toISOString();
  const priceText = latest === null || latest === undefined
    ? '暂无有效价格'
    : `${Number(latest).toLocaleString('en-US', { maximumFractionDigits: 4 })}${product.unit ? ` ${product.unit}` : ''}`;
  const staleText = product.stale ? '；数据日期较旧' : '';

  return {
    title: `${product.product}最新价格${direction}`,
    url: product.sourceUrl || '#',
    source: product.sourceName || 'price_total历史数据',
    sourceId: `price-total-watch:${product.id}`,
    collectionChannel: 'price-watch',
    snippet: `${product.latestDate || '日期未知'}：${priceText}，涨跌幅${move >= 0 ? '+' : ''}${move.toFixed(2)}%${staleText}`,
    summary: `${product.product}最新价${priceText}，较上一期${direction}${Math.abs(move).toFixed(2)}%。`,
    time: date,
    publishedAt: date,
    score: 100,
    signalType: move > 0 ? '利好涨价' : move < 0 ? '利空降价' : '普通新闻',
    priceProduct: product.product,
    priceLatestValue: latest === null || latest === undefined ? '--' : String(latest),
    priceMoveValue: String(move),
    priceDisplayUnit: product.unit || '',
    priceChartUrl: `/api/news/price-chart?kind=price-total&product=${encodeURIComponent(product.id)}`,
    priceSourceUpdatedAt: product.latestDate || '',
    priceGroup: product.group || '其他',
    priceStale: Boolean(product.stale),
    ...getTungstenRefreshState(product, collectorStatus),
  };
}

function getNewsCompatibleItems() {
  const cache = readCache();
  const collectorStatus = readCollectorStatus();
  return (cache.products || []).map((product) => toNewsItem(product, collectorStatus));
}

function mergeWithNews(newsItems) {
  const cache = readCache();
  const collectorStatus = readCollectorStatus();
  const products = cache.products || [];
  const retainedNews = (newsItems || []).filter((item) => {
    const isLegacyPrice = item.collectionChannel === 'price-watch' || item.sourceId === 'tungsten-price-watch';
    if (!isLegacyPrice) return true;
    return !products.some((product) => isSameProduct(item, product));
  });
  return [...products.map((product) => toNewsItem(product, collectorStatus)), ...retainedNews];
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderChart(productId) {
  const product = (readCache().products || []).find((item) => item.id === productId);
  if (!product) return null;
  const validHistory = (product.history || []).filter((point) => Number.isFinite(Number(point.value)));
  const latestYear = validHistory.length
    ? String(validHistory[validHistory.length - 1].date).slice(0, 4)
    : '';
  const ytdHistory = latestYear
    ? validHistory.filter((point) => String(point.date).startsWith(latestYear))
    : [];
  // Show no more than the current calendar year. Sparse series retain their
  // available observations instead of being hidden by a fixed 60-row cut.
  const history = ytdHistory.length >= 2 ? ytdHistory : validHistory.slice(-31);
  const width = 600;
  const height = 280;
  const left = 58;
  const right = 22;
  const top = 46;
  const bottom = 46;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const title = escapeXml(`${product.product} 年初至今价格走势`);

  if (history.length < 2) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/><text x="24" y="34" font-size="18" font-weight="700" fill="#111827">${title}</text><text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="14" fill="#6b7280">历史数据不足</text></svg>`;
  }

  const values = history.map((point) => Number(point.value));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMax === rawMin ? Math.max(Math.abs(rawMax) * 0.02, 1) : (rawMax - rawMin) * 0.12;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index) => left + (index / (history.length - 1)) * chartWidth;
  const y = (value) => top + ((max - value) / (max - min)) * chartHeight;
  const points = history.map((point, index) => `${x(index).toFixed(1)},${y(Number(point.value)).toFixed(1)}`).join(' ');
  const latest = history.at(-1);
  const firstDate = escapeXml(history[0].date);
  const lastDate = escapeXml(latest.date);
  const latestText = Number(latest.value).toLocaleString('en-US', { maximumFractionDigits: 4 });
  const grid = [0, 0.5, 1].map((ratio) => {
    const yy = top + ratio * chartHeight;
    const label = (max - ratio * (max - min)).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="#e5e7eb"/><text x="${left - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#6b7280">${label}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="8" fill="#fff"/><text x="24" y="30" font-size="18" font-weight="700" fill="#111827">${title}</text><text x="${width - 24}" y="30" text-anchor="end" font-size="12" fill="#6b7280">最新 ${latestText} ${escapeXml(product.unit || '')}</text>${grid}<polyline points="${points}" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(history.length - 1)}" cy="${y(Number(latest.value))}" r="4" fill="#d97706"/><text x="${left}" y="${height - 18}" font-size="11" fill="#6b7280">${firstDate}</text><text x="${width - right}" y="${height - 18}" text-anchor="end" font-size="11" fill="#6b7280">${lastDate}</text></svg>`;
}

function triggerRefresh({ collect = true, only = null, manual = false } = {}) {
  if (refreshPromise) return { started: false, promise: refreshPromise };
  refreshStatus = { updating: true, startedAt: new Date().toISOString(), completedAt: null, error: null, mode: only || 'full' };
  const python = process.env.PRICE_TRACKING_PYTHON || process.env.PYTHON || 'python3';
  const args = [REFRESH_SCRIPT];
  if (!collect) args.push('--export-only');
  if (only) args.push('--only', only);
  if (collect && !only && (!manual || !tungstenRefreshMayStart() || tungstenPricesAreCurrent())) {
    args.push('--skip-tungsten');
  }

  refreshPromise = new Promise((resolve) => {
    const child = spawn(python, args, { cwd: SERVER_ROOT, env: process.env });
    let stderr = '';
    child.stdout.on('data', (chunk) => process.stdout.write(`[price-refresh] ${chunk}`));
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      refreshStatus = { ...refreshStatus, updating: false, completedAt: new Date().toISOString(), error: error.message };
      refreshPromise = null;
      resolve({ success: false, error: error.message });
    });
    child.on('close', (code) => {
      const error = code === 0 ? null : (stderr.trim() || `price refresh exited with code ${code}`);
      refreshStatus = { ...refreshStatus, updating: false, completedAt: new Date().toISOString(), error };
      refreshPromise = null;
      resolve({ success: code === 0, error });
    });
  });
  return { started: true, promise: refreshPromise };
}

function scheduleTungstenRefresh(delay) {
  if (tungstenTimer) clearTimeout(tungstenTimer);
  tungstenTimer = setTimeout(async () => {
    if (tungstenPricesAreCurrent()) {
      scheduleTungstenRefresh(millisecondsUntilTungstenStart({ tomorrow: true }));
      return;
    }

    const { promise } = triggerRefresh({ collect: true, only: 'tungsten' });
    await promise;
    scheduleTungstenRefresh(
      tungstenPricesAreCurrent()
        ? millisecondsUntilTungstenStart({ tomorrow: true })
        : TUNGSTEN_RETRY_INTERVAL_MS,
    );
  }, delay);
  tungstenTimer.unref?.();
}

function startAutoRefresh() {
  if (timer) return;
  triggerRefresh({ collect: true });
  timer = setInterval(() => triggerRefresh({ collect: true }), REFRESH_INTERVAL_MS);
  timer.unref?.();
  scheduleTungstenRefresh(
    tungstenPricesAreCurrent()
      ? millisecondsUntilTungstenStart({ tomorrow: true })
      : tungstenRefreshMayStart()
        ? 1000
        : millisecondsUntilTungstenStart(),
  );
  console.log('[price-refresh] scheduled every 30 min');
  console.log('[price-refresh] tungsten first attempt scheduled at 10:45 Asia/Shanghai; retries stop after current-day data');
}

function getStatus() {
  const cache = readCache();
  return {
    ...refreshStatus,
    generatedAt: cache.generatedAt || null,
    productCount: (cache.products || []).length,
    collectorStatus: readCollectorStatus(),
  };
}

export {
  getNewsCompatibleItems,
  getStatus,
  mergeWithNews,
  readCache,
  renderChart,
  startAutoRefresh,
  triggerRefresh,
};
