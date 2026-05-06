import React, { useState, useMemo } from 'react';
import { Card, Row, Col, Tag, Space, Button, Spin, Empty, Typography, Input, Badge } from 'antd';
import { ReloadOutlined, AlertOutlined, CheckCircleOutlined, SearchOutlined, SoundOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTheme } from '../../hooks/useTheme';
import { useNewsFeed, type NewsItem } from '../../hooks/useNewsFeed';

const { Text } = Typography;

// 参考 wrx-news-daily skill 的分类体系
const CATEGORY_ORDER = ['宏观', '大宗商品', '加密货币', '软件/AI大模型', '硬件', '消费'] as const;
type CategoryType = typeof CATEGORY_ORDER[number];

const CATEGORY_EMOJI: Record<CategoryType, string> = {
  '宏观': '1️⃣',
  '大宗商品': '2️⃣',
  '加密货币': '3️⃣',
  '软件/AI大模型': '4️⃣',
  '硬件': '5️⃣',
  '消费': '6️⃣',
};

const CATEGORY_COLORS: Record<string, string> = {
  '宏观': 'blue',
  '大宗商品': 'orange',
  '加密货币': 'gold',
  '软件/AI大模型': 'purple',
  '硬件': 'cyan',
  '消费': 'pink',
};

// API分类映射到标准分类
const CATEGORY_MAP: Record<string, CategoryType> = {
  '宏观': '宏观',
  '大宗商品': '大宗商品',
  '加密货币': '加密货币',
  '软件/AI大模型': '软件/AI大模型',
  '硬件': '硬件',
  '消费': '消费',
  // 兼容旧分类
  'AI': '软件/AI大模型',
  '科技': '软件/AI大模型',
  '美股': '宏观',
  '商品': '大宗商品',
  '地缘政治': '宏观',
  '互联网': '消费',
  '港股': '宏观',
  'A股': '宏观',
  '欧股': '宏观',
  '医药': '消费',
  '其他': '消费',
};

const NewsRow: React.FC<{
  item: NewsItem;
  theme: string;
  isNew?: boolean;
  index: number;
}> = ({ item, theme, isNew }) => {
  const [expanded, setExpanded] = useState(false);
  const formatTime = (t: string) => {
    if (!t || !t.trim()) return '--';
    // 如果是 HH:mm 格式直接返回
    if (/^\d{2}:\d{2}$/.test(t)) return t;
    // 如果是"XX分钟前"格式，显示"X分钟前"
    if (t.includes('分钟')) return t;
    // 如果是"Real-time"或其他，直接返回
    return t;
  };
  const timeStr = formatTime(item.time || '');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        padding: '8px 12px',
        borderBottom: '1px solid ' + (theme === 'dark' ? '#2a2a2a' : '#f0f0f0'),
        background: isNew ? (theme === 'dark' ? '#1a2a1a' : '#f6ffed') : 'transparent',
        transition: 'background 0.3s',
      }}
      onClick={() => {
        if (!item.url) setExpanded(!expanded);
      }}
    >
      {/* 时间戳 */}
      <Text
        type="secondary"
        style={{
          fontSize: 12,
          minWidth: 48,
          marginRight: 8,
          color: theme === 'dark' ? '#777' : '#999',
          fontFamily: 'monospace',
        }}
      >
        {timeStr}
      </Text>

      {/* 标题 */}
      <div style={{ flex: 1 }}>
        <Text
          style={{
            color: item.url ? (theme === 'dark' ? '#177ddc' : '#1677ff') : (theme === 'dark' ? '#e8e8e8' : '#333'),
            fontSize: 13,
            cursor: item.url ? 'pointer' : 'default',
            textDecoration: 'none',
          }}
          onClick={() => {
            if (item.url) {
              window.open(item.url, '_blank', 'noopener,noreferrer');
            }
          }}
        >
          {item.title}
        </Text>
        <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {item.source}
        </Text>
      </div>

      {/* 新消息标记 */}
      {isNew && (
        <Badge color="green" style={{ marginLeft: 8 }}>
          <SoundOutlined style={{ color: '#52c41a', fontSize: 11 }} />
        </Badge>
      )}
    </div>
  );
};

const NewsPanel: React.FC = () => {
  const { theme } = useTheme();
  const { news, lastUpdated, loading, apiStatus, isMockData, refresh } = useNewsFeed();
  const [searchText, setSearchText] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [showNewOnly] = useState(false);

  // 上次刷新时间，用于判断"新"新闻
  const prevNewsRef = React.useRef<Set<string>>(new Set());
  const [newNewsIds, setNewNewsIds] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    const currentIds = new Set(news.map(n => n.title));
    const newIds = new Set<string>();
    currentIds.forEach(id => {
      if (!prevNewsRef.current.has(id)) {
        newIds.add(id);
      }
    });
    setNewNewsIds(newIds);
    prevNewsRef.current = currentIds;
  }, [news]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // 按 news daily skill 的分类顺序分组
  const grouped = useMemo(() => {
    const result: Partial<Record<CategoryType, NewsItem[]>> = {};
    for (const cat of CATEGORY_ORDER) {
      result[cat] = [];
    }
    news.forEach(item => {
      const mappedCat = CATEGORY_MAP[item.category] || '消费';
      if (result[mappedCat]) {
        result[mappedCat]!.push(item);
      }
    });
    return result;
  }, [news]);

  // 过滤后的分组
  const filteredGrouped = useMemo(() => {
    const filtered: Partial<Record<CategoryType, NewsItem[]>> = {};
    for (const cat of CATEGORY_ORDER) {
      const items = (grouped[cat] || []).filter(item => {
        if (selectedCategories.size > 0 && !selectedCategories.has(cat)) return false;
        if (searchText && !item.title.toLowerCase().includes(searchText.toLowerCase())) return false;
        if (showNewOnly && !newNewsIds.has(item.title)) return false;
        return true;
      });
      if (items.length > 0) filtered[cat] = items;
    }
    return filtered;
  }, [grouped, selectedCategories, searchText, showNewOnly, newNewsIds]);

  const stats = useMemo(() => {
    const total = news.length;
    const categoryCount: Record<string, number> = {};
    news.forEach(item => {
      const mappedCat = CATEGORY_MAP[item.category] || '消费';
      categoryCount[mappedCat] = (categoryCount[mappedCat] || 0) + 1;
    });
    return { total, categoryCount };
  }, [news]);

  return (
    <div>
      {/* 状态栏 */}
      <Card
        size="small"
        style={{
          marginBottom: 12,
          background: apiStatus === 'offline'
            ? (theme === 'dark' ? '#2a1a1a' : '#fff2f0')
            : (theme === 'dark' ? '#1f1f1f' : '#fff'),
          borderColor: apiStatus === 'offline' ? '#ffccc7' : 'transparent',
        }}
      >
        <Row justify="space-between" align="middle">
          <Col>
            <Space>
              {apiStatus === 'offline' ? (
                <>
                  <AlertOutlined style={{ color: '#ff4d4f' }} />
                  <Text strong style={{ color: '#ff4d4f' }}>离线模式</Text>
                </>
              ) : (
                <>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  <Text style={{ color: '#52c41a' }}>实时推送</Text>
                </>
              )}
              {isMockData && <Tag color="orange">模拟数据</Tag>}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {lastUpdated ? `更新于 ${dayjs(lastUpdated).format('HH:mm:ss')}` : '等待更新...'}
              </Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {stats.total} 条
              </Text>
              <Button
                icon={<ReloadOutlined />}
                onClick={refresh}
                loading={loading}
                size="small"
              >
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={12}>
        {/* 左侧：新闻列表 */}
        <Col span={16}>
          <Card
            size="small"
            title={
              <Space>
                <span style={{ fontSize: 16 }}>📰</span>
                <span>新闻简报</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 'normal' }}>
                  {dayjs().format('YYYY年MM月DD日')} {dayjs().format('dddd')}
                </Text>
                {newNewsIds.size > 0 && (
                  <Badge count={newNewsIds.size} size="small">
                    <Tag color="green" style={{ margin: 0 }}>新</Tag>
                  </Badge>
                )}
              </Space>
            }
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
            styles={{ body: { padding: 0, maxHeight: 560, overflow: 'auto' } }}
          >
            <Spin spinning={loading && news.length === 0}>
              {Object.keys(filteredGrouped).length > 0 ? (
                Object.entries(filteredGrouped).map(([category, items]) => {
                  const cat = category as CategoryType;
                  return (
                    <div key={category}>
                      {/* 分组标题栏 */}
                      <div
                        style={{
                          padding: '10px 16px 6px',
                          background: theme === 'dark' ? '#141414' : '#fafafa',
                          borderBottom: '1px solid ' + (theme === 'dark' ? '#303030' : '#f0f0f0'),
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <Tag color={CATEGORY_COLORS[category]} style={{ marginRight: 8 }}>
                          {CATEGORY_EMOJI[cat]} {category}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {items.length} 条
                        </Text>
                      </div>
                      {items.map((item, index) => (
                        <NewsRow
                          key={`${category}-${index}`}
                          item={item}
                          index={index}
                          theme={theme}
                          isNew={newNewsIds.has(item.title)}
                        />
                      ))}
                    </div>
                  );
                })
              ) : (
                <Empty
                  description={searchText ? '未找到匹配的新闻' : '暂无新闻数据'}
                  style={{ padding: 60 }}
                />
              )}
            </Spin>
          </Card>
        </Col>

        {/* 右侧：分类筛选 + 搜索 */}
        <Col span={8}>
          <Card
            size="small"
            title="🔍 分类筛选"
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', marginBottom: 12 }}
          >
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索关键词..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ marginBottom: 12 }}
              allowClear
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CATEGORY_ORDER.map(cat => (
                <Tag
                  key={cat}
                  color={selectedCategories.has(cat) ? CATEGORY_COLORS[cat] : 'default'}
                  style={{ cursor: 'pointer', margin: 0 }}
                  onClick={() => toggleCategory(cat)}
                >
                  {cat} {stats.categoryCount[cat] || 0}
                </Tag>
              ))}
            </div>
          </Card>

          {/* 快捷分类 */}
          <Card
            size="small"
            title="⚡ 快捷筛选"
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
          >
            <Space wrap>
              <Button
                size="small"
                type={selectedCategories.size === 0 ? 'primary' : 'default'}
                onClick={() => setSelectedCategories(new Set())}
              >
                全部
              </Button>
              {CATEGORY_ORDER.map(cat => (
                <Button
                  key={cat}
                  size="small"
                  type={selectedCategories.has(cat) ? 'primary' : 'default'}
                  onClick={() => setSelectedCategories(new Set([cat]))}
                >
                  {cat}
                </Button>
              ))}
            </Space>
          </Card>

          {/* 新闻来源说明 */}
          <Card
            size="small"
            title="📡 新闻来源"
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', marginTop: 12 }}
          >
            <div style={{ fontSize: 11, color: theme === 'dark' ? '#888' : '#999', lineHeight: 1.8 }}>
              <div>财联社 · 华尔街见闻</div>
              <div>36氪 · 腾讯新闻</div>
              <div>Hacker News · CoinDesk</div>
              <div>Binance · 微博热点</div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default NewsPanel;
