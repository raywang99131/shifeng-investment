import { Alert, Card, Col, Collapse, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { NEBIUS_RESEARCH, NEBIUS_REVENUE_SCENARIOS } from './nebiusResearch';

const { Paragraph, Text, Link } = Typography;
const { sources, priceChanges, checkedAt, reportedEffectiveDate } = NEBIUS_RESEARCH;
const fullUtilization = NEBIUS_REVENUE_SCENARIOS.at(-1)!;
const money = (value: number) => `$${value.toFixed(2)}`;

function SourceLink({ source }: { source: { label: string; url: string } }) {
  return <Link href={source.url} target="_blank" rel="noreferrer">{source.label}</Link>;
}

export default function NebiusComputeResearch() {
  return (
    <Card className="ai-section-card ai-compute-research" title="Nebius 涨价跟踪与单 GW 收入核验">
      <Space wrap size={[8, 8]}>
        <Tag color="blue">研究更新 {checkedAt}</Tag>
        <Tag color="orange">新价待官方确认</Tag>
        <Text type="secondary">通知拟生效：{reportedEffectiveDate}</Text>
      </Space>
      <Paragraph className="ai-compute-research-intro">
        涨价幅度与公开转述一致，为算租定价权提供正面信号；“北美算租厂商被低估”仍需结合实际签约价、投产进度、资本开支和估值验证。
      </Paragraph>
      <Paragraph type="secondary">
        <SourceLink source={sources.notice} /> 与 <SourceLink source={sources.report} /> 披露同一轮客户通知，属于同源转述。
        核验时 <SourceLink source={sources.prices} /> 仍列旧价；未取得原始邮件，发送日期及新价尚未获一手确认。以下新价不计入已生效报价曲线。
      </Paragraph>
      <Table
        rowKey="gpu"
        size="small"
        pagination={false}
        scroll={{ x: 820 }}
        dataSource={[...priceChanges]}
        columns={[
          { title: 'GPU', dataIndex: 'gpu', width: 80 },
          { title: '9/17 官网价', dataIndex: 'current', width: 125, align: 'right', render: money },
          { title: '10/1 通知新价', dataIndex: 'announced', width: 140, align: 'right', render: money },
          { title: '涨幅（复算）', width: 125, align: 'right', render: (_, row) => `+${((row.announced / row.current - 1) * 100).toFixed(1)}%` },
          { title: '通知所列地区（转述）', dataIndex: 'regions' },
        ]}
      />
      <Paragraph type="secondary" className="ai-compute-research-caption">
        单位：USD / GPU / 小时；按需、未税，通知称含配套 CPU 和内存。涉及美国、欧洲及以色列，不能外推为北美全行业或全部存量长协同步涨价。
      </Paragraph>
      <Row gutter={[24, 16]} className="ai-compute-research-metrics">
        <Col xs={24} md={12}>
          <Statistic title="Q2 四笔大单 · 折合年合同价值 / GW" value="200–250" suffix="亿美元" />
          <Text type="secondary">官方披露 $20–25M / MW · <SourceLink source={sources.shareholderLetter} /></Text>
        </Col>
        <Col xs={24} md={12}>
          <Statistic title="B200 六折、满租 · 情景年收入 / GW" value={fullUtilization.announcedRevenueYiUsd.toFixed(1)} precision={1} suffix="亿美元" />
          <Text type="secondary">假设总用电 2.2 kW / GPU、全年可计费；非公司指引</Text>
        </Col>
      </Row>
      <Alert
        showIcon
        type="warning"
        title="400 亿美元 / GW：英伟达平台销售口径"
        description={<>
          <SourceLink source={sources.nvidiaCall} /> 的 Vera Rubin 数字指 NVIDIA 整套平台的收入机会，涵盖 CPU、GPU 和网络等。
          它不是算租厂商的年度租赁收入指引，不能与上述年合同价值直接比较。
        </>}
      />
      <Collapse
        className="ai-compute-research-details"
        items={[
          {
            key: 'calculation',
            label: '展开测算：203 亿美元如何成立，以及利用率敏感性',
            children: <>
              <Paragraph>
                将“长协折扣比例 60%”解释为按标价六折成交：$8.50 × 60% = $5.10 / GPU / 小时。
                60% 是研究假设，不是 Nebius 披露的长协折扣；如果原意是减价 60%（四折），同样装机和满租条件下年收入约 135.4 亿美元。
              </Paragraph>
              <Paragraph>
                203 亿美元隐含约 45.4 万张可计费 GPU。以 1 GW 机房总输入功率、每卡分摊总用电约 2.2 kW 复算：
              </Paragraph>
              <Paragraph strong>
                年收入 =（1,000,000 kW ÷ 2.2 kW / GPU）× $8.50 × 60% × 8,760 小时 × 可计费利用率
              </Paragraph>
              <Paragraph type="secondary">
                2.2 kW 为反推的情景假设，须覆盖服务器、网络、存储及制冷等开销，并非 B200 芯片功耗。
                <SourceLink source={sources.dgxSpecs} /> 列示 8 卡整机最大功耗 14.3 kW，折合每卡 1.7875 kW，尚不含外部设施开销；只能作为参考，不能代表 Nebius 实际机型、PUE 或运行功耗。
                若 1 GW 指 IT 功率，须另行统一功率口径，不能重复扣除 PUE。
              </Paragraph>
              <Table
                rowKey="utilization"
                size="small"
                pagination={false}
                scroll={{ x: 590 }}
                dataSource={NEBIUS_REVENUE_SCENARIOS}
                columns={[
                  { title: '可计费利用率', dataIndex: 'utilization', render: value => `${value * 100}%` },
                  { title: '旧价年收入', dataIndex: 'previousRevenueYiUsd', align: 'right', render: value => value.toFixed(1) },
                  { title: '新价年收入', dataIndex: 'announcedRevenueYiUsd', align: 'right', render: value => value.toFixed(1) },
                  { title: '理论增量', dataIndex: 'incrementalRevenueYiUsd', align: 'right', render: value => `+${value.toFixed(1)}` },
                ]}
              />
              <Paragraph type="secondary" className="ai-compute-research-caption">
                单位：亿美元 / 年。假设全部容量全年可用、均按对应价格六折计费；实际应按合同计费条款、投产时间和定价组合测算。这里的利用率是可计费时间比例，不是 GPU 芯片忙碌率。
              </Paragraph>
              <Paragraph>
                <SourceLink source={sources.shareholderLetter} /> 的 $20–25M / MW 对应四笔 Q2 大单的年合同价值（ACV），折合 200–250 亿美元 / GW / 年。
                这是特定合同的年化口径，不是 Q2 已实现收入，也不是所有新增或已签电力容量都能立即实现的收入。
                与 203 亿情景数量级相近，不等于验证了 B200 装机密度或六折假设。
              </Paragraph>
            </>,
          },
          {
            key: 'thesis',
            label: '投资含义、待验证事项与来源',
            children: <>
              <Paragraph>
                <Text strong>研究判断：</Text>官方大单 ACV 支持单位电力变现能力改善；若本轮按需涨价落地且可计费利用率稳定，将增强新签与续约定价的上行逻辑。
                对 Nebius、CoreWeave、IREN 的行业参考有意义，个股低估判断仍需各自的合同、融资摊薄、折旧、资本开支和估值支持。
              </Paragraph>
              <Paragraph>
                <Text strong>反向验证：</Text>高标价可能伴随更深折扣、客户流失或利用率下降；存量固定价长协未必重定价。
                Rubin 的单位电力产出提升，也需与整套设备投资和实际租价共同评估，不能仅由 NVIDIA 每 GW 销售额更高推出算租股更便宜。
              </Paragraph>
              <Paragraph>
                <Text strong>下一验证点：</Text>2026-10-01 对照官方价目表或原始通知核实价格及地区；下一次业绩披露关注新签 ACV / MW、投产及可计费容量、合同期限与自由现金流。
                当前状态：定价权线索增强；“被低估”待验证。本条为 {checkedAt} 的研究记录。
              </Paragraph>
              <Space orientation="vertical" size={8}>
                {Object.entries(sources).map(([key, source]) => (
                  <div key={key}><SourceLink source={source} /> <Text type="secondary">— {source.status}</Text></div>
                ))}
              </Space>
            </>,
          },
        ]}
      />
    </Card>
  );
}
