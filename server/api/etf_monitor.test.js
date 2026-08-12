import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createEtfMonitorRouter } from './etf_monitor.js';

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (
      error ? reject(error) : resolve()
    ))),
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFetchStub(calls) {
  return async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ path: `${parsed.pathname}${parsed.search}`, method: init.method || 'GET' });
    if (parsed.pathname === '/api/monitor/symbols') {
      return jsonResponse({ symbols: [{ symbol: '159915.SZ', name: '创业板ETF易方达' }] });
    }
    if (parsed.pathname === '/api/health') {
      return jsonResponse({ status: 'ok', data_status: 'live', last_updated: '2026-08-10T10:00:00' });
    }
    if (parsed.pathname === '/api/monitor/cached-snapshot') {
      return jsonResponse({
        symbol: '159915.SZ',
        name: '创业板ETF易方达',
        data_status: 'live',
        latest_candle: { time: '2026-08-10T10:00:00', close: 3.54, amount: 120000000 },
        candles: [],
        current_alert: null,
        last_updated: '2026-08-10T10:00:00',
        error: null,
      });
    }
    if (parsed.pathname === '/api/alerts') {
      return jsonResponse({ alerts: [] });
    }
    if (parsed.pathname === '/api/monitor/poll-all') {
      return jsonResponse({ results: [{ symbol: '159915.SZ', data_status: 'live' }] });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  };
}

test('overview reads cached snapshots and alerts through one platform endpoint', async (t) => {
  const calls = [];
  const app = express();
  app.use('/api/etf-monitor', createEtfMonitorRouter({
    baseUrl: 'http://etf-monitor.test',
    fetchImpl: createFetchStub(calls),
    now: () => new Date('2026-08-10T02:01:00.000Z'),
  }));
  const server = await listen(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/etf-monitor/overview`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data_status, 'live');
  assert.equal(payload.items[0].symbol, '159915.SZ');
  assert.ok(calls.some((call) => call.path.startsWith('/api/monitor/cached-snapshot?')));
  assert.ok(!calls.some((call) => call.path.startsWith('/api/monitor/snapshot?')));
});

test('manual refresh polls all monitored ETFs before returning the latest overview', async (t) => {
  const calls = [];
  const app = express();
  app.use('/api/etf-monitor', createEtfMonitorRouter({
    baseUrl: 'http://etf-monitor.test',
    fetchImpl: createFetchStub(calls),
  }));
  const server = await listen(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/etf-monitor/refresh`, { method: 'POST' });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.poll_results.length, 1);
  assert.ok(calls.some((call) => call.path === '/api/monitor/poll-all' && call.method === 'POST'));
});

test('overview returns a clear degraded response when the monitor is offline', async (t) => {
  const app = express();
  app.use('/api/etf-monitor', createEtfMonitorRouter({
    baseUrl: 'http://etf-monitor.test',
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
  }));
  const server = await listen(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/etf-monitor/overview`);
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.success, false);
  assert.match(payload.error, /ETF监控后台不可用/);
});
