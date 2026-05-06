import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, Spin, Empty, Typography, Space, Button, List, Tag } from 'antd';
import { ArrowLeftOutlined, RiseOutlined, FallOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { fetchKline } from '../../services/quoteApi';
import { STOCK_LIST } from '../../data/stocks';
import { useNewsFeed } from '../../hooks/useNewsFeed';
import { useTheme } from '../../hooks/useTheme';

const { Text } = Typography;

interface KlineBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  pct_chg: number;
}

const StockDetailPanel: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { news } = useNewsFeed();

  const [klineData, setKlineData] = useState<KlineBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 股票名称
  const stockInfo = useMemo(() => {
    return STOCK_LIST.find(s => s.code === code) || { code, name: code };
  }, [code]);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError(null);
    fetchKline(code, 90)
      .then(data => {
        if (data.success && data.data) {
          setKlineData(data.data);
        } else {
          setError(data.error || '获取K线数据失败');
        }
      })
      .catch(err => {
        setError(err.message || '网络错误');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [code]);

  // 最新一条K线
  const latest = klineData.length > 0 ? klineData[klineData.length - 1] : null;
  const prevClose = klineData.length > 1 ? klineData[klineData.length - 2].close : latest?.open;

  // 相关新闻（按股票名称过滤）
  const relatedNews = useMemo(() => {
    if (!stockInfo.name) return [];
    return news.filter(item =>
      item.title.includes(stockInfo.name || '') ||
      item.title.includes(code!)
    ).slice(0, 10);
  }, [news, stockInfo, code]);

  // ---------- 技术指标计算 ----------
  const indicators = useMemo(() => {
    if (klineData.length < 26) return { ma5: [], ma10: [], ma20: [], macd: [] };
    const closes = klineData.map(d => d.close);

    const calcEMA = (data: number[], period: number): number[] => {
      const k = 2 / (period + 1);
      const ema: number[] = [];
      ema[0] = data[0];
      for (let i = 1; i < data.length; i++) ema[i] = data[i] * k + ema[i - 1] * (1 - k);
      return ema;
    };

    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const dif = ema12.map((v, i) => v - ema26[i]);
    const dea = calcEMA(dif, 9);
    const macd = dif.map((v, i) => (v - dea[i]) * 2);

    const calcMA = (data: number[], period: number): number[] =>
      data.map((_, i) => i < period - 1 ? NaN : data.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period);

    return {
      ma5: calcMA(closes, 5),
      ma10: calcMA(closes, 10),
      ma20: calcMA(closes, 20),
      macd,
    };
  }, [klineData]);

  // K线图 ECharts 配置
  const klineOption = useMemo(() => {
    if (klineData.length === 0) return {};
    const rev = [...klineData].reverse();
    const dates = rev.map(d => d.date);
    const ohlc = rev.map(d => [d.open, d.close, d.low, d.high]);
    const volumes = rev.map(d => ({ value: d.volume, itemStyle: { color: d.close >= d.open ? '#ef5350' : '#26a69a' } }));
    const { ma5, ma10, ma20, macd } = indicators;
    const revI = (arr: number[]) => [...arr].reverse();

    const upColor = '#ef5350';
    const downColor = '#26a69a';
    const textColor = theme === 'dark' ? '#e8e8e8' : '#333';
    const gridLineColor = theme === 'dark' ? '#222' : '#f0f0f0';
    const axisLineColor = theme === 'dark' ? '#333' : '#ddd';

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: unknown) => {
          const arr = (params as { seriesName: string; dataIndex: number; value: number | number[] }[]);
          if (!arr || arr.length === 0) return '';
          const idx = arr[0].dataIndex;
          const d = rev[idx];
          if (!d) return '';
          const maVals = arr.filter(p => ['MA5','MA10','MA20'].includes(p.seriesName)).map(p => `${p.seriesName}:${(p.value as number).toFixed(2)}`).join(' &nbsp; ');
          const macdItem = arr.find(p => p.seriesName === 'MACD');
          return `<div style="font-size:12px">
            <div>${d.date}</div>
            <div>开: ${d.open} &nbsp; 收: ${d.close} &nbsp; 高: ${d.high} &nbsp; 低: ${d.low}</div>
            <div>涨跌: ${d.pct_chg >= 0 ? '+' : ''}${d.pct_chg.toFixed(2)}%</div>
            <div>成交量: ${(d.volume / 10000).toFixed(0)}万手</div>
            ${maVals ? `<div>${maVals}</div>` : ''}
            ${macdItem ? `<div>MACD:${(macdItem.value as number).toFixed(3)}</div>` : ''}
          </div>`;
        }
      },
      legend: { show: true, top: 0, textStyle: { color: textColor, fontSize: 11 }, inactiveColor: '#666' },
      grid: [
        { left: 60, right: 20, top: 30, height: '40%' },
        { left: 60, right: 20, top: '66%', height: '12%' },
        { left: 60, right: 20, top: '80%', height: '16%' },
      ],
      xAxis: [
        { type: 'category', data: dates, gridIndex: 0, boundaryGap: true, axisLine: { lineStyle: { color: axisLineColor } }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { show: false }, axisTick: { show: false } },
        { type: 'category', data: dates, gridIndex: 1, boundaryGap: true, axisLine: { lineStyle: { color: axisLineColor } }, axisLabel: { show: false }, splitLine: { show: false }, axisTick: { show: false } },
        { type: 'category', data: dates, gridIndex: 2, boundaryGap: true, axisLine: { lineStyle: { color: axisLineColor } }, axisLabel: { show: false }, splitLine: { show: false }, axisTick: { show: false } },
      ],
      yAxis: [
        { scale: true, gridIndex: 0, axisLine: { show: false }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { lineStyle: { color: gridLineColor } }, axisTick: { show: false } },
        { scale: true, gridIndex: 1, axisLine: { show: false }, axisLabel: { show: false }, splitLine: { show: false }, axisTick: { show: false } },
        { scale: true, gridIndex: 2, axisLine: { show: false }, axisLabel: { color: textColor, fontSize: 10 }, splitLine: { lineStyle: { color: gridLineColor } }, axisTick: { show: false } },
      ],
      series: [
        { name: 'MA5', type: 'line', data: revI(ma5), smooth: true, lineStyle: { color: '#f39c12', width: 1 }, symbol: 'none', xAxisIndex: 0, yAxisIndex: 0 },
        { name: 'MA10', type: 'line', data: revI(ma10), smooth: true, lineStyle: { color: '#e74c3c', width: 1 }, symbol: 'none', xAxisIndex: 0, yAxisIndex: 0 },
        { name: 'MA20', type: 'line', data: revI(ma20), smooth: true, lineStyle: { color: '#3498db', width: 1 }, symbol: 'none', xAxisIndex: 0, yAxisIndex: 0 },
        { type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0, itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor } },
        { type: 'bar', data: volumes, xAxisIndex: 1, yAxisIndex: 1, barWidth: '60%' },
        {
          name: 'MACD', type: 'bar', data: revI(macd).map(v => ({ value: v, itemStyle: { color: v >= 0 ? upColor : downColor } })),
          xAxisIndex: 2, yAxisIndex: 2, barWidth: '60%',
        },
      ],
      dataZoom: [
        { type: 'inside', start: 50, end: 100, xAxisIndex: [0, 1, 2] },
        { type: 'slider', start: 50, end: 100, xAxisIndex: [0, 1, 2], height: 18, bottom: 2, borderColor: 'transparent', backgroundColor: theme === 'dark' ? '#1f1f1f' : '#f0f0f0', fillerColor: 'rgba(100,149,237,0.2)', handleStyle: { color: '#6495ed' } },
      ],
    };
  }, [klineData, indicators, theme]);

  if (!code) {
    return <Empty description="无效的股票代码" />;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
      </Space>

      <Card
        size="small"
        title={
          <Space>
            <Text strong style={{ fontSize: 18 }}>{stockInfo.name}</Text>
            <Text type="secondary">{stockInfo.code}</Text>
          </Space>
        }
        style={{ marginBottom: 16, background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : error ? (
          <Empty description={error} />
        ) : latest ? (
          <Row gutter={16}>
            <Col span={6}>
              <Statistic
                title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>最新价</span>}
                value={latest.close}
                precision={2}
                valueStyle={{ color: latest.close >= (prevClose || 0) ? '#ff4d4f' : '#52c41a', fontSize: 22 }}
                suffix="元"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>涨跌幅</span>}
                value={latest.pct_chg}
                precision={2}
                prefix={latest.pct_chg >= 0 ? <RiseOutlined /> : <FallOutlined />}
                valueStyle={{ color: latest.pct_chg >= 0 ? '#ff4d4f' : '#52c41a' }}
                suffix="%"
              />
            </Col>
            <Col span={6}>
              <Statistic
                title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>今开</span>}
                value={latest.open}
                precision={2}
                valueStyle={{ color: theme === 'dark' ? '#fff' : '#333' }}
              />
            </Col>
            <Col span={6}>
              <Statistic
                title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>成交量</span>}
                value={(latest.volume / 10000).toFixed(0)}
                valueStyle={{ color: theme === 'dark' ? '#fff' : '#333' }}
                suffix="万手"
              />
            </Col>
          </Row>
        ) : null}
      </Card>

      <Card
        size="small"
        title="日K线"
        style={{ marginBottom: 16, background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
        styles={{ body: { height: 560 } }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
        ) : error ? (
          <Empty description={error} />
        ) : (
          <ReactECharts option={klineOption} style={{ height: 400 }} />
        )}
      </Card>

      {relatedNews.length > 0 && (
        <Card
          size="small"
          title="相关新闻"
          style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
          styles={{ body: { maxHeight: 300, overflow: 'auto' } }}
        >
          <List
            size="small"
            dataSource={relatedNews}
            renderItem={item => (
              <List.Item style={{ padding: '8px 0' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color="blue" style={{ fontSize: 11 }}>{item.category}</Tag>
                    <Text style={{ fontSize: 13 }}>{item.title}</Text>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {item.source} &nbsp; {item.time || dayjs().format('HH:mm')}
                  </Text>
                </div>
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
};

export default StockDetailPanel;
