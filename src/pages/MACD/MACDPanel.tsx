import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, Button, Tag, Space, Typography, Card, message, Row, Col, Statistic, Segmented, Input, Select, Empty } from 'antd';
import { AimOutlined, ReloadOutlined, SearchOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../hooks/useTheme';

const { Title, Text } = Typography;

type SignalLevel = '强信号' | '拐点观察' | '趋势延续' | '趋势跟踪' | '转弱风险' | '无信号';
type ViewMode = 'candidate' | 'strong' | 'turn' | 'risk' | 'all';

interface MACDRow {
  股票代码: string;
  股票名称: string;
  现价?: number;
  涨幅?: string;
  涨幅数值?: number;
  换手?: string;
  成交额?: string;
  所属行业?: string;
  日K_DIF: number;
  日K_DEA: number;
  日K_MACD: number;
  日K_MACD_上一期?: number;
  M15_DIF: number;
  M15_DEA: number;
  M15_MACD: number;
  M15_MACD_上一期?: number;
  信号等级?: SignalLevel;
  信号分?: number;
  信号标签?: string[];
  是否候选?: boolean;
  日线状态?: string;
  分钟状态?: string;
  日线拐点?: boolean;
  十五分钟确认?: boolean;
  红柱扩张?: boolean;
  标准化强度?: number;
  观察理由?: string;
}

interface MacdApiResponse {
  success: boolean;
  data: MACDRow[];
  generatedAt?: string;
  cached?: boolean;
  error?: string;
}

const UP_COLOR = '#ff4d4f';
const DOWN_COLOR = '#52c41a';

const levelColor: Record<SignalLevel, string> = {
  强信号: 'red',
  拐点观察: 'volcano',
  趋势延续: 'gold',
  趋势跟踪: 'blue',
  转弱风险: 'green',
  无信号: 'default',
};

const formatNumber = (value?: number, digits = 4) => (
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-'
);

const formatSigned = (value?: number, digits = 4) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
};

const displayCode = (code: string) => code.replace(/^(sh|sz)/, '');
const routeCode = (code: string) => displayCode(code);

const valueColor = (value?: number) => {
  if (typeof value !== 'number') return undefined;
  if (value > 0) return UP_COLOR;
  if (value < 0) return DOWN_COLOR;
  return undefined;
};

const MACDPanel: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [data, setData] = useState<MACDRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [view, setView] = useState<ViewMode>('candidate');
  const [keyword, setKeyword] = useState('');
  const [industry, setIndustry] = useState<string | undefined>();

  const fetchMACD = useCallback(async (forceRefresh = false, notify = true) => {
    setLoading(true);
    try {
      const res = await fetch(forceRefresh ? '/api/macd?refresh=1' : '/api/macd');
      const json = await res.json() as MacdApiResponse;
      if (json.success) {
        setData(json.data || []);
        setLastUpdated(json.generatedAt ? new Date(json.generatedAt).toLocaleString() : new Date().toLocaleString());
        if (notify) {
          message.success(`${forceRefresh ? '刷新' : '加载'}成功，共 ${json.data?.length || 0} 只${json.cached ? '（缓存）' : ''}`);
        }
      } else {
        message.error(json.error || '获取数据失败');
      }
    } catch {
      message.error('网络错误，请检查服务器');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMACD(false, false);
  }, [fetchMACD]);

  const summary = useMemo(() => {
    const strong = data.filter((row) => row.信号等级 === '强信号').length;
    const turn = data.filter((row) => row.信号等级 === '拐点观察').length;
    const trend = data.filter((row) => row.信号等级 === '趋势延续').length;
    const candidate = data.filter((row) => row.是否候选).length;
    const risk = data.filter((row) => row.信号等级 === '转弱风险').length;
    return { strong, turn, trend, candidate, risk, total: data.length };
  }, [data]);

  const industryOptions = useMemo(() => (
    Array.from(new Set(data.map((row) => row.所属行业).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
      .map((item) => ({ label: item, value: item }))
  ), [data]);

  const filteredData = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return data.filter((row) => {
      if (view === 'candidate' && !row.是否候选) return false;
      if (view === 'strong' && row.信号等级 !== '强信号') return false;
      if (view === 'turn' && row.信号等级 !== '拐点观察') return false;
      if (view === 'risk' && row.信号等级 !== '转弱风险') return false;
      if (industry && row.所属行业 !== industry) return false;
      if (!text) return true;
      return (
        row.股票代码.toLowerCase().includes(text) ||
        displayCode(row.股票代码).includes(text) ||
        row.股票名称.toLowerCase().includes(text) ||
        (row.所属行业 || '').toLowerCase().includes(text)
      );
    });
  }, [data, view, industry, keyword]);

  const statCardStyle: React.CSSProperties = {
    borderRadius: 8,
    border: theme === 'dark' ? '1px solid #303030' : '1px solid #f0f0f0',
    background: theme === 'dark' ? '#1f1f1f' : '#ffffff',
  };

  const columns = [
    {
      title: '股票',
      dataIndex: '股票代码',
      key: 'stock',
      fixed: 'left' as const,
      width: 190,
      render: (_: string, row: MACDRow) => (
        <Space orientation="vertical" size={2}>
          <Space size={6}>
            <Tag color="blue" style={{ margin: 0 }}>{displayCode(row.股票代码)}</Tag>
            <Text strong>{row.股票名称}</Text>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.所属行业 || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '信号',
      dataIndex: '信号分',
      key: 'signal',
      width: 260,
      sorter: (a: MACDRow, b: MACDRow) => (a.信号分 || 0) - (b.信号分 || 0),
      defaultSortOrder: 'descend' as const,
      render: (_: number, row: MACDRow) => {
        const level = row.信号等级 || '无信号';
        return (
          <Space orientation="vertical" size={4} style={{ width: '100%' }}>
            <Space size={8}>
              <Tag color={levelColor[level]} style={{ margin: 0 }}>{level}</Tag>
              <Text strong style={{ color: level === '转弱风险' ? DOWN_COLOR : UP_COLOR }}>
                {formatNumber(row.信号分, 1)}
              </Text>
            </Space>
            <Space size={[4, 4]} wrap>
              {(row.信号标签 || []).slice(0, 4).map((tag) => (
                <Tag key={tag} color="default" style={{ margin: 0 }}>{tag}</Tag>
              ))}
            </Space>
          </Space>
        );
      },
    },
    {
      title: '交易特征',
      key: 'trade',
      width: 150,
      render: (_: unknown, row: MACDRow) => (
        <Space orientation="vertical" size={2}>
          <Text>现价 {formatNumber(row.现价, 2)}</Text>
          <Text style={{ color: valueColor(row.涨幅数值), fontWeight: 600 }}>
            涨幅 {row.涨幅 || (typeof row.涨幅数值 === 'number' ? `${formatSigned(row.涨幅数值, 2)}%` : '-')}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>换手 {row.换手 || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '日线',
      key: 'daily',
      width: 190,
      sorter: (a: MACDRow, b: MACDRow) => (a.日K_MACD || 0) - (b.日K_MACD || 0),
      render: (_: unknown, row: MACDRow) => (
        <Space orientation="vertical" size={2}>
          <Space size={6}>
            <Tag color={row.日线状态 === '多头' ? 'red' : 'green'} style={{ margin: 0 }}>{row.日线状态 || '-'}</Tag>
            {row.日线拐点 && <Tag color="volcano" style={{ margin: 0 }}>拐点</Tag>}
          </Space>
          <Text style={{ color: valueColor(row.日K_MACD), fontWeight: 600 }}>MACD {formatSigned(row.日K_MACD)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>DIF {formatNumber(row.日K_DIF)} / DEA {formatNumber(row.日K_DEA)}</Text>
        </Space>
      ),
    },
    {
      title: '15M',
      key: 'm15',
      width: 180,
      sorter: (a: MACDRow, b: MACDRow) => (a.M15_MACD || 0) - (b.M15_MACD || 0),
      render: (_: unknown, row: MACDRow) => (
        <Space orientation="vertical" size={2}>
          <Tag color={row.十五分钟确认 ? 'red' : 'default'} style={{ margin: 0 }}>{row.分钟状态 || '-'}</Tag>
          <Text style={{ color: valueColor(row.M15_MACD), fontWeight: 600 }}>MACD {formatSigned(row.M15_MACD)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>DIF {formatNumber(row.M15_DIF)} / DEA {formatNumber(row.M15_DEA)}</Text>
        </Space>
      ),
    },
    {
      title: '强度',
      dataIndex: '标准化强度',
      key: 'strength',
      width: 110,
      sorter: (a: MACDRow, b: MACDRow) => (a.标准化强度 || 0) - (b.标准化强度 || 0),
      render: (value: number) => (
        <Text style={{ color: valueColor(value), fontWeight: 600 }}>{formatSigned(value, 2)}%</Text>
      ),
    },
    {
      title: '观察理由',
      dataIndex: '观察理由',
      key: 'reason',
      width: 280,
      render: (value: string) => <Text>{value || '-'}</Text>,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space orientation="vertical" size={2}>
          <Title level={4} style={{ margin: 0 }}>MACD选股</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>自选股池 · 日线 + 15M</Text>
        </Space>
        <Space>
          {lastUpdated && <Text type="secondary" style={{ fontSize: 12 }}>刷新: {lastUpdated}</Text>}
          <Button icon={<ReloadOutlined />} onClick={() => fetchMACD(true, true)} loading={loading} type="primary">刷新</Button>
        </Space>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} lg={6}>
          <Card style={statCardStyle} styles={{ body: { padding: 14 } }}>
            <Statistic title="重点候选" value={summary.candidate} suffix={`/ ${summary.total}`} styles={{ content: { color: '#fa541c', fontSize: 24 } }} prefix={<AimOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card style={statCardStyle} styles={{ body: { padding: 14 } }}>
            <Statistic title="强信号" value={summary.strong} styles={{ content: { color: UP_COLOR, fontSize: 24 } }} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card style={statCardStyle} styles={{ body: { padding: 14 } }}>
            <Statistic title="拐点观察" value={summary.turn} suffix={`+ ${summary.trend} 趋势`} styles={{ content: { color: '#faad14', fontSize: 24 } }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card style={statCardStyle} styles={{ body: { padding: 14 } }}>
            <Statistic title="转弱风险" value={summary.risk} styles={{ content: { color: DOWN_COLOR, fontSize: 24 } }} prefix={<WarningOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card style={{ borderRadius: 8 }} styles={{ body: { padding: 12 } }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <Segmented
            value={view}
            onChange={(value) => setView(value as ViewMode)}
            options={[
              { label: `重点候选 ${summary.candidate}`, value: 'candidate' },
              { label: `强信号 ${summary.strong}`, value: 'strong' },
              { label: `拐点 ${summary.turn}`, value: 'turn' },
              { label: `转弱 ${summary.risk}`, value: 'risk' },
              { label: `全部 ${summary.total}`, value: 'all' },
            ]}
          />
          <Space wrap>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="代码 / 名称 / 行业"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              style={{ width: 210 }}
            />
            <Select
              allowClear
              placeholder="行业"
              value={industry}
              onChange={setIndustry}
              options={industryOptions}
              style={{ width: 170 }}
            />
          </Space>
        </div>

        <Table
          dataSource={filteredData}
          columns={columns}
          rowKey="股票代码"
          loading={loading}
          size="small"
          pagination={{ pageSize: 30, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 只` }}
          scroll={{ x: 1360 }}
          locale={{ emptyText: <Empty description="暂无匹配股票" /> }}
          onRow={(row) => ({
            onClick: () => navigate(`/stock/${routeCode(row.股票代码)}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </div>
  );
};

export default MACDPanel;
