import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
  theme as antdTheme,
  type TableColumnsType,
} from 'antd';
import {
  AlertOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';

const { Text } = Typography;
const AUTO_REFRESH_MS = 60_000;
const UP_COLOR = '#ff4d4f';
const DOWN_COLOR = '#52c41a';

type DataStatus = 'live' | 'cached' | 'degraded' | 'empty';
type AlertSeverity = 'warning' | 'critical';

interface EtfCandle {
  symbol?: string;
  name?: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  kline_period?: string;
}

interface EtfAlert {
  id: number;
  symbol: string;
  name: string;
  alert_type: 'volume_spike';
  candle_time: string;
  volume: number;
  prev_volume: number;
  ratio: number;
  threshold: number;
  severity: AlertSeverity;
  message: string;
  created_at: string;
}

interface EtfMonitorItem {
  symbol: string;
  name: string;
  data_status: DataStatus;
  latest_candle: EtfCandle | null;
  candles: EtfCandle[];
  current_alert: EtfAlert | null;
  last_updated: string | null;
  alerts: EtfAlert[];
  error: string | null;
}

interface EtfOverview {
  success: boolean;
  generated_at?: string;
  data_status: DataStatus;
  last_updated?: string | null;
  error?: string;
  items: EtfMonitorItem[];
}

interface StatusMeta {
  text: string;
  color: string;
}

const STATUS_META: Record<DataStatus, StatusMeta> = {
  live: { text: '实时', color: 'success' },
  cached: { text: '缓存', color: 'warning' },
  degraded: { text: '异常', color: 'error' },
  empty: { text: '等待数据', color: 'default' },
};

function formatAmount(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('MM-DD HH:mm') : value;
}

function dateKey(value?: string | null) {
  return value ? value.slice(0, 10) : '';
}

function periodForAlert(alert: EtfAlert, candles: EtfCandle[]) {
  const matching = candles.filter((candle) => candle.time === alert.candle_time);
  if (matching.length === 0) return alert.candle_time.slice(11, 16) > '14:30' ? '5分钟' : '15分钟';
  const preferred = alert.candle_time.slice(11, 16) > '14:30' ? '5' : '15';
  return `${matching.find((candle) => candle.kline_period === preferred)?.kline_period || matching[0].kline_period || preferred}分钟`;
}

function latestDayCandles(candles: EtfCandle[]) {
  const ordered = [...candles].sort((a, b) => a.time.localeCompare(b.time));
  const latestDay = dateKey(ordered.at(-1)?.time);
  const byTime = new Map<string, EtfCandle>();

  ordered.forEach((candle) => {
    if (dateKey(candle.time) !== latestDay) return;
    const existing = byTime.get(candle.time);
    if (!existing) {
      byTime.set(candle.time, candle);
      return;
    }
    const desiredPeriod = candle.time.slice(11, 16) > '14:30' ? '5' : '15';
    if (candle.kline_period === desiredPeriod && existing.kline_period !== desiredPeriod) {
      byTime.set(candle.time, candle);
    }
  });

  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

function alertsForLatestDay(item: EtfMonitorItem) {
  const latestDay = dateKey(item.latest_candle?.time || item.last_updated);
  return item.alerts.filter((alert) => dateKey(alert.candle_time) === latestDay);
}

function maxAlertRatio(alerts: EtfAlert[]): number | null {
  let maximum: number | null = null;
  for (const alert of alerts) {
    if (Number.isFinite(alert.ratio) && (maximum === null || alert.ratio > maximum)) {
      maximum = alert.ratio;
    }
  }
  return maximum;
}

const ETFMonitorPanel: React.FC = () => {
  const [messageApi, messageContextHolder] = message.useMessage();
  const { token } = antdTheme.useToken();
  const [overview, setOverview] = useState<EtfOverview | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const applyOverview = useCallback((payload: EtfOverview) => {
    setOverview(payload);
    setSelectedSymbol((current) => (
      payload.items.some((item) => item.symbol === current)
        ? current
        : payload.items[0]?.symbol || ''
    ));
    setError(payload.error || '');
  }, []);

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch('/api/etf-monitor/overview');
      const payload = await response.json() as EtfOverview;
      if (!response.ok && !payload.items?.length) {
        throw new Error(payload.error || 'ETF监控数据加载失败');
      }
      applyOverview(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ETF监控数据加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyOverview]);

  useEffect(() => {
    void loadOverview(false);
    const timer = window.setInterval(() => {
      void loadOverview(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadOverview]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const response = await fetch('/api/etf-monitor/refresh', { method: 'POST' });
      const payload = await response.json() as EtfOverview;
      if (!response.ok) throw new Error(payload.error || 'ETF刷新失败');
      applyOverview(payload);
      messageApi.success('ETF成交额监控已刷新');
    } catch (cause) {
      const nextError = cause instanceof Error ? cause.message : 'ETF刷新失败';
      setError(nextError);
      messageApi.warning('刷新失败，继续展示最近一次缓存');
    } finally {
      setRefreshing(false);
    }
  }, [applyOverview, messageApi]);

  const selected = useMemo(
    () => overview?.items.find((item) => item.symbol === selectedSymbol) || overview?.items[0] || null,
    [overview?.items, selectedSymbol],
  );
  const selectedCandles = useMemo(
    () => latestDayCandles(selected?.candles || []),
    [selected?.candles],
  );
  const selectedDayAlerts = useMemo(
    () => (selected ? alertsForLatestDay(selected) : []),
    [selected],
  );
  const selectedMaxRatio = useMemo(
    () => maxAlertRatio(selectedDayAlerts),
    [selectedDayAlerts],
  );
  const chartOption = useMemo(() => {
    const alertTimes = new Set(selectedDayAlerts.map((alert) => alert.candle_time));
    const labels = selectedCandles.map((candle) => candle.time.slice(11, 16));
    const isAlertIndex = (index: number) => alertTimes.has(selectedCandles[index]?.time);
    return {
      animation: false,
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      grid: [
        { left: 58, right: 24, top: 26, height: '48%' },
        { left: 58, right: 24, top: '66%', height: '20%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: labels,
          boundaryGap: true,
          axisLabel: { color: token.colorTextSecondary, showMaxLabel: true },
          axisLine: { lineStyle: { color: token.colorBorder } },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: labels,
          boundaryGap: true,
          axisLabel: {
            showMaxLabel: true,
            margin: 8,
            interval: (index: number) => (
              isAlertIndex(index)
              || index === 0
              || index === selectedCandles.length - 1
              || index % 3 === 0
            ),
            formatter: (value: string, index: number) => (
              isAlertIndex(index)
                ? `{time|${value}}\n{alert|异动}`
                : `{time|${value}}`
            ),
            rich: {
              time: {
                color: token.colorTextSecondary,
                lineHeight: 16,
              },
              alert: {
                color: token.colorWhite,
                backgroundColor: token.colorError,
                borderRadius: 3,
                padding: [2, 4],
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 20,
              },
            },
          },
          axisLine: { lineStyle: { color: token.colorBorder } },
        },
      ],
      yAxis: [
        {
          scale: true,
          axisLabel: { color: token.colorTextSecondary },
          splitLine: { lineStyle: { color: token.colorBorderSecondary } },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: '成交额（亿）',
          nameTextStyle: { color: token.colorTextSecondary },
          axisLabel: { color: token.colorTextSecondary },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '价格',
          type: 'candlestick',
          data: selectedCandles.map((candle) => [candle.open, candle.close, candle.low, candle.high]),
          itemStyle: {
            color: UP_COLOR,
            color0: DOWN_COLOR,
            borderColor: UP_COLOR,
            borderColor0: DOWN_COLOR,
          },
        },
        {
          name: '成交额',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: selectedCandles.map((candle) => ({
            value: Number((candle.amount / 100_000_000).toFixed(3)),
            itemStyle: {
              color: alertTimes.has(candle.time)
                ? token.colorError
                : candle.close >= candle.open ? UP_COLOR : DOWN_COLOR,
              opacity: alertTimes.has(candle.time) ? 1 : 0.72,
            },
          })),
        },
      ],
    };
  }, [selectedCandles, selectedDayAlerts, token.colorBorder, token.colorBorderSecondary, token.colorError, token.colorTextSecondary, token.colorWhite]);

  const alertColumns = useMemo<TableColumnsType<EtfAlert>>(() => [
    {
      title: '时间',
      dataIndex: 'candle_time',
      width: 110,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '周期',
      key: 'period',
      width: 74,
      render: (_value, alert) => periodForAlert(alert, selected?.candles || []),
    },
    {
      title: '级别',
      dataIndex: 'severity',
      width: 74,
      render: (severity: AlertSeverity) => (
        <Tag color={severity === 'critical' ? 'error' : 'warning'}>
          {severity === 'critical' ? '严重' : '提醒'}
        </Tag>
      ),
    },
    {
      title: '放大倍数',
      dataIndex: 'ratio',
      width: 96,
      align: 'right',
      render: (value: number) => <Text strong style={{ color: value >= 5 ? token.colorError : token.colorWarning }}>{value.toFixed(2)}x</Text>,
    },
    {
      title: '当前成交额',
      dataIndex: 'volume',
      width: 112,
      align: 'right',
      render: (value: number) => formatAmount(value),
    },
    {
      title: '对比成交额',
      dataIndex: 'prev_volume',
      width: 112,
      align: 'right',
      render: (value: number) => formatAmount(value),
    },
    {
      title: '说明',
      dataIndex: 'message',
      ellipsis: true,
    },
  ], [selected?.candles, token.colorError, token.colorWarning]);

  if (loading && !overview) {
    return <div style={{ padding: 64, textAlign: 'center' }}><Spin size="large" description="加载ETF成交额监控..." /></div>;
  }

  return (
    <div>
      {messageContextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 16 }}>
        <Space orientation="vertical" size={2}>
          <Space wrap>
            <Text strong style={{ fontSize: 16 }}>ETF盘中成交额异动</Text>
            <Tag color={STATUS_META[overview?.data_status || 'degraded'].color}>
              {STATUS_META[overview?.data_status || 'degraded'].text}
            </Tag>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            15分钟监控；14:30后切换5分钟。9:45放大1.15倍触发，其余时段放大1.30倍触发。
          </Text>
        </Space>
        <Space wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <ClockCircleOutlined /> 更新 {formatDateTime(overview?.last_updated)}
          </Text>
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refreshAll} type="primary">
            立即刷新
          </Button>
        </Space>
      </div>

      {error ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="ETF监控服务异常，当前继续展示最近一次缓存"
          description={error}
        />
      ) : null}

      {overview?.items.length ? (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {overview.items.map((item) => {
              const dayAlerts = alertsForLatestDay(item);
              const maximum = maxAlertRatio(dayAlerts);
              const isSelected = item.symbol === selected?.symbol;
              const status = STATUS_META[item.data_status] || STATUS_META.degraded;
              return (
                <Col xs={24} sm={12} xl={6} key={item.symbol}>
                  <Card
                    hoverable
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedSymbol(item.symbol)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setSelectedSymbol(item.symbol);
                    }}
                    style={{
                      height: '100%',
                      borderColor: isSelected ? token.colorPrimary : token.colorBorderSecondary,
                      background: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
                    }}
                    styles={{ body: { padding: 14 } }}
                  >
                    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <Space orientation="vertical" size={0}>
                          <Text strong>{item.name}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>{item.symbol}</Text>
                        </Space>
                        <Tag color={status.color}>{status.text}</Tag>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Space orientation="vertical" size={0}>
                          <Text type="secondary" style={{ fontSize: 12 }}>最新成交额</Text>
                          <Text strong style={{ fontSize: 18 }}>{formatAmount(item.latest_candle?.amount)}</Text>
                        </Space>
                        <Space orientation="vertical" size={0} style={{ textAlign: 'right' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>当日异动</Text>
                          <Text strong style={{ color: dayAlerts.length > 0 ? token.colorWarning : token.colorSuccess }}>
                            {dayAlerts.length}次{maximum !== null ? ` · ${maximum.toFixed(2)}x` : ''}
                          </Text>
                        </Space>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        最新价 {item.latest_candle?.close?.toFixed(3) || '-'} · {formatDateTime(item.last_updated)}
                      </Text>
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {selected ? (
            <>
              {selected.current_alert ? (
                <Alert
                  type={selected.current_alert.severity === 'critical' ? 'error' : 'warning'}
                  showIcon
                  icon={<AlertOutlined />}
                  style={{ marginBottom: 16 }}
                  title={`${selected.name} 当前成交额异动：${selected.current_alert.ratio.toFixed(2)}x`}
                  description={selected.current_alert.message}
                />
              ) : (
                <Alert
                  type="success"
                  showIcon
                  style={{ marginBottom: 16 }}
                  title={`${selected.name} 最近一根已完成K线未触发成交额异动`}
                />
              )}

              <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                <Col xs={12} lg={6}>
                  <Card styles={{ body: { padding: 12 } }}>
                    <Statistic title="最新成交额" value={selected.latest_candle?.amount || 0} formatter={() => formatAmount(selected.latest_candle?.amount)} />
                  </Card>
                </Col>
                <Col xs={12} lg={6}>
                  <Card styles={{ body: { padding: 12 } }}>
                    <Statistic title="最新价格" value={selected.latest_candle?.close || 0} precision={3} />
                  </Card>
                </Col>
                <Col xs={12} lg={6}>
                  <Card styles={{ body: { padding: 12 } }}>
                    <Statistic title="当日异动" value={selectedDayAlerts.length} suffix="次" styles={{ content: { color: selectedDayAlerts.length > 0 ? token.colorWarning : token.colorSuccess } }} />
                  </Card>
                </Col>
                <Col xs={12} lg={6}>
                  <Card styles={{ body: { padding: 12 } }}>
                    <Statistic title="最大放大倍数" value={selectedMaxRatio || 0} precision={2} suffix="x" styles={{ content: { color: selectedMaxRatio ? token.colorWarning : token.colorTextSecondary } }} />
                  </Card>
                </Col>
              </Row>

              <Card
                title={<Space><BarChartOutlined /><span>当日价格与成交额</span></Space>}
                extra={<Text type="secondary" style={{ fontSize: 12 }}>红色成交额柱及下方“异动”表示该时点触发提醒</Text>}
                styles={{ body: { padding: '8px 8px 0' } }}
                style={{ marginBottom: 16 }}
              >
                {selectedCandles.length > 0 ? (
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <ReactECharts option={chartOption} style={{ height: 390, minWidth: 720 }} notMerge />
                  </div>
                ) : (
                  <Empty description="暂无当日K线" style={{ padding: 64 }} />
                )}
              </Card>

              <Card
                title={<Space><DatabaseOutlined /><span>历史异动记录</span><Tag>{selected.alerts.length}条</Tag></Space>}
                styles={{ body: { padding: 0 } }}
              >
                <Table
                  dataSource={selected.alerts}
                  columns={alertColumns}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
                  locale={{ emptyText: '暂无异动记录' }}
                  scroll={{ x: 860 }}
                />
              </Card>
            </>
          ) : null}
        </>
      ) : (
        <Empty description="ETF监控后台尚未提供数据" style={{ padding: 64 }} />
      )}
    </div>
  );
};

export default ETFMonitorPanel;
