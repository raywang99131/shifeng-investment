import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getResearchSourceStatus, syncResearch } from '../lib/researchSync.js';
import {
  markResearchCompleted,
  markSyncResultCompletions,
  readCompletedState,
} from '../lib/researchCompletion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// 本地存储路径（Cloudflare 部署时换成 KV/R2）
const RESEARCH_DIR = process.env.RESEARCH_DATA_DIR || path.join(__dirname, '../data/research');
const REPORTS_DIR = process.env.RESEARCH_REPORTS_DIR || path.join(__dirname, '../public/reports');
const RESEARCH_KINDS = ['cninfo', 'earnings', 'earnings-report', 'risk'];

// 首次启动自动建目录
for (const dir of [RESEARCH_DIR, REPORTS_DIR, ...RESEARCH_KINDS.map((kind) => path.join(REPORTS_DIR, kind))]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * 数据契约
 *
 * ResearchSummary = {
 *   kind: 'cninfo' | 'earnings' | 'earnings-report' | 'risk',
 *   date: 'YYYY-MM-DD',
 *   reportDate: 'YYMMDD',
 *   generatedAt: ISO8601,
 *   coverage: string,                    // e.g. "2026-06-25 (周一)"
 *   totalCount: number,                  // 公告总数
 *   watchlistHits: number,               // 自选股命中数
 *   topGood: ResearchTopEntry[],         // 利好 TOP5
 *   topBad: ResearchTopEntry[],          // 利空 TOP5
 *   stats: { avgPct?, totalForecasts? },
 *   files: ResearchFile[],               // 可下载的 xlsx/pdf
 * }
 *
 * ResearchTopEntry = {
 *   rank: number,
 *   code: string,
 *   name: string,
 *   industry?: string,
 *   subset?: string,
 *   score: number,                       // cninfo: -10 ~ +10, earnings: 同比%
 *   title: string,
 *   summary?: string,
 * }
 *
 * ResearchFile = {
 *   filename: string,                    // e.g. "巨潮资讯-公告研判-260625.xlsx"
 *   type: 'xlsx' | 'pdf',
 *   size: number,                        // bytes
 *   url: string,                         // /api/research/files/cninfo/2026-06-25/xxx.xlsx
 * }
 */

function readSummary(kind, date) {
  const fp = path.join(RESEARCH_DIR, kind, `${date}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch (e) {
    console.error(`readSummary ${kind}/${date} failed:`, e.message);
    return null;
  }
}

function writeSummary(kind, date, data) {
  const dir = path.join(RESEARCH_DIR, kind);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${date}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
  return true;
}

function isResearchKind(kind) {
  return RESEARCH_KINDS.includes(kind);
}

function getShanghaiDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isResearchSummaryReady(summary) {
  if (!summary || typeof summary !== 'object') return false;
  if (Number(summary.totalCount) > 0 || Number(summary.watchlistHits) > 0) return true;

  const populatedLists = [
    summary.topGood,
    summary.topBad,
    summary.allGood,
    summary.allBad,
    summary.allItems,
  ];
  return populatedLists.some((items) => Array.isArray(items) && items.length > 0);
}

function isResearchDateReady(kind, date) {
  return isResearchSummaryReady(readSummary(kind, date));
}

function listDates(kind, { includeFuture = false } = {}) {
  const dir = path.join(RESEARCH_DIR, kind);
  if (!fs.existsSync(dir)) return [];
  const today = getShanghaiDateKey();
  const completed = readCompletedState()[kind] || {};
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .filter(date => isResearchDateReady(kind, date))
    .filter(date => includeFuture || date <= today || Boolean(completed[date]))
    .sort()
    .reverse();  // 最新的在前
}

function markReadySyncResultCompletions(syncResult, trigger) {
  const readyResults = (syncResult?.results || []).filter((result) => (
    result?.success
    && isResearchKind(result.kind)
    && isResearchDateReady(result.kind, result.date)
  ));
  return markSyncResultCompletions({ ...syncResult, results: readyResults }, trigger);
}

// ────────────────────────────────────────────────────────────
// GET /api/research/cninfo/latest  — 最新 cninfo 研判
// GET /api/research/cninfo/history — 日期列表
// GET /api/research/cninfo/:date   — 单日详情
// ────────────────────────────────────────────────────────────
router.get('/cninfo/latest', (req, res) => {
  const dates = listDates('cninfo');
  if (dates.length === 0) return res.json(null);
  const latest = readSummary('cninfo', dates[0]);
  res.json(latest);
});

router.get('/cninfo/history', (req, res) => {
  const dates = listDates('cninfo');
  res.json({ kind: 'cninfo', dates });
});

router.get('/cninfo/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' });
  }
  const data = readSummary('cninfo', date);
  if (!data) return res.status(404).json({ error: `No cninfo data for ${date}` });
  res.json(data);
});

// ────────────────────────────────────────────────────────────
// GET /api/research/earnings/latest
// GET /api/research/earnings/history
// GET /api/research/earnings/:date
// ────────────────────────────────────────────────────────────
router.get('/earnings/latest', (req, res) => {
  const dates = listDates('earnings');
  if (dates.length === 0) return res.json(null);
  const latest = readSummary('earnings', dates[0]);
  res.json(latest);
});

router.get('/earnings/history', (req, res) => {
  const dates = listDates('earnings');
  res.json({ kind: 'earnings', dates });
});

router.get('/earnings/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' });
  }
  const data = readSummary('earnings', date);
  if (!data) return res.status(404).json({ error: `No earnings data for ${date}` });
  res.json(data);
});

// ────────────────────────────────────────────────────────────
// GET /api/research/earnings-report/latest
// GET /api/research/earnings-report/history
// GET /api/research/earnings-report/:date
// ────────────────────────────────────────────────────────────
router.get('/earnings-report/latest', (req, res) => {
  const dates = listDates('earnings-report');
  if (dates.length === 0) return res.json(null);
  const latest = readSummary('earnings-report', dates[0]);
  res.json(latest);
});

router.get('/earnings-report/history', (req, res) => {
  const dates = listDates('earnings-report');
  res.json({ kind: 'earnings-report', dates });
});

router.get('/earnings-report/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' });
  }
  const data = readSummary('earnings-report', date);
  if (!data) return res.status(404).json({ error: `No earnings-report data for ${date}` });
  res.json(data);
});

// ────────────────────────────────────────────────────────────
// GET /api/research/risk/latest
// GET /api/research/risk/history
// GET /api/research/risk/:date
// ────────────────────────────────────────────────────────────
router.get('/risk/latest', (req, res) => {
  const dates = listDates('risk');
  if (dates.length === 0) return res.json(null);
  const latest = readSummary('risk', dates[0]);
  res.json(latest);
});

router.get('/risk/history', (req, res) => {
  const dates = listDates('risk');
  res.json({ kind: 'risk', dates });
});

router.get('/risk/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format, expected YYYY-MM-DD' });
  }
  const data = readSummary('risk', date);
  if (!data) return res.status(404).json({ error: `No risk data for ${date}` });
  res.json(data);
});

// ────────────────────────────────────────────────────────────
// POST /api/research/publish  — Mac 推送脚本调用
// body: { kind: 'cninfo' | 'earnings' | 'earnings-report' | 'risk', date: 'YYYY-MM-DD', summary: {...} }
// ────────────────────────────────────────────────────────────
router.post('/publish', (req, res) => {
  const { kind, date, summary } = req.body;
  if (!isResearchKind(kind)) {
    return res.status(400).json({ error: 'kind must be cninfo, earnings, earnings-report, or risk' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  if (!summary || typeof summary !== 'object') {
    return res.status(400).json({ error: 'summary required' });
  }
  const publishedSummary = { ...summary, kind, date };
  writeSummary(kind, date, publishedSummary);
  const completed = isResearchSummaryReady(publishedSummary) ? markResearchCompleted(kind, date, {
    trigger: 'publish',
    syncedAt: new Date().toISOString(),
    source: 'publish endpoint',
  }) : null;
  res.json({ success: true, kind, date, completed });
});

// ────────────────────────────────────────────────────────────
// POST /api/research/sync  — 从原始自动化产物同步到平台
// body: { kind?: 'cninfo' | 'earnings' | 'earnings-report' | 'risk' | 'all', date?: 'YYYY-MM-DD', days?: number, force?: boolean }
// ────────────────────────────────────────────────────────────
router.post('/sync', async (req, res) => {
  try {
    const result = await syncResearch(req.body || {});
    const completed = markReadySyncResultCompletions(result, 'manual-sync');
    result.completed = completed;
    res.status(result.success ? 200 : 207).json(result);
  } catch (e) {
    res.status(400).json({
      success: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/research/hook/completed  — 原始任务完成后通知平台同步
// body: { kind: 'cninfo' | 'earnings' | 'earnings-report' | 'risk', date: 'YYYY-MM-DD', force?: boolean }
// ────────────────────────────────────────────────────────────
router.post('/hook/completed', async (req, res) => {
  const { kind, date, force = false } = req.body || {};
  if (!isResearchKind(kind)) {
    return res.status(400).json({ success: false, error: 'kind must be cninfo, earnings, earnings-report, or risk' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ success: false, error: 'date must be YYYY-MM-DD' });
  }

  try {
    const sync = await syncResearch({ kind, date, force: Boolean(force) });
    const completed = markReadySyncResultCompletions(sync, 'completion-hook');
    const selected = sync.results?.find((result) => result.kind === kind && result.date === date);
    if (!selected?.success || !isResearchDateReady(kind, date)) {
      return res.status(422).json({
        success: false,
        kind,
        date,
        error: selected?.error || 'report is empty and is not ready to publish',
        sync,
      });
    }
    res.json({
      success: true,
      kind,
      date,
      completed: completed.find((item) => item.kind === kind && item.date === date) || null,
      sync,
    });
  } catch (e) {
    res.status(400).json({
      success: false,
      kind,
      date,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

router.get('/sync/status', (_req, res) => {
  res.json({
    ...getResearchSourceStatus(),
    completed: readCompletedState(),
  });
});

// ────────────────────────────────────────────────────────────
// GET /api/research/files/:kind/:date/:filename  — 文件下载
// ────────────────────────────────────────────────────────────
router.get('/files/:kind/:date/:filename', (req, res) => {
  const { kind, date, filename } = req.params;
  if (!isResearchKind(kind)) {
    return res.status(400).json({ error: 'Invalid kind' });
  }
  // 防止路径穿越攻击
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const fp = path.join(REPORTS_DIR, kind, date, filename);
  if (!fs.existsSync(fp)) {
    return res.status(404).json({ error: `File not found: ${kind}/${date}/${filename}` });
  }
  res.download(fp);
});

export default router;
