import React, { useState, useMemo } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Space, DatePicker, Button, Modal, Form, InputNumber, Popconfirm, message, Empty, AutoComplete } from 'antd';
import { DollarOutlined, RiseOutlined, FallOutlined, SyncOutlined, PlusOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTheme } from '../../hooks/useTheme';
import { syncPrices } from '../../services/quoteApi';
import { useFundPortfolio } from '../../hooks/useFundPortfolio';
import { FundDashboard, FundSwitcher, AddFundModal, ContributionModal } from '../../components/Fund';
import { type Position } from '../../types/fund';
import { searchStocks } from '../../data/stocks';

const { RangePicker } = DatePicker;
const { useForm } = Form;

const PositionModal: React.FC<{
  open: boolean;
  position?: Position;
  initialCapital: number;
  otherPositions: { code: string; marketValue: number }[];
  onClose: () => void;
  onSave: (data: Position) => void;
}> = ({ open, position, initialCapital, otherPositions, onClose, onSave }) => {
  const [form] = useForm();
  const [inputMode, setInputMode] = useState<'shares' | 'weight'>('shares');
  const [codeOptions, setCodeOptions] = useState<{ value: string; label: string; name: string; code: string }[]>([]);
  const [nameOptions, setNameOptions] = useState<{ value: string; label: string; name: string; code: string }[]>([]);
  const [previewShares, setPreviewShares] = useState<number | null>(null);
  const [weightWarning, setWeightWarning] = useState<string | null>(null);
  const title = position ? '编辑持仓' : '添加持仓';

  // 计算其他持仓的市值总和（编辑时排除自身），以初始资金为分母
  const otherMarketValueSum = otherPositions
    .filter((p) => p.code !== position?.code)
    .reduce((sum, p) => sum + p.marketValue, 0);
  // 其他持仓的权重（用于权重模式超限检查）
  const otherWeightSum = initialCapital > 0 ? (otherMarketValueSum / initialCapital) * 100 : 0;

  React.useEffect(() => {
    if (open) {
      if (position) {
        form.setFieldsValue({ ...position, weight: undefined });
        setInputMode('shares');
      } else {
        form.resetFields();
        setInputMode('shares');
      }
      setPreviewShares(null);
      setWeightWarning(null);
    }
  }, [open, position, form]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      const shares = Number(values.shares);
      const avgCost = Number(values.avgCost);
      const currentPrice = Number(values.currentPrice);
      const thisPrice = currentPrice || avgCost;
      const thisMarketValue = shares * thisPrice;

      if (inputMode === 'weight' && shares > 0 && avgCost > 0 && initialCapital > 0) {
        // 检查权重是否超限
        const newTotal = otherWeightSum + shares;
        if (newTotal > 100) {
          message.error(`权重总和已达 ${newTotal.toFixed(1)}%，超过 100%，请降低权重`);
          return;
        }
        // 按权重计算股数：initialCapital * weight% / 当前价(avgCost)
        // avgCost 在 weight 模式里是"当前价"，currentPrice 是"平均成本"
        const calculatedShares = Math.floor((initialCapital * (shares / 100)) / avgCost);
        onSave({ code: values.code, name: values.name, shares: calculatedShares, avgCost: currentPrice || avgCost, currentPrice: avgCost });
      } else {
        // 按股数录入：检查总持仓是否超过初始资金（编辑时用表单新值替换旧持仓市值）
        if (otherMarketValueSum + thisMarketValue > initialCapital) {
          const newPct = ((otherMarketValueSum + thisMarketValue) / initialCapital) * 100;
          message.error(`总持仓市值已达 ${newPct.toFixed(1)}%，超过 100%，请降低持仓`);
          return;
        }
        onSave({ code: values.code, name: values.name, shares, avgCost, currentPrice: currentPrice || avgCost });
      }
      onClose();
    });
  };

  return (
    <Modal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
    >
      <div onKeyDown={(e) => { if (e.key === 'Enter') handleOk(); }}>

      <Form form={form} layout="vertical">
        <Form.Item label="录入方式" style={{ marginBottom: 8 }}>
          <Space>
            <Button type={inputMode === 'shares' ? 'primary' : 'default'} size="small" onClick={() => setInputMode('shares')}>按股数录入</Button>
            <Button type={inputMode === 'weight' ? 'primary' : 'default'} size="small" onClick={() => setInputMode('weight')}>按权重录入</Button>
          </Space>
        </Form.Item>
        <Form.Item name="code" label="股票代码" rules={[{ required: true, message: '请输入股票代码' }]}>
          <AutoComplete
            options={codeOptions}
            onSearch={(val) => setCodeOptions(searchStocks(val).slice(0, 10))}
            onSelect={(val, opt) => { form.setFieldsValue({ code: val, name: opt.name }); setNameOptions([]); }}
            placeholder="如 000001"
            disabled={!!position}
          />
        </Form.Item>
        <Form.Item name="name" label="股票名称" rules={[{ required: true, message: '请输入股票名称' }]}>
          <AutoComplete
            options={nameOptions}
            onSearch={(val) => setNameOptions(searchStocks(val).slice(0, 10))}
            onSelect={(_val, opt) => { form.setFieldsValue({ name: opt.name, code: opt.code }); setCodeOptions([]); }}
            placeholder="如 平安银行"
          />
        </Form.Item>
        {inputMode === 'shares' ? (
          <>
            <Form.Item name="shares" label="持仓数量" rules={[{ required: true, message: '请输入持仓数量' }]}>
              <InputNumber placeholder="如 10000" style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="avgCost" label="平均成本" rules={[{ required: true, message: '请输入平均成本' }]}>
              <InputNumber placeholder="如 12.50" style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="currentPrice" label="当前价（留空则默认等于平均成本）">
              <InputNumber placeholder="如 13.20（留空则等于平均成本）" style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item
              name="shares"
              label="目标权重 (%)"
              rules={[{ required: true, message: '请输入目标权重' }, { type: 'number', min: 0.01, max: 100, message: '权重需在 0.01~100 之间' }]}
              extra={`初始资金 ¥${initialCapital.toLocaleString()}，输入权重后系统将自动计算股数`}
            >
              <InputNumber
                placeholder="如 20"
                style={{ width: '100%' }}
                min={0.01}
                max={100}
                precision={2}
                suffix="%"
                disabled={initialCapital <= 0}
                onChange={(val) => {
                  const weight = Number(val);
                  const price = Number(form.getFieldValue('avgCost'));
                  if (weight > 0 && price > 0 && initialCapital > 0) {
                    setPreviewShares(Math.floor((initialCapital * (weight / 100)) / price));
                    // 检查权重是否超限
                    const newTotal = otherWeightSum + weight;
                    if (newTotal > 100) {
                      setWeightWarning(`权重总和已达 ${newTotal.toFixed(1)}%，超过 100%，请降低权重`);
                    } else {
                      setWeightWarning(null);
                    }
                  } else {
                    setPreviewShares(null);
                    setWeightWarning(null);
                  }
                }}
              />
            </Form.Item>
            <Form.Item name="avgCost" label="当前价（用于计算股数）" rules={[{ required: true, message: '请输入当前价' }]}>
              <InputNumber
                placeholder="如 13.50"
                style={{ width: '100%' }}
                min={0}
                precision={2}
                onChange={() => {
                  const weight = Number(form.getFieldValue('shares'));
                  const price = Number(form.getFieldValue('avgCost'));
                  if (weight > 0 && price > 0 && initialCapital > 0) {
                    setPreviewShares(Math.floor((initialCapital * (weight / 100)) / price));
                  } else {
                    setPreviewShares(null);
                  }
                }}
              />
            </Form.Item>
            {previewShares !== null && (
              <Form.Item label="计算结果">
                <InputNumber value={previewShares} disabled style={{ width: '100%', background: 'transparent', border: 'none' }} />
              </Form.Item>
            )}
            {weightWarning && (
              <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
                {weightWarning}
              </div>
            )}
            <Form.Item name="currentPrice" label="平均成本（留空则默认等于当前价）">
              <InputNumber placeholder="如 12.50（留空则等于当前价）" style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
          </>
        )}
      </Form>
    </div>
    </Modal>
  );
};

const PortfolioPanel: React.FC = () => {
  const { theme } = useTheme();
  const {
    funds,
    currentFund,
    selectFund,
    addFund,
    updateFund,
    deleteFund,
    addPosition,
    updatePosition,
    deletePosition,
    addNAVRecord,
  } = useFundPortfolio();

  const [modalOpen, setModalOpen] = useState(false);
  const [isViewingDashboard, setIsViewingDashboard] = useState(true);
  const [addFundModalOpen, setAddFundModalOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [contributionModalOpen, setContributionModalOpen] = useState(false);
  const [navDateRange, setNavDateRange] = useState<[string | null, string | null]>([null, null]);

  // 根据日期范围过滤净值历史
  const filteredNavHistory = useMemo(() => {
    if (!currentFund || !navDateRange[0] || !navDateRange[1]) {
      return currentFund?.navHistory ?? [];
    }
    return currentFund.navHistory.filter(
      (n) => n.date >= navDateRange[0]! && n.date <= navDateRange[1]!
    );
  }, [currentFund, navDateRange]);

  // 计算当前基金的统计数据
  const stats = useMemo(() => {
    if (!currentFund) {
      return { totalMarketValue: 0, totalCost: 0, totalProfit: 0, profitPercent: 0, dailyReturn: 0, cash: 0, initialCapital: 0, positions: [] as (Position & { currentPrice: number; marketValue: number; profit: number; profitPercent: number; dailyReturn: number; contribution: number; contributionPercent: number; weight: number })[] };
    }
    const initialCapital = currentFund.initialCapital;
    const totalMarketValue = currentFund.positions.reduce((sum, p) => {
      const price = p.currentPrice ?? p.avgCost;
      return sum + p.shares * price;
    }, 0);
    const cash = initialCapital - totalMarketValue;
    const totalCost = currentFund.positions.reduce((sum, p) => sum + p.shares * p.avgCost, 0);
    const totalProfit = totalMarketValue - totalCost;
    const profitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    // 加权日收益：基于昨收和今价
    let dailyReturn = 0;
    let weightedCurr = 0;
    let weightedPrev = 0;
    for (const p of currentFund.positions) {
      const curr = (p.currentPrice ?? p.avgCost) * p.shares;
      const prev = (p.prevClose ?? p.currentPrice ?? p.avgCost) * p.shares;
      weightedCurr += curr;
      weightedPrev += prev;
    }
    if (weightedPrev > 0) {
      dailyReturn = ((weightedCurr - weightedPrev) / weightedPrev) * 100;
    }

    const positions = currentFund.positions.map((p) => {
      const currentPrice = p.currentPrice ?? p.avgCost;
      const prevPrice = p.prevClose ?? p.currentPrice ?? p.avgCost;
      const marketValue = p.shares * currentPrice;
      const cost = p.shares * p.avgCost;
      const profit = marketValue - cost;
      const profitPercent = cost > 0 ? (profit / cost) * 100 : 0;
      const dailyReturn = prevPrice > 0 ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;
      const contribution = profit;
      const contributionPercent = totalProfit !== 0 ? (profit / totalProfit) * 100 : 0;
      const weight = initialCapital > 0 ? (marketValue / initialCapital) * 100 : 0;
      return { ...p, currentPrice, marketValue, profit, profitPercent, dailyReturn, contribution, contributionPercent, weight };
    });

    return { totalMarketValue, totalCost, totalProfit, profitPercent, dailyReturn, cash, initialCapital, positions };
  }, [currentFund]);

const handleFundSelect = (fundId: string) => {
    selectFund(fundId);
    setIsViewingDashboard(false);
  };

  const handleBackToDashboard = () => {
    setIsViewingDashboard(true);
  };

  const handleAddFund = (name: string, initialCapital: number) => {
    addFund(name, initialCapital);
  };

  const handleSave = (values: Position) => {
    if (!currentFund) return;
    if (editingPosition) {
      updatePosition(currentFund.id, editingPosition.code, values);
      message.success('持仓已更新');
    } else {
      addPosition(currentFund.id, values);
      message.success('持仓已添加');
    }
    setEditingPosition(undefined);
  };

  const handleEdit = (record: Position) => {
    setEditingPosition(record);
    setModalOpen(true);
  };

  const handleDelete = (code: string) => {
    if (!currentFund) return;
    deletePosition(currentFund.id, code);
    message.success('持仓已删除');
  };

  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    let successCount = 0;
    for (const fund of funds) {
      if (fund.positions.length > 0) {
        const codes = fund.positions.map((p) => p.code);
        const res = await syncPrices({ fundId: fund.id, codes });
        if (res.success && res.prices) {
          for (const [code, priceData] of Object.entries(res.prices)) {
            updatePosition(fund.id, code, { currentPrice: priceData.currentPrice, prevClose: priceData.prevClose });
          }
          const totalMV = fund.positions.reduce((sum, p) => {
            const pd = res.prices![p.code];
            const price = pd ? pd.currentPrice : (p.currentPrice ?? p.avgCost);
            return sum + p.shares * price;
          }, 0);
          const nav = fund.initialCapital > 0 ? totalMV / fund.initialCapital : 1;
          addNAVRecord(fund.id, { date: res.tradeDate!, nav, cumulativeNav: nav, marketValue: totalMV });
          successCount++;
        }
      }
    }
    setSyncing(false);
    if (successCount > 0) {
      message.success(`已刷新 ${successCount} 个基金的行情并记录净值`);
    } else {
      message.error('刷新失败，请检查服务');
    }
  };

  const handleSyncCurrent = async () => {
    if (!currentFund) return;
    setSyncing(true);
    try {
      const codes = currentFund.positions.map((p) => p.code);
      const res = await syncPrices({ fundId: currentFund.id, codes });
      if (res.success && res.prices) {
        for (const [code, priceData] of Object.entries(res.prices)) {
          updatePosition(currentFund.id, code, { currentPrice: priceData.currentPrice, prevClose: priceData.prevClose });
        }
        // 同步完成后自动记录今日净值
        const updatedFund = funds.find(f => f.id === currentFund.id);
        if (updatedFund) {
          const totalMarketValue = updatedFund.positions.reduce((sum, p) => {
            const priceData = res.prices![p.code];
            const price = priceData ? priceData.currentPrice : (p.currentPrice ?? p.avgCost);
            return sum + p.shares * price;
          }, 0);
          const nav = updatedFund.initialCapital > 0 ? totalMarketValue / updatedFund.initialCapital : 1;
          addNAVRecord(currentFund.id, {
            date: res.tradeDate!,
            nav,
            cumulativeNav: nav,
            marketValue: totalMarketValue,
          });
          message.success(`数据已更新 (${res.tradeDate})，净值已记录: ${nav.toFixed(4)}`);
        } else {
          message.success(`数据已更新 (${res.tradeDate})`);
        }
      } else {
        message.error(res.error || '同步失败');
      }
    } catch {
      message.error('同步失败，请检查服务');
    } finally {
      setSyncing(false);
    }
  };

  const openAddModal = () => {
    setEditingPosition(undefined);
    setModalOpen(true);
  };

  const curveChartOption = useMemo(() => {
    const navData = filteredNavHistory.length > 0 ? filteredNavHistory : [];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const data = (params as { axisValue: string; value: number }[])[0];
          return `${data.axisValue}<br/>净值: ${data.value.toFixed(4)}`;
        },
      },
      xAxis: {
        type: 'category',
        data: navData.map((n) => n.date.slice(5)),
        axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
        axisLabel: { color: theme === 'dark' ? '#888' : '#666', rotate: 45 },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: theme === 'dark' ? '#444' : '#ddd' } },
        axisLabel: {
          color: theme === 'dark' ? '#888' : '#666',
          formatter: (value: number) => value.toFixed(3),
        },
        splitLine: { lineStyle: { color: theme === 'dark' ? '#333' : '#eee' } },
      },
      series: [
        {
          data: navData.map((n) => n.nav),
          type: 'line',
          smooth: true,
          lineStyle: {
            color: stats.totalProfit >= 0 ? '#ff4d4f' : '#52c41a',
            width: 2,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: stats.totalProfit >= 0 ? 'rgba(255, 77, 79, 0.3)' : 'rgba(82, 196, 26, 0.3)' },
                { offset: 1, color: stats.totalProfit >= 0 ? 'rgba(255, 77, 79, 0.05)' : 'rgba(82, 196, 26, 0.05)' },
              ],
            },
          },
        },
      ],
      grid: { left: 60, right: 20, top: 20, bottom: 60 },
    };
  }, [filteredNavHistory, theme, stats.totalProfit]);

  const allocationChartOption = {
    backgroundColor: 'transparent',
    title: {
      text: '仓位分布',
      left: 'center',
      textStyle: { color: theme === 'dark' ? '#fff' : '#333', fontSize: 14 },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const data = params as { name: string; value: number; percent: number };
        return `${data.name}: ¥${data.value.toLocaleString()} (${data.percent.toFixed(1)}%)`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 4,
          borderColor: theme === 'dark' ? '#141414' : '#fff',
          borderWidth: 2,
        },
        label: {
          color: theme === 'dark' ? '#fff' : '#333',
        },
        data: [
          ...stats.positions.map((p) => ({
            value: p.marketValue,
            name: p.name,
          })),
          ...(stats.cash > 0 ? [{ value: stats.cash, name: '现金' }] : []),
        ],
      },
    ],
  };

  const columns = [
    {
      title: '股票代码',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      render: (code: string) => <Tag color="blue">{code}</Tag>,
    },
    {
      title: '股票名称',
      dataIndex: 'name',
      key: 'name',
      width: 100,
      render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    {
      title: '持仓数量',
      dataIndex: 'shares',
      key: 'shares',
      width: 100,
      align: 'right' as const,
      render: (shares: number) => shares.toLocaleString(),
    },
    {
      title: '平均成本',
      dataIndex: 'avgCost',
      key: 'avgCost',
      width: 100,
      align: 'right' as const,
      render: (cost: number) => `¥${cost.toFixed(2)}`,
    },
    {
      title: '当前价',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 100,
      align: 'right' as const,
      render: (price: number) => `¥${price.toFixed(2)}`,
    },
    {
      title: '今日涨跌',
      key: 'dailyReturn',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, record: Position & { dailyReturn: number }) => {
        const dr = record.dailyReturn;
        const color = dr > 0 ? '#ff4d4f' : dr < 0 ? '#52c41a' : '#888';
        const icon = dr > 0 ? <ArrowUpOutlined /> : dr < 0 ? <ArrowDownOutlined /> : null;
        return (
          <span style={{ color, fontSize: 12 }}>
            {icon}{dr !== 0 ? ` ${Math.abs(dr).toFixed(2)}%` : '0.00%'}
          </span>
        );
      },
    },
    {
      title: '市值',
      dataIndex: 'marketValue',
      key: 'marketValue',
      width: 120,
      align: 'right' as const,
      render: (value: number) => `¥${value.toLocaleString()}`,
    },
    {
      title: '成本/现价',
      key: 'costPrice',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, record: Position & { currentPrice: number; profitPercent: number }) => {
        const direction = record.profitPercent > 0 ? '↑' : record.profitPercent < 0 ? '↓' : '';
        const color = record.profitPercent > 0 ? '#ff4d4f' : record.profitPercent < 0 ? '#52c41a' : '#888';
        return (
          <span style={{ color }}>
            {record.avgCost.toFixed(2)} {direction} {record.currentPrice.toFixed(2)}
            <span style={{ fontSize: 11, marginLeft: 4 }}>({record.profitPercent >= 0 ? '+' : ''}{record.profitPercent.toFixed(1)}%)</span>
          </span>
        );
      },
    },
    {
      title: '持仓占比',
      key: 'weight',
      width: 90,
      align: 'right' as const,
      render: (_: unknown, record: Position & { weight: number }) => {
        return `${record.weight.toFixed(1)}%`;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Position) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.code)} okText="删除" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (isViewingDashboard) {
    return (
      <>
        <FundDashboard
          funds={funds}
          onSelectFund={handleFundSelect}
          onAddFund={() => setAddFundModalOpen(true)}
          onSyncAll={handleSyncAll}
          syncing={syncing}
        />
        <AddFundModal
          open={addFundModalOpen}
          onClose={() => setAddFundModalOpen(false)}
          onSave={handleAddFund}
        />
      </>
    );
  }

  if (!currentFund) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <Empty description="暂无基金" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBackToDashboard}>
            返回九宫格
          </Button>
        </Space>
        <FundSwitcher
          funds={funds}
          currentFundId={currentFund.id}
          onSelect={selectFund}
          onAdd={(name, ic) => addFund(name, ic)}
          onUpdate={updateFund}
          onDelete={deleteFund}
        />
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic
              title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>总市值</span>}
              value={stats.totalMarketValue}
              precision={2}
              prefix={<DollarOutlined />}
              valueStyle={{ color: theme === 'dark' ? '#fff' : '#333' }}
              suffix="元"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic
              title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>总盈亏</span>}
              value={stats.totalProfit}
              precision={2}
              prefix={stats.totalProfit >= 0 ? <RiseOutlined /> : <FallOutlined />}
              valueStyle={{ color: stats.totalProfit >= 0 ? '#ff4d4f' : '#52c41a' }}
              suffix="元"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic
              title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>收益率</span>}
              value={stats.profitPercent}
              precision={2}
              prefix={stats.profitPercent >= 0 ? <RiseOutlined /> : <FallOutlined />}
              valueStyle={{ color: stats.profitPercent >= 0 ? '#ff4d4f' : '#52c41a' }}
              suffix="%"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic
              title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>今日涨跌</span>}
              value={stats.dailyReturn}
              precision={2}
              prefix={stats.dailyReturn >= 0 ? <ArrowUpOutlined /> : stats.dailyReturn < 0 ? <ArrowDownOutlined /> : null}
              valueStyle={{ color: stats.dailyReturn > 0 ? '#ff4d4f' : stats.dailyReturn < 0 ? '#52c41a' : '#888' }}
              suffix="%"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}>
            <Statistic
              title={<span style={{ color: theme === 'dark' ? '#888' : '#666' }}>持仓数量</span>}
              value={stats.positions.length}
              valueStyle={{ color: theme === 'dark' ? '#fff' : '#333' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card
            size="small"
            title="净值曲线"
            extra={
              <Space size="small">
                <RangePicker
                  size="small"
                  onChange={(_dates, dateStrings) => {
                    setNavDateRange(dateStrings as [string | null, string | null]);
                  }}
                />
                <Button
                  size="small"
                  onClick={() => {
                    if (!currentFund) return;
                    const today = new Date().toISOString().slice(0, 10);
                    const nav = stats.initialCapital > 0 ? stats.totalMarketValue / stats.initialCapital : 1;
                    addNAVRecord(currentFund.id, {
                      date: today,
                      nav,
                      cumulativeNav: nav,
                      marketValue: stats.totalMarketValue,
                    });
                    message.success(`净值 ${nav.toFixed(4)} 已记录 (${today})`);
                  }}
                >
                  记录今日
                </Button>
              </Space>
            }
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 320 }}
          >
            <ReactECharts option={curveChartOption} style={{ height: 260 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            size="small"
            title="仓位分布"
            style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff', height: 320 }}
          >
            <ReactECharts option={allocationChartOption} style={{ height: 260 }} />
          </Card>
        </Col>
      </Row>

      {currentFund && currentFund.navHistory.length > 0 && (
        <Card
          size="small"
          title="净值历史"
          extra={
            <span style={{ color: '#888', fontSize: 12 }}>
              共 {currentFund.navHistory.length} 条记录
            </span>
          }
          style={{ marginBottom: 16, background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
        >
          <Table
            dataSource={[...currentFund.navHistory].reverse().map((r) => ({ ...r, key: r.date }))}
            columns={[
              { title: '日期', dataIndex: 'date', width: 120 },
              {
                title: '净值',
                dataIndex: 'nav',
                width: 100,
                align: 'right' as const,
                render: (v: number) => v.toFixed(4),
              },
              {
                title: '市值（元）',
                dataIndex: 'marketValue',
                width: 150,
                align: 'right' as const,
                render: (v: number) => v.toLocaleString('zh-CN', { maximumFractionDigits: 0 }),
              },
              {
                title: '操作',
                width: 80,
                render: (_: unknown, record: { date: string }) => (
                  <Popconfirm
                    title="删除该条记录？"
                    onConfirm={() => {
                      if (!currentFund) return;
                      const newHistory = currentFund.navHistory.filter((n) => n.date !== record.date);
                      updateFund(currentFund.id, { navHistory: newHistory } as unknown as { name?: string; initialCapital?: number });
                      message.success('已删除');
                    }}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button type="link" size="small" danger>删除</Button>
                  </Popconfirm>
                ),
              },
            ]}
            pagination={false}
            size="small"
            scroll={{ x: 400 }}
          />
        </Card>
      )}

      <Card
        size="small"
        title="持仓明细"
        extra={
          <Space>
            <Button icon={<SyncOutlined />} onClick={handleSyncCurrent} loading={syncing}>
              同步数据
            </Button>
            {stats.positions.length > 0 && (
              <Button onClick={() => setContributionModalOpen(true)}>
                贡献分析
              </Button>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
              添加持仓
            </Button>
          </Space>
        }
        style={{ background: theme === 'dark' ? '#1f1f1f' : '#fff' }}
      >
        {stats.positions.length > 0 ? (
          <Table
            columns={columns}
            dataSource={stats.positions}
            rowKey="code"
            pagination={false}
            size="small"
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={5}>
                    <strong>股票合计</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>¥{stats.totalMarketValue.toLocaleString()}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <strong style={{ color: stats.totalProfit >= 0 ? '#ff4d4f' : '#52c41a' }}>
                      {stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toLocaleString()}
                    </strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <strong>{(stats.totalMarketValue / stats.initialCapital * 100).toFixed(1)}%</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
                {stats.cash > 0 && (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={5}>
                      <span style={{ color: '#888' }}>现金</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <span style={{ color: '#888' }}>¥{stats.cash.toLocaleString()}</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <span style={{ color: '#888' }}>—</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <span style={{ color: '#888' }}>{(stats.cash / stats.initialCapital * 100).toFixed(1)}%</span>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              </Table.Summary>
            )}
          />
        ) : (
          <Empty description="暂无持仓，点击「添加持仓」添加" />
        )}
      </Card>

      <PositionModal
        open={modalOpen}
        position={editingPosition}
        initialCapital={stats.initialCapital}
        otherPositions={stats.positions.map((p) => ({ code: p.code, marketValue: p.marketValue }))}
        onClose={() => { setModalOpen(false); setEditingPosition(undefined); }}
        onSave={handleSave}
      />

      <ContributionModal
        open={contributionModalOpen}
        positions={stats.positions}
        totalProfit={stats.totalProfit}
        onClose={() => setContributionModalOpen(false)}
      />
    </div>
  );
};

export default PortfolioPanel;
