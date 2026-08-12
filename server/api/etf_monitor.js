import express from 'express';

const DEFAULT_ETF_MONITOR_URL = 'http://127.0.0.1:8000';
const DEFAULT_TIMEOUT_MS = 15000;
const REFRESH_TIMEOUT_MS = 120000;

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_ETF_MONITOR_URL).replace(/\/+$/, '');
}

function latestIso(values) {
  return values
    .filter(Boolean)
    .map((value) => String(value))
    .sort((a, b) => b.localeCompare(a))[0] || null;
}

function aggregateStatus(health, items) {
  if (health?.data_status === 'live') return 'live';
  if (items.some((item) => item.data_status === 'live')) return 'live';
  if (items.some((item) => item.latest_candle)) return 'cached';
  return health?.data_status || 'degraded';
}

export function createEtfMonitorRouter({
  baseUrl = process.env.ETF_MONITOR_URL || DEFAULT_ETF_MONITOR_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const router = express.Router();
  const upstream = normalizeBaseUrl(baseUrl);

  const requestJson = async (pathname, init = {}, requestTimeoutMs = timeoutMs) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(`${upstream}${pathname}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(init.headers || {}),
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.detail || payload?.error || `HTTP ${response.status}`;
        throw new Error(String(detail));
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('ETF监控后台响应超时');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const loadOverview = async () => {
    const [symbolPayload, health] = await Promise.all([
      requestJson('/api/monitor/symbols'),
      requestJson('/api/health').catch((error) => ({
        status: 'degraded',
        data_status: 'degraded',
        error: error.message,
      })),
    ]);
    const symbols = Array.isArray(symbolPayload?.symbols) ? symbolPayload.symbols : [];

    const items = await Promise.all(symbols.map(async (symbolInfo) => {
      const symbol = String(symbolInfo.symbol || '');
      const encodedSymbol = encodeURIComponent(symbol);
      try {
        const [snapshot, alertPayload] = await Promise.all([
          requestJson(`/api/monitor/cached-snapshot?symbol=${encodedSymbol}`),
          requestJson(`/api/alerts?symbol=${encodedSymbol}&limit=100`),
        ]);
        return {
          ...snapshot,
          symbol,
          name: snapshot?.name || symbolInfo.name || symbol,
          alerts: Array.isArray(alertPayload?.alerts) ? alertPayload.alerts : [],
        };
      } catch (error) {
        return {
          symbol,
          name: symbolInfo.name || symbol,
          data_status: 'degraded',
          latest_candle: null,
          candles: [],
          current_alert: null,
          last_updated: null,
          alerts: [],
          error: error.message,
        };
      }
    }));

    return {
      success: items.some((item) => Boolean(item.latest_candle)),
      generated_at: now().toISOString(),
      data_status: aggregateStatus(health, items),
      last_updated: latestIso(items.map((item) => item.last_updated)),
      backend: health,
      items,
    };
  };

  router.get('/overview', async (_req, res) => {
    try {
      const overview = await loadOverview();
      res.status(overview.success ? 200 : 503).json(overview);
    } catch (error) {
      res.status(503).json({
        success: false,
        data_status: 'degraded',
        error: `ETF监控后台不可用：${error.message}`,
        items: [],
      });
    }
  });

  router.post('/refresh', async (_req, res) => {
    try {
      const pollPayload = await requestJson(
        '/api/monitor/poll-all',
        { method: 'POST' },
        REFRESH_TIMEOUT_MS,
      );
      const overview = await loadOverview();
      res.status(overview.success ? 200 : 503).json({
        ...overview,
        poll_results: Array.isArray(pollPayload?.results) ? pollPayload.results : [],
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        data_status: 'degraded',
        error: `ETF刷新失败：${error.message}`,
        items: [],
      });
    }
  });

  router.get('/health', async (_req, res) => {
    try {
      const health = await requestJson('/api/health');
      res.status(health.status === 'ok' ? 200 : 503).json({ success: true, ...health });
    } catch (error) {
      res.status(503).json({ success: false, status: 'degraded', error: error.message });
    }
  });

  return router;
}

export default createEtfMonitorRouter();
