import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  STANDARD_TMT_DEFINITION_ID,
  STANDARD_TMT_DEFINITION_NAME,
  createEastmoneySpotSnapshotRunner,
  createSpotRefreshController,
  createSpotRefreshHandler,
  createTmtMarginHandler,
  getMarginFreshness,
} from './tmt_margin.js';

function fakeProcess({ code = 0, stdout = '', stderr = '', delayMs = 0, neverClose = false } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killSignals = [];
  proc.kill = (signal = 'SIGTERM') => {
    proc.killSignals.push(signal);
    queueMicrotask(() => proc.emit('close', null, signal));
    return true;
  };

  if (!neverClose) {
    setTimeout(() => {
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', code, null);
    }, delayMs);
  }
  return proc;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function standardPayload({
  date = '20260805',
  includeTrading = true,
  tradingDates = ['20260806', '20260805', '20260804'],
} = {}) {
  const classificationAsof = '20260806';
  const membershipHash = 'a'.repeat(64);
  const membershipMode = 'current_components_backfill';
  const turnover = [
    { industry_code: '801080', industry_name: '电子', turnover_pct: 34.83 },
    { industry_code: '801750', industry_name: '计算机', turnover_pct: 8.90 },
    { industry_code: '801760', industry_name: '传媒', turnover_pct: 3.26 },
    { industry_code: '801770', industry_name: '通信', turnover_pct: 12.15 },
  ];
  const coreNumbers = {
    tmt_yy: 6000,
    market_yy: 20000,
    pct: 30,
    tmt_buy: 600,
    market_buy: 2000,
    tmt_buy_pct: 30,
    tmt_universe_count: 1400,
    tmt_margin_count: 1180,
    tmt_count: 1180,
    tmt_turnover_pct: 59.14,
  };
  const trend = [...new Set([date, ...tradingDates])].map((trendDate) => ({
    date: trendDate,
    definition_id: STANDARD_TMT_DEFINITION_ID,
    definition_name: STANDARD_TMT_DEFINITION_NAME,
    classification_asof: classificationAsof,
    membership_hash: membershipHash,
    membership_mode: membershipMode,
    ...coreNumbers,
    tmt_turnover_by_industry: structuredClone(turnover),
  }));
  return {
    success: true,
    date,
    definition_id: STANDARD_TMT_DEFINITION_ID,
    definition_name: STANDARD_TMT_DEFINITION_NAME,
    classification_asof: classificationAsof,
    membership_hash: membershipHash,
    membership_mode: membershipMode,
    data: {
      date,
      definition_id: STANDARD_TMT_DEFINITION_ID,
      definition_name: STANDARD_TMT_DEFINITION_NAME,
      classification_asof: classificationAsof,
      membership_hash: membershipHash,
      membership_mode: membershipMode,
      ...coreNumbers,
      tmt_turnover_by_industry: structuredClone(turnover),
      incr_pct_3d: null,
      incr_pct_5d: null,
      incr_pct_10d: null,
      trend,
      industry_summary: [
        {
          industry_code: '801080', industry_name: '电子', universe_count: 600, margin_count: 500,
          yy: 3000, buy: 300, yy_chg_1d: null, pct: 15, tmt_share_pct: 50,
        },
        {
          industry_code: '801750', industry_name: '计算机', universe_count: 400, margin_count: 350,
          yy: 1500, buy: 150, yy_chg_1d: 10, pct: 7.5, tmt_share_pct: 25,
        },
        {
          industry_code: '801760', industry_name: '传媒', universe_count: 200, margin_count: 150,
          yy: 500, buy: 50, yy_chg_1d: -2, pct: 2.5, tmt_share_pct: 8.33,
        },
        {
          industry_code: '801770', industry_name: '通信', universe_count: 200, margin_count: 180,
          yy: 1000, buy: 100, yy_chg_1d: 5, pct: 5, tmt_share_pct: 16.67,
        },
      ],
      top_balance_stocks: [{
        code: '000001', name: '标准电子股', market: 'sz', yy: 100, buy: 10,
        repay: null, net: null, yy_chg_1d: null,
        sw_industry_code: '801080', sw_industry_name: '电子',
      }],
      top_change_stocks: [{
        code: '000002', name: '标准计算机股', market: 'sz', yy: 80, buy: 8,
        repay: 4, net: 4, yy_chg_1d: 2,
        sw_industry_code: '801750', sw_industry_name: '计算机',
      }],
      ...(includeTrading ? {
        trading_congestion: {
          date: tradingDates[0],
          trend: tradingDates.map((tradingDate, index) => ({
            date: tradingDate,
            top1_ratio: 25 - index,
          })),
        },
      } : {}),
    },
  };
}

test('margin freshness is independent from the same-day trading snapshot timestamp', () => {
  const stalePayload = standardPayload({
    date: '20260730',
    tradingDates: ['20260806', '20260805', '20260803'],
  });
  const stale = getMarginFreshness(stalePayload);
  assert.equal(stale.stale, true);
  assert.equal(stale.reasonCode, 'MARGIN_CACHE_OUTDATED');
  assert.equal(stale.dataDate, '20260730');
  assert.equal(stale.expectedDate, '20260805');
  assert.equal(stale.lagTradingDays, 3);

  const freshPayload = structuredClone(stalePayload);
  freshPayload.date = '20260805';
  freshPayload.data.date = '20260805';
  const fresh = getMarginFreshness(freshPayload);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.lagTradingDays, 1);
});

test('old custom-pool cache is an explicit methodology mismatch', () => {
  const freshness = getMarginFreshness({
    success: true,
    data: {
      date: '20260805',
      pct: 24.33,
      tmt_count: 706,
      trading_congestion: standardPayload().data.trading_congestion,
    },
  });

  assert.equal(freshness.stale, true);
  assert.equal(freshness.compatible, false);
  assert.equal(freshness.definitionMatches, false);
  assert.equal(freshness.reasonCode, 'MARGIN_DEFINITION_MISMATCH');
  assert.equal(freshness.expectedDefinitionId, STANDARD_TMT_DEFINITION_ID);
});

test('valid standard cache is served without rebuilding', async () => {
  const cached = standardPayload();
  let runCount = 0;
  const handler = createTmtMarginHandler({
    readCached: () => cached,
    runScript: async () => { runCount += 1; return standardPayload(); },
    needsSpotRefresh: () => false,
    hasFullHistory: () => true,
  });
  const res = responseRecorder();

  await handler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cached, true);
  assert.equal(res.body.stale, false);
  assert.equal(res.body.needsMarginRefresh, false);
  assert.equal(res.body.marginDefinitionId, STANDARD_TMT_DEFINITION_ID);
  assert.equal(res.body.data.pct, 30);
  assert.equal(runCount, 0);
});

test('stale standard cache rebuilds on an ordinary GET', async () => {
  const cached = standardPayload({ date: '20260801' });
  let runCount = 0;
  const handler = createTmtMarginHandler({
    readCached: () => cached,
    runScript: async () => { runCount += 1; return standardPayload(); },
    needsSpotRefresh: () => false,
    hasFullHistory: () => true,
  });
  const res = responseRecorder();

  await handler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cached, false);
  assert.equal(res.body.stale, false);
  assert.equal(res.body.needsMarginRefresh, false);
  assert.equal(res.body.staleReason, null);
  assert.equal(res.body.marginDataDate, '20260805');
  assert.equal(res.body.expectedMarginDataDate, '20260805');
  assert.equal(runCount, 1);
});

test('incompatible custom cache is never returned when its standard rebuild fails', async () => {
  const trading = standardPayload().data.trading_congestion;
  const customCached = {
    success: true,
    generatedAt: '2026-08-06T07:00:00.000Z',
    data: {
      date: '20260805',
      pct: 24.33,
      tmt_count: 706,
      core_stocks: [{ code: '000001' }],
      trading_congestion: trading,
    },
  };
  let runCount = 0;
  const handler = createTmtMarginHandler({
    readCached: () => customCached,
    // Simulate an old script still producing the incompatible custom payload.
    runScript: async () => { runCount += 1; return customCached; },
    needsSpotRefresh: () => false,
    hasFullHistory: () => true,
  });
  const res = responseRecorder();

  await handler({ query: {} }, res);

  assert.equal(runCount, 1, 'a normal GET must rebuild an incompatible cache');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.errorCode, 'STANDARD_TMT_DATA_UNAVAILABLE');
  assert.equal(res.body.staleReason, 'MARGIN_DEFINITION_MISMATCH');
  assert.equal(res.body.needsMarginRefresh, true);
  assert.equal(res.body.marginDataAvailable, false);
  assert.equal(res.body.data.pct, undefined);
  assert.equal(res.body.data.tmt_count, undefined);
  assert.deepEqual(res.body.data.trading_congestion.trend, trading.trend);
});

test('standard refresh preserves independent trading-congestion cache', async () => {
  const cached = {
    success: true,
    data: {
      date: '20260805',
      pct: 24.33,
      trading_congestion: standardPayload().data.trading_congestion,
    },
  };
  const refreshed = standardPayload({ includeTrading: false });
  const handler = createTmtMarginHandler({
    readCached: () => cached,
    runScript: async () => refreshed,
    needsSpotRefresh: () => false,
    hasFullHistory: () => true,
  });
  const res = responseRecorder();

  await handler({ query: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cached, false);
  assert.equal(res.body.data.pct, 30);
  assert.ok(res.body.data.trading_congestion);
  assert.equal(res.body.expectedMarginDataDate, '20260805');
});

test('refresh failure may fall back to a valid standard cache', async () => {
  const cached = standardPayload();
  const handler = createTmtMarginHandler({
    readCached: () => cached,
    runScript: async () => { throw Object.assign(new Error('upstream unavailable'), { code: 'UPSTREAM_FAILED' }); },
    needsSpotRefresh: () => false,
    hasFullHistory: () => true,
  });
  const res = responseRecorder();

  await handler({ query: { refresh: '1' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cached, true);
  assert.equal(res.body.stale, true);
  assert.equal(res.body.staleReason, 'REFRESH_FAILED');
  assert.equal(res.body.refreshErrorCode, 'UPSTREAM_FAILED');
  assert.equal(res.body.data.pct, 30);
});

test('valid production-shaped standard payload passes the fail-closed contract', () => {
  const payload = standardPayload();
  const freshness = getMarginFreshness(payload);

  assert.equal(freshness.contractValid, true);
  assert.equal(freshness.compatible, true);
  assert.equal(freshness.stale, false);
  assert.equal(freshness.definitionMatches, true);
  assert.equal(freshness.membershipMetadataValid, true);
});

test('root and data metadata conflict is rejected', () => {
  const payload = standardPayload();
  payload.data.membership_hash = 'b'.repeat(64);

  const freshness = getMarginFreshness(payload);

  assert.equal(freshness.compatible, false);
  assert.equal(freshness.reasonCode, 'MARGIN_METADATA_CONFLICT');
});

test('truthy standard IDs cannot disguise a legacy custom payload', () => {
  const payload = standardPayload();
  payload.data.core_stocks = [{ code: '000001' }];

  const freshness = getMarginFreshness(payload);

  assert.equal(freshness.compatible, false);
  assert.equal(freshness.reasonCode, 'MARGIN_LEGACY_PAYLOAD_REJECTED');
});

test('standard payload missing one of the exact four industries is rejected', () => {
  const payload = standardPayload();
  payload.data.tmt_turnover_by_industry = payload.data.tmt_turnover_by_industry.slice(0, 3);

  const freshness = getMarginFreshness(payload);

  assert.equal(freshness.compatible, false);
  assert.equal(freshness.reasonCode, 'MARGIN_INDUSTRY_SET_INVALID');
});

test('unsupported membership mode is rejected even when root and data agree', () => {
  const payload = standardPayload();
  payload.membership_mode = 'current_asof';
  payload.data.membership_mode = 'current_asof';

  const freshness = getMarginFreshness(payload);

  assert.equal(freshness.compatible, false);
  assert.equal(freshness.reasonCode, 'MARGIN_MEMBERSHIP_MODE_INVALID');
});

test('obviously ancient standard data is stale without a trading trend reference', () => {
  const freshness = getMarginFreshness(standardPayload({ date: '20200102', includeTrading: false }));

  assert.equal(freshness.compatible, true);
  assert.equal(freshness.stale, true);
  assert.equal(freshness.reasonCode, 'MARGIN_CACHE_OUTDATED');
  assert.equal(freshness.dateCheckSource, 'calendar_age_guard');
});

test('spot refresh status never leaks custom margin fields from its cache', async () => {
  const customCached = {
    success: true,
    generatedAt: '2026-08-06T07:00:00.000Z',
    data: {
      date: '20260805',
      pct: 24.33,
      core_stocks: [{ code: '000001' }],
      trading_congestion: standardPayload().data.trading_congestion,
    },
  };
  const controller = createSpotRefreshController({
    runSpotSnapshot: async () => ({ success: true, attempts: 1 }),
    readCached: () => customCached,
    needsRefresh: () => true,
    now: () => new Date('2026-08-06T08:00:00.000Z'),
  });
  const accepted = responseRecorder();
  controller.postHandler({}, accepted);
  await controller.waitForIdle();
  const status = responseRecorder();

  controller.statusHandler({}, status);

  assert.equal(status.statusCode, 200);
  assert.equal(status.body.success, true);
  assert.equal(status.body.data.pct, undefined);
  assert.equal(status.body.data.core_stocks, undefined);
  assert.ok(status.body.data.trading_congestion);
});

test('spot snapshot retries one transient upstream failure and shares concurrent work', async () => {
  let spawnCount = 0;
  const spawnProcess = () => {
    spawnCount += 1;
    return spawnCount === 1
      ? fakeProcess({ code: 1, stderr: 'Temporary failure in name resolution' })
      : fakeProcess({ code: 0, stdout: '{"date":"20260721"}', delayMs: 5 });
  };
  const run = createEastmoneySpotSnapshotRunner({
    spawnProcess,
    attemptTimeoutMs: 50,
    totalTimeoutMs: 120,
    retryDelayMs: 0,
    maxAttempts: 2,
  });

  const first = run();
  const duplicate = run();
  assert.strictEqual(duplicate, first);
  const result = await first;

  assert.equal(result.success, true);
  assert.equal(result.attempts, 2);
  assert.equal(spawnCount, 2);
});

test('spot snapshot has a hard total timeout and terminates the child process', async () => {
  const children = [];
  const run = createEastmoneySpotSnapshotRunner({
    spawnProcess: () => {
      const child = fakeProcess({ neverClose: true });
      children.push(child);
      return child;
    },
    attemptTimeoutMs: 15,
    totalTimeoutMs: 35,
    retryDelayMs: 0,
    maxAttempts: 2,
  });

  const startedAt = Date.now();
  await assert.rejects(run(), (error) => {
    assert.equal(error.code, 'UPSTREAM_TIMEOUT');
    assert.ok(error.attempts >= 1 && error.attempts <= 2);
    return true;
  });
  assert.ok(Date.now() - startedAt < 250, 'refresh must respect the total timeout budget');
  assert.ok(children.length >= 1 && children.length <= 2);
  assert.ok(children.every((child) => child.killSignals.includes('SIGTERM')));
});

test('spot refresh failure returns stale cache metadata without mutating the last-good payload', async () => {
  const cached = {
    success: true,
    generatedAt: '2026-07-17T09:57:46.000Z',
    data: {
      trading_congestion: {
        date: '20260717',
        top1_ratio: 22.1,
      },
    },
  };
  const before = JSON.stringify(cached);
  const error = Object.assign(new Error('Eastmoney spot snapshot timeout'), {
    code: 'UPSTREAM_TIMEOUT',
    attempts: 2,
    retryable: true,
  });
  const handler = createSpotRefreshHandler({
    runSpotSnapshot: async () => { throw error; },
    readCached: () => cached,
    buildStatus: () => ({ spot_archive_end: '20260717' }),
  });
  const res = responseRecorder();

  await handler({}, res);

  assert.equal(res.statusCode, 504);
  assert.equal(res.body.success, false);
  assert.equal(res.body.cached, true);
  assert.equal(res.body.stale, true);
  assert.equal(res.body.staleDataDate, '20260717');
  assert.equal(res.body.generatedAt, cached.generatedAt);
  assert.equal(res.body.refresh.code, 'UPSTREAM_TIMEOUT');
  assert.equal(res.body.refresh.attempts, 2);
  assert.deepEqual(res.body.data, cached.data);
  assert.equal(JSON.stringify(cached), before);
});

test('spot refresh controller responds immediately and deduplicates background refreshes', async () => {
  let finishRefresh;
  let runCount = 0;
  const runSpotSnapshot = () => {
    runCount += 1;
    return new Promise((resolve) => { finishRefresh = resolve; });
  };
  const cached = {
    generatedAt: '2026-07-17T09:57:46.000Z',
    data: { trading_congestion: { date: '20260717' } },
  };
  const controller = createSpotRefreshController({
    runSpotSnapshot,
    readCached: () => cached,
    needsRefresh: () => true,
    now: (() => {
      let tick = 0;
      return () => new Date(`2026-07-21T07:00:0${tick++}.000Z`);
    })(),
  });
  const first = responseRecorder();
  const duplicate = responseRecorder();

  controller.postHandler({}, first);
  controller.postHandler({}, duplicate);

  assert.equal(first.statusCode, 202);
  assert.equal(first.body.refresh.status, 'running');
  assert.equal(first.body.staleDataDate, '20260717');
  assert.equal(duplicate.statusCode, 202);
  assert.equal(runCount, 1);

  finishRefresh({ success: true, attempts: 2, stdout: '{"provider":"sina_fallback"}' });
  await controller.waitForIdle();

  const status = responseRecorder();
  controller.statusHandler({}, status);
  assert.equal(status.body.refresh.status, 'success');
  assert.equal(status.body.refresh.provider, 'sina_fallback');
  assert.equal(status.body.data.trading_congestion.date, '20260717');
  assert.equal(status.body.data.pct, undefined);
});

test('spot refresh controller skips duplicate daily work when cache is already fresh', () => {
  let runCount = 0;
  const cached = {
    generatedAt: '2026-07-21T07:30:00.000Z',
    data: { trading_congestion: { date: '20260721' } },
  };
  const controller = createSpotRefreshController({
    runSpotSnapshot: async () => { runCount += 1; return { success: true }; },
    readCached: () => cached,
    needsRefresh: () => false,
    now: () => new Date('2026-07-21T07:55:00.000Z'),
  });
  const res = responseRecorder();

  controller.postHandler({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.refresh.status, 'success');
  assert.equal(res.body.refresh.alreadyFresh, true);
  assert.equal(res.body.stale, false);
  assert.equal(res.body.data, null);
  assert.equal(runCount, 0);
});
