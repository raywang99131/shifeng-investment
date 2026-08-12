import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const RESEARCH_DIR = process.env.RESEARCH_DATA_DIR || path.join(SERVER_DIR, 'data/research');
const COMPLETED_FILE = process.env.RESEARCH_COMPLETED_FILE || path.join(RESEARCH_DIR, 'completed.json');

function defaultState() {
  return { cninfo: {}, earnings: {}, 'earnings-report': {}, risk: {} };
}

export function readCompletedState() {
  if (!fs.existsSync(COMPLETED_FILE)) return defaultState();
  try {
    const data = JSON.parse(fs.readFileSync(COMPLETED_FILE, 'utf-8'));
    return {
      cninfo: data?.cninfo && typeof data.cninfo === 'object' ? data.cninfo : {},
      earnings: data?.earnings && typeof data.earnings === 'object' ? data.earnings : {},
      'earnings-report': data?.['earnings-report'] && typeof data['earnings-report'] === 'object'
        ? data['earnings-report']
        : {},
      risk: data?.risk && typeof data.risk === 'object' ? data.risk : {},
    };
  } catch (error) {
    console.error('read completed research state failed:', error.message);
    return defaultState();
  }
}

function writeCompletedState(data) {
  fs.mkdirSync(path.dirname(COMPLETED_FILE), { recursive: true });
  fs.writeFileSync(COMPLETED_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function markResearchCompleted(kind, date, meta = {}) {
  const state = readCompletedState();
  state[kind][date] = {
    ...(state[kind][date] || {}),
    ...meta,
    kind,
    date,
    completedAt: meta.completedAt || new Date().toISOString(),
  };
  writeCompletedState(state);
  return state[kind][date];
}

export function markSyncResultCompletions(syncResult, trigger) {
  const marked = [];
  for (const result of syncResult?.results || []) {
    if (!result?.success || !['cninfo', 'earnings', 'earnings-report', 'risk'].includes(result.kind)) continue;
    marked.push(markResearchCompleted(result.kind, result.date, {
      trigger,
      syncedAt: syncResult.generatedAt || new Date().toISOString(),
      filesCopied: result.filesCopied || 0,
      filesSkipped: result.filesSkipped || 0,
    }));
  }
  return marked;
}
