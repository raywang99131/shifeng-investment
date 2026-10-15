import { Alert, Button, Card, Col, Collapse, Image, Row, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import {
  ANTHROPIC_ANNUAL_COMPARISON,
  ANTHROPIC_LATEST_COMMITMENTS,
  ANTHROPIC_ORIGINAL_COMMITMENTS,
  ANTHROPIC_ORIGINAL_SUM_B,
  ANTHROPIC_RESEARCH,
  type AnthropicResearchSourceId,
} from './anthropicComputeData';

const { Paragraph, Text, Link } = Typography;
const money = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;

function ResearchSource({ id }: { id: AnthropicResearchSourceId }) {
  const source = ANTHROPIC_RESEARCH.sources[id];
  return <Link href={source.url} target="_blank" rel="noreferrer">{source.label}</Link>;
}

function LatestCommitments() {
  return <>
    <Paragraph type="secondary">
      来源：<ResearchSource id="reutersLatest" /> · 报道日期 {ANTHROPIC_RESEARCH.latestReportedAt}。
      Reuters 称已阅保密 IPO 文件；文件尚未公开，本页未取得原件。
    </Paragraph>
    <Row gutter={[24, 16]} className="ai-compute-research-metrics">
      <Col xs={24} md={8}><Statistic title="未来约十年 · 报道总额" value={`≥ ${money(ANTHROPIC_RESEARCH.latestHeadlineB)}`} /></Col>
      <Col xs={12} md={8}><Statistic title="本篇报道覆盖伙伴" value={ANTHROPIC_RESEARCH.latestPartnerCount} suffix="家" /></Col>
      <Col xs={12} md={8}><Statistic title="不可取消或须按最低义务支付" value={`约 ${ANTHROPIC_RESEARCH.nonCancelableApproxPercent}%`} /></Col>
    </Row>
    <Alert showIcon type="info" title="合同性质与金额含义逐项保留" description="以下包括基础设施服务义务、设备租赁和可取消协议上限。报道总额与 William Blair 原图的范围、时间及口径不同，两组金额不相加，也不构成当年 CapEx 或实际支出。" />
    <Table
      className="ai-anthropic-table"
      rowKey="id" size="small" pagination={false} scroll={{ x: 1260 }}
      dataSource={ANTHROPIC_LATEST_COMMITMENTS}
      columns={[
        { title: '伙伴', dataIndex: 'supplier', fixed: 'left', width: 150 },
        { title: '报道金额（USD）', width: 160, render: (_, row) => <><Text strong>{row.qualifier} {money(row.amountB)}</Text><div><Text type="secondary">{row.obligation}</Text></div></> },
        { title: '支付 / 合同期间', dataIndex: 'term', width: 190 },
        { title: '架构 / 服务', dataIndex: 'architecture', width: 200 },
        { title: '付款与退出条件', dataIndex: 'cancellation', width: 420 },
        { title: '来源', width: 140, render: (_, row) => <ResearchSource id={row.sourceId} /> },
      ]}
    />
    <Paragraph type="secondary" className="ai-compute-research-caption">
      B = 十亿美元；金额保持“至少 / 约 / 最高 / 超过”等原始限定。未披露的期限和取消条件保持未知；未来容量不代表已投产容量。
    </Paragraph>
  </>;
}

function OriginalCommitments() {
  return <>
    <Paragraph type="secondary">来源：{ANTHROPIC_RESEARCH.originalSourceLabel}。下表按截图转录，月份沿用图中标注，不视为逐项核实的签约日。</Paragraph>
    <Row gutter={[24, 16]} className="ai-compute-research-metrics">
      <Col xs={24} md={12}><Statistic title="原图有金额的 13 项 · 名义合计（未去重）" value={money(ANTHROPIC_ORIGINAL_SUM_B)} /></Col>
      <Col xs={24} md={12}><Statistic title="原图列示关系（含 CoreWeave 金额未披露）" value={ANTHROPIC_ORIGINAL_COMMITMENTS.length} suffix="项" /></Col>
    </Row>
    <Alert showIcon type="warning" title="原图约 $585B：研报汇总口径" description="原图含多年总额、最高值与未确定交易，不能全部视为已签约的刚性付款义务。CoreWeave 的 N/D 表示未披露金额；名义合计仅加总其余 13 项，不代表完整、无重叠的采购总额。" />
    <Collapse className="ai-compute-research-details" items={[{
      key: 'image',
      label: '查看用户提供的 William Blair 原图（点击图片放大）',
      children: <figure className="ai-anthropic-original-image">
        <Image width="100%" preview={{ motionName: '' }} src={ANTHROPIC_RESEARCH.originalImageUrl} alt="William Blair Exhibit 5：Anthropic 自 2025 年以来的算力承诺，14 项关系，CoreWeave 金额未披露，其余名义合计 584.7 十亿美元。" />
        <figcaption>{ANTHROPIC_RESEARCH.originalSourceLabel}；保留截图原貌。</figcaption>
      </figure>,
    }]} />
    <Table
      className="ai-anthropic-table"
      rowKey="id" size="small" pagination={false} scroll={{ x: 820 }}
      dataSource={ANTHROPIC_ORIGINAL_COMMITMENTS}
      columns={[
        { title: '原图伙伴', dataIndex: 'supplier', width: 200 },
        { title: '原图月份', dataIndex: 'reportedMonth', width: 110 },
        { title: '原图金额（USD）', dataIndex: 'amountB', width: 145, align: 'right', render: value => value === null ? 'N/D · 未披露' : money(value) },
        { title: '核对备注', dataIndex: 'note', width: 430 },
      ]}
    />
    <Paragraph className="ai-compute-research-caption">
      <ResearchSource id="metaReport" /> 所述 Meta 交易仍为谈判；<ResearchSource id="googleOfficial" /> 将 Google / Broadcom 合作称为此前 $50B 美国基础设施计划的扩展，存在重叠风险，未能据此量化去重金额。
    </Paragraph>
  </>;
}

function AnnualComparison() {
  return <>
    <Table
      rowKey="supplier" size="small" pagination={false} scroll={{ x: 750 }}
      dataSource={ANTHROPIC_ANNUAL_COMPARISON}
      columns={[
        { title: '伙伴', dataIndex: 'supplier', width: 140 },
        { title: '所用总额 / 期限', width: 160, render: (_, row) => `${row.supplier === 'AWS' ? '> ' : ''}${money(row.totalB)} / ${row.years} 年` },
        { title: '简单年均', width: 135, render: (_, row) => `${row.supplier === 'AWS' ? '> ' : ''}${money(row.annualB)} / 年` },
        { title: '证据口径', dataIndex: 'qualifier', width: 240 },
        { title: '来源', width: 150, render: (_, row) => <ResearchSource id={row.sourceId} /> },
      ]}
    />
    <Paragraph type="secondary" className="ai-compute-research-caption">
      仅用总额除以年数：Google $200B ÷ 5 = $40B / 年；AWS 官方披露超过 $100B ÷ 10，简单年均超过 $10B / 年。
      Google 金额与期限来自媒体，Reuters 当时注明未独立核实。以上不是实际年度付款安排，不能据此认定实际支出为四倍，也不能推出 TPU 的算力份额。
    </Paragraph>
    <Paragraph type="secondary">
      <ResearchSource id="googleOfficial" /> 确认下一代 TPU 容量预计从 2027 年起上线；<ResearchSource id="awsOfficial" /> 确认最高 5GW 新容量。
      按投产时间、可用容量及工作负载跟踪多平台布局，采购总额不能直接折算成 GPU 订单或供应商收入。
    </Paragraph>
  </>;
}

export default function AnthropicComputeResearch() {
  return <Card className="ai-section-card ai-compute-research" title="Anthropic 算力采购承诺与供应商版图" id="anthropic-compute-research">
    <Space wrap size={[8, 8]}>
      <Tag color="blue">研究核验 {ANTHROPIC_RESEARCH.checkedAt}</Tag>
      <Tag>人工核验快照</Tag>
      <Tag color="orange">原图与最新报道分别列示</Tag>
    </Space>
    <Paragraph className="ai-compute-research-intro">
      TPU、Trainium 与 GPU 的多平台采购增强供给选择；评估算力需求时，同时关注交付节奏、最低付款义务和退出条款。
      供应商数量覆盖云服务、芯片和数据中心伙伴，不等于独立芯片架构数量。
    </Paragraph>
    <Tabs className="ai-inner-tabs" defaultActiveKey="latest" items={[
      { key: 'latest', label: `最新核验 · ${ANTHROPIC_RESEARCH.latestReportedAt} 报道`, children: <LatestCommitments /> },
      { key: 'original', label: '原图口径 · William Blair', children: <OriginalCommitments /> },
    ]} />
    <Collapse className="ai-compute-research-details" items={[
      { key: 'annual', label: 'Google 与 AWS：简单年均合同额与证据差异', children: <AnnualComparison /> },
      { key: 'sources', label: '全部核验来源与研究边界', children: <>
        <Space orientation="vertical" size={10}>
          {Object.entries(ANTHROPIC_RESEARCH.sources).map(([id, source]) => <div key={id}><Link href={source.url} target="_blank" rel="noreferrer">{source.label}</Link> <Text type="secondary">— {source.status}</Text></div>)}
        </Space>
        <Paragraph type="secondary" className="ai-compute-research-intro">
          本条为 {ANTHROPIC_RESEARCH.checkedAt} 的人工研究记录；页面刷新不会改变核验日期。
          采购承诺分别保留原图与报道口径，不计入小时租价、融资累计、ARR 或 CDS 计算。
        </Paragraph>
      </> },
    ]} />
  </Card>;
}

export function AnthropicComputeSummary({ variant, onOpenResearch }: {
  variant: 'overview' | 'debt';
  onOpenResearch?: () => void;
}) {
  const isDebt = variant === 'debt';
  return <Card className="ai-section-card ai-anthropic-summary" title={isDebt ? 'Anthropic 长期算力付款承诺' : 'Anthropic 算力采购 · 多平台布局'}>
    <Space wrap size={[8, 8]}><Tag color="blue">研究核验 {ANTHROPIC_RESEARCH.checkedAt}</Tag><Tag color="orange">媒体所见保密文件</Tag></Space>
    <Paragraph className="ai-compute-research-intro">
      {isDebt
        ? <>Reuters 报道未来约十年、{ANTHROPIC_RESEARCH.latestPartnerCount} 家伙伴的基础设施承诺至少 {money(ANTHROPIC_RESEARCH.latestHeadlineB)}，约 {ANTHROPIC_RESEARCH.nonCancelableApproxPercent}% 不可取消或须按最低义务支付。重点跟踪容量交付与收入增长能否覆盖付款节奏；xAI 最高 $84.5B 的协议大多可提前 90 天取消。</>
        : <>Anthropic 同时采购 TPU、Trainium 和 GPU 算力。原图列示 14 项关系、名义合计 {money(ANTHROPIC_ORIGINAL_SUM_B)}；Reuters 后续报道六家伙伴、至少 {money(ANTHROPIC_RESEARCH.latestHeadlineB)}。范围和合同性质不同，两组数据分别保留。</>}
    </Paragraph>
    <Paragraph type="secondary">
      {isDebt ? '采购付款义务单独分析，不纳入融资累计、债券余额或 CDS 定价。' : 'TPU 的重要性值得跟踪；合同简单年均不代表实际年度支出或芯片份额。'}
      {' '}来源：<ResearchSource id="reutersLatest" /> · {ANTHROPIC_RESEARCH.latestReportedAt}；保密文件原件未公开。
    </Paragraph>
    {onOpenResearch ? <Button type="link" onClick={onOpenResearch} style={{ paddingInline: 0 }}>查看算力租赁中的 Anthropic 研究卡 →</Button> : null}
  </Card>;
}
