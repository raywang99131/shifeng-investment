import { Alert, Card, Space, Table, Tag, Typography } from 'antd';
import type { CdsComparisonCompany, CdsModelComparison } from './types';

const { Text } = Typography;
const bp = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(2);
const delta = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
const curveLabel = (kind: string) => kind === 'standard-rfr' ? '标准利率曲线' : '美债代理曲线';

const columns = [
  { title: '公司', dataIndex: 'company', key: 'company', fixed: 'left' as const, width: 116 },
  { title: '报价日期', dataIndex: 'date', key: 'date', width: 112 },
  { title: '原模型 bp', dataIndex: 'legacyBp', key: 'legacy', render: bp, align: 'right' as const },
  { title: '新模型 bp', dataIndex: 'newBp', key: 'new', render: bp, align: 'right' as const },
  { title: '差值 bp', dataIndex: 'differenceBp', key: 'diff', render: delta, align: 'right' as const },
  { title: '原模型周变化', key: 'oldWeek', render: (_: unknown, row: CdsComparisonCompany) => delta(row.legacyChanges.sevenDayBp), align: 'right' as const },
  { title: '新模型周变化', key: 'newWeek', render: (_: unknown, row: CdsComparisonCompany) => delta(row.newChanges.sevenDayBp), align: 'right' as const },
  { title: '利率依据', dataIndex: 'curveKind', key: 'curve', render: curveLabel, width: 136 },
];

export default function CdsModelComparisonPanel({ comparison, primaryAsOf }: {
  comparison?: CdsModelComparison;
  primaryAsOf: string | null;
}) {
  if (!comparison) return null;
  const failed = comparison.status === 'error';
  const behind = Boolean(comparison.asOf && primaryAsOf && comparison.asOf < primaryAsOf);
  const label = failed ? '复算失败 · 上次结果' : behind ? '等待同步' : comparison.status === 'ready'
    ? '标准曲线已接入' : comparison.status === 'unavailable' ? '等待原始数据' : '代理曲线 · 估计值';
  return (
    <Card title="新旧模型对比" className="ai-section-card" extra={<Tag color={failed || behind ? 'warning' : 'blue'}>并行验证</Tag>}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Tag color={failed || behind ? 'warning' : 'default'}>{label}</Tag>
          {comparison.asOf ? <Text type="secondary">结果截至 {comparison.asOf}</Text> : null}
          <Text type="secondary">新模型：ISDA 定价实现</Text>
        </Space>
        <Alert showIcon type={failed || behind ? 'warning' : 'info'}
          title={behind && !failed ? '新模型日期落后于当前数据，请以各自标注日期为准。' : comparison.message} />
        {comparison.companies.length > 0 ? (
          <Table<CdsComparisonCompany> rowKey="company" size="small" pagination={false}
            dataSource={comparison.companies} columns={columns} scroll={{ x: 960 }}
            expandable={{ expandedRowRender: row => (
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">{row.instrumentName} · 最近 7 条实际结算记录</Text>
                <Table rowKey="date" size="small" pagination={false} dataSource={row.history.slice(-7)} scroll={{ x: 650 }}
                  columns={[
                    { title: '日期', dataIndex: 'date', key: 'date', width: 112 },
                    { title: '原模型 bp', dataIndex: 'legacyBp', key: 'old', render: bp },
                    { title: '新模型 bp', dataIndex: 'newBp', key: 'new', render: bp },
                    { title: '差值 bp', dataIndex: 'differenceBp', key: 'diff', render: delta },
                    { title: '利率依据', dataIndex: 'curveKind', key: 'curve', render: curveLabel },
                  ]} />
              </Space>
            ) }} />
        ) : null}
        <Text type="secondary">周变化单位为 bp，按结果日期与 7 天前或此前最近记录相减。利率曲线口径或合约变化时，新模型周变化留空。新模型尚待独立市场报价验证，当前主图沿用原序列。</Text>
      </Space>
    </Card>
  );
}
