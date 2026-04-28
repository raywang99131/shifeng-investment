import React, { useState, useEffect } from 'react';
import { Card, Tag, Space, Button, Spin, Empty, Typography, Divider, Alert } from 'antd';
import { ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTheme } from '../../hooks/useTheme';

const { Text } = Typography;

interface NewsItem {
  category: string;
  title: string;
  source: string;
  time?: string;
}

interface NewsEntry {
  id: string;
  type: string;
  news: NewsItem[];
  createdAt: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const NewsFeed: React.FC = () => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [latestNews, setLatestNews] = useState<NewsEntry | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchNews = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/news/latest`);
      const data = await response.json();
      if (data && data.news) {
        setLatestNews(data);
        setLastUpdated(data.createdAt);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '获取新闻失败，请稍后重试';
      setErrorMsg(msg);
      console.error('Failed to fetch news:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 60000);
    return () => clearInterval(interval);
  }, []);

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      '宏观': 'blue',
      'AI': 'purple',
      '科技': 'cyan',
      '加密货币': 'orange',
      '美股': 'green',
      '商品': 'red',
      '地缘政治': 'volcano',
      '互联网': 'geekblue',
    };
    return colors[category] || 'default';
  };

  return (
    <div>
      {errorMsg && (
        <Alert type="error" message={errorMsg} showIcon closable onClose={() => setErrorMsg(null)} style={{ marginBottom: 8 }} />
      )}
      <Card
        size="small"
        title={
          <Space>
            <span>📰 新闻简报</span>
            {lastUpdated && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                <ClockCircleOutlined /> {dayjs(lastUpdated).format('HH:mm')}
              </Text>
            )}
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchNews} loading={loading} size="small">
            刷新
          </Button>
        }
        style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
      >
        <Spin spinning={loading}>
          {latestNews && latestNews.news.length > 0 ? (
            <div>
              {(() => {
                const grouped: Record<string, NewsItem[]> = {};
                latestNews.news.forEach((item) => {
                  if (!grouped[item.category]) {
                    grouped[item.category] = [];
                  }
                  grouped[item.category].push(item);
                });

                return Object.entries(grouped).map(([category, items]) => (
                  <div key={category} style={{ marginBottom: 16 }}>
                    <Divider plain style={{ margin: '12px 0', fontSize: 13 }}>
                      <Tag color={getCategoryColor(category)}>{category}</Tag>
                    </Divider>
                    {items.map((item, index) => (
                      <div
                        key={index}
                        style={{
                          padding: '6px 8px',
                          borderRadius: 4,
                          marginBottom: 4,
                          background: theme === 'dark' ? '#262626' : '#fafafa',
                        }}
                      >
                        <Text style={{ color: theme === 'dark' ? '#fff' : '#333' }}>
                          {item.title}
                        </Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          来源: {item.source}
                        </Text>
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          ) : (
            <Empty description="暂无新闻数据" />
          )}
        </Spin>
      </Card>

      {latestNews && (
        <Card
          size="small"
          title="📋 纯文本格式（可复制发送）"
          style={{ marginTop: 16, background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
        >
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              background: theme === 'dark' ? '#141414' : '#f5f5f5',
              padding: 12,
              borderRadius: 4,
              color: theme === 'dark' ? '#fff' : '#333',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {`📰 新闻简报 - ${dayjs(latestNews.createdAt).format('YYYY年MM月DD日 HH:mm')}

${latestNews.news.map((item) => `• ${item.title} (${item.source})`).join('\n')}`}
          </pre>
        </Card>
      )}
    </div>
  );
};

export default NewsFeed;