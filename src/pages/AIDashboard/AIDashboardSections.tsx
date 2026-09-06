import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import OpenRouterWeeklyChart from './OpenRouterWeeklyChart';
import { arrChartSeries, arrSourceCategory, arrValueLabel, primaryArrMetrics, latestCompanyValuations, type LatestCompanyValuation } from './arrChart';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Grid,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  BankOutlined,
  DownloadOutlined,
  LineChartOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../hooks/useTheme';
import type {
  AiDashboardSnapshot,
  ArrCompanyMetric,
  ArrPoint,
  BenchmarkMetricDefinition,
  BenchmarkModel,
  CapitalEvent,
  CdsCompanyMetric,
  CdsQualityStatus,
  ComputeRentalQuote,
  IceCdsImportStatus,
  PriceEvent,
  TokenPrice,
} from './types';
import {
  benchmarkDisclosureKey,
  benchmarkMetricDisplayLabel,
  benchmarkModelEffortLabel,
  formatBenchmarkValue,
  formatArrDelta,
  formatCurrencyPrice,
  formatMultiple,
  formatPriceChange,
  formatTaskCostComponents,
  formatTaskTokenBreakdown,
  formatTokenCount,
  formatTokenDelta,
  formatUsd,
  groupOfficialBenchmarkMetrics,
  methodologyTooltip,
  officialBenchmarkSummaryRows,
  terminalBenchmarkRunLabel,
  topBenchmarkScoreRows,
} from './viewModel';

const { Text, Title, Link } = Typography;

type DashboardProps = { data: AiDashboardSnapshot };

function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function formatLargeMoney(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const absolute = Math.abs(value);
  const divisor = absolute >= 1_000_000_000 ? 1_000_000_000 : absolute >= 1_000_000 ? 1_000_000 : 1;
  const suffix = divisor === 1_000_000_000 ? 'B' : divisor === 1_000_000 ? 'M' : '';
  return `${currency} ${(value / divisor).toFixed(2)}${suffix}`;
}

function capitalRateLabel(event: CapitalEvent): string {
  if (event.rateType === 'fixed') return event.couponPercent === null ? '固定利率未披露' : `${event.couponPercent.toFixed(2)}% 固定`;
  if (event.rateType === 'floating') return `${event.benchmark || '基准'}${event.spreadBps === null ? '' : ` + ${event.spreadBps}bp`}`;
  if (event.rateType === 'not_applicable') return '股权融资';
  return '利率未披露';
}

function safeTokenNumber(value: string): number {
  try {
    return Number(BigInt(value));
  } catch {
    return 0;
  }
}

function dateLabel(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '—';
}

function ChartCard({ title, extra, children, className = '' }: React.PropsWithChildren<{ title: React.ReactNode; extra?: React.ReactNode; className?: string }>) {
  return <Card className={`ai-section-card ${className}`} title={title} extra={extra}>{children}</Card>;
}

function NoData({ description = '暂无可展示数据' }: { description?: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

function MetricHelp({ point }: { point: ArrPoint | null | undefined }) {
  if (!point?.provenance) return null;
  return (
    <Tooltip title={(
      <Flex vertical gap={3}>
        {methodologyTooltip(point.provenance).map((line) => <span key={line}>{line}</span>)}
        <a href={point.provenance.sourceUrl} target="_blank" rel="noreferrer">查看原始来源</a>
      </Flex>
    )}>
      <QuestionCircleOutlined aria-label="查看数据口径" />
    </Tooltip>
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function useChartPalette() {
  const { theme } = useTheme();
  return useMemo(() => ({
    text: theme === 'dark' ? '#c7c7c7' : '#595959',
    line: theme === 'dark' ? '#3a3a3a' : '#e8e8e8',
    blue: theme === 'dark' ? '#3c9ae8' : '#1677ff',
    cyan: '#13c2c2',
    orange: '#fa8c16',
    red: '#f5222d',
  }), [theme]);
}

const CDS_CHART_STYLE: Record<string, { color: string; min: number; max: number }> = {
  Oracle: { color: '#d97706', min: 140, max: 300 },
  CoreWeave: { color: '#0f9d8f', min: 400, max: 1200 },
  NVIDIA: { color: '#65a30d', min: 30, max: 120 },
  Amazon: { color: '#f59e0b', min: 30, max: 100 },
  Google: { color: '#3b82f6', min: 30, max: 100 },
  Microsoft: { color: '#0f9d8f', min: 30, max: 100 },
  Meta: { color: '#1677ff', min: 50, max: 120 },
};
const DEFAULT_CDS_CHART_STYLE = { color: '#1677ff', min: 0, max: 100 };

function CdsChangeBadge({ value, label }: { value: number | null; label: string }) {
  const direction = value === null || value === 0 ? 'flat' : value > 0 ? 'up' : 'down';
  const icon = direction === 'up'
    ? <ArrowUpOutlined />
    : direction === 'down' ? <ArrowDownOutlined /> : <ArrowRightOutlined />;
  const formatted = value === null ? '—' : `${value > 0 ? '+' : ''}${compactNumber(value)}bp`;
  return (
    <span className="ai-cds-change-wrap">
      <span className={`ai-cds-change ai-cds-change-${direction}`}>{icon} {formatted}</span>
      <Text type="secondary" className="ai-cds-change-label">{label}</Text>
    </span>
  );
}

function cdsQualityLabel(status: CdsQualityStatus | undefined): string {
  if (status === 'validated') return '已通过官方基准验证';
  if (status === 'model-derived') return '模型换算值';
  if (status === 'needs-review') return '待复核';
  if (status === 'stale') return '数据过期';
  return '不可用';
}

function CdsQualityTag({ status }: { status?: CdsQualityStatus }) {
  const color = status === 'validated'
    ? 'success'
    : status === 'model-derived'
      ? 'blue'
      : status === 'needs-review'
        ? 'warning'
        : status === 'stale' ? 'error' : 'default';
  return <Tag color={color}>{cdsQualityLabel(status)}</Tag>;
}

function CdsSummaryCard({ metric }: { metric: CdsCompanyMetric }) {
  return (
    <Card className="ai-cds-summary-card" variant="outlined">
      <Flex justify="space-between" align="flex-start" gap={8} wrap>
        <Text className="ai-cds-summary-title">{metric.company.toUpperCase()} 5Y CDS 信用违约互换利差</Text>
        <CdsQualityTag status={metric.qualityStatus} />
      </Flex>
      <Tooltip title={(
        <Space orientation="vertical" size={2}>
          <Text style={{ color: 'inherit' }}>EOD Price：{metric.latestEodPrice?.toFixed(4) ?? '—'}</Text>
          <Text style={{ color: 'inherit' }}>合约：{metric.latestInstrumentName || '—'}</Text>
          <Text style={{ color: 'inherit' }}>状态：{cdsQualityLabel(metric.qualityStatus)}</Text>
        </Space>
      )}>
        <div className="ai-cds-latest-value">
          {compactNumber(metric.latestBp)} <span>bp</span>
        </div>
      </Tooltip>
      <Flex wrap gap={12} className="ai-cds-changes">
        <CdsChangeBadge value={metric.changes.oneDayBp} label="1天" />
        <CdsChangeBadge value={metric.changes.sevenDayBp} label="7天" />
        <CdsChangeBadge value={metric.changes.oneMonthBp} label="1月" />
      </Flex>
    </Card>
  );
}

function CdsTrendChart({
  metric,
}: {
  metric: CdsCompanyMetric;
}) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const style = CDS_CHART_STYLE[metric.company] || DEFAULT_CDS_CHART_STYLE;
  const labelInterval = Math.max(0, Math.ceil(metric.history.length / (compact ? 5 : 8)) - 1);
  const values = metric.history.map((point) => point.valueBp);
  const chartMin = values.length > 0 ? Math.min(style.min, Math.floor(Math.min(...values) / 10) * 10) : style.min;
  const chartMax = values.length > 0 ? Math.max(style.max, Math.ceil(Math.max(...values) / 10) * 10) : style.max;
  const option = useMemo(() => ({
    animationDuration: 350,
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ dataIndex: number; marker: string }>) => {
        const point = metric.history[params[0]?.dataIndex];
        if (!point) return '';
        const isScreenshotBackfill = point.sourceKind === 'screenshot_backfill';
        return [
          `<b>${escapeHtml(metric.company)} · ${escapeHtml(point.date)}</b>`,
          `${params[0]?.marker || ''}Spread：${escapeHtml(compactNumber(point.valueBp))} bp`,
          `EOD Price：${point.eodPrice === undefined ? '—' : escapeHtml(point.eodPrice.toFixed(4))}`,
          `来源：${isScreenshotBackfill ? '用户截图曲线回填（近似）' : 'ICE EOD Price · 模型换算'}`,
          `合约：${escapeHtml(point.instrumentName || '—')}`,
          `状态：${isScreenshotBackfill ? '截图历史参考' : escapeHtml(cdsQualityLabel(point.qualityStatus))}`,
        ].join('<br/>');
      },
    },
    grid: { left: compact ? 48 : 64, right: compact ? 10 : 18, top: 20, bottom: compact ? 62 : 58 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: metric.history.map((point) => point.date),
      axisLabel: { color: palette.text, fontSize: compact ? 9 : 11, rotate: 32, interval: labelInterval, hideOverlap: true },
      axisLine: { lineStyle: { color: palette.line } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: compact ? '' : 'CDS 信用违约互换利差 (bp)',
      nameLocation: 'middle',
      nameGap: 43,
      min: chartMin,
      max: chartMax,
      axisLabel: { color: palette.text, fontSize: compact ? 9 : 11 },
      nameTextStyle: { color: palette.text, fontSize: 11 },
      splitLine: { lineStyle: { color: palette.line } },
    },
    series: [{
      name: `${metric.company} 5Y CDS`,
      type: 'line',
      smooth: 0.25,
      showSymbol: false,
      data: metric.history.map((point) => ({ value: point.valueBp })),
      lineStyle: { color: style.color, width: 2.2 },
      itemStyle: { color: style.color },
      areaStyle: { color: style.color, opacity: 0.1 },
    }],
  }), [chartMax, chartMin, compact, labelInterval, metric, palette, style]);
  return (
    <Card className="ai-cds-chart-card" variant="outlined">
      <Title level={5}>{metric.company} 5Y CDS 信用违约互换利差（bp）</Title>
      <Text type="secondary" className="ai-cds-chart-source">截图历史回填 + ICE EOD Price · ISDA 换算值</Text>
      {metric.history.length > 0
        ? <ReactECharts option={option} style={{ height: compact ? 300 : 330 }} notMerge />
        : <NoData description="暂无 CDS 历史数据" />}
    </Card>
  );
}

function CdsRiskSection({
  data,
  importStatus,
  onImport,
}: DashboardProps & { importStatus?: IceCdsImportStatus | null; onImport?: () => void }) {
  const cds = data.creditRisk?.cds5y;
  const companies = cds?.companies || [];
  return (
    <section className="ai-cds-section" aria-labelledby="ai-cds-title">
      <Flex className="ai-cds-section-header" justify="space-between" align="flex-start" gap={16} wrap>
        <div>
          <Title level={4} id="ai-cds-title">5Y CDS 信用风险监测</Title>
          <Text type="secondary">信用利差越高，市场定价的信用风险通常越高</Text>
        </div>
        <Space size={8} wrap>
          <Tag color="blue">截至 {dateLabel(cds?.asOf)}</Tag>
          {cds?.sourceUrl
            ? <Tag><Link href={cds.sourceUrl} target="_blank" rel="noreferrer">{cds.sourceLabel}</Link></Tag>
            : <Tag>{cds?.sourceLabel || 'ICE EOD Price · ISDA 换算值'}</Tag>}
          {cds?.qualityStatus ? <CdsQualityTag status={cds.qualityStatus} /> : null}
          {data.sources.creditRisk?.stale ? <Tag color="warning">数据过期 · 使用上一版</Tag> : null}
          {importStatus?.workbookAvailable
            ? <Button size="small" icon={<DownloadOutlined />} href="/api/ai-dashboard/cds/export.xlsx">下载 Excel</Button>
            : null}
          {importStatus?.localWriteAllowed && onImport
            ? <Button size="small" type="primary" icon={<UploadOutlined />} onClick={onImport}>导入 ICE 当日数据</Button>
            : null}
        </Space>
      </Flex>
      {companies.length === 0 ? (
        <Card className="ai-cds-empty-card" variant="outlined"><NoData description="等待导入 ICE EOD Price" /></Card>
      ) : (
        <>
          <Row gutter={[12, 12]}>
            {companies.map((metric) => (
              <Col xs={24} md={8} key={metric.company}>
                <CdsSummaryCard metric={metric} />
              </Col>
            ))}
          </Row>
          <Row gutter={[12, 12]}>
            {companies.map((metric) => (
              <Col xs={24} md={12} key={metric.company}>
                <CdsTrendChart metric={metric} />
              </Col>
            ))}
          </Row>
        </>
      )}
      <div className="ai-cds-disclosure">
        <Text type="secondary">数据说明：{cds?.note || 'Spread (bp) 为 ICE EOD Price 经模型换算的估算值，不代表 ICE 官方 spread。'}</Text>
      </div>
    </section>
  );
}

function CombinedArrChart({ metrics, height = 360 }: { metrics: ArrCompanyMetric[]; height?: number }) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const option = useMemo(() => {
    const series = arrChartSeries(metrics);
    const companyColor = (company: string) => company === 'Anthropic' ? palette.cyan : palette.red;
    const dotColor = (point: ArrPoint) => arrSourceCategory(point) === 'official' ? palette.blue : arrSourceCategory(point) === 'yipit' ? palette.orange : '#929aaa';
    return {
      useUTC: true,
      animationDuration: 250,
      tooltip: {
        trigger: 'item', confine: true, enterable: true,
        formatter: (item: { marker: string; seriesName: string; data: { point: ArrPoint } }) => {
          const point = item.data.point;
          const date = point.datePrecision === 'month' ? point.month : point.datePrecision === 'month-start' ? `${point.month} 月初` : point.observedAt;
          const sourceLink = point.sourceUrl?.startsWith('https://')
            ? `<a href="${escapeHtml(point.sourceUrl)}" target="_blank" rel="noreferrer">来源 ${escapeHtml(point.sourceCell || '')}</a>` : '';
          return [
            `${item.marker}<b>${escapeHtml(item.seriesName)}</b>`,
            `${escapeHtml(date)} · 历史观测`,
            `来源：${escapeHtml(point.sourceLabel)} · ${{ official: '官方口径', yipit: 'Yipit', unspecified: '原表未注明来源' }[arrSourceCategory(point)]}`,
            `ARR：${escapeHtml(arrValueLabel(point))} 亿美元`,
            point.valueHigh !== undefined ? '图中以区间中点定位，原始区间见上方。' : '',
            point.kind === 'actual' && point.comparisonLabel ? `${point.consecutiveMonth ? '月环比' : '相邻观测变化'}：${escapeHtml(formatArrDelta(point.momAbsolute, point.momPercent))}<br/>${escapeHtml(point.comparisonLabel)}` : '',
            `口径：${escapeHtml(point.methodology || point.provenance?.methodology || point.sourceLabel)}`,
            point.commentary ? `备注：${escapeHtml(point.commentary)}` : '', sourceLink,
          ].filter(Boolean).join('<br/>');
        },
      },
      legend: { top: 0, type: 'scroll', textStyle: { color: palette.text },

      },
      grid: { left: compact ? 44 : 64, right: 36, top: 60, bottom: 72 },
      dataZoom: [{ type: 'slider', bottom: 0, height: 22 }, { type: 'inside' }],
      xAxis: { type: 'time', axisLabel: { color: palette.text, fontSize: compact ? 9 : 12, hideOverlap: true }, axisLine: { lineStyle: { color: palette.line } } },
      yAxis: { type: 'value', name: '亿美元', nameTextStyle: { color: palette.text }, axisLabel: { color: palette.text }, splitLine: { lineStyle: { color: palette.line } } },
      series: series.map((series) => ({
        ...series,
        lineStyle: { color: companyColor(series.company), width: 2.5 },
        itemStyle: { color: companyColor(series.company) },
        data: series.data.map((item) => ({ ...item, itemStyle: { color: dotColor(item.point) } })),
        label: { show: true, position: 'top', color: palette.text, fontSize: compact ? 9 : 11,
          formatter: (params: { data: { point: ArrPoint } }) => arrValueLabel(params.data.point) },
        labelLayout: { hideOverlap: true },
        emphasis: { focus: 'series' },
      })),
    };
  }, [compact, metrics, palette]);
  if (!metrics.some((metric) => metric.actualPoints.length || metric.forecastPoints.length)) return <NoData description="暂无 ARR 数据" />;
  return <><Space wrap size={12}><Text type="secondary">● Anthropic · ◆ OpenAI</Text><Tag color="blue">官方披露</Tag><Tag color="orange">Yipit</Tag><Tag>原表未注明来源</Tag></Space><ReactECharts option={option} style={{ height }} notMerge /></>;
}

function OpenRouterTopChart({ data, height = 350 }: { data: AiDashboardSnapshot['openRouter']; height?: number }) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const option = useMemo(() => {
    const models = data.topModels.map((item) => item.model).reverse();
    const values = data.topModels.map((item) => safeTokenNumber(item.totalTokens)).reverse();
    return {
      animationDuration: 350,
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number) => formatTokenCount(String(Math.round(value))) },
      grid: { left: compact ? 112 : 238, right: compact ? 14 : 70, top: 12, bottom: 28 },
      xAxis: { type: 'value', axisLabel: { color: palette.text, fontSize: compact ? 8 : 12, formatter: (value: number) => formatTokenCount(String(Math.round(value))) }, splitLine: { lineStyle: { color: palette.line } } },
      yAxis: {
        type: 'category',
        data: models,
        axisLabel: { color: palette.text, width: compact ? 100 : 215, overflow: 'break', lineHeight: compact ? 11 : 15, fontSize: compact ? 8 : 12, interval: 0 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: values,
        barMaxWidth: 20,
        itemStyle: { color: palette.blue, borderRadius: [0, 3, 3, 0] },
        label: { show: !compact, position: 'right', color: palette.text, formatter: (params: { value: number }) => formatTokenCount(String(Math.round(params.value))) },
      }],
    };
  }, [compact, data.topModels, palette]);
  if (data.topModels.length === 0) return <NoData description="暂无 OpenRouter 排名" />;
  return <ReactECharts option={option} style={{ height }} notMerge />;
}

function OpenRouterHistoryChart({ data }: { data: AiDashboardSnapshot['openRouter'] }) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const option = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ seriesName: string; marker: string; data: number | null; dataIndex: number }>) => {
        const point = data.history[params[0]?.dataIndex];
        if (!point) return '';
        return [
          `<b>${escapeHtml(point.startDate)} → ${escapeHtml(point.endDate)}</b>`,
          `周 Token：${escapeHtml(formatTokenCount(point.totalTokens))}`,
          `周环比：${escapeHtml(formatTokenDelta(point.weekOverWeekAbsolute, point.weekOverWeekPercent))}`,
        ].join('<br/>');
      },
    },
    legend: { top: 0, textStyle: { color: palette.text } },
    grid: { left: compact ? 45 : 72, right: compact ? 45 : 72, top: 42, bottom: 42 },
    xAxis: { type: 'category', data: data.history.map((item) => item.endDate), axisLabel: { color: palette.text, rotate: 30, fontSize: compact ? 8 : 12 }, axisLine: { lineStyle: { color: palette.line } } },
    yAxis: [
      { type: 'value', axisLabel: { color: palette.text, fontSize: compact ? 8 : 12, formatter: (value: number) => formatTokenCount(String(Math.round(value))) }, splitLine: { lineStyle: { color: palette.line } } },
      { type: 'value', axisLabel: { color: palette.text, fontSize: compact ? 8 : 12, formatter: (value: number) => formatTokenCount(String(Math.round(value))) }, splitLine: { show: false } },
    ],
    series: [
      { name: '周 Token 总量', type: 'line', smooth: true, symbolSize: 7, areaStyle: { opacity: 0.08 }, data: data.history.map((item) => safeTokenNumber(item.totalTokens)), itemStyle: { color: palette.cyan }, lineStyle: { width: 3, color: palette.cyan } },
      { name: '周环比增量', type: 'bar', yAxisIndex: 1, data: data.history.map((item) => item.weekOverWeekAbsolute === null ? null : safeTokenNumber(item.weekOverWeekAbsolute)), itemStyle: { color: palette.orange, opacity: 0.72 } },
    ],
  }), [compact, data.history, palette]);
  if (data.history.length === 0) return <NoData description="暂无 12 周历史" />;
  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}

function latestArrCompany(data: AiDashboardSnapshot) {
  return primaryArrMetrics(data.arrAndValuation.companies).toSorted((left, right) => (right.latestActual?.observedAt || '').localeCompare(left.latestActual?.observedAt || ''))[0] || null;
}

export function OverviewSection({ data }: DashboardProps) {
  const arr = latestArrCompany(data);
  const arrPoint = arr?.latestActual;
  const capital = data.capitalEvents?.[0] || data.debtFinancing?.[0];
  const currentValuations = latestCompanyValuations(data.arrAndValuation.valuations, data.arrAndValuation.companies);
  const valuation = currentValuations.find((row) => row.company === 'Anthropic' && row.parrLow !== null);
  return (
    <div className="ai-section-stack">
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card className="ai-kpi-card">
            <Statistic
              title={<Space size={6}><span>{`最新 ARR${arr ? ` · ${arr.company}` : ''}`}</span><MetricHelp point={arrPoint} /></Space>}
              value={arrPoint?.value ?? '—'}
              suffix={arr ? '亿美元' : undefined}
              precision={arr ? 2 : undefined}
              prefix={<LineChartOutlined />}
            />
            <Text type="secondary">{arrPoint ? `${arr.sourceLabel} · ${arrPoint.observedAt} · 较上次 ${formatArrDelta(arrPoint.momAbsolute, arrPoint.momPercent)}` : '暂无环比观测'}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="ai-kpi-card">
            <Statistic title="OpenRouter Top 10 · 七日 Token" value={formatTokenCount(data.openRouter.top10TotalTokens ?? null)} prefix={<ThunderboltOutlined />} />
            <Text type="secondary">官网榜单约数合计 · 截至 {dateLabel(data.openRouter.endDate)}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="ai-kpi-card ai-debt-kpi">
            <Statistic title={`最新融资规模${capital ? ` · ${capital.entity}` : ''}`} value={capital ? formatLargeMoney(capital.amountOriginal, capital.currency) : '—'} prefix={<BankOutlined />} />
            <Text strong>{capital?.instrument || '暂无结构化融资事件'}</Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card className="ai-kpi-card">
            <Statistic title={`最新 P/ARR${valuation ? ` · ${valuation.company}` : ''}`} value={valuation ? formatMultiple(valuation.parrLow, valuation.parrHigh) : '—'} />
            <Text type="secondary">估值期间 {valuation?.datePrecision === 'month' ? valuation.asOf.slice(0, 7) : dateLabel(valuation?.asOf)} · ARR 更新 {valuation?.datePrecision === 'month' ? valuation.arrAsOf?.slice(0, 7) : dateLabel(valuation?.arrAsOf)}</Text>
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <ChartCard title="OpenAI 与 Anthropic · 历史 ARR" extra={arr?.stale ? <Tag color="warning">部分观测超过 18 天</Tag> : <Tag color="success">观测有效</Tag>}>
            <CombinedArrChart metrics={primaryArrMetrics(data.arrAndValuation.companies)} height={340} />
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard title="OpenRouter Top 10 · 周公开 Token" extra={<Text type="secondary">含量级，不代表模型质量</Text>}>
            <OpenRouterTopChart data={data.openRouter} height={340} />
          </ChartCard>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <ChartCard title="最新融资事件" extra={<Text type="secondary">股权、债务与可转债统一事件口径</Text>}>
            {capital ? (
              <Descriptions bordered column={{ xs: 1, sm: 2 }} size="small">
                <Descriptions.Item label="融资手段"><Text strong className="ai-emphasis-value">{capital.instrument}</Text></Descriptions.Item>
                <Descriptions.Item label="融资规模"><Text strong className="ai-emphasis-value">{formatLargeMoney(capital.amountOriginal, capital.currency)}</Text></Descriptions.Item>
                <Descriptions.Item label="公司">{capital.entity}</Descriptions.Item>
                <Descriptions.Item label="日期">{dateLabel(capital.eventDate)}</Descriptions.Item>
                <Descriptions.Item label="利率 / 类型">{capitalRateLabel(capital)}</Descriptions.Item>
                <Descriptions.Item label="来源"><a href={capital.sourceUrl} target="_blank" rel="noreferrer">{capital.sourceLabel}</a></Descriptions.Item>
              </Descriptions>
            ) : <NoData description="暂无结构化融资数据" />}
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard title="最新估值与 P/ARR">
            <ValuationTable data={currentValuations} />
          </ChartCard>
        </Col>
      </Row>
    </div>
  );
}

function ValuationTable({ data }: { data: LatestCompanyValuation[] }) {
  return <Table
    rowKey="company" size="small" pagination={false} scroll={{ x: 620 }}
    locale={{ emptyText: <NoData description="暂无估值数据" /> }} dataSource={data}
    columns={[
      { title: '公司', dataIndex: 'company', fixed: 'left', width: 115 },
      { title: '估值（亿美元）', width: 155, align: 'right', render: (_, row) => row.valuationLow === row.valuationHigh ? compactNumber(row.valuationLow) : `${compactNumber(row.valuationLow)}–${compactNumber(row.valuationHigh)}` },
      { title: 'ARR', width: 110, align: 'right', render: (_, row) => row.arrPoint ? arrValueLabel(row.arrPoint) : '—' },
      { title: 'P/ARR', width: 120, align: 'right', render: (_, row) => <Text strong>{row.parrUpperBound && row.parrHigh !== null ? `<${formatMultiple(row.parrHigh, row.parrHigh)}` : formatMultiple(row.parrLow, row.parrHigh)}</Text> },
      { title: '来源', width: 190, render: (_, row) => <Tooltip title={<>
        <div>估值：{row.datePrecision === 'month' ? row.asOf.slice(0, 7) : row.asOf} · {row.sourceLabel} {row.sourceCell}</div>
        <div>ARR：{row.arrPoint?.datePrecision === 'month' ? row.arrPoint.month : row.arrAsOf || '未披露'} · {row.arrSourceLabel} {row.arrPoint?.sourceCell}</div>
        <div>最新明确估值 ÷ 最新历史 ARR；两项日期可能不同。</div>
        {row.multipleKind === 'P/S' && <div>原表倍数列为 P/S；此处使用 ARR 跟踪值重新计算。</div>}
      </>}><Space size={5}>
        {row.sourceUrl ? <Link href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceLabel?.includes('飞书') ? '飞书表格' : row.sourceLabel || '估值来源'}</Link> : <Text>{row.sourceLabel || '未注明'}</Text>}
        {row.arrSourceLabel && row.arrSourceLabel !== row.sourceLabel && row.arrPoint?.sourceUrl && <><Text type="secondary">/</Text><Link href={row.arrPoint.sourceUrl} target="_blank" rel="noreferrer">{row.arrSourceLabel}</Link></>}
      </Space></Tooltip> },
    ]}
  />;
}

export function ArrValuationSection({ data }: DashboardProps) {
  const metrics = data.arrAndValuation.companies;
  const primary = primaryArrMetrics(metrics);
  const latest = ['Anthropic', 'OpenAI'].map((company) => primary.filter((m) => m.company === company && m.latestActual).toSorted((a, b) => b.latestActual!.observedAt.localeCompare(a.latestActual!.observedAt))[0]).filter(Boolean);
  const reference = data.arrAndValuation.reference;
  const currentValuations = latestCompanyValuations(data.arrAndValuation.valuations, metrics);
  return (
    <div className="ai-section-stack">
      {reference && <Alert type="info" showIcon title="数据已按飞书表格核对" description={<>
        <Link href={reference.url} target="_blank" rel="noreferrer">{reference.title} · {reference.sheet}</Link>
        <span> · 导入 {reference.retrievedAt.slice(0, 10)} · 表格修改 {reference.sourceUpdatedAt}。{reference.note}</span>
      </>} />}
      <ChartCard title="最新估值与 P/ARR" extra={<Text type="secondary">金额单位：亿美元</Text>}>
        <ValuationTable data={currentValuations} />
      </ChartCard>
      <ChartCard title="OpenAI 与 Anthropic · 历史 ARR" extra={<Text type="secondary">单位：亿美元</Text>}>
        <Row gutter={[20, 12]}>
          <Col xs={24} lg={18}><CombinedArrChart metrics={primary} height={370} /></Col>
          <Col xs={24} lg={6}>
            <Flex vertical gap={14} className="ai-arr-aside">
              {latest.map((metric) => metric.latestActual && <Card size="small" key={metric.seriesId}>
                <Statistic title={`${metric.company} · ${metric.sourceLabel}`} value={arrValueLabel(metric.latestActual)} suffix="亿美元" />
                <Text type="secondary">观测 {metric.latestActual.observedAt}</Text><br/>
                <Text type="secondary">较上次 {formatArrDelta(metric.latestActual.momAbsolute, metric.latestActual.momPercent)}</Text>
              </Card>)}
              <Text type="secondary">汇集两家公司全部历史观测。点颜色区分来源，形状区分公司；拖动下方时间条可放大查看。Yipit 已乘 10 换算为亿美元。</Text>
              {primary.some((m) => m.stale) && <Tag color="warning">最近观测超过 18 天</Tag>}
            </Flex>
          </Col>
        </Row>
      </ChartCard>
    </div>
  );
}

export function OpenRouterSection({ data, refreshing = false }: DashboardProps & { refreshing?: boolean }) {
  return (
    <div className="ai-section-stack">
      <ChartCard title="OpenRouter 每周 Token 用量">
        <OpenRouterWeeklyChart history={data.openRouter.weeklyHistory} latestDate={data.openRouter.endDate} error={data.openRouter.weeklyHistoryError} />
      </ChartCard>
      <Alert
        type="info"
        showIcon
        title="口径说明"
        description="直接同步 OpenRouter 官网 This Week 榜单：截至最新完整 UTC 数据日的滚动七天，包含输入与输出 Token。数量与模型周环比均为官网显示约数，免费版本单独排名。Top 10 合计仅覆盖这十个模型；网页表格未提供全平台七日总量及对应周环比。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card className="ai-kpi-card"><Statistic title="Top 10 · 七日 Token 合计（约）" value={formatTokenCount(data.openRouter.top10TotalTokens ?? null)} /><Text type="secondary">官网显示值相加，仅覆盖榜单前十名</Text></Card>
        </Col>
        <Col xs={24} md={12}>
          <Card className="ai-kpi-card"><Statistic title="官网数据截至（UTC）" value={data.openRouter.endDate || '—'} /><Text type="secondary">统计窗口：{dateLabel(data.openRouter.startDate)} → {dateLabel(data.openRouter.endDate)}</Text></Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={data.openRouter.history.length ? 14 : 24}><ChartCard title="Top 10 模型 · 七日 Token（官网约数）"><OpenRouterTopChart data={data.openRouter} height={430} /></ChartCard></Col>
        {data.openRouter.history.length > 0 && <Col xs={24} xl={10}><ChartCard title="已保存的平台周 Token 历史"><OpenRouterHistoryChart data={data.openRouter} /></ChartCard></Col>}
      </Row>
      <ChartCard title="官网周排名表" extra={<Link href="https://openrouter.ai/rankings" target="_blank" rel="noopener noreferrer">查看 OpenRouter 原网页 ↗</Link>}>
        <Table
          size="small"
          rowKey="model"
          pagination={false}
          loading={refreshing}
          scroll={{ x: 650 }}
          locale={{ emptyText: <NoData description="暂无 OpenRouter 数据" /> }}
          dataSource={data.openRouter.topModels}
          columns={[
            { title: '排名', dataIndex: 'rank', width: 72 },
            { title: '模型', dataIndex: 'model', className: 'ai-model-name', render: (value, row) => <Tooltip title={value}>{row.url ? <Link href={row.url} target="_blank" rel="noopener noreferrer">{value}</Link> : <span>{value}</span>}</Tooltip> },
            { title: '七日公开 Token（约）', dataIndex: 'totalTokens', width: 180, align: 'right', render: (value, row) => <Text strong>{row.tokenDisplay || `${row.approximate ? '≈' : ''}${formatTokenCount(value)}`}</Text> },
            { title: '模型周环比（约）', dataIndex: 'weekOverWeekPercent', width: 155, align: 'right', render: (value: number | null | undefined) => value == null ? '—' : <Text type={value < 0 ? 'danger' : value > 0 ? 'success' : undefined}>{value > 0 ? '+' : ''}{compactNumber(value * 100)}%</Text> },
          ]}
        />
        <Text type="secondary" className="ai-attribution">{data.openRouter.attribution}</Text>
      </ChartCard>
    </div>
  );
}

function TokenPriceCharts({ prices }: { prices: TokenPrice[] }) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  if (prices.length === 0) return <NoData description="暂无 API Token 价格" />;
  const grouped = prices.reduce((groups, row) => {
    const currency = row.currency || '未标注';
    groups.set(currency, [...(groups.get(currency) || []), row]);
    return groups;
  }, new Map<string, TokenPrice[]>());
  return (
    <div className="ai-section-stack">
      {[...grouped.entries()].map(([currency, currencyPrices]) => {
        const rows = currencyPrices.slice(0, 30).toReversed();
        const labels = rows.map((row) => [
          row.model,
          row.contextTier && row.contextTier !== 'standard' ? row.contextTier : null,
          row.serviceTier && row.serviceTier !== 'standard' ? row.serviceTier : null,
        ].filter(Boolean).join(' · '));
        const height = Math.max(320, Math.min(760, rows.length * 34 + 90));
        const option = {
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            valueFormatter: (value: number) => formatCurrencyPrice(value, currency, 3),
          },
          legend: { top: 0, textStyle: { color: palette.text } },
          grid: { left: compact ? 112 : 230, right: compact ? 10 : 35, top: 44, bottom: 28 },
          xAxis: {
            type: 'value',
            name: compact ? '' : `${currency} / 1M Tokens`,
            nameTextStyle: { color: palette.text },
            axisLabel: { color: palette.text, fontSize: compact ? 8 : 12 },
            splitLine: { lineStyle: { color: palette.line } },
          },
          yAxis: {
            type: 'category',
            data: labels,
            axisLabel: { color: palette.text, fontSize: compact ? 8 : 12, lineHeight: compact ? 11 : 15, width: compact ? 100 : 205, overflow: 'break', interval: 0 },
            axisTick: { show: false },
          },
          series: [
            { name: '输入', type: 'bar', data: rows.map((row) => row.inputPrice), itemStyle: { color: palette.blue } },
            { name: '缓存读取', type: 'bar', data: rows.map((row) => row.cacheReadPrice), itemStyle: { color: palette.cyan } },
            { name: '缓存写入', type: 'bar', data: rows.map((row) => row.cacheWritePrice), itemStyle: { color: '#722ed1' } },
            { name: '输出', type: 'bar', data: rows.map((row) => row.outputPrice), itemStyle: { color: palette.orange } },
          ],
        };
        return <ChartCard key={currency} title={`当前代际公开价 · ${currency}`}><ReactECharts option={option} style={{ height }} notMerge /></ChartCard>;
      })}
    </div>
  );
}

const PRICE_FIELD_LABELS: Record<PriceEvent['priceField'], string> = {
  inputPrice: '输入',
  cacheReadPrice: '缓存读取',
  cacheWritePrice: '缓存写入',
  outputPrice: '输出',
};

function PriceEventsCard({ events }: { events: PriceEvent[] }) {
  return (
    <ChartCard title="近期官方调价" extra={<Text type="secondary">仅同一 SKU 可比</Text>}>
      <Table
        rowKey="id"
        size="small"
        pagination={{ pageSize: 8, showSizeChanger: false }}
        locale={{ emptyText: <NoData description="尚无可确认的同 SKU 调价记录" /> }}
        dataSource={events}
        columns={[
          { title: '日期', dataIndex: 'asOf', width: 100, render: dateLabel },
          { title: '模型 / 价格项', render: (_, row) => <><Text strong>{row.model}</Text><br /><Text type="secondary">{PRICE_FIELD_LABELS[row.priceField]} · {row.contextTier}</Text></> },
          { title: '变化', width: 190, render: (_, row) => <Text className={row.absoluteDelta > 0 ? 'ai-change-up' : 'ai-change-down'}>{formatPriceChange(row)}</Text> },
          { title: '原始来源', width: 90, render: (_, row) => <a href={row.sourceUrl} target="_blank" rel="noreferrer">官网</a> },
        ]}
      />
    </ChartCard>
  );
}

function TokenPricing({ data }: DashboardProps) {
  return (
    <div className="ai-section-stack">
      <Alert
        type="info"
        showIcon
        title="最新代际与可比口径"
        description="主图只展示各厂商当前代际、标准服务档的官网公开价；上下文档位分别保留。USD 与 CNY 分图展示，不做隐含汇率换算。旧代际保存在历史中，仅用于识别同 SKU 调价。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}><TokenPriceCharts prices={data.modelPricing.token} /></Col>
        <Col xs={24} xl={9}><PriceEventsCard events={data.modelPricing.priceEvents || []} /></Col>
      </Row>
      <ChartCard title="当前代际 API Token 价格明细" extra={<Text type="secondary">各币种 / 1M Tokens</Text>}>
        <Table
          rowKey={(row) => `${row.vendor}-${row.model}-${row.contextTier}-${row.serviceTier}-${row.currency}-${row.asOf}`}
          size="small"
          pagination={{ pageSize: 25, showSizeChanger: false }}
          tableLayout="fixed"
          scroll={{ x: 760 }}
          locale={{ emptyText: <NoData description="暂无 API Token 价格" /> }}
          dataSource={data.modelPricing.token}
          columns={[
            { title: '厂商', dataIndex: 'vendor', fixed: 'left', width: 110 },
            { title: '模型', dataIndex: 'model', width: 260, className: 'ai-model-name', render: (value, row) => <>{value}{row.contextTier && row.contextTier !== 'standard' ? <><br /><Text type="secondary">{row.contextTier}</Text></> : null}</> },
            { title: '输入', dataIndex: 'inputPrice', width: 130, align: 'right', render: (value, row) => formatCurrencyPrice(value, row.currency, 3) },
            { title: '缓存', dataIndex: 'cacheReadPrice', width: 130, align: 'right', render: (value, row) => <Tooltip title="缓存读取（命中）价格"><span>{formatCurrencyPrice(value, row.currency, 3)}</span></Tooltip> },
            { title: '输出', dataIndex: 'outputPrice', width: 130, align: 'right', render: (value, row) => formatCurrencyPrice(value, row.currency, 3) },
          ]}
        />
      </ChartCard>
    </div>
  );
}

function VideoPricing({ data }: DashboardProps) {
  return (
    <ChartCard title="视频模型 API 价格" extra={<Text type="secondary">保留官网原始币种与计费单位</Text>}>
      <Table
        rowKey={(row) => `${row.vendor}-${row.model}-${row.mode}-${row.resolution}-${row.durationTier}`}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: false }}
        tableLayout="fixed"
        scroll={{ x: 1000 }}
        locale={{ emptyText: <NoData description="尚未从厂商官网确认可展示的视频 API 价格" /> }}
        dataSource={data.modelPricing.video.filter((row) => row.model !== 'MiniMax-Hailuo-02')}
        columns={[
          { title: '厂商', dataIndex: 'vendor', fixed: 'left', width: 100 },
          { title: '模型', dataIndex: 'model', width: 220, className: 'ai-model-name' },
          { title: '生成模式', dataIndex: 'mode', width: 180 },
          { title: '分辨率', dataIndex: 'resolution', width: 85 },
          { title: '时长档', dataIndex: 'durationTier', width: 130 },
          { title: '公开价格', width: 170, align: 'right', render: (_, row) => row.pricingMode === 'fixed' ? <><Text strong>{formatCurrencyPrice(row.price, row.currency, 3)}</Text><br /><Text type="secondary">{row.displayUnit}</Text></> : <Tag>{row.pricingMode === 'inquiry' ? '询价' : '未公开'}</Tag> },
          { title: '来源', width: 115, render: (_, row) => <a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceLabel}</a> },
        ]}
      />
    </ChartCard>
  );
}

function CodingPlanPricing({ data }: DashboardProps) {
  return (
    <ChartCard title="Coding Plan 价格" extra={<Text type="secondary">套餐价格与额度限制分开记录</Text>}>
      <Table
        rowKey={(row) => `${row.vendor}-${row.plan}`}
        size="small"
        pagination={{ pageSize: 15, showSizeChanger: false }}
        scroll={{ x: 1200 }}
        locale={{ emptyText: <NoData description="尚未从厂商官网确认 Coding Plan 价格" /> }}
        dataSource={data.modelPricing.codingPlans}
        columns={[
          { title: '厂商', dataIndex: 'vendor', fixed: 'left', width: 120 },
          { title: '套餐', dataIndex: 'plan', width: 180 },
          { title: '计价状态', dataIndex: 'pricingMode', width: 100, render: (value) => <Tag>{value === 'fixed' ? '公开价' : value === 'inquiry' ? '询价' : '未公开'}</Tag> },
          { title: '月付', dataIndex: 'monthlyPrice', width: 120, align: 'right', render: (value, row) => row.pricingMode === 'fixed' ? formatCurrencyPrice(value, row.currency) : '—' },
          { title: '年付折算/月', dataIndex: 'annualMonthlyPrice', width: 145, align: 'right', render: (value, row) => row.pricingMode === 'fixed' ? formatCurrencyPrice(value, row.currency) : '—' },
          { title: '额度限制', dataIndex: 'allowanceText', width: 260, render: (value) => value || '未公布' },
          { title: '超量计费', dataIndex: 'overage', width: 180, render: (value) => value || '未公布' },
          { title: '日期', dataIndex: 'asOf', width: 112, render: dateLabel },
          { title: '来源', width: 150, render: (_, row) => <a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceLabel}</a> },
        ]}
      />
    </ChartCard>
  );
}

export function ModelPricingSection({ data }: DashboardProps) {
  return (
    <div className="ai-section-stack">
      <Tabs className="ai-inner-tabs" items={[
        { key: 'token', label: 'API Token', children: <TokenPricing data={data} /> },
        { key: 'video', label: '视频模型', children: <VideoPricing data={data} /> },
        { key: 'coding', label: 'Coding Plan', children: <CodingPlanPricing data={data} /> },
      ]} />
    </div>
  );
}

function benchmarkMetrics(models: BenchmarkModel[]) {
  return [...new Set(models.flatMap((model) => Object.keys(model.scores || {})))];
}

function legacyMetricDefinition(key: string, models: BenchmarkModel[]): BenchmarkMetricDefinition {
  const score = models.find((model) => model.scores?.[key])?.scores?.[key];
  return {
    key,
    label: key,
    group: '厂商官网口径',
    unit: score && Number.isFinite(score.value) && Math.abs(score.value) <= 1 ? 'percent' : (score?.metric || 'number'),
    direction: score?.direction === 'lower' ? 'lower' : 'higher',
    source: score?.source || 'official-model-card',
    sourceUrl: score?.sourceUrl,
  };
}

function BenchmarkScoreTooltip({ score, metric }: {
  score: BenchmarkModel['scores'][string];
  metric: BenchmarkMetricDefinition;
}) {
  return (
    <Space orientation="vertical" size={2}>
      <Text>{metric.label} · {metric.direction === 'lower' ? 'lower-is-better' : 'higher-is-better'}</Text>
      <Text>来源：{score.source || metric.source}</Text>
      {score.asOf && <Text>数据日期：{dateLabel(score.asOf)}</Text>}
      {score.sampleSize !== undefined && <Text>样本数：{score.sampleSize}</Text>}
      {score.standardDeviation !== undefined && <Text>标准差：{score.standardDeviation}</Text>}
      {(score.sourceUrl || metric.sourceUrl) && <a href={(score.sourceUrl || metric.sourceUrl) ?? undefined} target="_blank" rel="noreferrer">查看来源</a>}
    </Space>
  );
}

export function BenchmarkSection({ data, refreshing = false }: DashboardProps & { refreshing?: boolean }) {
  const metrics = data.benchmarks.metrics?.length
    ? data.benchmarks.metrics
    : benchmarkMetrics(data.benchmarks.models).map((key) => legacyMetricDefinition(key, data.benchmarks.models));
  const matrixRows = data.benchmarks.models.map((model) => ({ ...model, key: `${model.vendor}-${model.model}` }));
  const metricGroups = groupOfficialBenchmarkMetrics(metrics);
  const summaryRows = officialBenchmarkSummaryRows({ ...data.benchmarks, metrics });
  const terminalDisclosures = metrics.filter((metric) => (
    metric.testFamily === 'Terminal-Bench' || /terminal[- ]bench/i.test(metric.testName || '')
  )).map((metric) => ({
    metric,
    winner: data.benchmarks.winners[metric.key],
    scores: topBenchmarkScoreRows(matrixRows.flatMap((model) => {
      const score = model.scores?.[metric.key];
      if (!score) return [];
      const disclosures = Array.isArray(score.disclosures) && score.disclosures.length > 0
        ? score.disclosures
        : [score];
      return disclosures.map((disclosure) => ({ vendor: model.vendor, model: model.model, score: disclosure }));
    }), metric.direction),
  })).filter((row) => row.scores.length > 0);
  const otherWinnerGroups = metricGroups.map((group) => ({
    category: group.category,
    rows: summaryRows.filter((row) => row.category === group.category && !row.terminalBench),
  })).filter((group) => group.rows.length > 0);
  const coverage = data.benchmarks.coverage || {
    vendors: matrixRows.length,
    disclosedVendors: matrixRows.filter((model) => Object.keys(model.scores || {}).length > 0).length,
    metrics: metrics.length,
    comparableMetrics: metrics.filter((metric) => metric.comparable !== false).length,
  };
  return (
    <div className="ai-section-stack">
      <Alert
        type={data.benchmarks.sourceMode === 'official-model-cards' ? 'info' : 'warning'}
        showIcon
        title={`${coverage.vendors} 个厂商的最新文本模型 · ${coverage.disclosedVendors} 个官网已披露评分 · ${coverage.comparableMetrics} 个严格可比口径`}
        description={(
          <Flex gap={8} wrap>
            <Text type="secondary">数据日期 {dateLabel(data.benchmarks.asOf)}</Text>
            <Tag color={data.benchmarks.sourceMode === 'official-model-cards' ? 'blue' : 'default'}>{data.benchmarks.sourceMode === 'official-model-cards' ? '厂商官网模型卡' : '等待官网模型卡同步'}</Tag>
            <Tag>无第三方 Benchmark 补数</Tag>
            {refreshing && <Tag color="processing">正在检查最新数据…</Tag>}
          </Flex>
        )}
      />
      <ChartCard
        title="Terminal-Bench 系列 · 厂商官网披露"
        extra={<Text type="secondary">配置一致标严格冠军；否则仅标官网披露最高</Text>}
      >
        {terminalDisclosures.length === 0 ? (
          <NoData description="当前最新模型的官网模型卡尚未披露 Terminal-Bench 成绩" />
        ) : (
          <div className="ai-terminal-bench-grid">
            {terminalDisclosures.map(({ metric, winner, scores }) => (
              <div className="ai-terminal-bench-card" key={metric.key}>
                <Flex justify="space-between" align="start" gap={12}>
                  <div>
                    <Text strong>{benchmarkMetricDisplayLabel(metric)}</Text>
                    <Text className="ai-benchmark-run-label" type="secondary">
                      {[metric.agent, metric.harness].filter(Boolean).join(' · ') || '官网未完整披露运行配置'}
                    </Text>
                  </div>
                  <Tag color={winner ? 'blue' : 'default'}>{winner ? '严格可比' : '合并披露 · 不排名'}</Tag>
                </Flex>
                {scores.map(({ vendor, model, score }) => {
                  const strictChampion = winner?.models.includes(model) === true;
                  const disclosedHighest = !winner && score.value === scores[0]?.score.value;
                  const runLabel = terminalBenchmarkRunLabel(score);
                  return (
                    <Flex className="ai-terminal-score-row" justify="space-between" align="start" gap={8} key={`${vendor}-${model}-${benchmarkDisclosureKey(score)}`}>
                      <Space orientation="vertical" size={0}>
                        <Text>{benchmarkModelEffortLabel(model, score.effort)}</Text>
                        {runLabel && <Text className="ai-benchmark-run-label" type="secondary">{runLabel}</Text>}
                      </Space>
                      <Flex align="center" justify="end" gap={6} wrap>
                        {strictChampion && <Tag color="blue">冠军</Tag>}
                        {disclosedHighest && <Tag color="cyan">披露最高</Tag>}
                        <Text strong={strictChampion || disclosedHighest}>{formatBenchmarkValue(score, metric)}</Text>
                      </Flex>
                    </Flex>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <Text className="ai-benchmark-source-policy" type="secondary">
          每条成绩仅引用该模型厂商自己的官网或官方模型卡；“披露最高”只比较厂商自报数值，Agent、Harness、Effort 不一致时不视为严格排名。
        </Text>
      </ChartCard>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={7}>
          <ChartCard title="各分项最强模型">
            {otherWinnerGroups.length === 0 ? <NoData description="暂无其他严格可比冠军摘要" /> : (
              <div className="ai-winner-list">
                {otherWinnerGroups.map((group) => (
                  <section className="ai-benchmark-category" key={group.category}>
                    <Text className="ai-benchmark-category-title" type="secondary">{group.category}</Text>
                    {group.rows.map((row) => (
                      <div className="ai-winner-row" key={row.metricKey}>
                        <Flex align="start" justify="space-between" gap={8}>
                          <Text strong>{row.label}</Text>
                          <Tag variant="filled">{row.formattedValue}</Tag>
                        </Flex>
                        <Text className="ai-benchmark-run-label" type="secondary">{row.runLabel}</Text>
                        <Text className="ai-winner-name">{row.models.join(' / ')}</Text>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </ChartCard>
        </Col>
        <Col xs={24} xl={17}>
          <ChartCard title="各厂商最新模型 Benchmark 矩阵" extra={<Text type="secondary">旧模型得分不顶替最新模型 · 并列第一完整保留</Text>}>
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              scroll={{ x: Math.max(1320, 800 + metrics.length * 150) }}
              locale={{ emptyText: <NoData description="暂无 Benchmark 数据" /> }}
              dataSource={matrixRows}
              columns={[
                { title: '厂商', dataIndex: 'vendor', fixed: 'left', width: 115 },
                { title: '最新文本模型', dataIndex: 'model', fixed: 'left', width: 220, className: 'ai-model-name' },
                { title: '发布日期', dataIndex: 'releasedAt', width: 112, render: dateLabel },
                {
                  title: '总参数',
                  width: 100,
                  render: (_: unknown, row: BenchmarkModel) => row.specs?.totalParameters || <Text type="secondary">未披露</Text>,
                },
                {
                  title: '激活参数',
                  width: 100,
                  render: (_: unknown, row: BenchmarkModel) => row.specs?.activeParameters || <Text type="secondary">未披露</Text>,
                },
                {
                  title: '上下文长度',
                  width: 170,
                  render: (_: unknown, row: BenchmarkModel) => row.specs?.contextWindowLabel
                    ? <Tooltip title={`标准化：${row.specs.contextWindowTokens?.toLocaleString('en-US') || '未披露'} Tokens · ${row.specs.sourceUrl || '官网模型卡'}`}><span>{row.specs.contextWindowLabel}</span></Tooltip>
                    : <Text type="secondary">未披露</Text>,
                },
                ...metricGroups.map((group) => ({
                  title: group.category,
                  children: group.metrics.map((metric) => ({
                    title: (
                      <Tooltip title={`${metric.label} · ${metric.direction === 'lower' ? 'lower' : 'higher'}-is-better · ${metric.source}`}>
                        <span className="ai-benchmark-metric-title">{metric.label}</span>
                      </Tooltip>
                    ),
                    width: 150,
                    align: 'right' as const,
                    render: (_: unknown, row: BenchmarkModel) => {
                      const score = row.scores?.[metric.key];
                      const champion = data.benchmarks.winners[metric.key]?.models.includes(row.model);
                      if (!score) return <Text type="secondary">—</Text>;
                      return (
                        <Tooltip title={<BenchmarkScoreTooltip score={score} metric={metric} />}>
                          <Text strong={champion} className={champion ? 'ai-benchmark-winner' : ''}>{formatBenchmarkValue(score, metric)}</Text>
                        </Tooltip>
                      );
                    },
                  })),
                })),
              ]}
            />
            {data.benchmarks.attributions?.length > 0 && (
              <Flex className="ai-benchmark-attributions" gap={10} wrap>
                <Text type="secondary">数据来源：</Text>
                {data.benchmarks.attributions.map((source) => source.url
                  ? <a key={`${source.source}-${source.url}`} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
                  : <Text key={`${source.source}-${source.label}`}>{source.label}</Text>)}
              </Flex>
            )}
          </ChartCard>
        </Col>
      </Row>
      <ChartCard title="12 家官网模型卡同步状态" extra={<Text type="secondary">失败仅保留该厂商上一版官网数据，不跨厂商补数</Text>}>
        <div className="ai-vendor-source-grid">
          {(data.benchmarks.vendorSources || []).map((source) => (
            <div className="ai-vendor-source-state" key={source.vendor}>
              <Flex justify="space-between" gap={8}>
                <Text strong>{source.vendor}</Text>
                <Tag color={source.status === 'ready' && !source.stale ? 'success' : source.status === 'ready' ? 'warning' : 'default'}>
                  {source.status === 'ready' ? (source.stale ? '人工发现' : '已同步') : source.status === 'unavailable' ? '未披露' : '读取失败'}
                </Tag>
              </Flex>
              <Text>{source.model || '尚未确认当前旗舰模型卡'}</Text>
              <Text type="secondary">{source.disclosedScores} 项官网评分 · {dateLabel(source.releasedAt)}</Text>
              {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">打开官网来源</a>}
              {source.error && <Text type="secondary">{source.error}</Text>}
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}

export function ArtificialAnalysisSection({ data }: DashboardProps) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const indexRows = useMemo(
    () => data.artificialAnalysis.intelligenceIndex || [],
    [data.artificialAnalysis.intelligenceIndex],
  );
  const taskCosts = useMemo(
    () => data.artificialAnalysis.taskCosts || [],
    [data.artificialAnalysis.taskCosts],
  );
  const scatterRows = useMemo(
    () => taskCosts.filter((row) => row.outputTokens !== null && row.totalCost !== null),
    [taskCosts],
  );
  const indexOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ dataIndex: number; value: number }>) => {
        const point = params[0];
        const row = indexRows[point?.dataIndex];
        return row ? `<b>#${row.rank} ${row.model}</b><br/>AA Intelligence Index: ${row.score.toFixed(1)}<br/>v${row.indexVersion} · ${row.asOf}` : '';
      },
    },
    grid: { left: compact ? 128 : 250, right: 28, top: 16, bottom: 36 },
    xAxis: { type: 'value', name: 'Index', axisLabel: { color: palette.text }, splitLine: { lineStyle: { color: palette.line } } },
    yAxis: {
      type: 'category', inverse: true, data: indexRows.map((row) => row.model),
      axisLabel: { color: palette.text, width: compact ? 112 : 230, overflow: 'truncate', fontSize: compact ? 9 : 11 },
      axisTick: { show: false },
    },
    series: [{ type: 'bar', data: indexRows.map((row) => row.score), itemStyle: { color: palette.blue, borderRadius: [0, 5, 5, 0] } }],
  }), [compact, indexRows, palette]);
  const taskOption = useMemo(() => ({
    tooltip: {
      trigger: 'item',
      formatter: ({ data }: { data: { value: [number, number]; model: string } }) => `<b>${data.model}</b><br/>Output Tokens / task: ${Math.round(data.value[0]).toLocaleString('en-US')}<br/>Cost / task: $${data.value[1].toFixed(4)}`,
    },
    grid: { left: compact ? 54 : 78, right: 24, top: 20, bottom: 52 },
    xAxis: { type: 'value', name: 'Output Tokens / task', nameLocation: 'middle', nameGap: 32, axisLabel: { color: palette.text }, splitLine: { lineStyle: { color: palette.line } } },
    yAxis: { type: 'value', name: 'USD / task', axisLabel: { color: palette.text }, splitLine: { lineStyle: { color: palette.line } } },
    series: [{
      type: 'scatter', symbolSize: compact ? 11 : 15,
      data: scatterRows.map((row) => ({ value: [row.outputTokens, row.totalCost], model: row.model })),
      itemStyle: { color: palette.orange },
    }],
  }), [compact, palette, scatterRows]);

  return (
    <div className="ai-section-stack">
      <Alert
        showIcon
        type="warning"
        title="Artificial Analysis 为独立第三方参考，不参与厂商官网模型卡冠军"
        description="指数、每任务输出 Token 与成本直接读取 AA 公共页面 JSON-LD；缺失组件保持为空，不使用其他数据源补数。"
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <ChartCard title="Artificial Analysis Intelligence Index（第三方参考）" extra={<Tag color="warning">v{data.artificialAnalysis.indexVersion || '—'}</Tag>}>
            {indexRows.length === 0 ? <NoData description="暂无 AA Intelligence Index 公共数据" /> : (
              <ReactECharts option={indexOption} style={{ height: Math.max(420, indexRows.length * 27 + 80) }} notMerge />
            )}
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard title="单任务输出 Token 与成本" extra={<Text type="secondary">同一 AA Index 任务口径</Text>}>
            {scatterRows.length === 0 ? <NoData description="暂无同时披露 Token 与成本的模型" /> : (
              <ReactECharts option={taskOption} style={{ height: Math.max(420, scatterRows.length * 22 + 100) }} notMerge />
            )}
          </ChartCard>
        </Col>
      </Row>
      <ChartCard title="单任务 Token / 成本明细" extra={<Text type="secondary">组件成本求和，不跨币种换算</Text>}>
        <Table
          rowKey={(row) => `${row.model}-${row.taskVersion}`}
          size="small"
          pagination={false}
          scroll={{ x: 1080 }}
          locale={{ emptyText: <NoData description="暂无单任务成本明细" /> }}
          dataSource={taskCosts}
          columns={[
            { title: '模型', dataIndex: 'model', fixed: 'left', width: 220, className: 'ai-model-name', render: (value, row) => row.modelUrl ? <a href={row.modelUrl} target="_blank" rel="noreferrer">{value}</a> : value },
            { title: '任务 / 版本', width: 230, render: (_, row) => <><Text>{row.taskName}</Text><Text className="ai-benchmark-run-label" type="secondary">v{row.taskVersion} · {row.harness}</Text></> },
            { title: '输出 Token / task', width: 190, render: (_, row) => <Tooltip title={formatTaskTokenBreakdown(row)}>{row.outputTokens === null ? '—' : Math.round(row.outputTokens).toLocaleString('en-US')}</Tooltip> },
            { title: '成本 / task', width: 130, align: 'right', render: (_, row) => <Tooltip title={formatTaskCostComponents(row)}><Text strong>{formatCurrencyPrice(row.totalCost, row.currency, 4)}</Text></Tooltip> },
            { title: '数据日期', dataIndex: 'asOf', width: 112, render: dateLabel },
            { title: '来源', width: 130, render: (_, row) => <a href={row.sourceUrl} target="_blank" rel="noreferrer">Artificial Analysis</a> },
          ]}
        />
      </ChartCard>
    </div>
  );
}

function ComputeLatestChart({ quotes }: { quotes: ComputeRentalQuote[] }) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const rows = quotes.toReversed();
  const option = useMemo(() => ({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number) => formatCurrencyPrice(value, rows[0]?.currency, 3) },
    grid: { left: compact ? 112 : 230, right: compact ? 8 : 32, top: 28, bottom: 32 },
    xAxis: { type: 'value', name: compact ? '' : `${rows[0]?.currency || ''} / GPU / 小时`, axisLabel: { color: palette.text, fontSize: compact ? 8 : 12 }, splitLine: { lineStyle: { color: palette.line } } },
    yAxis: { type: 'category', data: rows.map((row) => `${row.platform} · ${row.gpu} · ${row.billingMode}\n${row.region} · ${row.instanceSpec}`), axisLabel: { color: palette.text, fontSize: compact ? 8 : 11, width: compact ? 100 : 210, overflow: 'break' }, axisTick: { show: false } },
    series: [{ name: '每 GPU 小时', type: 'bar', data: rows.map((row) => row.pricePerGpuHour), itemStyle: { color: palette.blue, borderRadius: [0, 5, 5, 0] } }],
  }), [compact, rows, palette]);
  if (quotes.length === 0) return <NoData description="暂无最新租赁报价" />;
  return <ReactECharts option={option} style={{ height: Math.max(340, rows.length * 36 + 90) }} notMerge />;
}

function ComputeHistoryChart({ quotes }: { quotes: ComputeRentalQuote[] }) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const dates = [...new Set(quotes.map((row) => row.asOf))].sort();
  const groups = new Map<string, ComputeRentalQuote[]>();
  for (const row of quotes) {
    groups.set(row.quoteKey, [...(groups.get(row.quoteKey) || []), row]);
  }
  const series = [...groups.values()].slice(0, 14).map((rows) => {
    const byDate = new Map(rows.map((row) => [row.asOf, row]));
    const first = rows[0];
    return {
      name: `${first.platform} · ${first.gpu} · ${first.region} · ${first.billingMode}`,
      type: 'line',
      showSymbol: true,
      connectNulls: true,
      data: dates.map((date) => byDate.get(date)?.pricePerGpuHour ?? null),
    };
  });
  const option = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (value: number) => formatUsd(value, 3) },
    legend: { type: 'scroll', top: 0, textStyle: { color: palette.text } },
    grid: { left: compact ? 44 : 70, right: compact ? 8 : 24, top: 64, bottom: 44 },
    xAxis: { type: 'category', data: dates, axisLabel: { color: palette.text, fontSize: compact ? 8 : 12 }, axisLine: { lineStyle: { color: palette.line } } },
    yAxis: { type: 'value', name: compact ? '' : 'USD/GPU/h', axisLabel: { color: palette.text, fontSize: compact ? 8 : 12 }, splitLine: { lineStyle: { color: palette.line } } },
    series,
  }), [compact, dates, series, palette]);
  if (quotes.length === 0) return <NoData description="暂无租赁历史" />;
  return <ReactECharts option={option} style={{ height: 400 }} notMerge />;
}

export function ComputeRentalSection({ data }: DashboardProps) {
  const latest = data.computeRental.filter((row) => row.latest);
  const comparableLatest = latest.filter((row) => row.currency === 'USD');
  return (
    <div className="ai-section-stack">
      <Alert type="info" showIcon title="精确报价口径" description="涨跌只在同平台、同 GPU、同实例规格、同地区、同计费方式、同币种内计算。Spot / 抢占式、按需与预留价格不会互相拼接；实例总价仅在 GPU 数量明确时折算为每 GPU 小时。" />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}><ChartCard title="最新 USD 精确报价横向对比"><ComputeLatestChart quotes={comparableLatest} /></ChartCard></Col>
        <Col xs={24} xl={12}><ChartCard title="同一精确报价键历史趋势"><ComputeHistoryChart quotes={data.computeRental.filter((row) => row.currency === 'USD')} /></ChartCard></Col>
      </Row>
      <ChartCard title="最新报价、同口径绝对涨跌与环比">
        <Table
          rowKey={(row) => `${row.quoteKey}-${row.asOf}`}
          size="small"
          pagination={{ pageSize: 15, showSizeChanger: false }}
          scroll={{ x: 1500 }}
          locale={{ emptyText: <NoData description="暂无算力租赁数据" /> }}
          dataSource={latest}
          columns={[
            { title: '平台', dataIndex: 'platform', fixed: 'left', width: 140 },
            { title: 'GPU', dataIndex: 'gpu', fixed: 'left', width: 130 },
            { title: '实例规格', dataIndex: 'instanceSpec', width: 190 },
            { title: '地区', dataIndex: 'region', width: 120 },
            { title: '计费方式', dataIndex: 'billingMode', width: 120 },
            { title: '日期', dataIndex: 'asOf', width: 112 },
            { title: '每 GPU / 小时', dataIndex: 'pricePerGpuHour', width: 145, align: 'right', render: (value, row) => formatCurrencyPrice(value, row.currency, 3) },
            { title: '前值', dataIndex: 'previousPricePerGpuHour', width: 110, align: 'right', render: (value, row) => formatCurrencyPrice(value, row.currency, 3) },
            { title: '绝对涨跌', dataIndex: 'absoluteChange', width: 120, align: 'right', render: (value, row) => value === null ? '—' : <Text className={value > 0 ? 'ai-change-up' : 'ai-change-down'}>{value > 0 ? '+' : ''}{formatCurrencyPrice(value, row.currency, 3)}</Text> },
            { title: '环比', dataIndex: 'percentChange', width: 100, align: 'right', render: (value) => value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%` },
            { title: '来源', width: 130, render: (_, row) => <a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceLabel}</a> },
          ]}
        />
      </ChartCard>
      <ChartCard title="算力官网来源状态" extra={<Text type="secondary">动态计算器不可复现时保留上一版</Text>}>
        <Table rowKey="sourceId" size="small" pagination={false} dataSource={data.computeSourceReports || []} locale={{ emptyText: <NoData description="等待首次算力官网同步" /> }} columns={[
          { title: '平台', dataIndex: 'platform' },
          { title: '状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === 'ready' ? 'success' : 'error'}>{value === 'ready' ? '已同步' : '失败'}</Tag> },
          { title: '报价行', dataIndex: 'rows', width: 90, align: 'right' },
          { title: '日期', dataIndex: 'asOf', width: 112, render: dateLabel },
          { title: '详情', dataIndex: 'message', render: (value) => value || '—' },
          { title: '官网', width: 80, render: (_, row) => row.url ? <a href={row.url} target="_blank" rel="noreferrer">打开</a> : '—' },
        ]} />
      </ChartCard>
    </div>
  );
}

function CapitalHistoryChart({ events }: { events: CapitalEvent[] }) {
  const palette = useChartPalette();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const rows = events.filter((event) => event.comparableUsdAmount !== null).toSorted((left, right) => left.eventDate.localeCompare(right.eventDate));
  const option = useMemo(() => ({
    tooltip: {
      trigger: 'item',
      formatter: (params: { data: { value: number; event: CapitalEvent } }) => {
        const event = params.data.event;
        return [
          `<b>${escapeHtml(event.entity)} · ${escapeHtml(event.eventDate)}</b>`,
          escapeHtml(event.instrument),
          `原币：${escapeHtml(formatLargeMoney(event.amountOriginal, event.currency))}`,
          `可比美元：${escapeHtml(formatLargeMoney(event.comparableUsdAmount, 'USD'))}`,
          `利率：${escapeHtml(capitalRateLabel(event))}`,
        ].join('<br/>');
      },
    },
    grid: { left: compact ? 44 : 70, right: compact ? 8 : 24, top: 30, bottom: compact ? 105 : 80 },
    xAxis: { type: 'category', data: rows.map((event) => `${event.eventDate}\n${event.entity}`), axisLabel: { color: palette.text, rotate: 35, fontSize: compact ? 8 : 11 }, axisLine: { lineStyle: { color: palette.line } } },
    yAxis: { type: 'value', name: compact ? '' : '可比融资规模（十亿美元）', axisLabel: { color: palette.text }, splitLine: { lineStyle: { color: palette.line } } },
    series: [{
      type: 'bar',
      data: rows.map((event) => ({
        value: (event.comparableUsdAmount || 0) / 1_000_000_000,
        event,
        itemStyle: { color: event.instrumentCategory === 'equity' ? palette.blue : event.instrumentCategory === 'convertible' ? '#722ed1' : palette.orange },
      })),
    }],
  }), [compact, rows, palette]);
  if (rows.length === 0) return <NoData description="暂无可比美元融资历史" />;
  return <ReactECharts option={option} style={{ height: 390 }} notMerge />;
}

export function DebtFinancingSection({
  data,
  cdsImportStatus,
  onImportIceCds,
}: DashboardProps & { cdsImportStatus?: IceCdsImportStatus | null; onImportIceCds?: () => void }) {
  const [selectedEntity, setSelectedEntity] = React.useState('all');
  const allEvents = data.capitalEvents || [];
  const entities = [...new Set(allEvents.map((event) => event.entity))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const events = selectedEntity === 'all' ? allEvents : allEvents.filter((event) => event.entity === selectedEntity);
  const metric = selectedEntity === 'all'
    ? data.capitalMetrics?.industry
    : data.capitalMetrics?.byEntity.find((row) => row.entity === selectedEntity);
  const latest = events[0];
  return (
    <div className="ai-section-stack">
      <Alert type="info" showIcon title="覆盖口径" description="覆盖全球与中国 CSP、模型厂商的股权轮、固定息债、浮息贷款、可转债与授信；金额保留原币，可比美元只在披露或核验汇率口径存在时使用。利率缺失保持空值，不由相邻交易推断。" />
      <Flex justify="space-between" align="center" wrap gap={12}>
        <Title level={4} style={{ margin: 0 }}>融资历史与债务条件</Title>
        <Select value={selectedEntity} onChange={setSelectedEntity} style={{ minWidth: 220 }} options={[
          { value: 'all', label: '全部公司' },
          ...entities.map((entity) => ({ value: entity, label: entity })),
        ]} />
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={12} xl={6}><Card className="ai-kpi-card"><Statistic title="累计可比融资" value={formatLargeMoney(metric?.cumulativeComparableUsd, 'USD')} /></Card></Col>
        <Col xs={12} xl={6}><Card className="ai-kpi-card"><Statistic title="近 12 月可比融资" value={formatLargeMoney(metric?.trailing12MonthComparableUsd, 'USD')} /></Card></Col>
        <Col xs={12} xl={6}><Card className="ai-kpi-card"><Statistic title="近 12 月事件数" value={metric?.trailing12MonthCount ?? '—'} suffix={metric ? '笔' : undefined} /></Card></Col>
        <Col xs={12} xl={6}><Card className="ai-kpi-card"><Statistic title="固定息债加权票息" value={metric?.weightedAverageFixedCoupon ?? '—'} suffix={metric?.weightedAverageFixedCoupon !== null && metric?.weightedAverageFixedCoupon !== undefined ? '%' : undefined} precision={2} /></Card></Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}><ChartCard title="完整融资事件历史 · 可比美元"><CapitalHistoryChart events={events} /></ChartCard></Col>
        <Col xs={24} xl={9}>
          <ChartCard title="最新融资事件" className="ai-debt-highlight">
        {latest ? (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="公司 / 日期">{latest.entity} · {dateLabel(latest.eventDate)}</Descriptions.Item>
            <Descriptions.Item label="融资工具"><Text strong className="ai-emphasis-value">{latest.instrument}</Text></Descriptions.Item>
            <Descriptions.Item label="规模"><Text strong>{formatLargeMoney(latest.amountOriginal, latest.currency)}</Text></Descriptions.Item>
            <Descriptions.Item label="利率 / 类型">{capitalRateLabel(latest)}</Descriptions.Item>
            <Descriptions.Item label="期限">{latest.tenorYears === null ? '未披露' : `${latest.tenorYears} 年`}</Descriptions.Item>
            <Descriptions.Item label="用途">{latest.useOfProceeds || '未披露'}</Descriptions.Item>
            <Descriptions.Item label="来源"><a href={latest.sourceUrl} target="_blank" rel="noreferrer">{latest.sourceLabel}</a></Descriptions.Item>
          </Descriptions>
        ) : <NoData description="暂无结构化融资事件" />}
          </ChartCard>
        </Col>
      </Row>
      <CdsRiskSection data={data} importStatus={cdsImportStatus} onImport={onImportIceCds} />
      <ChartCard title="股权与债务融资全量明细">
        <Table
          rowKey="id"
          size="middle"
          pagination={{ pageSize: 15, showSizeChanger: false }}
          scroll={{ x: 1750 }}
          locale={{ emptyText: <NoData description="暂无融资数据" /> }}
          dataSource={events}
          columns={[
            { title: '公司', dataIndex: 'entity', fixed: 'left', width: 140 },
            { title: '地区', dataIndex: 'geography', width: 90 },
            { title: '事件日', dataIndex: 'eventDate', width: 112, render: dateLabel },
            { title: '融资工具', dataIndex: 'instrument', width: 220, render: (value) => <Text strong className="ai-emphasis-value">{value}</Text> },
            { title: '原币规模', width: 160, align: 'right', render: (_, row) => formatLargeMoney(row.amountOriginal, row.currency) },
            { title: '可比美元', dataIndex: 'comparableUsdAmount', width: 150, align: 'right', render: (value) => formatLargeMoney(value, 'USD') },
            { title: '利率 / 类型', width: 150, render: (_, row) => capitalRateLabel(row) },
            { title: '期限', dataIndex: 'tenorYears', width: 90, render: (value) => value === null ? '—' : `${value} 年` },
            { title: '到期日', dataIndex: 'maturityDate', width: 112, render: dateLabel },
            { title: '资金用途', dataIndex: 'useOfProceeds', width: 260, render: (value) => value || '—' },
            { title: '来源', width: 140, render: (_, row) => <a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceLabel}</a> },
          ]}
        />
      </ChartCard>
      <ChartCard title="融资官网 / 监管来源状态" extra={<Text type="secondary">无稳定第一方入口的公司标为“来源发现维护”</Text>}>
        <Table rowKey="sourceId" size="small" pagination={{ pageSize: 16, showSizeChanger: false }} dataSource={data.capitalSourceReports || []} locale={{ emptyText: <NoData description="等待首次融资来源同步" /> }} columns={[
          { title: '公司', dataIndex: 'entity' },
          { title: '状态', dataIndex: 'status', width: 140, render: (value) => <Tag color={value === 'ready' ? 'success' : value === 'error' ? 'error' : 'default'}>{value === 'ready' ? '已同步' : value === 'error' ? '失败' : '来源发现维护'}</Tag> },
          { title: '事件行', dataIndex: 'rows', width: 90, align: 'right' },
          { title: '日期', dataIndex: 'asOf', width: 112, render: dateLabel },
          { title: '详情', dataIndex: 'message', render: (value) => value || '—' },
          { title: '官网 / 申报', width: 110, render: (_, row) => row.url ? <a href={row.url} target="_blank" rel="noreferrer">打开</a> : '待发现' },
        ]} />
      </ChartCard>
    </div>
  );
}
