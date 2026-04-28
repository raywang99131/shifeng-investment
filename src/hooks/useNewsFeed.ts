import { useState, useEffect, useCallback, useRef } from 'react';
import { message } from 'antd';

export interface NewsItem {
  category: string;
  title: string;
  source: string;
  time?: string;
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
  { category: 'AI', title: 'OpenAI发布GPT-5预览版，多项能力超越现有模型', source: 'OpenAI' },
  { category: 'AI', title: '国内首个千亿参数多模态大模型通过备案', source: '人工智能学会' },
  { category: '科技', title: '某头部互联网公司Q1财报超预期，营收同比增长15%', source: '公司公告' },
  { category: '科技', title: '半导体设备出口管制新规落地，影响几何？', source: '商务部' },
  { category: '加密货币', title: '比特币突破10万美元关口，机构持仓创历史新高', source: 'CoinMarketCap' },
  { category: '加密货币', title: '以太坊ETF净流入连续三周为正', source: 'Bloomberg' },
  { category: '美股', title: '纳指再创历史新高，科技板块领涨', source: 'Bloomberg' },
  { category: '美股', title: '美联储降息预期升温，美债收益率下行', source: 'Fed' },
  { category: '商品', title: '黄金突破2500美元/盎司，创历史新高', source: 'Wind' },
  { category: '商品', title: '原油需求预期下调，油价承压', source: 'IEA' },
  { category: '地缘政治', title: '中美经贸磋商进展积极，市场风险偏好回升', source: '新华社' },
  { category: '地缘政治', title: '中东局势有所缓和，原油供应预期改善', source: '路透' },
  { category: '互联网', title: '电商平台GMV增速边际回暖，直播电商渗透率提升', source: '艾瑞咨询' },
  { category: '互联网', title: '互联网广告市场Q1同比增长8%，复苏态势延续', source: 'QuestMobile' },
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

  const refresh = useCallback(() => {
    fetchNews(true);
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
