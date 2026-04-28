import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const NEWS_FILE = path.join(__dirname, 'data', 'news.json');

app.use(cors());
app.use(bodyParser.json());

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readNews() {
  try {
    if (fs.existsSync(NEWS_FILE)) {
      const data = fs.readFileSync(NEWS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading news:', error);
  }
  return { entries: [], lastUpdated: null };
}

function writeNews(data) {
  try {
    fs.writeFileSync(NEWS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error writing news:', error);
    return false;
  }
}

app.get('/api/news', (req, res) => {
  const data = readNews();
  res.json(data);
});

app.post('/api/news', (req, res) => {
  const { news, type } = req.body;

  if (!news || !Array.isArray(news)) {
    return res.status(400).json({ error: 'Invalid news data. Expected { news: [...] }' });
  }

  const currentData = readNews();
  const newEntry = {
    id: Date.now().toString(),
    type: type || 'morning',
    news: news,
    createdAt: new Date().toISOString(),
  };

  currentData.entries = currentData.entries || [];
  currentData.entries.unshift(newEntry);

  if (currentData.entries.length > 50) {
    currentData.entries = currentData.entries.slice(0, 50);
  }

  currentData.lastUpdated = new Date().toISOString();

  if (writeNews(currentData)) {
    res.json({ success: true, entry: newEntry });
  } else {
    res.status(500).json({ error: 'Failed to save news' });
  }
});

app.get('/api/news/latest', (req, res) => {
  const data = readNews();
  const entries = data.entries || [];
  const latest = entries[0] || null;
  res.json(latest);
});

app.delete('/api/news', (req, res) => {
  if (writeNews({ entries: [], lastUpdated: new Date().toISOString() })) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to clear news' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stock quote sync - calls Python quote service on port 3001
app.post('/api/sync', async (req, res) => {
  const { fundId, codes } = req.body;
  if (!codes || !Array.isArray(codes)) {
    return res.status(400).json({ success: false, error: 'codes required' });
  }
  try {
    const codesParam = codes.join(',');
    const response = await fetch(`http://localhost:3001/quotes/batch?codes=${codesParam}`);
    const data = await response.json();
    if (!data.success) {
      return res.json({ success: false, error: data.error || 'Quote service error' });
    }
    const prices = {};
    for (const q of data.quotes) {
      prices[q.code] = { currentPrice: q.close, pctChg: q.pct_chg, prevClose: q.pre_close };
    }
    res.json({ success: true, tradeDate: data.trade_date, prices });
  } catch (err) {
    res.json({ success: false, error: 'Failed to reach quote service' });
  }
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🏢 石锋资产投研平台 - API 服务已启动                    ║
║                                                          ║
║   API 地址: http://localhost:${PORT}                       ║
║                                                          ║
║   接口列表:                                              ║
║   • GET  /api/news        - 获取所有新闻                  ║
║   • GET  /api/news/latest - 获取最新新闻                  ║
║   • POST /api/news        - 添加新闻 { news: [...] }      ║
║   • DELETE/api/news       - 清空新闻                      ║
║   • GET  /api/health      - 健康检查                      ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});