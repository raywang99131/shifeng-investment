import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import express from 'express';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'research-earnings-report-'));
const sourceRoot = path.join(tempRoot, 'source');
const dataRoot = path.join(tempRoot, 'data');
const reportsRoot = path.join(tempRoot, 'reports');

process.env.EARNINGS_REPORT_OUTPUT_DIR = sourceRoot;
process.env.RESEARCH_DATA_DIR = dataRoot;
process.env.RESEARCH_REPORTS_DIR = reportsRoot;
process.env.RESEARCH_COMPLETED_FILE = path.join(dataRoot, 'completed.json');

const [{ default: researchRouter }, { syncResearch }] = await Promise.all([
  import('./research.js'),
  import('../lib/researchSync.js'),
]);

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.EARNINGS_REPORT_OUTPUT_DIR;
  delete process.env.RESEARCH_DATA_DIR;
  delete process.env.RESEARCH_REPORTS_DIR;
  delete process.env.RESEARCH_COMPLETED_FILE;
});

function earningsReportInput(date, overrides = {}) {
  return {
    date,
    generated_at: `${date}T14:00:00.000Z`,
    fetch_summary: {
      formal_report_rows: 1,
      watchlist_report_rows: 1,
    },
    items: [{
      公告日期: date,
      公告标题: '2020年年度报告',
      公告ID: `${date}-fixture`,
      原文链接: 'https://example.com/earnings-report.pdf',
      证券代码: '688001',
      证券简称: '测试公司',
      所属子集: '测试子集',
      watchlist命中: 1,
      报告类型: '年度报告',
      报告期: '2020FY',
      扣非净利润亿元: 0.01,
      '扣非净利润同比%': 25,
      归母净利润亿元: 0.012,
      '归母净利润同比%': 20,
      营业收入亿元: 0.05,
      '营业收入同比%': 10,
      经营现金流亿元: 0.008,
      '经营现金流同比%': 5,
      基本每股收益元: 0.12,
      '加权ROE%': 6,
      ...overrides,
    }],
  };
}

function writeSourceDay(date, { input = earningsReportInput(date), report = true } = {}) {
  const dayDir = path.join(sourceRoot, date);
  fs.mkdirSync(dayDir, { recursive: true });
  if (input !== null) {
    fs.writeFileSync(path.join(dayDir, 'input.json'), JSON.stringify(input, null, 2));
  }
  if (report) {
    fs.writeFileSync(path.join(dayDir, `A股业绩报告-${date}.pdf`), `pdf fixture ${date}`);
  }
  return dayDir;
}

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

test('earnings-report sync reads local input.json and report files without publishing empty days', async () => {
  writeSourceDay('2020-01-02');
  writeSourceDay('2020-01-03', {
    input: earningsReportInput('2020-01-03', {
      证券代码: '688002',
      证券简称: '测试公司二',
      公告标题: '2020年半年度报告',
      报告类型: '半年度报告',
      报告期: '2020H1',
      扣非净利润亿元: 0.006,
      '扣非净利润同比%': -25,
      归母净利润亿元: 0.008,
      '归母净利润同比%': -20,
      营业收入亿元: 0.04,
      '营业收入同比%': -10,
    }),
  });
  writeSourceDay('2020-01-04', { input: earningsReportInput('2020-01-04'), report: false });
  writeSourceDay('2020-01-05', { input: null, report: true });
  writeSourceDay('2020-01-06', { input: { date: '2020-01-06', items: [] }, report: true });

  const sync = await syncResearch({ kind: 'earnings-report', days: 14 });
  assert.equal(sync.success, true);
  assert.equal(sync.totals.attempted, 3);
  assert.equal(sync.totals.succeeded, 3);

  const latest = JSON.parse(fs.readFileSync(
    path.join(dataRoot, 'earnings-report', '2020-01-03.json'),
    'utf8',
  ));
  assert.equal(latest.kind, 'earnings-report');
  assert.equal(latest.totalCount, 1);
  assert.equal(latest.watchlistHits, 1);
  assert.equal(latest.topBad[0].title, '2020H1 半年度报告');
  assert.equal(latest.allItems[0].forecastType, '半年度报告');
  assert.equal(latest.allItems[0].highWan, 80);
  assert.match(latest.allItems[0].reason, /营收同比 -10%/);
  assert.match(latest.files[0].url, /^\/api\/research\/files\/earnings-report\//);

  const empty = JSON.parse(fs.readFileSync(
    path.join(dataRoot, 'earnings-report', '2020-01-06.json'),
    'utf8',
  ));
  assert.equal(empty.totalCount, 0);
});

test('earnings-report explicit sync reports missing input and missing report files', async () => {
  const missingInput = await syncResearch({ kind: 'earnings-report', date: '2020-01-05' });
  assert.equal(missingInput.success, false);
  assert.match(missingInput.results[0].error, /no earnings-report input\.json/);

  const missingReport = await syncResearch({ kind: 'earnings-report', date: '2020-01-04' });
  assert.equal(missingReport.success, false);
  assert.match(missingReport.results[0].error, /no earnings-report report files/);

  await assert.rejects(
    syncResearch({ kind: 'earnings-report', date: 'not-a-date' }),
    /date must be YYYY-MM-DD/,
  );
});

test('earnings-report API exposes latest, history, detail, status, and downloads', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/research', researchRouter);
  const server = await listen(app);
  t.after(server.close);

  const historyResponse = await fetch(`${server.baseUrl}/api/research/earnings-report/history`);
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(await historyResponse.json(), {
    kind: 'earnings-report',
    dates: ['2020-01-03', '2020-01-02'],
  });

  const latestResponse = await fetch(`${server.baseUrl}/api/research/earnings-report/latest`);
  const latest = await latestResponse.json();
  assert.equal(latestResponse.status, 200);
  assert.equal(latest.date, '2020-01-03');
  assert.equal(latest.kind, 'earnings-report');

  const detailResponse = await fetch(`${server.baseUrl}/api/research/earnings-report/2020-01-02`);
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.topGood[0].title, '2020FY 年度报告');

  const syncResponse = await fetch(`${server.baseUrl}/api/research/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'earnings-report', days: 14 }),
  });
  const sync = await syncResponse.json();
  assert.equal(syncResponse.status, 200);
  assert.equal(sync.totals.attempted, 3);
  assert.deepEqual(sync.completed.map((item) => item.date).sort(), ['2020-01-02', '2020-01-03']);

  const invalidResponse = await fetch(`${server.baseUrl}/api/research/earnings-report/not-a-date`);
  assert.equal(invalidResponse.status, 400);

  const statusResponse = await fetch(`${server.baseUrl}/api/research/sync/status`);
  const status = await statusResponse.json();
  assert.equal(status['earnings-report'].root, sourceRoot);
  assert.equal(status['earnings-report'].exists, true);
  assert.deepEqual(Object.keys(status.completed['earnings-report']).sort(), ['2020-01-02', '2020-01-03']);

  const file = detail.files[0];
  const downloadResponse = await fetch(`${server.baseUrl}${file.url}`);
  assert.equal(downloadResponse.status, 200);
  assert.equal(await downloadResponse.text(), 'pdf fixture 2020-01-02');
});
