import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Table, Tag, Space, Select, DatePicker, Input, Button, Spin, Tabs, Empty, Alert } from 'antd';
import { SearchOutlined, ReloadOutlined, EyeOutlined, DownloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { useTheme } from '../../hooks/useTheme';
import { gangtiseApi, type SummaryItem, type ReportItem } from '../../services/gangtiseApi';
import { CATEGORY_CONFIG, SEARCH_TYPE, RANK_TYPE } from '../../config/gangtise';

const { RangePicker } = DatePicker;
const { Search } = Input;

const ResearchPanel: React.FC = () => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [summaryData, setSummaryData] = useState<SummaryItem[]>([]);
  const [reportData, setReportData] = useState<ReportItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [selectedMarket, setSelectedMarket] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([null, null]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchSummaryData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        from: 0,
        size: 20,
        searchType: searchKeyword ? SEARCH_TYPE.fullText : undefined,
        rankType: RANK_TYPE.timeDesc,
        keyword: searchKeyword || undefined,
        marketList: selectedMarket.length > 0 ? selectedMarket : undefined,
        startTime: dateRange[0]?.format('YYYY-MM-DD HH:mm:ss'),
        endTime: dateRange[1]?.format('YYYY-MM-DD HH:mm:ss'),
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
  }, [searchKeyword, selectedMarket, dateRange]);

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        from: 0,
        size: 20,
        searchType: searchKeyword ? SEARCH_TYPE.fullText : undefined,
        rankType: RANK_TYPE.timeDesc,
        keyword: searchKeyword || undefined,
        marketList: selectedMarket.length > 0 ? selectedMarket : undefined,
        startTime: dateRange[0]?.format('YYYY-MM-DD HH:mm:ss'),
        endTime: dateRange[1]?.format('YYYY-MM-DD HH:mm:ss'),
      };
      const response = await gangtiseApi.getReportList(params);
      if (response.status && response.data) {
        setReportData(response.data.list);
        setTotal(response.data.total);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '获取数据失败，请稍后重试';
      setErrorMsg(msg);
      console.error('Failed to fetch report data:', error);
    } finally {
      setLoading(false);
    }
  }, [searchKeyword, selectedMarket, dateRange]);

  useEffect(() => {
    if (activeTab === 'summary') {
      fetchSummaryData();
    } else {
      fetchReportData();
    }
  }, [activeTab, fetchSummaryData, fetchReportData]);

  const handleSearch = () => {
    if (activeTab === 'summary') {
      fetchSummaryData();
    } else {
      fetchReportData();
    }
  };

  const trendChartOption = {
    backgroundColor: 'transparent',
    title: {
      text: '研报发布趋势',
      left: 'center',
      textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 },
    },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
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
      data: [120, 200, 150, 80, 70, 110, 130],
      type: 'bar',
      barWidth: '50%',
      itemStyle: {
        color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#1890ff' }, { offset: 1, color: '#69c0ff' }] },
        borderRadius: [4, 4, 0, 0],
      },
    }],
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
  };

  const categoryChartOption = {
    backgroundColor: 'transparent',
    title: { text: '研报类型分布', left: 'center', textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 } },
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', right: 10, top: 'center', textStyle: { color: theme === 'dark' ? '#888' : '#666' } },
    series: [{
      type: 'pie',
      radius: ['40%', '65%'],
      center: ['40%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: theme === 'dark' ? '#141414' : '#fff', borderWidth: 2 },
      label: { color: theme === 'dark' ? '#fff' : '#333' },
      data: [
        { value: 40, name: '行业研报' },
        { value: 25, name: '公司研报' },
        { value: 20, name: '宏观策略' },
        { value: 15, name: '其他' },
      ],
    }],
  };

  const summaryColumns = [{
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
    title: '相关股票',
    dataIndex: 'securityList',
    key: 'securityList',
    width: 150,
    ellipsis: true,
    render: (securities: { securityName: string }[]) => securities?.map(s => s.securityName).join(', '),
  }, {
    title: '相关机构',
    dataIndex: 'institutionList',
    key: 'institutionList',
    width: 150,
    ellipsis: true,
    render: (institutions: { institutionName: string }[]) => institutions?.map(i => i.institutionName).join(', '),
  }, {
    title: '操作',
    key: 'action',
    width: 100,
    render: () => (
      <Space>
        <Button type="link" size="small" icon={<EyeOutlined />}>查看</Button>
        <Button type="link" size="small" icon={<DownloadOutlined />}>下载</Button>
      </Space>
    ),
  }];

  const reportColumns = [{
    title: '标题',
    dataIndex: 'title',
    key: 'title',
    ellipsis: true,
    render: (text: string) => <span style={{ color: theme === 'dark' ? '#fff' : '#333' }}>{text}</span>,
  }, {
    title: '报告类型',
    dataIndex: 'reportType',
    key: 'reportType',
    width: 100,
    render: (type: string) => <Tag color="purple">{type}</Tag>,
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
    title: '相关股票',
    dataIndex: 'securityList',
    key: 'securityList',
    width: 150,
    ellipsis: true,
    render: (securities: { securityName: string }[]) => securities?.map(s => s.securityName).join(', '),
  }, {
    title: '发布时间',
    dataIndex: 'publishTime',
    key: 'publishTime',
    width: 120,
    render: (time: string) => dayjs(time).format('YYYY-MM-DD'),
  }, {
    title: '操作',
    key: 'action',
    width: 100,
    render: () => (
      <Space>
        <Button type="link" size="small" icon={<EyeOutlined />}>查看</Button>
        <Button type="link" size="small" icon={<DownloadOutlined />}>下载</Button>
      </Space>
    ),
  }];

  return (
    <div>
      {errorMsg && (
        <Alert type="error" message={errorMsg} showIcon closable onClose={() => setErrorMsg(null)} style={{ marginBottom: 16 }} />
      )}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card size="small" title="研报发布趋势" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 280 }}>
            <ReactECharts option={trendChartOption} style={{ height: 220 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="研报类型分布" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 280 }}>
            <ReactECharts option={categoryChartOption} style={{ height: 220 }} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title={<Tabs activeKey={activeTab} onChange={setActiveTab} size="small" items={[{ key: 'summary', label: '会议纪要' }, { key: 'report', label: '研究报告' }]} />}
        extra={
          <Space wrap>
            <Select mode="multiple" placeholder="市场" value={selectedMarket} onChange={setSelectedMarket} style={{ minWidth: 120 }} allowClear options={[{ label: 'A股', value: 'aShares' }, { label: '港股', value: 'hkStocks' }, { label: '美股', value: 'usStocks' }]} />
            <RangePicker value={dateRange} onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])} style={{ width: 240 }} />
            <Search placeholder="搜索关键词" value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} onSearch={handleSearch} style={{ width: 200 }} prefix={<SearchOutlined />} allowClear />
            <Button icon={<ReloadOutlined />} onClick={handleSearch}>刷新</Button>
          </Space>
        }
        style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
      >
        <Spin spinning={loading}>
          {activeTab === 'summary' ? (
            <Table columns={summaryColumns} dataSource={summaryData} rowKey="summaryId" pagination={{ total, pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} size="small" locale={{ emptyText: <Empty description="暂无数据" /> }} />
          ) : (
            <Table columns={reportColumns} dataSource={reportData} rowKey="reportId" pagination={{ total, pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} size="small" locale={{ emptyText: <Empty description="暂无数据" /> }} />
          )}
        </Spin>
      </Card>
    </div>
  );
};

export default ResearchPanel;