import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const NEWS_FILE = path.join(__dirname, 'data', 'news.json');
const FUNDS_FILE = path.join(__dirname, 'data', 'funds.json');

// fetch_all_news.py 输出的分类 → 前端分类映射
const CATEGORY_MAP = {
  '1_宏观': '宏观',
  '2_大宗商品': '大宗商品',
  '3_加密货币': '加密货币',
  '4_软件AI': '软件/AI大模型',
  '5_硬件': '硬件',
  '6_消费': '消费',
};

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../dist')));

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

// 调用 openclaw 的 fetch_all_news.py 采集真实新闻
app.post('/api/news/refresh', async (req, res) => {
  try {
    const scriptPath = os.homedir() + '/.openclaw/workspace/skills/wrx-news-daily/scripts/fetch_all_news.py';

    const result = await new Promise((resolve, reject) => {
      const proc = spawn('python3', [scriptPath, '--types', 'all', '--limit', '10']);

      let stdout = '';
      let stderr = '';

      // 2分钟超时
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('Script timed out after 120 seconds'));
      }, 120000);

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Script exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // 解析 JSON 输出（最后一行为有效JSON）
    const lines = result.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    const newsItems = JSON.parse(jsonLine);

    // 转换分类，并为没有URL的新闻生成搜索链接
    const transformedNews = newsItems.map(item => {
      let url = item.url || '';
      if (!url) {
        // 没有URL时，用必应搜索构造链接
        const query = encodeURIComponent(item.title);
        url = `https://www.bing.com/search?q=${query}`;
      }
      return {
        category: CATEGORY_MAP[item.category] || '消费',
        title: item.title,
        source: item.source,
        time: item.time || '',
        url,
      };
    });

    // 保存到 news.json
    const currentData = readNews();
    const newEntry = {
      id: Date.now().toString(),
      type: 'morning',
      news: transformedNews,
      createdAt: new Date().toISOString(),
    };

    currentData.entries = currentData.entries || [];
    currentData.entries.unshift(newEntry);
    if (currentData.entries.length > 50) {
      currentData.entries = currentData.entries.slice(0, 50);
    }
    currentData.lastUpdated = new Date().toISOString();
    writeNews(currentData);

    res.json({ success: true, entry: newEntry });
  } catch (err) {
    console.error('News refresh error:', err);
    res.status(500).json({ success: false, error: err.message });
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
    const QUOTE_BASE = process.env.QUOTE_SERVICE_URL || 'http://localhost:3001';
    const response = await fetch(`${QUOTE_BASE}/quotes/batch?codes=${codesParam}`);
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

// K-line historical data proxy
app.get('/api/kline', async (req, res) => {
  const { code, period, count } = req.query;
  if (!code) {
    return res.status(400).json({ success: false, error: 'code required' });
  }
  try {
    const response = await fetch(`${QUOTE_BASE}/kline?code=${code}&period=${period || 'daily'}&count=${count || '60'}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch kline' });
  }
});

// Funds portfolio persistence
function readFunds() {
  try {
    if (fs.existsSync(FUNDS_FILE)) {
      const data = fs.readFileSync(FUNDS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading funds:', error);
  }
  return { funds: [], lastUpdated: null };
}

function writeFunds(data) {
  try {
    fs.writeFileSync(FUNDS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error writing funds:', error);
    return false;
  }
}

// Funds API endpoints
app.get('/api/funds', (req, res) => {
  res.json(readFunds());
});

app.post('/api/funds', (req, res) => {
  const { funds } = req.body;
  if (!Array.isArray(funds)) {
    return res.status(400).json({ error: 'Invalid funds data. Expected { funds: [...] }' });
  }
  if (writeFunds({ funds, lastUpdated: new Date().toISOString() })) {
    res.json({ success: true });
  } else {
    res.status(500).json({ error: 'Failed to save funds' });
  }
});

// SPA fallback - only for non-API, non-file routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.includes('.')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../dist/index.html'));
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