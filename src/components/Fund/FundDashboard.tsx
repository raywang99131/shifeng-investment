import React, { useState, useMemo } from 'react';
import { Card, Row, Col, Button, Empty, Typography, Space } from 'antd';
import { PlusOutlined, RightOutlined, ArrowUpOutlined, ArrowDownOutlined, SyncOutlined } from '@ant-design/icons';
import { type Fund } from '../../types/fund';

const { Text } = Typography;

type SortKey = 'name' | 'nav' | 'dailyReturn';
type SortOrder = 'asc' | 'desc';

const profitColor = (v: number) => v > 0 ? '#ff4d4f' : v < 0 ? '#52c41a' : '#888';
const profitIcon = (v: number) => v > 0 ? <ArrowUpOutlined /> : v < 0 ? <ArrowDownOutlined /> : null;

interface FundStats {
  fund: Fund;
  totalCost: number;
  totalMarketValue: number;
  profit: number;
  profitPercent: number;
  dailyReturn: number;
  nav: number;
}

interface FundDashboardProps {
  funds: Fund[];
  onSelectFund: (id: string) => void;
  onAddFund: () => void;
  onSyncAll: () => void;
  syncing: boolean;
}

const FundDashboardCard: React.FC<{ stats: FundStats; onClick: () => void }> = ({ stats, onClick }) => {
  const { fund, dailyReturn, nav } = stats;

  return (
    <Card
      hoverable
      onClick={onClick}
      style={{ cursor: 'pointer', height: 200 }}
      styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } }}
    >
      <div>
        <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 4 }}>{fund.name}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>持仓 {fund.positions.length} 只股票</Text>
      </div>
      <div>
        <Row gutter={8} style={{ marginBottom: 6 }}>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 11 }}>最新净值</Text>
            <div style={{ fontSize: 15, fontWeight: 600, color: profitColor(nav - 1) }}>
              {nav.toFixed(4)}
            </div>
          </Col>
          <Col span={12}>
            <Text type="secondary" style={{ fontSize: 11 }}>今日涨跌</Text>
            <div style={{ fontSize: 15, fontWeight: 600, color: profitColor(dailyReturn) }}>
              {profitIcon(dailyReturn)}
              {dailyReturn !== 0 ? ` ${Math.abs(dailyReturn).toFixed(2)}%` : ' 0.00%'}
            </div>
          </Col>
        </Row>
        <Button type="link" icon={<RightOutlined />} iconPlacement="end" style={{ padding: 0, marginTop: 6 }} onClick={onClick}>
          查看详情
        </Button>
      </div>
    </Card>
  );
};

const FundDashboard: React.FC<FundDashboardProps> = ({ funds, onSelectFund, onAddFund, onSyncAll, syncing }) => {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // 计算每个基金的统计数据
  const allStats = useMemo<FundStats[]>(() => {
    return funds.map((fund) => {
      const totalCost = fund.positions.reduce((sum, p) => sum + p.shares * p.avgCost, 0);
      const totalMarketValue = fund.positions.reduce((sum, p) => {
        const price = p.currentPrice ?? p.avgCost;
        return sum + p.shares * price;
      }, 0);
      const profit = totalMarketValue - totalCost;
      const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

      // 净值 = 市值 / 成本（假设初始净值为1）
      const nav = totalCost > 0 ? totalMarketValue / totalCost : 1.0;

      // 日收益：基于昨收价和今价计算所有持仓的加权日涨跌
      let dailyReturn = 0;
      const weightedSum = { prev: 0, curr: 0 };
      for (const p of fund.positions) {
        const curr = (p.currentPrice ?? p.avgCost) * p.shares;
        const prev = (p.prevClose ?? p.currentPrice ?? p.avgCost) * p.shares;
        weightedSum.curr += curr;
        weightedSum.prev += prev;
      }
      if (weightedSum.prev > 0) {
        dailyReturn = ((weightedSum.curr - weightedSum.prev) / weightedSum.prev) * 100;
      }

      return { fund, totalCost, totalMarketValue, profit, profitPercent, dailyReturn, nav };
    });
  }, [funds]);

  // 排序
  const sortedStats = useMemo(() => {
    const sorted = [...allStats];
    sorted.sort((a, b) => {
      if (sortKey === 'name') {
        return sortOrder === 'asc' ? a.fund.name.localeCompare(b.fund.name) : b.fund.name.localeCompare(a.fund.name);
      }
      if (sortKey === 'nav') {
        return sortOrder === 'asc' ? a.nav - b.nav : b.nav - a.nav;
      }
      if (sortKey === 'dailyReturn') {
        return sortOrder === 'asc' ? a.dailyReturn - b.dailyReturn : b.dailyReturn - a.dailyReturn;
      }
      return 0;
    });
    return sorted;
  }, [allStats, sortKey, sortOrder]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  if (funds.length === 0) {
    return (
      <Empty
        description="暂无基金，点击下方按钮创建第一个基金"
        style={{ padding: '80px 0' }}
      >
        <Button type="primary" icon={<PlusOutlined />} onClick={onAddFund}>
          添加基金
        </Button>
      </Empty>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Text type="secondary">共 {funds.length} 个基金</Text>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={onAddFund}>
            添加基金
          </Button>
          <Button size="small" icon={<SyncOutlined />} onClick={onSyncAll} loading={syncing}>
            一键刷新
          </Button>
        </Space>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>排序：</Text>
          <Button size="small" type={sortKey === 'nav' ? 'primary' : 'default'} onClick={() => toggleSort('nav')}>
            净值{sortIcon('nav')}
          </Button>
          <Button size="small" type={sortKey === 'dailyReturn' ? 'primary' : 'default'} onClick={() => toggleSort('dailyReturn')}>
            日收益{sortIcon('dailyReturn')}
          </Button>
          <Button size="small" type={sortKey === 'name' ? 'primary' : 'default'} onClick={() => toggleSort('name')}>
            名称{sortIcon('name')}
          </Button>
        </Space>
      </div>
      <Row gutter={[16, 16]}>
        {sortedStats.map((stats) => (
          <Col key={stats.fund.id} span={8}>
            <FundDashboardCard stats={stats} onClick={() => onSelectFund(stats.fund.id)} />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default FundDashboard;
