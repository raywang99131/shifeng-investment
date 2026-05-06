import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';

export interface NewsItem {
  category: string;
  title: string;
  source: string;
  time?: string;
  url?: string;
}

export interface NewsEntry {
  id: string;
  type: string;
  news: NewsItem[];
  createdAt: string;
}

interface UseNewsFeedReturn {
  news: NewsItem[];
  lastUpdated: string | null;
  loading: boolean;
  apiStatus: 'checking' | 'online' | 'offline';
  error: string | null;
  isMockData: boolean;
  refresh: () => void;
}

const MOCK_NEWS: NewsItem[] = [
  { category: '宏观', title: '央行开展逆回购操作，维护流动性合理充裕', source: 'Wind' },
  { category: '宏观', title: '3月CPI同比上涨0.2%，PPI环比下降0.1%', source: '国家统计局' },
  { category: '宏观', title: '美联储降息预期升温，美债收益率下行', source: 'Fed' },
  { category: '宏观', title: '中美经贸磋商进展积极，市场风险偏好回升', source: '新华社' },
  { category: '宏观', title: '3月出口超预期，贸易顺差扩大', source: '海关总署' },
  { category: '大宗商品', title: '黄金突破2500美元/盎司，创历史新高', source: 'Wind' },
  { category: '大宗商品', title: '原油需求预期下调，油价承压', source: 'IEA' },
  { category: '大宗商品', title: '中东局势有所缓和，原油供应预期改善', source: '路透' },
  { category: '大宗商品', title: '铜价持续走高，矿业股受益', source: 'Bloomberg' },
  { category: '大宗商品', title: '钨精矿价格创年内新高', source: '亚洲金属网' },
  { category: '加密货币', title: '比特币突破10万美元关口，机构持仓创历史新高', source: 'CoinMarketCap' },
  { category: '加密货币', title: '以太坊ETF净流入连续三周为正', source: 'Bloomberg' },
  { category: '加密货币', title: 'Circle推出新稳定币合规框架', source: 'CoinDesk' },
  { category: '加密货币', title: 'Binance现货交易量环比增长23%', source: 'Binance' },
  { category: '加密货币', title: 'CRCL代币暴涨引发社区热议', source: 'CoinMarketCap' },
  { category: '软件/AI大模型', title: 'OpenAI发布GPT-5预览版，多项能力超越现有模型', source: 'OpenAI' },
  { category: '软件/AI大模型', title: '国内首个千亿参数多模态大模型通过备案', source: '人工智能学会' },
  { category: '软件/AI大模型', title: '腾讯云宣布云计算产品涨价', source: '腾讯云' },
  { category: '软件/AI大模型', title: '微软Azure AI服务新增多模态能力', source: 'Microsoft' },
  { category: '软件/AI大模型', title: 'Anthropic发布Claude 4，性能大幅提升', source: 'Anthropic' },
  { category: '硬件', title: '英伟达GB200芯片开始规模化交付', source: 'NVDA' },
  { category: '硬件', title: 'BroadcomAI芯片需求超预期', source: 'AVGO' },
  { category: '硬件', title: 'Groq发布新一代LPU推理芯片', source: 'Groq' },
  { category: '硬件', title: '台积电3nm产能利用率持续攀升', source: '台积电' },
  { category: '硬件', title: '三星HBM4通过客户认证', source: '三星' },
  { category: '消费', title: '泡泡玛特海外营收占比首超40%', source: 'PPMT' },
  { category: '消费', title: '电商平台GMV增速边际回暖，直播电商渗透率提升', source: '艾瑞咨询' },
  { category: '消费', title: '互联网广告市场Q1同比增长8%，复苏态势延续', source: 'QuestMobile' },
  { category: '消费', title: '某头部互联网公司Q1财报超预期，营收同比增长15%', source: '公司公告' },
  { category: '消费', title: '游戏版号发放加速，龙头公司受益', source: '国家新闻出版署' },
];

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const POLL_INTERVAL = 60000;
const MAX_CONSECUTIVE_FAILURES = 3;

export function useNewsFeed(): UseNewsFeedReturn {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [isMockData, setIsMockData] = useState(false);

  const consecutiveFailures = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkApiStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/health`);
      if (response.ok) {
        setApiStatus('online');
        consecutiveFailures.current = 0;
        return true;
      }
      setApiStatus('offline');
      return false;
    } catch {
      setApiStatus('offline');
      return false;
    }
  }, []);

  const fetchNews = useCallback(async (showOfflineAlert = false) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/news/latest`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: NewsEntry = await response.json();
      if (data && data.news && data.news.length > 0) {
        setNews(data.news);
        setLastUpdated(data.createdAt);
        setIsMockData(false);
      } else {
        // API 返回空数据，使用 mock
        setNews(MOCK_NEWS);
        setLastUpdated(new Date().toISOString());
        setIsMockData(true);
      }
      consecutiveFailures.current = 0;
    } catch (err) {
      consecutiveFailures.current += 1;
      const msg = err instanceof Error ? err.message : '获取新闻失败';

      // 连续失败后使用 mock 数据
      if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES) {
        setNews(MOCK_NEWS);
        setLastUpdated(new Date().toISOString());
        setIsMockData(true);
        setApiStatus('offline');
        if (showOfflineAlert) {
          message.warning('后端服务不可用，显示离线数据');
        }
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 先调用采集脚本获取最新新闻
      await fetch(`${API_BASE}/api/news/refresh`, { method: 'POST' });
    } catch (err) {
      console.error('Refresh error:', err);
    }
    // 再获取最新数据
    await fetchNews(true);
  }, [fetchNews]);

  // 初始加载 + 轮询
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      if (!mounted) return;
      const online = await checkApiStatus();
      if (!mounted) return;
      if (online) {
        await fetchNews(false);
      } else {
        setNews(MOCK_NEWS);
        setLastUpdated(new Date().toISOString());
        setIsMockData(true);
      }
    };

    init();

    intervalRef.current = setInterval(async () => {
      if (!mounted) return;
      const online = await checkApiStatus();
      if (!mounted) return;
      if (online) {
        await fetchNews(false);
      } else {
        consecutiveFailures.current += 1;
        if (consecutiveFailures.current >= MAX_CONSECUTIVE_FAILURES) {
          if (news.length === 0) {
            setNews(MOCK_NEWS);
            setLastUpdated(new Date().toISOString());
            setIsMockData(true);
          }
        }
      }
    }, POLL_INTERVAL);

    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkApiStatus, fetchNews, news.length]);

  return {
    news,
    lastUpdated,
    loading,
    apiStatus,
    error,
    isMockData,
    refresh,
  };
}
