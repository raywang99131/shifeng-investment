import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAiDashboardServiceFromEnv, createEmptyAiDashboardSnapshot } from './aiDashboardService.js';

const html = await fs.readFile(new URL('./fixtures/openrouter/rankings.html', import.meta.url), 'utf8');

test('OpenRouter refresh replaces obsolete API totals with the current webpage even when an API key exists', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openrouter-web-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dataFile = path.join(dir, 'snapshot.json');
  const cacheFile = path.join(dir, 'openrouter-public.json');
  const old = createEmptyAiDashboardSnapshot('2026-08-23T00:00:00.000Z');
  old.openRouter = { ...old.openRouter, endDate: '2026-08-22', weekTotalTokens: '123', topModels: [{ rank: 1, model: 'old', totalTokens: '123' }] };
  await fs.writeFile(dataFile, JSON.stringify(old));
  await fs.writeFile(cacheFile, JSON.stringify({ asOf: '2026-08-22', startDate: '2026-08-16', endDate: '2026-08-22', topModels: old.openRouter.topModels }));
  const apiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'unused-test-key';
  t.after(() => { if (apiKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = apiKey; });
  let calls = 0;
  const service = createAiDashboardServiceFromEnv({
    dataFile, openRouterPublicFile: cacheFile,
    now: () => new Date('2026-09-06T10:00:00.000Z'),
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(String(url), 'https://openrouter.ai/rankings');
      assert.equal(new Headers(options.headers).has('Authorization'), false);
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    },
  });
  const snapshot = await service.refresh({ sources: ['openRouter'] });
  assert.equal(snapshot.sources.openRouter.status, 'ready', snapshot.sources.openRouter.message);
  assert.equal(calls, 1);
  assert.equal(snapshot.sources.openRouter.stale, false);
  assert.equal(snapshot.sources.openRouter.asOf, '2026-09-05');
  assert.equal(snapshot.openRouter.startDate, '2026-08-30');
  assert.equal(snapshot.openRouter.endDate, '2026-09-05');
  assert.equal(snapshot.openRouter.sourceMode, 'public-webpage');
  assert.equal(snapshot.openRouter.topModels[0].model, 'Hy4 preview');
  assert.equal(snapshot.openRouter.topModels[0].totalTokens, '14100000000000');
  assert.equal(snapshot.openRouter.topModels[5].weekOverWeekPercent, -0.03);
  assert.equal(snapshot.openRouter.top10TotalTokens, '75560000000000');
  assert.equal(snapshot.openRouter.weekTotalTokens, null);
  assert.equal(snapshot.openRouter.weekOverWeekAbsolute, null);
  assert.equal(snapshot.openRouter.archivedPlatformData.weekTotalTokens, '123');
  assert.deepEqual(snapshot.openRouter.history, []);
  assert.equal(snapshot.openRouter.weeklyHistory.weeks.length, 52);
  assert.equal(snapshot.openRouter.weeklyHistory.weeks.at(-1).totalDisplay, '108T');
  assert.equal(snapshot.openRouter.weeklyHistory.asOf, '2026-09-05');
  assert.equal(JSON.parse(await fs.readFile(cacheFile, 'utf8')).endDate, '2026-09-05');
});

test('a later leaderboard refresh preserves the dated browser chart when its capture cannot be loaded', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openrouter-history-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const captureFile = path.join(dir, 'history.json');
  await fs.copyFile(new URL('../data/ai-dashboard/openrouter-weekly-history.json', import.meta.url), captureFile);
  let page = html;
  const service = createAiDashboardServiceFromEnv({
    dataFile: path.join(dir, 'snapshot.json'), openRouterPublicFile: path.join(dir, 'public.json'),
    openRouterWeeklyHistoryFile: captureFile,
    now: () => new Date('2026-09-07T10:00:00.000Z'),
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://openrouter.ai/rankings');
      return new Response(page, { headers: { 'Content-Type': 'text/html' } });
    },
  });
  const first = await service.refresh({ sources: ['openRouter'] });
  await fs.writeFile(captureFile, 'invalid capture');
  page = html.replaceAll('2026-09-05', '2026-09-06');
  const updated = await service.refresh({ sources: ['openRouter'] });
  assert.equal(updated.openRouter.endDate, '2026-09-06');
  assert.deepEqual(updated.openRouter.weeklyHistory, first.openRouter.weeklyHistory);
  assert.equal(updated.openRouter.weeklyHistory.asOf, '2026-09-05');
  assert.match(updated.openRouter.weeklyHistoryError, /周图/);
});

test('blocked webpage refresh retains last-good values and source date, and never falls back to the old export', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openrouter-blocked-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let blocked = false;
  let currentTime = new Date('2026-09-06T10:00:00.000Z');
  const service = createAiDashboardServiceFromEnv({
    dataFile: path.join(dir, 'snapshot.json'), openRouterPublicFile: path.join(dir, 'export.json'),
    now: () => currentTime,
    fetchImpl: async () => blocked ? new Response('unavailable', { status: 503 })
      : new Response(html, { headers: { 'Content-Type': 'text/html' } }),
  });
  const first = await service.refresh({ sources: ['openRouter'] });
  blocked = true;
  currentTime = new Date('2026-09-07T10:00:00.000Z');
  const aged = await service.getSnapshot();
  assert.equal(aged.sources.openRouter.stale, true, 'an old source must become stale even before the next refresh');
  const failed = await service.refresh({ sources: ['openRouter'] });
  assert.deepEqual(failed.openRouter, first.openRouter);
  assert.equal(failed.sources.openRouter.asOf, '2026-09-05');
  assert.equal(failed.sources.openRouter.status, 'error');
  assert.equal(failed.sources.openRouter.stale, true);
  assert.match(failed.sources.openRouter.message, /HTTP 503/);
});
