import React, { useState } from 'react';
import { Card, Row, Col, Tag, Space, Button, Spin, Empty, Typography, Divider, message } from 'antd';
import { ReloadOutlined, ClockCircleOutlined, AlertOutlined, CheckCircleOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { useTheme } from '../../hooks/useTheme';
import { useNewsFeed, type NewsItem } from '../../hooks/useNewsFeed';

const { Text } = Typography;

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

const copyToClipboard = (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败');
    });
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) {
      message.success('已复制到剪贴板');
    } else {
      message.error('复制失败');
    }
  }
};

const NewsPanel: React.FC = () => {
  const { theme } = useTheme();
  const { news, lastUpdated, loading, apiStatus, isMockData, refresh } = useNewsFeed();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const grouped = news.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, NewsItem[]>);

  const categoryStats = news.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieChartOption = {
    backgroundColor: 'transparent',
    title: {
      text: '新闻分类分布',
      left: 'center',
      textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 },
    },
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: theme === 'dark' ? '#141414' : '#fff', borderWidth: 2 },
      label: { color: theme === 'dark' ? '#fff' : '#333' },
      data: Object.entries(categoryStats).map(([name, value]) => ({ name, value })),
    }],
  };

  return (
    <div>
      {apiStatus === 'offline' && !isMockData && (
        <Card size="small" style={{ marginBottom: 16, background: theme === 'dark' ? '#2a1a1a' : '#fff2f0', borderColor: '#ffccc7' }}>
          <Space>
            <AlertOutlined style={{ color: '#ff4d4f' }} />
            <Text strong style={{ color: '#ff4d4f' }}>API 服务未连接</Text>
            <Text type="secondary">请确保后端服务已启动: npm run server</Text>
            <Button size="small" onClick={refresh}>重试</Button>
          </Space>
        </Card>
      )}

      {apiStatus === 'online' && (
        <Card size="small" style={{ marginBottom: 16, background: theme === 'dark' ? '#1a2a1a' : '#f6ffed', borderColor: '#b7eb8f' }}>
          <Space>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <Text strong style={{ color: '#52c41a' }}>API 服务已连接</Text>
            <Text type="secondary">上次更新: {lastUpdated ? dayjs(lastUpdated).format('HH:mm:ss') : '从未'}</Text>
          </Space>
        </Card>
      )}

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card
            size="small"
            title="📰 最新简报"
            extra={
              <Space>
                {isMockData && (
                  <Tag color="orange" style={{ marginRight: 8 }}>离线模式</Tag>
                )}
                <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading} size="small">
                  刷新
                </Button>
              </Space>
            }
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', minHeight: 400 }}
          >
            <Spin spinning={loading}>
              {news.length > 0 ? (
                <div>
                  <Text type="secondary" style={{ marginBottom: 16, display: 'block' }}>
                    <ClockCircleOutlined /> {lastUpdated ? dayjs(lastUpdated).format('YYYY年MM月DD日 HH:mm:ss') : '-'}
                  </Text>
                  {Object.entries(grouped).map(([category, items]) => (
                    <div key={category} style={{ marginBottom: 12 }}>
                      <Divider style={{ margin: '8px 0', fontSize: 13 }}>
                        <Tag color={getCategoryColor(category)}>{category}</Tag>
                        <Button
                          type="text"
                          size="small"
                          onClick={() => toggleCategory(category)}
                          style={{ marginLeft: 8 }}
                        >
                          {collapsedCategories.has(category) ? '展开' : '折叠'}
                        </Button>
                      </Divider>
                      {collapsedCategories.has(category) ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>已折叠 {items.length} 条</Text>
                      ) : (
                        items.map((item, index) => (
                          <div
                            key={index}
                            style={{
                              padding: '8px 12px',
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
                        ))
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="暂无新闻数据，点击刷新按钮获取最新内容" />
              )}
            </Spin>
          </Card>
        </Col>
        <Col span={12}>
          <Card
            size="small"
            title="📊 分类统计"
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 400 }}
          >
            {news.length > 0 ? (
              <ReactECharts option={pieChartOption} style={{ height: 320 }} />
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>

      {news.length > 0 && (
        <Card
          size="small"
          title="📋 纯文本格式（可复制发送给同事）"
          style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
        >
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              background: theme === 'dark' ? '#141414' : '#f5f5f5',
              padding: 16,
              borderRadius: 4,
              color: theme === 'dark' ? '#fff' : '#333',
              maxHeight: 300,
              overflow: 'auto',
            }}
          >
            {`📰 新闻简报 - ${lastUpdated ? dayjs(lastUpdated).format('YYYY年MM月DD日 HH:mm') : '未知时间'}

${news.map((item, index) => `${index + 1}. [${item.category}] ${item.title} (${item.source})`).join('\n')}`}
          </pre>
          <Button
            type="link"
            onClick={() => {
              const text = `📰 新闻简报 - ${lastUpdated ? dayjs(lastUpdated).format('YYYY年MM月DD日 HH:mm') : '未知时间'}\n\n${news.map((item, index) => `${index + 1}. [${item.category}] ${item.title} (${item.source})`).join('\n')}`;
              copyToClipboard(text);
            }}
          >
            复制到剪贴板
          </Button>
        </Card>
      )}
    </div>
  );
};

export default NewsPanel;
