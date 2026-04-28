import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Space, Select, Input, Button, Spin, Alert } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { useTheme } from '../../hooks/useTheme';
import { gangtiseApi, type SummaryItem } from '../../services/gangtiseApi';
import { CATEGORY_CONFIG } from '../../config/gangtise';

const { Search } = Input;

interface MarketData {
  indexName: string;
  current: number;
  change: number;
  changePercent: number;
  volume: string;
  amount: string;
}

const mockMarketData: MarketData[] = [
  { indexName: '上证指数', current: 3285.67, change: 25.34, changePercent: 0.78, volume: '3.52亿', amount: '4521亿' },
  { indexName: '深证成指', current: 10956.23, change: -45.67, changePercent: -0.41, volume: '4.21亿', amount: '5832亿' },
  { indexName: '创业板指', current: 2189.45, change: 15.23, changePercent: 0.70, volume: '1.85亿', amount: '2341亿' },
  { indexName: '沪深300', current: 3985.34, change: 12.56, changePercent: 0.32, volume: '2.34亿', amount: '3456亿' },
];

const MarketPanel: React.FC = () => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [summaryData, setSummaryData] = useState<SummaryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedMarket, setSelectedMarket] = useState<string[]>(['aShares']);
  const [current, setCurrent] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchSummaryData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        from: (current - 1) * 10,
        size: 10,
        searchType: 2,
        rankType: 2,
        keyword: searchKeyword || undefined,
        marketList: selectedMarket.length > 0 ? selectedMarket : undefined,
      };
      const response = await gangtiseApi.getSummaryList(params);
      if (response.status && response.data) {
        setSummaryData(response.data.list);
        setTotal(response.data.total);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '获取数据失败，请稍后重试';
      setErrorMsg(msg);
      console.error('Failed to fetch summary data:', error);
    } finally {
      setLoading(false);
    }
  }, [searchKeyword, selectedMarket, current]);

  useEffect(() => {
    fetchSummaryData();
  }, [fetchSummaryData]);

  const lineChartOption = {
    backgroundColor: 'transparent',
    title: { text: '上证指数走势', left: 'center', textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: ['9:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00'],
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666' },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666' },
      splitLine: { lineStyle: { color: theme === 'dark' ? '#333' : '#eee' } },
    },
    series: [{
      data: [3265, 3278, 3272, 3280, 3285, 3282, 3288, 3285, 3286, 3285],
      type: 'line',
      smooth: true,
      lineStyle: { color: '#1890ff', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(24, 144, 255, 0.3)' }, { offset: 1, color: 'rgba(24, 144, 255, 0.05)' }] } },
    }],
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
  };

  const sectorChartOption = {
    backgroundColor: 'transparent',
    title: { text: '行业板块分布', left: 'center', textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 } },
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: theme === 'dark' ? '#141414' : '#fff', borderWidth: 2 },
      label: { color: theme === 'dark' ? '#fff' : '#333' },
      data: [
        { value: 35, name: '科技' },
        { value: 25, name: '金融' },
        { value: 18, name: '消费' },
        { value: 12, name: '医疗' },
        { value: 10, name: '其他' },
      ],
    }],
  };

  const columns = [{
    title: '标题',
    dataIndex: 'title',
    key: 'title',
    ellipsis: true,
    render: (text: string, record: SummaryItem) => (
      <Space direction="vertical" size={0}>
        <span style={{ color: theme === 'dark' ? '#fff' : '#333' }}>{text}</span>
        <span style={{ color: theme === 'dark' ? '#888' : '#999', fontSize: 12 }}>
          {record.publishTime ? dayjs(record.publishTime).format('YYYY-MM-DD HH:mm') : '-'}
        </span>
      </Space>
    ),
  }, {
    title: '市场',
    dataIndex: 'marketList',
    key: 'marketList',
    width: 100,
    render: (markets: string[]) => markets?.slice(0, 2).map(m => (
      <Tag key={m} color={m === 'aShares' ? 'blue' : m === 'hkStocks' ? 'green' : 'orange'}>
        {m === 'aShares' ? 'A股' : m === 'hkStocks' ? '港股' : m === 'usStocks' ? '美股' : m}
      </Tag>
    )),
  }, {
    title: '类型',
    dataIndex: 'categoryList',
    key: 'categoryList',
    width: 120,
    render: (categories: string[]) => categories?.slice(0, 2).map(c => (
      <Tag key={c} color="cyan">{CATEGORY_CONFIG[c as keyof typeof CATEGORY_CONFIG] || c}</Tag>
    )),
  }, {
    title: '机构',
    dataIndex: 'institutionList',
    key: 'institutionList',
    width: 150,
    ellipsis: true,
    render: (institutions: { institutionName: string }[]) => institutions?.map(i => i.institutionName).join(', '),
  }];

  return (
    <div>
      {errorMsg && (
        <Alert type="error" message={errorMsg} showIcon closable onClose={() => setErrorMsg(null)} style={{ marginBottom: 16 }} />
      )}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {mockMarketData.map((item, index) => (
          <Col span={6} key={index}>
            <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
              <Statistic
                title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>{item.indexName}</span>}
                value={item.current}
                precision={2}
                valueStyle={{ color: item.change >= 0 ? '#ff4d4f' : '#52c41a', fontSize: 20 }}
                suffix={<span style={{ fontSize: 12 }}>{item.change >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{Math.abs(item.change).toFixed(2)} ({item.changePercent.toFixed(2)}%)</span>}
              />
              <div style={{ marginTop: 8, color: theme === 'dark' ? '#888' : '#999', fontSize: 12 }}>
                成交量: {item.volume} | 成交额: {item.amount}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card size="small" title="指数走势" extra={<Button type="link" size="small">详情</Button>} style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 320 }}>
            <ReactECharts option={lineChartOption} style={{ height: 260 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="行业板块" extra={<Button type="link" size="small">详情</Button>} style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 320 }}>
            <ReactECharts option={sectorChartOption} style={{ height: 260 }} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="最新纪要"
        extra={
          <Space>
            <Select mode="multiple" placeholder="选择市场" value={selectedMarket} onChange={setSelectedMarket} style={{ width: 150 }} options={[{ label: 'A股', value: 'aShares' }, { label: '港股', value: 'hkStocks' }, { label: '美股', value: 'usStocks' }]} />
            <Search placeholder="搜索关键词" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onSearch={fetchSummaryData} style={{ width: 200 }} prefix={<SearchOutlined />} allowClear />
            <Button icon={<ReloadOutlined />} onClick={fetchSummaryData}>刷新</Button>
          </Space>
        }
        style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
      >
        <Spin spinning={loading}>
          <Table columns={columns} dataSource={summaryData} rowKey="summaryId" pagination={{ total, pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 条`, onChange: (page) => setCurrent(page) }} size="small" />
        </Spin>
      </Card>
    </div>
  );
};

export default MarketPanel;