import React, { useState } from 'react';
import { Card, Row, Col, Table, Tag, Space, Select, Input, Button, Statistic, Empty } from 'antd';
import { SearchOutlined, ReloadOutlined, GlobalOutlined, BankOutlined, ThunderboltOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { useTheme } from '../../hooks/useTheme';
import { gangtiseApi, type SummaryItem } from '../../services/gangtiseApi';
import { SEARCH_TYPE, RANK_TYPE } from '../../config/gangtise';

const { Search } = Input;

const AlternativePanel: React.FC = () => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [researchData, setResearchData] = useState<SummaryItem[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedMarket, setSelectedMarket] = useState<string[]>([]);

  const fetchResearchData = async () => {
    setLoading(true);
    try {
      const params = {
        from: 0,
        size: 10,
        searchType: searchKeyword ? SEARCH_TYPE.fullText : undefined,
        rankType: RANK_TYPE.timeDesc,
        keyword: searchKeyword || 'AI智能体',
        marketList: selectedMarket.length > 0 ? selectedMarket : ['aShares'],
      };
      const response = await gangtiseApi.getSummaryList(params);
      if (response.status && response.data) {
        setResearchData(response.data.list);
      }
    } catch (error) {
      console.error('Failed to fetch research data:', error);
    } finally {
      setLoading(false);
    }
  };

  const gdpChartOption = {
    backgroundColor: 'transparent',
    title: { text: 'GDP季度增速', left: 'center', textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: ['Q1 2022', 'Q2 2022', 'Q3 2022', 'Q4 2022', 'Q1 2023', 'Q2 2023', 'Q3 2023', 'Q4 2023', 'Q1 2024'],
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666', rotate: 45 },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666', formatter: '{value}%' },
      splitLine: { lineStyle: { color: theme === 'dark' ? '#333' : '#eee' } },
    },
    series: [{
      data: [4.8, 0.4, 3.9, 2.9, 4.5, 6.3, 4.9, 5.2, 5.2],
      type: 'bar',
      barWidth: '50%',
      itemStyle: {
        color: (params: unknown) => {
          const value = (params as { value: number }).value;
          return value >= 5 ? '#52c41a' : value >= 4 ? '#1890ff' : '#ff4d4f';
        },
        borderRadius: [4, 4, 0, 0],
      },
    }],
    grid: { left: 50, right: 20, top: 40, bottom: 60 },
  };

  const sentimentChartOption = {
    backgroundColor: 'transparent',
    title: { text: '市场情绪指数', left: 'center', textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: ['周一', '周二', '周三', '周四', '周五'],
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666' },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666' },
      splitLine: { lineStyle: { color: theme === 'dark' ? '#333' : '#eee' } },
    },
    series: [{
      data: [65, 72, 68, 75, 78],
      type: 'line',
      smooth: true,
      lineStyle: { color: '#722ed1', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(114, 46, 209, 0.3)' }, { offset: 1, color: 'rgba(114, 46, 209, 0.05)' }] } },
      markLine: { silent: true, lineStyle: { color: '#faad14', type: 'dashed' }, data: [{ yAxis: 50 }, { yAxis: 80 }], label: { formatter: '{b}: {c}' } },
    }],
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
  };

  const factorChartOption = {
    backgroundColor: 'transparent',
    title: { text: '因子表现', left: 'center', textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { data: ['价值', '动量', '质量'], bottom: 0, textStyle: { color: theme === 'dark' ? '#888' : '#666' } },
    xAxis: {
      type: 'category',
      data: ['周一', '周二', '周三', '周四', '周五'],
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666' },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
      axisLabel: { color: theme === 'dark' ? '#888' : '#666', formatter: '{value}%' },
      splitLine: { lineStyle: { color: theme === 'dark' ? '#333' : '#eee' } },
    },
    series: [
      { name: '价值', data: [1.2, 0.8, 1.5, 1.1, 0.9], type: 'line', smooth: true, lineStyle: { color: '#1890ff', width: 2 } },
      { name: '动量', data: [0.5, 1.2, 0.9, 1.8, 1.5], type: 'line', smooth: true, lineStyle: { color: '#52c41a', width: 2 } },
      { name: '质量', data: [0.8, 0.6, 1.1, 0.7, 1.3], type: 'line', smooth: true, lineStyle: { color: '#fa8c16', width: 2 } },
    ],
    grid: { left: 50, right: 20, top: 40, bottom: 50 },
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
    title: '概念',
    dataIndex: 'conceptList',
    key: 'conceptList',
    width: 150,
    ellipsis: true,
    render: (concepts: { conceptId?: string; conceptName: string }[]) => concepts?.slice(0, 2).map(c => (
      <Tag key={c.conceptId || c.conceptName} color="purple">{c.conceptName}</Tag>
    )),
  }, {
    title: '相关机构',
    dataIndex: 'institutionList',
    key: 'institutionList',
    width: 150,
    ellipsis: true,
    render: (institutions: { institutionName: string }[]) => institutions?.map(i => i.institutionName).join(', '),
  }];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}><GlobalOutlined /> GDP当季增速</span>} value={5.2} precision={1} suffix="%" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}><BankOutlined /> CPI同比</span>} value={2.0} precision={1} suffix="%" valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>社融增量</span>} value={23500} precision={0} suffix="亿" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}><ThunderboltOutlined /> M2同比</span>} value={9.7} precision={1} suffix="%" valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small" title="GDP季度增速" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 320 }}>
            <ReactECharts option={gdpChartOption} style={{ height: 260 }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="市场情绪指数" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 320 }}>
            <ReactECharts option={sentimentChartOption} style={{ height: 260 }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="因子表现" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 320 }}>
            <ReactECharts option={factorChartOption} style={{ height: 260 }} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="最新调研纪要"
        extra={
          <Space>
            <Select mode="multiple" placeholder="选择市场" value={selectedMarket} onChange={setSelectedMarket} style={{ width: 150 }} allowClear options={[{ label: 'A股', value: 'aShares' }, { label: '港股', value: 'hkStocks' }, { label: '美股', value: 'usStocks' }]} />
            <Search placeholder="搜索关键词" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onSearch={fetchResearchData} style={{ width: 200 }} prefix={<SearchOutlined />} allowClear />
            <Button icon={<ReloadOutlined />} onClick={fetchResearchData}>刷新</Button>
          </Space>
        }
        style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
      >
        <Table columns={columns} dataSource={researchData} rowKey="summaryId" loading={loading} pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }} size="small" locale={{ emptyText: <Empty description="点击刷新按钮获取最新数据" /> }} />
      </Card>
    </div>
  );
};

export default AlternativePanel;