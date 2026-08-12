import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Alert, Card, Row, Col, Statistic, Table, Tag, Space, Button, Spin, message, Typography, Tabs, Empty, Tooltip, DatePicker } from 'antd';
import { ReloadOutlined, WarningOutlined, CheckCircleOutlined, ExclamationCircleOutlined, RiseOutlined, BarChartOutlined, TableOutlined, QuestionCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { deriveSpotRefreshState, staleRefreshDescription, type SpotRefreshPayload } from './spotRefreshState';
import ETFMonitorPanel from './ETFMonitorPanel';

const { Title, Text } = Typography;

interface TrendItem {
  date: string;
  tmt_yy?: number;
  tmt_sz_yy?: number;
  market_yy: number;
  pct: number;
  tmt_buy: number;
  market_buy: number;
  tmt_buy_pct: number;
  tmt_count?: number;
  tmt_turnover_pct?: number | null;
  tmt_turnover_by_industry?: IndustryTurnover[];
}

interface TradingTrendItem {
  date: string | null;
  stock_count: number;
  total_amount_yi: number;
  top1_count: number;
  top1_amount_yi: number;
  top1_ratio: number | null;
  top1_percentile?: number | null;
  top3_count: number;
  top3_amount_yi: number;
  top3_ratio: number | null;
  top3_percentile?: number | null;
  top5_count: number;
  top5_amount_yi: number;
  top5_ratio: number | null;
  top5_percentile?: number | null;
}

interface TradingTopStock {
  rank: number;
  code: string;
  name: string;
  price: number | null;
  pct_chg: number | null;
  volume: number | null;
  volume_10k_lot: number | null;
  amount_yi: number;
  amount_share: number | null;
  turnover_rate: number | null;
  volume_ratio: number | null;
  market_cap_yi: number | null;
  float_market_cap_yi: number | null;
}

interface TradingCongestionData extends TradingTrendItem {
  warning: 'normal' | 'warm' | 'warning' | 'danger';
  percentile_sample_count?: number;
  trend: TradingTrendItem[];
  top100: TradingTopStock[];
  top100_by_date?: Record<string, TradingTopStock[]>;
  volume_top100?: TradingTopStock[];
  volume_top100_by_date?: Record<string, TradingTopStock[]>;
  available_top100_dates?: string[];
  source?: string;
  stale?: boolean;
  error?: string;
}

interface MarginStock {
  code: string;
  name: string;
  market?: string;
  yy: number;
  buy: number;
  net: number | null;
  repay: number | null;
  yy_chg_1d?: number | null;
  sw_industry_code?: string;
  sw_industry_name?: string;
}

interface IndustryTurnover {
  industry_code: string;
  industry_name: string;
  turnover_pct: number | null;
}

interface IndustrySummary {
  industry_code: string;
  industry_name: string;
  universe_count: number | null;
  margin_count: number | null;
  yy: number | null;
  buy: number | null;
  yy_chg_1d: number | null;
  pct: number | null;
  tmt_share_pct: number | null;
}

interface ChartTooltipParam {
  name?: string;
  value?: number | null;
  marker?: string;
  seriesName?: string;
  dataIndex?: number;
  axisValue?: string;
}

interface TMTData {
  date?: string;
  definition_id?: string;
  definition_name?: string;
  classification_asof?: string;
  membership_hash?: string;
  membership_mode?: string;
  tmt_universe_count?: number;
  tmt_margin_count?: number;
  tmt_turnover_pct?: number | null;
  tmt_turnover_by_industry?: IndustryTurnover[];
  tmt_yy: number;
  tmt_count?: number;
  market_yy: number;
  pct: number;
  tmt_buy: number;
  market_buy: number;
  tmt_buy_pct: number;
  incr_pct_3d: number | null;
  incr_pct_5d: number | null;
  incr_pct_10d: number | null;
  warning?: 'normal' | 'warm' | 'warning' | 'danger';
  trend: TrendItem[];
  top_balance_stocks?: MarginStock[];
  top_change_stocks?: MarginStock[];
  industry_summary?: IndustrySummary[];
  history_status?: {
    mode: 'quick' | 'history';
    requested_count: number;
    completed_count: number;
    failed_count: number;
    requested_dates: string[];
    failed_dates?: Array<{ date: string; error: string }>;
  };
  trading_congestion?: TradingCongestionData;
}

type SpotRefreshApiPayload = SpotRefreshPayload<TMTData> & {
  refresh?: { status?: string };
};

interface TmtMarginApiResponse {
  success: boolean;
  data?: TMTData;
  error?: string;
  generatedAt?: string;
  lastUpdated?: string;
  cached?: boolean;
  stale?: boolean;
  staleDataDate?: string | null;
  staleReason?: string | null;
  refreshError?: string;
  needsSpotRefresh?: boolean;
  needsMarginRefresh?: boolean;
  marginDataDate?: string | null;
  expectedMarginDataDate?: string | null;
  marginLagTradingDays?: number;
  marginFreshnessReason?: string | null;
}

const UP_COLOR = '#ff4d4f';
const DOWN_COLOR = '#52c41a';
const SW_TMT_INDUSTRIES = ['电子', '计算机', '通信', '传媒'] as const;
const STANDARD_TMT_DEFINITION_ID = 'sw2021_l1_tmt_v1';

const formatAmount = (value?: number | null, digits = 1) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${value.toFixed(digits)}亿`;
};

const formatSignedAmount = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}亿`;
};

const formatPercentValue = (value?: number | null, digits = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${value.toFixed(digits)}%`;
};

const formatNumber = (value?: number | null, digits = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return value.toFixed(digits);
};

const formatTradeDate = (date?: string | null) => {
  if (!date) return '-';
  return date.includes('-') ? date : `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
};

const getPercentileColor = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return '#8c8c8c';
  if (value >= 98) return '#ff4d4f';
  if (value >= 95) return '#fa541c';
  if (value >= 90) return '#faad14';
  return '#52c41a';
};

const getChangeColor = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(value)) return undefined;
  if (value > 0) return UP_COLOR;
  if (value < 0) return DOWN_COLOR;
  return undefined;
};

const getTrendTmtYy = (item: TrendItem) => item.tmt_yy ?? item.tmt_sz_yy;

const hasTradingData = (trading?: TradingCongestionData | null): trading is TradingCongestionData => {
  if (!trading) return false;
  if (trading.top1_ratio !== undefined && trading.top1_ratio !== null) return true;
  return Boolean((trading.trend || []).some((item) => item.top1_ratio !== undefined && item.top1_ratio !== null));
};

const renderFormulaHelp = (title: string, lines: string[]) => (
  <Tooltip
    placement="topLeft"
    trigger={['hover', 'focus']}
    styles={{ root: { maxWidth: 520 } }}
    title={(
      <Space orientation="vertical" size={4}>
        <Text strong style={{ color: '#fff' }}>{title}</Text>
        {lines.map((line) => (
          <Text key={line} style={{ color: '#fff', fontSize: 12 }}>{line}</Text>
        ))}
      </Space>
    )}
  >
    <Button
      type="text"
      size="small"
      aria-label={title}
      icon={<QuestionCircleOutlined />}
      style={{ width: 20, height: 20, padding: 0, color: '#8c8c8c' }}
    />
  </Tooltip>
);

const TMTMarginPanel: React.FC = () => {
  const [messageApi, messageContextHolder] = message.useMessage();
  const [data, setData] = useState<TMTData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [spotRefreshLoading, setSpotRefreshLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [cached, setCached] = useState<boolean | null>(null);
  const [stale, setStale] = useState(false);
  const [staleDataDate, setStaleDataDate] = useState<string>('');
  const [needsMarginRefresh, setNeedsMarginRefresh] = useState(false);
  const [marginDataDate, setMarginDataDate] = useState<string>('');
  const [expectedMarginDataDate, setExpectedMarginDataDate] = useState<string>('');
  const [marginLagTradingDays, setMarginLagTradingDays] = useState(0);
  const [marginFreshnessReason, setMarginFreshnessReason] = useState<string>('');
  const [refreshError, setRefreshError] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'etf' | 'trading' | 'margin'>('etf');
  const [selectedTradeDate, setSelectedTradeDate] = useState<string>('');
  const [top100ByDate, setTop100ByDate] = useState<Record<string, TradingTopStock[]>>({});
  const [volumeTop100ByDate, setVolumeTop100ByDate] = useState<Record<string, TradingTopStock[]>>({});
  const [top100Kind, setTop100Kind] = useState<'amount' | 'volume'>('amount');
  const [visibleTop100Date, setVisibleTop100Date] = useState<string>('');
  const [visibleTop100Kind, setVisibleTop100Kind] = useState<'amount' | 'volume'>('amount');
  const [visibleTop100, setVisibleTop100] = useState<TradingTopStock[]>([]);
  const [top100Loading, setTop100Loading] = useState(false);
  const sortNullSafe = (value?: number | null) => (value === null || value === undefined || Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value);
  const normalizeTop100Map = (source?: Record<string, TradingTopStock[]>) => {
    const result: Record<string, TradingTopStock[]> = {};
    Object.entries(source || {}).forEach(([date, items]) => {
      if (date && Array.isArray(items) && items.length > 0) result[String(date)] = items;
    });
    return result;
  };

  const refreshTradingSpot = useCallback(async (notify = true) => {
    setSpotRefreshLoading(true);
    setError('');
    try {
      const applyRefreshPayload = (payload: SpotRefreshApiPayload) => {
        const refreshState = deriveSpotRefreshState<TMTData>(payload);
        if (refreshState.data) {
          setData(refreshState.data);
          const trading = refreshState.data.trading_congestion;
          if (trading?.date && Array.isArray(trading.top100)) {
            const latestDate = String(trading.date);
            setTop100ByDate((prev) => ({
              ...prev,
              ...normalizeTop100Map(trading.top100_by_date),
              [latestDate]: trading.top100,
            }));
            setVolumeTop100ByDate((prev) => ({
              ...prev,
              ...normalizeTop100Map(trading.volume_top100_by_date),
              ...(Array.isArray(trading.volume_top100) ? { [latestDate]: trading.volume_top100 } : {}),
            }));
            setVisibleTop100Date(latestDate);
            setVisibleTop100Kind(top100Kind);
            setVisibleTop100(top100Kind === 'volume' && Array.isArray(trading.volume_top100) ? trading.volume_top100 : trading.top100);
            setSelectedTradeDate(latestDate);
          }
        }
        setLastUpdated(refreshState.generatedAt);
        setCached(refreshState.cached);
        setStale(refreshState.stale);
        setStaleDataDate(refreshState.staleDataDate);
        setRefreshError(refreshState.refreshError);
        return refreshState;
      };

      const res = await fetch('/api/tmt-margin/spot-refresh', { method: 'POST' });
      let json = await res.json();
      let refreshState = applyRefreshPayload(json);
      if (!res.ok) throw new Error(refreshState.refreshError || '拥挤度刷新任务启动失败');

      if (json.refresh?.status === 'running') {
        if (notify) messageApi.info('拥挤度数据已在后台刷新，完成后会自动更新');
        let terminalPayload: SpotRefreshApiPayload | null = null;
        for (let poll = 0; poll < 65; poll += 1) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          try {
            const statusRes = await fetch('/api/tmt-margin/spot-refresh-status');
            if (!statusRes.ok) continue;
            json = await statusRes.json();
            if (json.refresh?.status === 'running') continue;
            terminalPayload = json;
            break;
          } catch {
            // A transient polling failure should not cancel the background task.
          }
        }
        if (!terminalPayload) {
          throw new Error('后台刷新等待超时，当前继续展示最近一次成功数据');
        }
        refreshState = applyRefreshPayload(terminalPayload);
        const terminalStatus = terminalPayload.refresh?.status;
        if (terminalStatus === 'success') {
          if (notify) messageApi.success('拥挤度数据刷新完成');
        } else if (refreshState.data) {
          if (notify) messageApi.warning('拥挤度刷新失败，已保留最近一次成功数据');
        } else {
          throw new Error(refreshState.refreshError || '拥挤度刷新失败');
        }
      } else if (json.success) {
        if (notify) messageApi.success('拥挤度数据刷新完成');
      }
    } catch (cause) {
      const nextError = cause instanceof Error ? cause.message : '网络错误，请检查服务器';
      setStale(true);
      setCached(true);
      setRefreshError(nextError);
      setError(nextError);
      if (notify) messageApi.warning('刷新请求失败，继续展示最近一次成功数据');
    } finally {
      setSpotRefreshLoading(false);
    }
  }, [messageApi, top100Kind]);

  const fetchTMT = useCallback(async (forceRefresh = false, notify = false, includeHistory = false) => {
    if (includeHistory) {
      setHistoryLoading(true);
    } else if (forceRefresh) {
      setRefreshLoading(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const params = new URLSearchParams();
      if (forceRefresh) params.set('refresh', '1');
      if (includeHistory) {
        params.set('history', '1');
        params.set('historyDays', '40');
      }
      const query = params.toString();
      const res = await fetch(query ? `/api/tmt-margin?${query}` : '/api/tmt-margin');
      const json = await res.json() as TmtMarginApiResponse;
      const responseData = json.data;
      const trading = responseData?.trading_congestion;

      // A 503 migration response can still carry safe all-A trading data. Keep it
      // available while the strict definition gate below prevents old margin data.
      if (responseData) {
        setData(responseData);
      }
      if (trading?.date && Array.isArray(trading.top100)) {
        const latestDate = String(trading.date);
        setTop100ByDate((prev) => {
          const next: Record<string, TradingTopStock[]> = {};
          Object.entries(prev).forEach(([date, items]) => {
            if (Array.isArray(items) && items.length > 0) next[date] = items;
          });
          Object.entries(normalizeTop100Map(trading.top100_by_date)).forEach(([date, items]) => {
            next[date] = items;
          });
          next[latestDate] = trading.top100;
          return next;
        });
        setVolumeTop100ByDate((prev) => {
          const next: Record<string, TradingTopStock[]> = {};
          Object.entries(prev).forEach(([date, items]) => {
            if (Array.isArray(items) && items.length > 0) next[date] = items;
          });
          Object.entries(normalizeTop100Map(trading.volume_top100_by_date)).forEach(([date, items]) => {
            next[date] = items;
          });
          if (Array.isArray(trading.volume_top100)) next[latestDate] = trading.volume_top100;
          return next;
        });
        setVisibleTop100Date(latestDate);
        setVisibleTop100Kind(top100Kind);
        setVisibleTop100(top100Kind === 'volume' && Array.isArray(trading.volume_top100) ? trading.volume_top100 : trading.top100);
      }

      setLastUpdated(json.generatedAt || json.lastUpdated || '');
      setCached(json.cached ?? null);
      setStale(Boolean(json.stale));
      setStaleDataDate(json.staleDataDate || (json.stale ? String(trading?.date || '') : ''));
      setRefreshError(json.refreshError || '');
      setNeedsMarginRefresh(Boolean(json.needsMarginRefresh));
      setMarginDataDate(json.marginDataDate || '');
      setExpectedMarginDataDate(json.expectedMarginDataDate || '');
      setMarginLagTradingDays(json.marginLagTradingDays || 0);
      setMarginFreshnessReason(json.marginFreshnessReason || '');

      if (json.success && res.ok) {
        if (!forceRefresh && !includeHistory && json.needsSpotRefresh) {
          void refreshTradingSpot(false);
        }
        if (notify) {
          if (json.stale && json.refreshError) {
            messageApi.warning('实时刷新失败，已保留最近一次成功数据');
          } else {
            messageApi.success(json.cached ? '已读取最近一次成功数据' : '刷新成功');
          }
        }
      } else {
        const nextError = json.error || '获取数据失败';
        setError(nextError);
        if (notify) messageApi.error(nextError);
      }
    } catch {
      const nextError = '网络错误，请检查服务器';
      setError(nextError);
      if (notify) messageApi.error(nextError);
    } finally {
      setLoading(false);
      setRefreshLoading(false);
      setHistoryLoading(false);
    }
  }, [messageApi, refreshTradingSpot, top100Kind]);

  useEffect(() => {
    fetchTMT(false, false);
  }, [fetchTMT]);

  useEffect(() => {
    const trading = data?.trading_congestion;
    const trendDates = trading?.trend?.map((row) => `${row.date}`).filter(Boolean) || [];
    const top100Dates = (trading?.available_top100_dates || []).map((date) => `${date}`).filter(Boolean);
    const availableDates = [...new Set([...top100Dates, ...trendDates])].sort((a, b) => b.localeCompare(a));
    const tradingDate = trading?.date ? `${trading.date}` : '';
    const latestDate = tradingDate && availableDates.includes(tradingDate) ? tradingDate : (availableDates[0] || tradingDate);
    if (latestDate && (!selectedTradeDate || !availableDates.includes(selectedTradeDate))) {
      setSelectedTradeDate(latestDate);
    }
  }, [data?.trading_congestion, selectedTradeDate]);

  const availableTop100DatesKey = (data?.trading_congestion?.available_top100_dates || []).join('|');

  useEffect(() => {
    if (!selectedTradeDate) return;
    const activeTop100ByDate = top100Kind === 'volume' ? volumeTop100ByDate : top100ByDate;
    const cachedTop100 = activeTop100ByDate[selectedTradeDate];
    if (Array.isArray(cachedTop100) && cachedTop100.length > 0) {
      setVisibleTop100Date(selectedTradeDate);
      setVisibleTop100Kind(top100Kind);
      setVisibleTop100(cachedTop100);
      return;
    }
    let cancelled = false;

    setTop100Loading(true);
    fetch(`/api/tmt-margin/trading-top100?date=${selectedTradeDate}&kind=${top100Kind}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const responseDate = String(json.date || selectedTradeDate);
        if (responseDate !== selectedTradeDate) return;
        if (json.success && Array.isArray(json.items)) {
          if (top100Kind === 'volume') {
            setVolumeTop100ByDate((prev) => ({
              ...prev,
              [selectedTradeDate]: json.items,
            }));
          } else {
            setTop100ByDate((prev) => ({
              ...prev,
              [selectedTradeDate]: json.items,
            }));
          }
          setVisibleTop100Date(selectedTradeDate);
          setVisibleTop100Kind(top100Kind);
          setVisibleTop100(json.items);
        }
      })
      .catch(() => {
        // Do not memoize failures as empty data; the next refresh or date switch should retry.
      })
      .finally(() => {
        if (!cancelled) setTop100Loading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedTradeDate,
    top100ByDate,
    top100Kind,
    volumeTop100ByDate,
    data?.trading_congestion?.date,
    availableTop100DatesKey,
  ]);

  const getWarningIcon = (warning: string) => {
    switch (warning) {
      case 'danger': return <WarningOutlined style={{ color: '#ff4d4f', fontSize: 22 }} />;
      case 'warning': return <ExclamationCircleOutlined style={{ color: '#faad14', fontSize: 22 }} />;
      case 'warm': return <RiseOutlined style={{ color: '#faad14', fontSize: 22 }} />;
      default: return <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 22 }} />;
    }
  };

  const getWarningColor = (warning: string) => {
    switch (warning) {
      case 'danger': return '#fff1f0';
      case 'warning': return '#fffbe6';
      case 'warm': return '#fffbe6';
      default: return '#f6ffed';
    }
  };

  const getWarningTextColor = (warning: string) => {
    switch (warning) {
      case 'danger': return '#a8071a';
      case 'warning': return '#874d00';
      case 'warm': return '#874d00';
      default: return '#135200';
    }
  };

  const getTrendOption = () => {
    if (!data?.trend?.length) return {};
    const sorted = [...data.trend].sort((a, b) => a.date.localeCompare(b.date));
    const dates = sorted.map(t => t.date.slice(4, 6) + '/' + t.date.slice(6, 8));
    const pcts = sorted.map(t => t.pct);

    return {
      backgroundColor: 'transparent',
      title: {
        text: '标准TMT融资余额占比',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500 },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: ChartTooltipParam[]) => {
          const p = params[0];
          if (!p) return '';
          return `${p.name}<br/>融资余额占比: <b>${p.value}%</b>`;
        },
      },
      xAxis: { type: 'category', data: dates, boundaryGap: false },
      yAxis: {
        type: 'value',
        min: Math.max(0, Math.min(...pcts) - 1),
        max: Math.max(...pcts) + 2,
        axisLabel: { formatter: '{value}%' },
      },
      series: [{
        data: pcts,
        type: 'line',
        smooth: true,
        lineStyle: { width: 2, color: '#1890ff' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(24,144,255,0.3)' },
              { offset: 1, color: 'rgba(24,144,255,0.05)' },
            ],
          },
        },
        symbol: 'circle',
        symbolSize: 6,
      }],
      grid: { left: 50, right: 20, top: 40, bottom: 30 },
    };
  };

  const getTurnoverOption = () => {
    const sorted = (data?.trend || [])
      .filter((item): item is TrendItem & { tmt_turnover_pct: number } => typeof item.tmt_turnover_pct === 'number')
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!sorted.length) return {};
    const dates = sorted.map((item) => item.date.slice(4, 6) + '/' + item.date.slice(6, 8));
    const pcts = sorted.map((item) => item.tmt_turnover_pct);

    return {
      backgroundColor: 'transparent',
      title: {
        text: '标准TMT成交额占全A',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500 },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: ChartTooltipParam[]) => {
          const p = params[0];
          if (!p) return '';
          return `${p.name}<br/>成交额占比: <b>${p.value}%</b>`;
        },
      },
      xAxis: { type: 'category', data: dates, boundaryGap: false },
      yAxis: {
        type: 'value',
        min: Math.max(0, Math.floor((Math.min(...pcts) - 5) / 5) * 5),
        max: Math.ceil((Math.max(...pcts) + 5) / 5) * 5,
        axisLabel: { formatter: '{value}%' },
      },
      series: [{
        data: pcts,
        type: 'line',
        smooth: true,
        lineStyle: { width: 2, color: '#722ed1' },
        itemStyle: { color: '#722ed1' },
        areaStyle: { color: 'rgba(114,46,209,0.10)' },
        symbol: 'circle',
        symbolSize: 6,
      }],
      grid: { left: 50, right: 20, top: 40, bottom: 30 },
    };
  };

  const getTradingWarningText = (trading?: TradingCongestionData) => {
    const tradingError = trading?.error;
    if (!hasTradingData(trading)) {
      return tradingError ? `交易拥挤度拉取失败：${tradingError}` : '交易拥挤度暂无数据';
    }
    const p = Math.max(
      trading.top1_percentile || 0,
      trading.top3_percentile || 0,
      trading.top5_percentile || 0,
    );
    if ((trading.percentile_sample_count || 0) < 20) {
      return `交易拥挤度已更新，历史样本 ${trading.percentile_sample_count || 0} 天，分位数仅作短样本参考`;
    }
    if (p >= 98) return '交易拥挤度高危：头部成交额集中度处于极高分位，需重点复核热门股退潮风险';
    if (p >= 95) return '交易拥挤度预警：头部成交额集中度接近历史高位，关注高成交标的分化';
    if (p >= 90) return '交易拥挤度升温：成交额开始向少数标的集中，适合拆解Top100结构';
    return '交易拥挤度正常：成交额集中度仍在可观察区间';
  };

  const getTradingTrendOption = () => {
    const trend = data?.trading_congestion?.trend?.filter((item) => item.date && item.top1_ratio !== undefined && item.top1_ratio !== null) || [];
    if (!trend.length) return {};
    const sorted = [...trend].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const dateKeys = sorted.map((item) => String(item.date));
    const showPointSymbol = sorted.length <= 1;
    const defaultZoomStart = dateKeys.length > 520
      ? Math.max(0, ((dateKeys.length - 520) / dateKeys.length) * 100)
      : 0;
    const yearLabelByDate: Record<string, string> = {};
    const yearBoundaries: { xAxis: string; label: { show: boolean } }[] = [];
    const monthLabelByDate: Record<string, string> = {};
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let lastMonthKey = '';
    let segmentStart = 0;
    dateKeys.forEach((date) => {
      const monthKey = date.slice(0, 6);
      if (monthKey !== lastMonthKey) {
        const monthIndex = Number(date.slice(4, 6)) - 1;
        monthLabelByDate[date] = monthNames[monthIndex] || date.slice(4, 6);
        lastMonthKey = monthKey;
      }
    });
    for (let i = 1; i <= dateKeys.length; i += 1) {
      const prevYear = dateKeys[i - 1]?.slice(0, 4);
      const nextYear = dateKeys[i]?.slice(0, 4);
      if (i === dateKeys.length || prevYear !== nextYear) {
        const midpoint = Math.floor((segmentStart + i - 1) / 2);
        if (dateKeys[midpoint]) {
          yearLabelByDate[dateKeys[midpoint]] = `${prevYear}`;
        }
        if (i < dateKeys.length && dateKeys[i]) {
          yearBoundaries.push({ xAxis: dateKeys[i], label: { show: false } });
        }
        segmentStart = i;
      }
    }

    return {
      backgroundColor: 'transparent',
      title: {
        text: '成交额集中度趋势',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500 },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: ChartTooltipParam[]) => {
          const row = sorted[params[0]?.dataIndex ?? -1];
          const getAmount = (seriesName: string) => {
            if (!row) return null;
            if (seriesName === '前1%') return row.top1_amount_yi;
            if (seriesName === '前3%') return row.top3_amount_yi;
            return row.top5_amount_yi;
          };
          const lines = params.map((p) => {
            const amount = getAmount(p.seriesName || '');
            return `${p.marker}${p.seriesName}: <b>${formatPercentValue(p.value)}</b>${amount ? ` · ${formatAmount(amount, 0)}` : ''}`;
          });
          return `${formatTradeDate(params[0]?.axisValue || '')}<br/>${lines.join('<br/>')}`;
        },
      },
      legend: { bottom: 0, data: ['前1%', '前3%', '前5%'] },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          start: defaultZoomStart,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          filterMode: 'none',
          throttle: 50,
        },
        {
          type: 'slider',
          xAxisIndex: [0, 1],
          start: defaultZoomStart,
          end: 100,
          height: 14,
          bottom: 28,
          showDetail: false,
          brushSelect: false,
          borderColor: 'rgba(140,140,140,0.22)',
          fillerColor: 'rgba(24,144,255,0.12)',
          handleSize: 12,
          filterMode: 'none',
        },
      ],
      xAxis: [
        {
          type: 'category',
          data: dateKeys,
          boundaryGap: false,
          axisLabel: {
            interval: (_index: number, value: string) => Boolean(monthLabelByDate[value]),
            formatter: (value: string) => monthLabelByDate[value] || '',
            hideOverlap: true,
            margin: 10,
          },
        },
        {
          type: 'category',
          data: dateKeys,
          position: 'bottom',
          offset: 28,
          boundaryGap: false,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            interval: 0,
            color: '#8c8c8c',
            fontWeight: 600,
            formatter: (value: string) => yearLabelByDate[value] || '',
          },
        },
      ],
      yAxis: {
        type: 'value',
        axisLabel: { formatter: '{value}%' },
        min: 0,
        max: (value: { max: number }) => Math.max(60, Math.ceil(value.max / 10) * 10),
      },
      series: [
        {
          name: '前1%',
          data: sorted.map((item) => item.top1_ratio),
          type: 'line',
          connectNulls: true,
          smooth: true,
          symbol: showPointSymbol ? 'circle' : 'none',
          symbolSize: showPointSymbol ? 7 : 0,
          showSymbol: showPointSymbol,
          lineStyle: { width: 2, color: '#ff4d4f' },
          itemStyle: { color: '#ff4d4f' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: 'rgba(140,140,140,0.45)', type: 'dashed', width: 1 },
            data: yearBoundaries,
          },
        },
        {
          name: '前3%',
          data: sorted.map((item) => item.top3_ratio),
          type: 'line',
          connectNulls: true,
          smooth: true,
          symbol: showPointSymbol ? 'circle' : 'none',
          symbolSize: showPointSymbol ? 7 : 0,
          showSymbol: showPointSymbol,
          lineStyle: { width: 2, color: '#faad14' },
          itemStyle: { color: '#faad14' },
        },
        {
          name: '前5%',
          data: sorted.map((item) => item.top5_ratio),
          type: 'line',
          connectNulls: true,
          smooth: true,
          symbol: showPointSymbol ? 'circle' : 'none',
          symbolSize: showPointSymbol ? 7 : 0,
          showSymbol: showPointSymbol,
          lineStyle: { width: 2, color: '#1890ff' },
          itemStyle: { color: '#1890ff' },
        },
      ],
      grid: { left: 50, right: 24, top: 42, bottom: 104 },
    };
  };

  const getTradingPercentileOption = () => {
    const trading = data?.trading_congestion;
    if (!hasTradingData(trading)) return {};
    const hasEnoughSample = (trading.percentile_sample_count || 0) >= 20;
    const labels = ['前1%', '前3%', '前5%'];
    const values = [trading.top1_percentile, trading.top3_percentile, trading.top5_percentile].map((v) => v ?? 0);
    return {
      backgroundColor: 'transparent',
      title: {
        text: hasEnoughSample ? '当前历史分位数' : '当前历史分位数（短样本）',
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: ChartTooltipParam[]) => {
          const p = params[0];
          if (!p) return '';
          return `${p.name}<br/>历史分位数: <b>${formatPercentValue(p.value)}</b>${hasEnoughSample ? '' : '<br/>样本较短，仅供参考'}`;
        },
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { formatter: '{value}%' },
      },
      yAxis: { type: 'category', data: labels },
      series: [{
        data: values.map((v) => ({
          value: v,
          itemStyle: { color: hasEnoughSample ? getPercentileColor(v) : '#1890ff' },
        })),
        type: 'bar',
        barWidth: 18,
        label: {
          show: true,
          position: 'right',
          formatter: ({ value }: { value: number }) => formatPercentValue(value),
        },
      }],
      grid: { left: 56, right: 58, top: 42, bottom: 32 },
    };
  };

  const hasEnoughTradingSample = (data?.trading_congestion?.percentile_sample_count || 0) >= 20;
  const formatTradingPercentile = (value?: number | null, digits = 0) =>
    formatPercentValue(value, digits);
  const getTradingPercentileColor = (value?: number | null) =>
    hasEnoughTradingSample ? getPercentileColor(value) : '#1890ff';
  const tradingPercentileHelp = (
    <Space orientation="vertical" size={4}>
      <Text strong style={{ color: '#fff' }}>分位数怎么算</Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>每次新增历史后，会用当前全部已缓存交易日重新计算分位数。</Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>回溯到2005前是“已缓存样本分位”；全部跑完后就是2005年以来分位。</Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>公式：样本中“占比小于等于当日”的天数 ÷ 样本天数 × 100%。</Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>所以如果当日是样本窗口最高值，就会显示 100%。</Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>分位越高，说明头部成交额集中度相对样本期越高。</Text>
    </Space>
  );
  const renderTradingPercentileHelpIcon = () => (
    <Tooltip placement="topLeft" trigger={['hover', 'focus']} styles={{ root: { maxWidth: 460 } }} title={tradingPercentileHelp}>
      <Button
        type="text"
        size="small"
        aria-label="交易拥挤度分位说明"
        icon={<QuestionCircleOutlined />}
        style={{ width: 20, height: 20, padding: 0, color: '#8c8c8c' }}
      />
    </Tooltip>
  );
  const renderTradingConcentrationCell = (
    ratio: number | null,
    amount: number | null,
    percentile?: number | null,
  ) => (
    <div style={{ textAlign: 'right' }}>
      <Space size={4}>
        <Text strong style={{ color: getTradingPercentileColor(percentile) }}>{formatPercentValue(ratio)}</Text>
        <Tooltip placement="top" trigger={['hover', 'focus']} styles={{ root: { maxWidth: 460 } }} title={tradingPercentileHelp}>
          <Tag color={getTradingPercentileColor(percentile)} style={{ cursor: 'help' }}>{formatTradingPercentile(percentile, 0)}</Tag>
        </Tooltip>
      </Space>
      <div style={{ marginTop: 2, fontSize: 11, color: '#888' }}>
        成交额 {formatAmount(amount, 0)}
      </div>
    </div>
  );

  const tradingTrendColumns = [
    { title: '日期', dataIndex: 'date', key: 'date', render: (v: string | null) => formatTradeDate(v).slice(5) },
    { title: '总成交额', dataIndex: 'total_amount_yi', key: 'total_amount_yi', align: 'right' as const, render: (v: number) => formatAmount(v, 0) },
    {
      title: '前1%占比',
      dataIndex: 'top1_ratio',
      key: 'top1_ratio',
      align: 'right' as const,
      render: (v: number | null, row: TradingTrendItem) => renderTradingConcentrationCell(v, row.top1_amount_yi, row.top1_percentile),
    },
    {
      title: '前3%占比',
      dataIndex: 'top3_ratio',
      key: 'top3_ratio',
      align: 'right' as const,
      render: (v: number | null, row: TradingTrendItem) => renderTradingConcentrationCell(v, row.top3_amount_yi, row.top3_percentile),
    },
    {
      title: '前5%占比',
      dataIndex: 'top5_ratio',
      key: 'top5_ratio',
      align: 'right' as const,
      render: (v: number | null, row: TradingTrendItem) => renderTradingConcentrationCell(v, row.top5_amount_yi, row.top5_percentile),
    },
  ];

  const top100Columns = [
    {
      title: '#',
      dataIndex: 'rank',
      key: 'rank',
      width: 52,
      fixed: 'left' as const,
      sorter: (a: TradingTopStock, b: TradingTopStock) => a.rank - b.rank,
      sortDirections: ['ascend', 'descend'] as ('ascend' | 'descend')[],
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: '标的',
      key: 'stock',
      fixed: 'left' as const,
      sorter: (a: TradingTopStock, b: TradingTopStock) => `${a.code}`.localeCompare(`${b.code}`),
      sortDirections: ['ascend', 'descend'] as ('ascend' | 'descend')[],
      render: (_: unknown, row: TradingTopStock) => (
        <Space orientation="vertical" size={0}>
          <Text strong>{row.name}</Text>
          <Tag color="blue" style={{ margin: 0 }}>{row.code}</Tag>
        </Space>
      ),
    },
    { title: '价格', dataIndex: 'price', key: 'price', align: 'right' as const, sorter: (a: TradingTopStock, b: TradingTopStock) => sortNullSafe(a.price) - sortNullSafe(b.price), render: (v: number | null) => formatNumber(v, 2) },
    {
      title: '涨跌幅',
      dataIndex: 'pct_chg',
      key: 'pct_chg',
      align: 'right' as const,
      sorter: (a: TradingTopStock, b: TradingTopStock) => sortNullSafe(a.pct_chg) - sortNullSafe(b.pct_chg),
      sortDirections: ['ascend', 'descend'] as ('ascend' | 'descend')[],
      render: (v: number | null) => <Text style={{ color: getChangeColor(v), fontWeight: 600 }}>{formatPercentValue(v, 2)}</Text>,
    },
    { title: '成交额', dataIndex: 'amount_yi', key: 'amount_yi', align: 'right' as const, sorter: (a: TradingTopStock, b: TradingTopStock) => sortNullSafe(a.amount_yi) - sortNullSafe(b.amount_yi), render: (v: number) => formatAmount(v, 2) },
    {
      title: '全A占比',
      dataIndex: 'amount_share',
      key: 'amount_share',
      align: 'right' as const,
      sorter: (a: TradingTopStock, b: TradingTopStock) => sortNullSafe(a.amount_share) - sortNullSafe(b.amount_share),
      sortDirections: ['ascend', 'descend'] as ('ascend' | 'descend')[],
      render: (v: number | null) => <Tag color={(v || 0) >= 1 ? 'red' : (v || 0) >= 0.5 ? 'orange' : 'blue'}>{formatPercentValue(v, 2)}</Tag>,
    },
    { title: '成交量', dataIndex: 'volume_10k_lot', key: 'volume_10k_lot', align: 'right' as const, sorter: (a: TradingTopStock, b: TradingTopStock) => sortNullSafe(a.volume_10k_lot) - sortNullSafe(b.volume_10k_lot), render: (v: number | null) => `${formatNumber(v, 2)}万手` },
    {
      title: (
        <Space size={2}>
          <span>换手率</span>
          {renderFormulaHelp('换手率口径', [
            '东财字段 f8：当日换手率（百分比）。',
            '常见口径：换手率 = 当日成交量 / 流通股本 × 100%。',
          ])}
        </Space>
      ),
      dataIndex: 'turnover_rate',
      key: 'turnover_rate',
      align: 'right' as const,
      sorter: (a: TradingTopStock, b: TradingTopStock) => sortNullSafe(a.turnover_rate) - sortNullSafe(b.turnover_rate),
      sortDirections: ['ascend', 'descend'] as ('ascend' | 'descend')[],
      render: (v: number | null) => formatPercentValue(v, 2),
    },
    {
      title: (
        <Space size={2}>
          <span>量比</span>
          {renderFormulaHelp('量比口径', [
            '实时横截面使用东财字段 f10。',
            '历史回溯只使用东财日线成交量按同一公式复算，不接入其他数据源。',
            '量比 = 今日成交量 / 近5个交易日均量。',
            '量比可用于衡量短期放量程度，数值越高代表近期放量越明显。',
          ])}
        </Space>
      ),
      dataIndex: 'volume_ratio',
      key: 'volume_ratio',
      align: 'right' as const,
      sorter: (a: TradingTopStock, b: TradingTopStock) => sortNullSafe(a.volume_ratio) - sortNullSafe(b.volume_ratio),
      sortDirections: ['ascend', 'descend'] as ('ascend' | 'descend')[],
      render: (v: number | null) => formatNumber(v, 2),
    },
  ];

  const trendColumns = [
    { title: '日期', dataIndex: 'date', key: 'date', render: (v: string) => v.slice(4, 6) + '/' + v.slice(6, 8) },
    { title: '成交额占全A', dataIndex: 'tmt_turnover_pct', key: 'tmt_turnover_pct', render: (v: number | null) => <Tag color="purple">{formatPercentValue(v)}</Tag> },
    { title: 'TMT融资余额', key: 'tmt_yy', render: (_: unknown, row: TrendItem) => formatAmount(getTrendTmtYy(row)) },
    { title: '全市场', dataIndex: 'market_yy', key: 'market_yy', render: (v: number) => formatAmount(v) },
    { title: '融资余额占比', dataIndex: 'pct', key: 'pct', render: (v: number) => <Tag color="blue">{formatPercentValue(v)}</Tag> },
    { title: 'TMT融资买入', dataIndex: 'tmt_buy', key: 'tmt_buy', render: (v: number) => formatAmount(v) },
    { title: '融资买入占比', dataIndex: 'tmt_buy_pct', key: 'tmt_buy_pct', render: (v: number) => formatPercentValue(v, 1) },
  ];

  const stockColumns = [
    {
      title: '标的',
      key: 'stock',
      fixed: 'left' as const,
      render: (_: unknown, row: MarginStock) => (
        <Space orientation="vertical" size={0}>
          <Text strong>{row.name}</Text>
          <Space size={4} wrap>
            <Tag color="blue" style={{ margin: 0 }}>{row.code}</Tag>
            {row.sw_industry_name && <Tag style={{ margin: 0 }}>{row.sw_industry_name}</Tag>}
          </Space>
        </Space>
      ),
    },
    { title: '融资余额', dataIndex: 'yy', key: 'yy', align: 'right' as const, render: (v: number) => formatAmount(v) },
    {
      title: '1日余额变化',
      dataIndex: 'yy_chg_1d',
      key: 'yy_chg_1d',
      align: 'right' as const,
      render: (v: number | null) => (
        <Text style={{ color: (v || 0) > 0 ? UP_COLOR : (v || 0) < 0 ? DOWN_COLOR : undefined, fontWeight: 600 }}>
          {formatSignedAmount(v)}
        </Text>
      ),
    },
    { title: '融资买入', dataIndex: 'buy', key: 'buy', align: 'right' as const, render: (v: number) => formatAmount(v) },
    {
      title: '融资净额',
      dataIndex: 'net',
      key: 'net',
      align: 'right' as const,
      render: (v: number | null) => (
        <Text style={{ color: (v || 0) > 0 ? UP_COLOR : (v || 0) < 0 ? DOWN_COLOR : undefined }}>
          {formatSignedAmount(v)}
        </Text>
      ),
    },
  ];

  const industryColumns = [
    { title: '申万一级行业', dataIndex: 'industry_name', key: 'industry_name', fixed: 'left' as const, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    {
      title: '两融覆盖/成分',
      key: 'coverage',
      align: 'right' as const,
      render: (_: unknown, row: IndustrySummary) => `${row.margin_count ?? '-'} / ${row.universe_count ?? '-'}`,
    },
    { title: '成交额占全A', dataIndex: 'turnover_pct', key: 'turnover_pct', align: 'right' as const, render: (v: number | null) => formatPercentValue(v) },
    { title: '融资余额', dataIndex: 'yy', key: 'yy', align: 'right' as const, render: (v: number | null) => formatAmount(v) },
    { title: '融资占全市场', dataIndex: 'pct', key: 'pct', align: 'right' as const, render: (v: number | null) => formatPercentValue(v) },
    { title: 'TMT内部占比', dataIndex: 'tmt_share_pct', key: 'tmt_share_pct', align: 'right' as const, render: (v: number | null) => formatPercentValue(v) },
    {
      title: '1日余额变化',
      dataIndex: 'yy_chg_1d',
      key: 'yy_chg_1d',
      align: 'right' as const,
      render: (v: number | null) => (
        <Text style={{ color: (v || 0) > 0 ? UP_COLOR : (v || 0) < 0 ? DOWN_COLOR : undefined, fontWeight: 600 }}>
          {formatSignedAmount(v)}
        </Text>
      ),
    },
    { title: '融资买入', dataIndex: 'buy', key: 'buy', align: 'right' as const, render: (v: number | null) => formatAmount(v) },
  ];

  const statusTime = lastUpdated ? new Date(lastUpdated).toLocaleString() : '';
  const historyStatus = data?.history_status;
  const actionLoading = refreshLoading || historyLoading || spotRefreshLoading;
  const trendWindowTitle = data?.trend?.length ? `近${data.trend.length}日标准TMT历史` : '标准TMT历史';
  const isStandardTmt = data?.definition_id === STANDARD_TMT_DEFINITION_ID;
  const latestTurnoverPct = useMemo(() => {
    if (typeof data?.tmt_turnover_pct === 'number') return data.tmt_turnover_pct;
    return [...(data?.trend || [])]
      .sort((a, b) => b.date.localeCompare(a.date))
      .find((item) => typeof item.tmt_turnover_pct === 'number')?.tmt_turnover_pct ?? null;
  }, [data?.tmt_turnover_pct, data?.trend]);
  const industryRows = useMemo(() => {
    const summaries = data?.industry_summary || [];
    const turnoverRows = data?.tmt_turnover_by_industry || [];
    return SW_TMT_INDUSTRIES.map((industryName) => {
      const summary = summaries.find((row) => row.industry_name === industryName);
      const turnover = turnoverRows.find((row) => (
        (summary?.industry_code && row.industry_code === summary.industry_code)
        || row.industry_name === industryName
      ));
      return {
        industry_code: summary?.industry_code || turnover?.industry_code || industryName,
        industry_name: industryName,
        universe_count: summary?.universe_count ?? null,
        margin_count: summary?.margin_count ?? null,
        yy: summary?.yy ?? null,
        buy: summary?.buy ?? null,
        yy_chg_1d: summary?.yy_chg_1d ?? null,
        pct: summary?.pct ?? null,
        tmt_share_pct: summary?.tmt_share_pct ?? null,
        turnover_pct: turnover?.turnover_pct ?? null,
      };
    });
  }, [data?.industry_summary, data?.tmt_turnover_by_industry]);
  const trading = data?.trading_congestion;
  const trendTradeDates = useMemo(() => (trading?.trend || []).map((row) => `${row.date}`).filter(Boolean), [trading?.trend]);
  const availableTradeDates = useMemo(() => {
    const top100Dates = (trading?.available_top100_dates || []).map((date) => `${date}`).filter(Boolean);
    const dateSet = new Set<string>([...top100Dates, ...trendTradeDates]);
    return [...dateSet].sort((a, b) => b.localeCompare(a));
  }, [trendTradeDates, trading?.available_top100_dates]);
  const availableTradeDateSet = useMemo(() => new Set(availableTradeDates), [availableTradeDates]);
  const selectedTradeDateValue = selectedTradeDate ? dayjs(formatTradeDate(selectedTradeDate)) : null;
  const selectedTop100 = useMemo(() => {
    if (!trading) return [];
    const selectedDate = selectedTradeDate || trading.date || '';
    if (selectedDate && visibleTop100Date === selectedDate && visibleTop100Kind === top100Kind && visibleTop100.length > 0) {
      return visibleTop100;
    }
    const activeTop100ByDate = top100Kind === 'volume' ? volumeTop100ByDate : top100ByDate;
    const cachedItems = selectedDate ? activeTop100ByDate[selectedDate] : undefined;
    if (Array.isArray(cachedItems) && cachedItems.length > 0) {
      return cachedItems;
    }
    const latestItems = top100Kind === 'volume' ? trading.volume_top100 : trading.top100;
    if (selectedDate && trading.date && selectedDate === `${trading.date}` && Array.isArray(latestItems)) {
      return latestItems;
    }
    return [];
  }, [trading, selectedTradeDate, top100ByDate, top100Kind, visibleTop100Date, visibleTop100Kind, visibleTop100, volumeTop100ByDate]);
  const selectedTradeRow = useMemo(() => {
    if (!trading?.trend?.length) return null;
    return trading.trend.find((item) => item.date === selectedTradeDate) || null;
  }, [trading, selectedTradeDate]);
  const effectiveTradingWarning = hasEnoughTradingSample ? (trading?.warning || 'normal') : 'normal';

  return (
    <div>
      {messageContextHolder}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>拥挤度追踪</Title>
          {activeTab === 'etf' ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ETF盘中15/5分钟成交额异动监控
            </Text>
          ) : activeTab === 'trading' && trading?.date ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              数据日期 {formatTradeDate(trading.date)}
              {trading.stock_count ? ` · 覆盖 ${trading.stock_count} 只A股` : ''}
            </Text>
          ) : data?.date && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              数据日期 {data.date.slice(0, 4)}-{data.date.slice(4, 6)}-{data.date.slice(6, 8)}
              {data.tmt_margin_count ? ` · 两融覆盖 ${data.tmt_margin_count}/${data.tmt_universe_count || '-'} 只标准成分` : ''}
            </Text>
          )}
          {activeTab === 'margin' && isStandardTmt && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              标准历史 {(data?.trend || []).length}/40 个交易日
              {historyStatus?.failed_count ? ` · 本次失败 ${historyStatus.failed_count} 日` : ''}
            </Text>
          )}
        </div>
        <Space wrap>
          {activeTab !== 'etf' && statusTime ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {cached ? '缓存' : '实时'}更新: {statusTime}
            </Text>
          ) : null}
          {spotRefreshLoading && activeTab === 'trading' ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              东财快照后台刷新中
            </Text>
          ) : null}
          {activeTab !== 'etf' ? (
            <Button
              icon={<ReloadOutlined />}
              onClick={() => activeTab === 'trading' ? refreshTradingSpot(true) : fetchTMT(true, true, true)}
              loading={actionLoading}
              disabled={actionLoading}
              type="primary"
            >
              刷新
            </Button>
          ) : null}
        </Space>
      </div>

      {stale && refreshError && activeTab === 'trading' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="实时刷新失败，当前展示最近一次成功数据"
          description={staleRefreshDescription({
            data,
            generatedAt: lastUpdated,
            cached: Boolean(cached),
            stale,
            staleDataDate: staleDataDate || String(data?.trading_congestion?.date || ''),
            refreshError,
          })}
        />
      )}
      {activeTab !== 'etf' && error && !data ? <Alert type="error" showIcon style={{ marginBottom: 12 }} title={error} /> : null}
      {activeTab === 'margin' && isStandardTmt && (needsMarginRefresh || actionLoading) && (
        <Alert
          type={actionLoading ? 'info' : 'warning'}
          showIcon
          style={{ marginBottom: 12 }}
          title={actionLoading ? '标准TMT相关数据正在刷新' : '标准TMT数据日期滞后或需刷新'}
          description={(
            <Space orientation="vertical" size={2}>
              {needsMarginRefresh ? (
                <Text>
                  当前两融日期 {formatTradeDate(marginDataDate || data?.date)}
                  {expectedMarginDataDate ? ` · 预期 ${formatTradeDate(expectedMarginDataDate)}` : ''}
                  {marginLagTradingDays > 0 ? ` · 滞后 ${marginLagTradingDays} 个交易日` : ''}
                </Text>
              ) : <Text>正在更新标准TMT相关数据。</Text>}
              {(marginFreshnessReason || refreshError) && (
                <Text type="secondary">{marginFreshnessReason || refreshError}</Text>
              )}
            </Space>
          )}
        />
      )}
      {activeTab === 'margin' && !isStandardTmt && error && data && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="标准TMT数据暂不可用"
          description={error}
        />
      )}

      <Card styles={{ body: { padding: 0 } }}>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'etf' | 'trading' | 'margin')}
            items={[
              {
                key: 'etf',
                label: (
                  <Space>
                    <ThunderboltOutlined />
                    ETF成交额异动
                  </Space>
                ),
              },
              {
                key: 'trading',
                label: (
                  <Space>
                    <BarChartOutlined />
                    全A交易拥挤度
                  </Space>
                ),
              },
              {
                key: 'margin',
                label: (
                  <Space>
                    <RiseOutlined />
                    标准TMT（申万一级）
                  </Space>
                ),
              },
            ]}
            style={{ padding: '0 16px' }}
          />
          <div style={{ padding: 16 }}>
            {activeTab === 'etf' ? (
              <ETFMonitorPanel />
            ) : !data ? (
              <div style={{ textAlign: 'center', padding: 60 }}>
                <Spin spinning={loading || refreshLoading || historyLoading} size="large" description="加载拥挤度追踪数据..." />
              </div>
            ) : activeTab === 'trading' ? (
              <>
                {trading?.stale && trading.error && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    title="交易拥挤度刷新失败，当前展示最近一次成功数据"
                    description={trading.error}
                  />
                )}

                <Card styles={{ body: { padding: 16, background: getWarningColor(effectiveTradingWarning) } }} style={{ marginBottom: 16 }}>
                  <Space size="large" align="start">
                    {getWarningIcon(effectiveTradingWarning)}
                    <Space orientation="vertical" size={2}>
                      <Text strong style={{ fontSize: 15, color: getWarningTextColor(effectiveTradingWarning) }}>
                        {getTradingWarningText(trading)}
                      </Text>
                      <div style={{ fontSize: 12, color: getWarningTextColor(effectiveTradingWarning), opacity: 0.85 }}>
                        <Space size={6} wrap>
                          <span>核心口径：主源为东方财富；主源不可用时降级使用新浪全A行情。全A个股按成交额降序排序，统计前1%/3%/5%成交额占全市场成交额比例。</span>
                          {renderFormulaHelp('交易拥挤度口径', [
                          '数据源：实时全A横截面主源为东方财富，主源不可用时降级使用新浪全A行情；历史序列优先使用已落库快照。',
                          '样本：全A有效成交个股，剔除成交额缺失或为0的记录；跨源降级日可能存在轻微口径差异。',
                          '前N%成交额 = 按成交额降序后前 ceil(股票数 × N%) 只股票成交额合计。',
                          '前N%成交额占比 = 前N%成交额 ÷ 全A总成交额 × 100%。',
                          '历史分位数 = 历史样本中小于等于当日占比的天数 ÷ 样本天数 × 100%。',
                          'Top100仅展示本地东方财富缓存；默认按成交额降序，点击表头可按其他字段排序。',
                        ])}
                        </Space>
                      </div>
                    </Space>
                  </Space>
                </Card>

                {hasTradingData(trading) ? (
                  <>

                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                      <Col xs={24} sm={12} xl={6}>
                        <Card styles={{ body: { padding: 12 } }}>
                          <Statistic
                            title="前1%成交额占比"
                            value={trading.top1_ratio ?? 0}
                            suffix="%"
                            precision={2}
                            styles={{ content: { color: getTradingPercentileColor(trading.top1_percentile), fontSize: 20 } }}
                          />
                          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                            成交额 {formatAmount(trading.top1_amount_yi, 0)} · {trading.top1_count} 只 · {hasEnoughTradingSample ? `分位 ${formatTradingPercentile(trading.top1_percentile, 0)}` : '分位待补'}
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} xl={6}>
                        <Card styles={{ body: { padding: 12 } }}>
                          <Statistic
                            title="前3%成交额占比"
                            value={trading.top3_ratio ?? 0}
                            suffix="%"
                            precision={2}
                            styles={{ content: { color: getTradingPercentileColor(trading.top3_percentile), fontSize: 20 } }}
                          />
                          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                            成交额 {formatAmount(trading.top3_amount_yi, 0)} · {trading.top3_count} 只 · {hasEnoughTradingSample ? `分位 ${formatTradingPercentile(trading.top3_percentile, 0)}` : '分位待补'}
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} xl={6}>
                        <Card styles={{ body: { padding: 12 } }}>
                          <Statistic
                            title="前5%成交额占比"
                            value={trading.top5_ratio ?? 0}
                            suffix="%"
                            precision={2}
                            styles={{ content: { color: getTradingPercentileColor(trading.top5_percentile), fontSize: 20 } }}
                          />
                          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                            成交额 {formatAmount(trading.top5_amount_yi, 0)} · {trading.top5_count} 只 · {hasEnoughTradingSample ? `分位 ${formatTradingPercentile(trading.top5_percentile, 0)}` : '分位待补'}
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} sm={12} xl={6}>
                        <Card styles={{ body: { padding: 12 } }}>
                          <Statistic
                            title="全A成交额"
                            value={trading.total_amount_yi}
                            suffix="亿"
                            precision={0}
                            styles={{ content: { color: '#1890ff', fontSize: 20 } }}
                          />
                          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                            {formatTradeDate(trading.date)} · {trading.stock_count} 只
                          </div>
                        </Card>
                      </Col>
                    </Row>

                    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                      <Col xs={24} xl={14}>
                        <Card styles={{ body: { padding: 0 } }}>
                          <ReactECharts option={getTradingTrendOption()} style={{ height: 280 }} />
                          <div style={{ padding: '0 12px 10px', marginTop: -8, fontSize: 12, color: '#8c8c8c' }}>
                            悬停在图上可用鼠标滚轮缩放显示时间范围，拖动底部滑块可平移窗口。
                          </div>
                        </Card>
                      </Col>
                      <Col xs={24} xl={10}>
                        <Card styles={{ body: { padding: hasEnoughTradingSample ? 0 : 24 } }} style={{ height: 280 }}>
                          {hasEnoughTradingSample ? (
                            <ReactECharts option={getTradingPercentileOption()} style={{ height: 280 }} />
                          ) : (
                            <div style={{ height: 232, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                              <Space orientation="vertical" size={8}>
                                <Text strong style={{ fontSize: 15 }}>历史分位数待补齐</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  当前样本 {trading.percentile_sample_count || 0} 天，累计到 20 天后展示分位数
                                </Text>
                                <Text style={{ color: '#1890ff', fontSize: 24, fontWeight: 700 }}>
                                  {formatPercentValue(trading.top3_ratio)}
                                </Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>当前前3%成交额占比</Text>
                              </Space>
                            </div>
                          )}
                        </Card>
                      </Col>
                    </Row>

                    <Card styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
                      <Table
                        dataSource={[...trading.trend].filter((item) => item.date && item.top1_ratio !== undefined && item.top1_ratio !== null).sort((a, b) => String(b.date).localeCompare(String(a.date)))}
                        columns={tradingTrendColumns}
                        rowKey={(row) => String(row.date)}
                        size="small"
                        pagination={{
                          pageSize: 5,
                          size: 'small',
                          showSizeChanger: false,
                          showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}个交易日`,
                        }}
                        scroll={{ x: 760 }}
                        title={() => (
                          <Space wrap>
                            <Text strong>交易拥挤度历史</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              分位数样本：{trading.percentile_sample_count || 0} 天
                            </Text>
                            {renderTradingPercentileHelpIcon()}
                          </Space>
                        )}
                      />
                    </Card>

                    <Card
                      styles={{ body: { padding: 0 } }}
                      title={(
                        <Space wrap>
                          <TableOutlined />
                          <Text strong>{top100Kind === 'volume' ? '成交量Top100' : '成交额Top100'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {formatTradeDate(selectedTradeDate || trading.date)}
                            {selectedTradeRow ? ` · 前1% ${formatPercentValue(selectedTradeRow.top1_ratio)} / ${formatAmount(selectedTradeRow.top1_amount_yi, 0)}` : ''}
                          </Text>
                        </Space>
                      )}
                      extra={(
                        <Space wrap size={8}>
                          <Space.Compact size="small">
                            <Button
                              type={top100Kind === 'amount' ? 'primary' : 'default'}
                              onClick={() => setTop100Kind('amount')}
                            >
                              成交额
                            </Button>
                            <Button
                              type={top100Kind === 'volume' ? 'primary' : 'default'}
                              onClick={() => setTop100Kind('volume')}
                            >
                              成交量
                            </Button>
                          </Space.Compact>
                          <Space size={6}>
                            <Text type="secondary" style={{ fontSize: 12 }}>日期</Text>
                            <DatePicker
                              size="small"
                              allowClear={false}
                              inputReadOnly
                              value={selectedTradeDateValue}
                              format="YYYY-MM-DD"
                              disabled={!availableTradeDates.length}
                              disabledDate={(current) => !current || !availableTradeDateSet.has(current.format('YYYYMMDD'))}
                              onChange={(value) => {
                                const nextDate = value?.format('YYYYMMDD') || '';
                                if (nextDate && availableTradeDateSet.has(nextDate)) {
                                  setSelectedTradeDate(nextDate);
                                }
                              }}
                            />
                          </Space>
                        </Space>
                      )}
                    >
                      {top100Loading ? (
                        <div style={{ padding: 48, textAlign: 'center' }}>
                          <Spin />
                        </div>
                      ) : selectedTop100.length > 0 ? (
                        <Table
                          dataSource={selectedTop100}
                          columns={top100Columns}
                          rowKey={(row) => `${selectedTradeDate || trading.date}-${row.code}`}
                          size="small"
                          pagination={{ pageSize: 20, size: 'small', showSizeChanger: false }}
                          showSorterTooltip={false}
                          scroll={{ x: 960 }}
                        />
                      ) : (
                        <Empty description="该日期暂无东财Top100缓存" style={{ padding: 48 }} />
                      )}
                    </Card>

                    <div style={{ marginTop: 16, fontSize: 12, color: '#888' }}>
                      <Text type="secondary">
                        Top100用于解释集中度和成交活跃结构。这里仅读取本地东财缓存，已有缓存日期可直接切换查看；没有缓存的日期不会用其他数据源补齐。
                      </Text>
                    </div>
                  </>
                ) : (
                  <Empty description="暂无交易拥挤度数据" style={{ padding: 64 }} />
                )}
              </>
            ) : !isStandardTmt ? (
              <Empty
                description="标准TMT数据尚未生成，请刷新后重试"
                style={{ padding: 64 }}
              />
            ) : (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  title={data.definition_name || '标准TMT（申万2021一级）'}
                  description={(
                    <Space orientation="vertical" size={2}>
                      <Text>行业范围固定为：电子、计算机、通信、传媒。分类日期：{formatTradeDate(data.classification_asof)}。</Text>
                      {data.membership_mode === 'current_components_backfill' && (
                        <Text type="secondary">历史序列按分类日当前成分回溯，尚不是严格点时成分口径。</Text>
                      )}
                      {data.membership_hash && (
                        <Text type="secondary" style={{ fontSize: 12 }}>成分快照：{data.membership_hash.slice(0, 12)}</Text>
                      )}
                    </Space>
                  )}
                />

                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                  <Col xs={24} sm={12} xl={6}>
                    <Card styles={{ body: { padding: 12 } }}>
                      <Statistic
                        title="标准TMT成交额占全A"
                        value={latestTurnoverPct ?? 0}
                        formatter={() => formatPercentValue(latestTurnoverPct)}
                        styles={{ content: { color: '#722ed1', fontSize: 20 } }}
                      />
                      <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>市场常用的TMT交易拥挤指标</div>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <Card styles={{ body: { padding: 12 } }}>
                      <Statistic
                        title="标准TMT融资余额占比"
                        value={data.pct}
                        suffix="%"
                        precision={2}
                        styles={{ content: { color: '#1890ff', fontSize: 20 } }}
                      />
                      <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                        {formatAmount(data.tmt_yy)} / 全市场 {formatAmount(data.market_yy)}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <Card styles={{ body: { padding: 12 } }}>
                      <Statistic
                        title="标准TMT融资买入额占比"
                        value={data.tmt_buy_pct}
                        suffix="%"
                        precision={1}
                        styles={{ content: { color: '#13a8a8', fontSize: 20 } }}
                      />
                      <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                        {formatAmount(data.tmt_buy)} / 全市场 {formatAmount(data.market_buy)}
                      </div>
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <Card styles={{ body: { padding: 12 } }}>
                      <Statistic
                        title="标准成分两融覆盖"
                        value={data.tmt_margin_count ?? data.tmt_count ?? 0}
                        formatter={() => data.tmt_margin_count ?? data.tmt_count ?? '-'}
                        suffix="只"
                        styles={{ content: { color: '#595959', fontSize: 20 } }}
                      />
                      <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                        全部标准成分 {data.tmt_universe_count ?? '-'} 只
                      </div>
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                  <Col xs={24} xl={12}>
                    <Card styles={{ body: { padding: 0 } }}>
                      <ReactECharts option={getTurnoverOption()} style={{ height: 240 }} />
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card styles={{ body: { padding: 0 } }}>
                      <ReactECharts option={getTrendOption()} style={{ height: 240 }} />
                    </Card>
                  </Col>
                </Row>

                <Card title="四行业拆分（申万2021一级）" styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
                  <Table
                    dataSource={industryRows}
                    columns={industryColumns}
                    rowKey="industry_name"
                    size="small"
                    pagination={false}
                    scroll={{ x: 980 }}
                  />
                </Card>

                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                  <Col xs={24} xl={12}>
                    <Card title="标准TMT：融资余额Top" styles={{ body: { padding: 0 } }}>
                      <Table
                        dataSource={data.top_balance_stocks || []}
                        columns={stockColumns}
                        rowKey="code"
                        size="small"
                        pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                        locale={{ emptyText: '暂无标准成分融资余额数据' }}
                        scroll={{ x: 720 }}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} xl={12}>
                    <Card title="标准TMT：融资余额增量Top" styles={{ body: { padding: 0 } }}>
                      <Table
                        dataSource={data.top_change_stocks || []}
                        columns={stockColumns}
                        rowKey="code"
                        size="small"
                        pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                        locale={{ emptyText: '暂无标准成分余额增量数据' }}
                        scroll={{ x: 720 }}
                      />
                    </Card>
                  </Col>
                </Row>

                <Card styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
                  <Table
                    dataSource={[...(data.trend || [])].sort((a, b) => b.date.localeCompare(a.date))}
                    columns={trendColumns}
                    rowKey="date"
                    size="small"
                    pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                    locale={{ emptyText: '暂无标准TMT历史数据' }}
                    scroll={{ x: 900 }}
                    title={() => <Text strong>{trendWindowTitle}</Text>}
                  />
                </Card>

                <Text type="secondary" style={{ fontSize: 12 }}>
                  成交额占比 = 电子、计算机、通信、传媒成交额合计 ÷ 全A成交额；融资余额占比 = 四行业融资余额合计 ÷ 沪深全市场融资余额。当前不设置绝对风险阈值，待标准口径历史样本积累后再校准。
                </Text>
              </>
            )}
          </div>
        </Card>
    </div>
  );
};

export default TMTMarginPanel;
