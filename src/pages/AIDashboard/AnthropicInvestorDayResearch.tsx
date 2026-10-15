import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import { useTheme } from '../../hooks/useTheme';
import { ANTHROPIC_INVESTOR_DAY, INVESTOR_DAY_VALUATION_SCENARIOS } from './anthropicInvestorDayData';
import './AnthropicInvestorDayResearch.css';

const { Paragraph, Text, Link } = Typography;
const research = ANTHROPIC_INVESTOR_DAY;
const q3 = research.quarters.at(-1)!;
const septemberScenario = INVESTOR_DAY_VALUATION_SCENARIOS.find((row) => row.id === 'september-common')!;
const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const range = (low: number, high: number) => low === high ? number(low) : `${number(low)}–${number(high)}`;
const multipleRange = (low: number, high: number) => `${low.toFixed(1)}–${high.toFixed(1)}×`;
const delta = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${number(value)}`;
const percent = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
const computeSource = {
  label: 'Reuters · 2026-09-29',
  url: 'https://www.investing.com/news/stock-market-news/anthropics-518-billion-ai-buildout-hinges-largely-on-deals-that-cannot-be-canceled-filing-shows-4922031',
  note: '9 月 29 日已报道的未来十年至少 5180 亿美元云服务、计算和基础设施承诺；10 月 14 日报道再次提及。',
};

function SourceLink({ source }: { source: { label: string; url: string; note: string } }) {
  return <Tooltip title={source.note}>
    {source.url
      ? <Link href={source.url} target="_blank" rel="noreferrer">{source.label}</Link>
      : <Text type="secondary">{source.label}</Text>}
  </Tooltip>;
}

function QuarterlyRevenueChart() {
  const { theme } = useTheme();
  const option = useMemo(() => {
    const text = theme === 'dark' ? '#c7c7c7' : '#595959';
    const line = theme === 'dark' ? '#3a3a3a' : '#e8e8e8';
    const blue = theme === 'dark' ? '#3c9ae8' : '#1677ff';
    return {
      animationDuration: 250,
      grid: { left: 52, right: 20, top: 35, bottom: 36 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (value: number | string) => `${number(Number(value))} 亿美元` },
      xAxis: { type: 'category', data: research.quarters.map((row) => row.period), axisLabel: { color: text }, axisLine: { lineStyle: { color: line } } },
      yAxis: { type: 'value', min: 0, name: '亿美元', nameTextStyle: { color: text }, axisLabel: { color: text }, splitLine: { lineStyle: { color: line } } },
      series: [{ name: '季度收入', type: 'bar', barMaxWidth: 64, data: research.quarters.map((row) => row.revenue), itemStyle: { color: blue, borderRadius: [5, 5, 0, 0] }, label: { show: true, position: 'top', color: text, formatter: '{c}' } }],
    };
  }, [theme]);
  return <div role="img" aria-label={`Anthropic 2026 年季度收入，单位亿美元：${research.quarters.map((row) => `${row.period} ${row.revenue}`).join('；')}。完整数据见季度明细。`}>
    <ReactECharts option={option} style={{ height: 270 }} notMerge />
  </div>;
}

export function AnthropicInvestorDaySummary({ onOpenResearch }: { onOpenResearch?: () => void }) {
  return <Card
    className="ai-section-card anthropic-investor-summary"
    size="small"
    title="Anthropic · Investor Day 研究更新"
    extra={<Button size="small" onClick={onOpenResearch} href={onOpenResearch ? undefined : '#anthropic-investor-day'}>查看详情</Button>}
  >
    <Row gutter={[20, 14]}>
      <Col xs={24} sm={8}><Statistic title="2026 Q3 收入 · 媒体报道" value={q3.revenue} suffix="亿美元" /></Col>
      <Col xs={24} sm={8}><Statistic title="9 月 ARR · 研究估算" value={research.septemberArrEstimate} prefix="约" suffix="亿美元" /></Col>
      <Col xs={24} sm={8}><Statistic title="IPO 预期 ÷ 9 月 ARR 估算" value={multipleRange(septemberScenario.parrLow, septemberScenario.parrHigh)} /></Col>
    </Row>
    <Paragraph className="anthropic-investor-caption" type="secondary">
      Investor Day {research.eventDate} · IPO 估值为媒体报道的预期，倍数使用研究估算分母；各项来源与不同时点情景见详情。
    </Paragraph>
  </Card>;
}

export default function AnthropicInvestorDayResearch() {
  return <Card
    className="ai-section-card anthropic-investor-research"
    id="anthropic-investor-day"
    title="Anthropic Investor Day · 2026Q3经营更新"
    extra={<Tag color="blue">研究更新 {research.checkedAt}</Tag>}
  >
    <Space wrap size={[8, 8]}>
      <Tag>Investor Day {research.eventDate}</Tag>
      <Tag>金额单位：亿美元</Tag>
      <Tag color="orange">媒体报道 / 研究纪要</Tag>
    </Space>
    <Paragraph className="anthropic-investor-intro">
      Q3 收入继续增长，经营效率改善。收入采用媒体报道，利润细节保留财通、建投纪要的转述归属；研究估算与 IPO 预测分别列示。
    </Paragraph>
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}><Card size="small"><Statistic title="2026 Q3 收入" value={q3.revenue} suffix="亿美元" /><Text type="secondary">季度环比 {percent(q3.momPercent)} · <SourceLink source={research.sources.reuters} /></Text></Card></Col>
      <Col xs={24} md={8}><Card size="small"><Statistic title="2026 前三季度收入合计" value={research.nineMonthRevenue} suffix="亿美元" /><Text type="secondary">Q1 + Q2 + Q3，已报道的季度收入之和</Text></Card></Col>
      <Col xs={24} md={8}><Card size="small"><Statistic title="9 月 ARR · 研究估算" value={research.septemberArrEstimate} prefix="约" suffix="亿美元" /><Text type="secondary">保留研究推算口径 · <SourceLink source={research.sources.memos} /></Text></Card></Col>
    </Row>

    <Row gutter={[24, 16]} className="anthropic-investor-section">
      <Col xs={24} lg={12}>
        <h3>季度收入</h3>
        <QuarterlyRevenueChart />
      </Col>
      <Col xs={24} lg={12}>
        <h3>季度明细与环比</h3>
        <Table
          rowKey="period" size="small" pagination={false} scroll={{ x: 470 }} dataSource={[...research.quarters]}
          columns={[
            { title: '期间', dataIndex: 'period', width: 105 },
            { title: '收入', dataIndex: 'revenue', align: 'right', render: number },
            { title: '环比增量', dataIndex: 'momAbsolute', align: 'right', render: delta },
            { title: '环比增速', dataIndex: 'momPercent', align: 'right', render: percent },
          ]}
        />
        <Paragraph type="secondary" className="anthropic-investor-caption">收入与增量单位：亿美元；环比由上述季度数值复算。<SourceLink source={research.sources.reuters} /></Paragraph>
        <Paragraph className="anthropic-investor-annualized">
          Q3 收入 × 4 = <Text strong>{number(research.q3AnnualizedRevenue)} 亿美元</Text>，属于季度收入年化，并非 ARR；9 月 ARR 约 {number(research.septemberArrEstimate)} 亿美元是另一个研究估算口径。
        </Paragraph>
      </Col>
    </Row>

    <Row gutter={[24, 16]} className="anthropic-investor-section">
      <Col xs={24} lg={12}>
        <h3>利润与算力经济性 · 纪要转述</h3>
        <ul className="anthropic-investor-facts">
          <li>连续两个季度实现调整后盈利，Q3 营业利润率约 11%。</li>
          <li>Q3 当季现金流为正，具体口径未披露。</li>
          <li>每 1 美元计算支出对应约 1.70 美元收入。</li>
        </ul>
        <Paragraph type="secondary" className="anthropic-investor-caption">
          来源：财通 / 建投转引 FT；付费正文未完整核验，调整项目和算力支出范围待正式披露。<SourceLink source={research.sources.ft} /> · <SourceLink source={research.sources.memos} />
        </Paragraph>
      </Col>
      <Col xs={24} lg={12}>
        <h3>未来十年算力承诺 · 既有报道</h3>
        <Statistic value={5180} prefix="至少" suffix="亿美元" />
        <Paragraph className="anthropic-investor-caption">
          Reuters 于 9 月 29 日已报道未来十年的云服务、计算和基础设施承诺，10 月 14 日报道再次提及。该数字跨越十年，不属于 Q3 当季资本开支、当日新增投入或融资规模。<SourceLink source={computeSource} />
        </Paragraph>
      </Col>
    </Row>

    <div className="anthropic-investor-section">
      <h3>ARR 与 IPO 估值情景</h3>
      <Paragraph>
        媒体报道的 IPO 预期估值为 {range(research.ipoValuationLow / 10000, research.ipoValuationHigh / 10000)} 万亿美元，并非已经完成的融资估值。
        下表以该区间除以不同时间、不同来源的 ARR 估算或预测；使用股权估值，未调整现金与负债。<SourceLink source={research.sources.bloomberg} />
      </Paragraph>
      <Table
        rowKey="id" size="small" pagination={false} scroll={{ x: 800 }} dataSource={[...INVESTOR_DAY_VALUATION_SCENARIOS]}
        columns={[
          { title: 'ARR 口径', width: 210, render: (_, row) => <><Text strong>{row.label}</Text><div><Text type="secondary">{row.period}</Text></div></> },
          { title: 'ARR（亿美元）', width: 135, align: 'right', render: (_, row) => range(row.arrLow, row.arrHigh) },
          { title: 'P/ARR（情景）', width: 145, align: 'right', render: (_, row) => multipleRange(row.parrLow, row.parrHigh) },
          { title: '来源与条件', dataIndex: 'note', width: 310 },
        ]}
      />
      <Paragraph type="secondary" className="anthropic-investor-caption">
        财通转引的 Yipit 约 {number(research.yipitQuotedEstimate)} 亿美元仅作研究对照，原始付费数据未取得；与 9 月约 {number(research.septemberArrEstimate)} 亿美元研究推算并列保留。
        年底 800–850 亿美元对应约 21.2–25.0×，年底 1000 亿美元为更高情景，不能当作已实现 ARR。<SourceLink source={research.sources.memos} />
      </Paragraph>
    </div>

    <div className="anthropic-investor-section">
      <h3>高频口径对照 · 中金纪要转述</h3>
      <Table
        rowKey="provider" size="small" pagination={false} scroll={{ x: 780 }} dataSource={[...research.highFrequencyComparisons]}
        columns={[
          { title: '提供方', dataIndex: 'provider', width: 130 },
          { title: 'ARR（亿美元）', dataIndex: 'arr', width: 135, align: 'right', render: number },
          { title: '观测截至日', dataIndex: 'observedAt', width: 125, render: (value: string | null) => value || '未提供' },
          { title: '纪要收到日', dataIndex: 'receivedAt', width: 125 },
          { title: '口径说明', dataIndex: 'methodology', width: 265 },
        ]}
      />
      <Paragraph type="secondary" className="anthropic-investor-caption">
        2026-10-15 是本次纪要收到日，不是数据观测日；两项截至日均未提供，统计口径待确认，仅作独立对照，不加入历史 ARR 主图或上述 IPO 情景。<SourceLink source={research.sources.cicc} />
      </Paragraph>
      <Paragraph type="secondary" className="anthropic-investor-caption">
        中金摘录的 Q3“16.8 亿美元”与 Reuters 报道的 168 亿美元冲突，存在十倍单位疑误；本页季度收入采用 Reuters 口径。
      </Paragraph>
    </div>

    <Row gutter={[24, 16]} className="anthropic-investor-section">
      <Col xs={24} lg={12}>
        <h3>纪要判断 · 比较基准分别保留</h3>
        <Paragraph>财通认为 9 月 ARR 估算低于其跟踪口径预期；建投认为 9 月 ARR 约 700 亿美元与此前市场预期相近；中金认为按月收入 × 12 隐含的 9 月 ARR 约 700 亿美元再次低于市场预期。各项判断的比较基准与跟踪口径分别归属原纪要。</Paragraph>
        <Paragraph type="secondary">月增约 6%、净增约 40 亿美元属于纪要的 ARR 推算，不能从季度收入唯一推出。<SourceLink source={research.sources.memos} /></Paragraph>
      </Col>
      <Col xs={24} lg={12}>
        <h3>IPO 时间线 · 媒体预期</h3>
        <Paragraph>Bloomberg 报道称，最快于 2026 年 11 月 9 日当周启动正式 IPO 营销，争取在 11 月 26 日感恩节前开始交易；安排仍可能调整。<SourceLink source={research.sources.bloomberg} /></Paragraph>
      </Col>
    </Row>
    <div className="anthropic-investor-sources">
      <Text strong>来源与核验范围</Text>
      {Object.entries(research.sources).map(([key, source]) => <div key={key}>
        <SourceLink source={source} /> <Text type="secondary">— {source.note}</Text>
      </div>)}
    </div>
  </Card>;
}
