import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card, Col, Grid, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useTheme } from '../../hooks/useTheme';
import { BOFA_CAPACITY_METRICS, BOFA_CAPACITY_RESEARCH, capacityNetAddition } from './bofaCapacityData';

const { Paragraph, Text, Link, Title } = Typography;
const research = BOFA_CAPACITY_RESEARCH;
const metrics = BOFA_CAPACITY_METRICS;
const groupLabels = new Map<string, string>(research.groups.map((group) => [group.id, group.label]));
const capacity = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toFixed(1);
const percentage = (value: number) => Number((value * 100).toFixed(1));

function CapacityChart() {
  const { theme } = useTheme();
  const screens = Grid.useBreakpoint();
  const compact = !screens.sm;
  const option = useMemo(() => {
    const text = theme === 'dark' ? '#c7c7c7' : '#595959';
    const line = theme === 'dark' ? '#3a3a3a' : '#e8e8e8';
    const colors = [theme === 'dark' ? '#3c9ae8' : '#1677ff', '#13c2c2', '#fa8c16'];
    return {
      animationDuration: 250,
      legend: { top: 0, type: 'scroll', textStyle: { color: text } },
      grid: { left: compact ? 48 : 62, right: 20, top: 52, bottom: 52 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number | string) => `${capacity(Number(value))} GW` },
      xAxis: {
        type: 'category', data: research.years.map((year) => compact ? `${year}` : `${year}\n研究估计`),
        axisLabel: { color: text, fontSize: compact ? 9 : 12, lineHeight: 16, interval: 0 },
        axisLine: { lineStyle: { color: line } },
      },
      yAxis: { type: 'value', min: 0, name: '容量（GW）', nameTextStyle: { color: text }, axisLabel: { color: text }, splitLine: { lineStyle: { color: line } } },
      series: [
        ...research.groups.map((group, index) => ({
          name: group.label, type: 'bar', stack: 'capacity', barMaxWidth: 60,
          data: [...group.totals], itemStyle: { color: colors[index] },
        })),
        {
          name: '全球合计 · 原表', type: 'line', data: [...research.totals],
          symbol: 'circle', symbolSize: 5, connectNulls: false,
          itemStyle: { color: text }, lineStyle: { color: text, type: 'dotted', width: 2 },
          label: { show: true, position: 'top', color: text, fontSize: compact ? 10 : 12, formatter: (point: { value: number }) => capacity(point.value) },
        },
      ],
    };
  }, [theme, compact]);
  return <div role="img" aria-label={`BofA 转引的全球 AI 与云数据中心容量研究估计，单位 GW；${research.years.map((year, index) => `${year} 年 ${research.totals[index]}`).join('；')}。按原表的三类运营商堆叠，虚线表示原表全球合计。`}>
    <ReactECharts option={option} style={{ height: compact ? 320 : 360 }} notMerge />
  </div>;
}

export default function BofaCapacityResearch() {
  return <Card
    id="bofa-capacity-research"
    className="ai-section-card ai-compute-research"
    title="全球AI／云数据中心容量 · BofA转引预测"
  >
    <Space wrap size={[8, 8]}>
      <Tag color="blue">核对 {research.checkedAt}</Tag>
      <Tag color="orange">原报告日期待核</Tag>
      <Text type="secondary">推文发布 {research.publishedAt}</Text>
    </Space>
    <Paragraph className="ai-compute-research-intro">
      按 Shay Boloor 转引的 BofA 附图整理。2025 年为模型估计基期，2026–2030 年为研究预测；各列均为研究估计，不代表已投产实际容量或公司指导。
    </Paragraph>

    <Row gutter={[20, 16]} className="ai-compute-research-metrics">
      <Col xs={24} sm={12} xl={6}>
        <Statistic title="2030 全球容量 · 模型估计" value={metrics.forecastCapacity} precision={1} suffix="GW" />
        <Text type="secondary">2025–2030 净新增 {capacity(metrics.netAddition)} GW</Text>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Statistic title="2030 / 2025 容量倍数" value={metrics.capacityMultiple} precision={2} suffix="倍" />
        <Text type="secondary">{capacity(metrics.forecastCapacity)} / {capacity(metrics.baseCapacity)} GW</Text>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Statistic title="2030 当年新增 · Neocloud 占比" value={percentage(metrics.annual2030NeocloudShare)} precision={1} suffix="%" />
        <Text type="secondary">{capacity(metrics.annual2030Neocloud)} / {capacity(metrics.annual2030Total)} GW 当年新增</Text>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Statistic title="2030 容量存量 · Neocloud 占比" value={percentage(metrics.stock2030NeocloudShare)} precision={1} suffix="%" />
        <Text type="secondary">Neocloud 存量 / 全球合计存量</Text>
      </Col>
    </Row>

    <Title level={5}>容量路径 · 全部为研究估计</Title>
    <CapacityChart />
    <Paragraph type="secondary" className="ai-compute-research-caption">
      单位：GW。柱形按附图三组容量堆叠，虚线采用原表全球合计；原表以一位小数列示，分组加总与全球总计可能出现 0.1 GW 舍入差，不据此改写原数值。
      推文“约 40%”对应 2030 当年新增容量中的 Neocloud 份额，并非全行业整体增速或 2025–2030 累计新增占比。
    </Paragraph>

    <div className="ai-compute-research-details">
      <Title level={5}>运营商明细 · 附图与推文分别保留</Title>
      <Table
        rowKey="id" size="small" pagination={false} scroll={{ x: 1120 }} dataSource={[...research.operators]}
        columns={[
          { title: '公司 / 运营商', dataIndex: 'label', width: 145 },
          { title: '附图分组', dataIndex: 'group', width: 125, render: (group: string) => groupLabels.get(group) || group },
          { title: '2025 基期估计', width: 120, align: 'right', render: (_, row) => capacity(row.values[0]) },
          { title: '2030 预测', width: 115, align: 'right', render: (_, row) => capacity(row.values.at(-1)) },
          { title: '附图净新增', width: 120, align: 'right', render: (_, row) => capacity(capacityNetAddition(row.values)) },
          { title: '推文新增', dataIndex: 'tweetIncrement', width: 110, align: 'right', render: capacity },
          { title: '备注 / 口径', dataIndex: 'note', width: 385 },
        ]}
      />
      <Paragraph type="secondary" className="ai-compute-research-caption">
        单位：GW；附图净新增 = 2030 预测 − 2025 基期估计。缺失值显示“—”，不按 0 处理。
        IREN 的推文原数为新增 3 GW，附图端点相减为 2.3 GW，两种表述分别保留，不自动覆盖。
        SPCX / xAI 按附图归入 Neocloud；图注称 NVIDIA 将其视为 Hyperscaler，因此 Neocloud 份额依赖原图分类。
      </Paragraph>
    </div>

    <div className="ai-compute-research-details">
      <Title level={5}>来源与统计口径</Title>
      <ul>{research.methodology.map((item) => <li key={item}>{item}</li>)}</ul>
      <Paragraph type="secondary">{research.sourceStatus}</Paragraph>
      <Space wrap size={[12, 8]}>
        <Link href={research.sourceUrl} target="_blank" rel="noopener noreferrer">{research.sourceLabel} · 原推文</Link>
        <Link href={research.imageUrl} target="_blank" rel="noopener noreferrer">查看转引附图</Link>
      </Space>
    </div>
  </Card>;
}
