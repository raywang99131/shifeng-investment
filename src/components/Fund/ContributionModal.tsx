import React from 'react';
import { Modal, Table, Typography, Divider } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { type Position } from '../../types/fund';

const { Text } = Typography;

interface ExtendedPosition extends Position {
  currentPrice: number;
  marketValue: number;
  profit: number;
  profitPercent: number;
  contribution: number;
  contributionPercent: number;
}

interface ContributionModalProps {
  open: boolean;
  positions: ExtendedPosition[];
  totalProfit: number;
  onClose: () => void;
}

const ContributionModal: React.FC<ContributionModalProps> = ({ open, positions, totalProfit, onClose }) => {
  const sorted = [...positions].sort((a, b) => b.contributionPercent - a.contributionPercent);

  const columns = [
    {
      title: '股票',
      key: 'stock',
      render: (_: unknown, record: ExtendedPosition) => (
        <div>
          <Text strong>{record.name}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{record.code}</Text>
        </div>
      ),
    },
    {
      title: '持仓数量',
      dataIndex: 'shares',
      key: 'shares',
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '市值',
      dataIndex: 'marketValue',
      key: 'marketValue',
      align: 'right' as const,
      render: (v: number) => `¥${v.toLocaleString()}`,
    },
    {
      title: '盈亏',
      dataIndex: 'profit',
      key: 'profit',
      align: 'right' as const,
      render: (v: number) => (
        <Text style={{ color: v >= 0 ? '#ff4d4f' : '#52c41a' }}>
          {v >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} ¥{Math.abs(v).toLocaleString()}
        </Text>
      ),
    },
    {
      title: '贡献金额',
      dataIndex: 'contribution',
      key: 'contribution',
      align: 'right' as const,
      render: (v: number) => (
        <Text style={{ color: v >= 0 ? '#ff4d4f' : '#52c41a' }}>
          {v >= 0 ? '+' : ''}¥{Math.abs(v).toLocaleString()}
        </Text>
      ),
    },
    {
      title: '贡献占比',
      dataIndex: 'contributionPercent',
      key: 'contributionPercent',
      align: 'right' as const,
      render: (v: number) => (
        <Text strong style={{ color: v >= 0 ? '#ff4d4f' : '#52c41a' }}>
          {v >= 0 ? '+' : ''}{v.toFixed(1)}%
        </Text>
      ),
    },
  ];

  return (
    <Modal title="收益贡献分析" open={open} onCancel={onClose} footer={null} width={720}>
      <Divider plain>
        <Text type="secondary" style={{ fontSize: 12 }}>
          贡献占比 = 单只股票盈亏 / 组合总盈亏 × 100%
        </Text>
      </Divider>
      <Table
        columns={columns}
        dataSource={sorted}
        rowKey="code"
        pagination={false}
        size="small"
        summary={() => (
          <Table.Summary>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><Text strong>合计</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong>{positions.reduce((s, p) => s + p.shares, 0).toLocaleString()}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <Text strong>¥{positions.reduce((s, p) => s + p.marketValue, 0).toLocaleString()}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <Text strong style={{ color: totalProfit >= 0 ? '#ff4d4f' : '#52c41a' }}>
                  {totalProfit >= 0 ? '+' : ''}¥{Math.abs(totalProfit).toLocaleString()}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right">
                <Text strong style={{ color: totalProfit >= 0 ? '#ff4d4f' : '#52c41a' }}>
                  {totalProfit >= 0 ? '+' : ''}¥{Math.abs(totalProfit).toLocaleString()}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right">
                <Text strong>100%</Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
    </Modal>
  );
};

export default ContributionModal;
