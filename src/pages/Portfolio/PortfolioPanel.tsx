import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, Table, Space, DatePicker, Button, Modal, Form, InputNumber, Popconfirm, message, Empty, AutoComplete } from 'antd';
import { RiseOutlined, FallOutlined, SyncOutlined, PlusOutlined, EditOutlined, DeleteOutlined, ArrowLeftOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
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
  const [loadingPrice, setLoadingPrice] = useState(false);
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

  const handleCodeSelect = (val: string, opt: { name: string; code: string }) => {
    form.setFieldsValue({ code: val, name: opt.name });
    setNameOptions([]);
    // fetch current price immediately
    setLoadingPrice(true);
    fetch(`http://localhost:3000/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundId: '', codes: [val] }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.prices && data.prices[val]) {
          form.setFieldsValue({ currentPrice: data.prices[val].currentPrice });
        }
      })
      .catch(() => {})
      .finally(() => setLoadingPrice(false));
  };

  // Auto-fetch current price when code changes (for new positions only)
  React.useEffect(() => {
    if (position) return;
    const code = form.getFieldValue('code');
    if (!code || code.length < 6) return;
    // price already loaded via onSelect
  }, [form, position]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      const shares = Number(values.shares);
      const avgCost = Number(values.avgCost);
      const currentPrice = Number(form.getFieldValue('currentPrice'));
      console.log('[handleOk] from form:', currentPrice, '| from values:', values.currentPrice);

      if (inputMode === 'weight' && shares > 0 && initialCapital > 0) {
        // 检查 currentPrice 是否获取到
        if (!currentPrice || currentPrice <= 0) {
          message.error('当前价获取失败，请尝试重新选择股票代码');
          return;
        }
        // 检查权重是否超限
        const newTotal = otherWeightSum + shares;
        if (newTotal > 100) {
          message.error(`权重总和已达 ${newTotal.toFixed(1)}%，超过 100%，请降低权重`);
          return;
        }
        // 按权重计算股数：initialCapital * weight% / 当前价
        const calculatedShares = Math.floor((initialCapital * (shares / 100)) / currentPrice);
        onSave({ code: values.code, name: values.name, shares: calculatedShares, avgCost, currentPrice });
      } else {
        // 按股数录入：检查总持仓是否超过初始资金（编辑时用表单新值替换旧持仓市值）
        const thisMarketValue = shares * (currentPrice || avgCost);
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
            onSelect={(val, opt) => handleCodeSelect(val, opt)}
            placeholder="如 000001"
            disabled={!!position}
          />
        </Form.Item>
        <Form.Item name="name" label="股票名称" rules={[{ required: true, message: '请输入股票名称' }]}>
          <AutoComplete
            options={nameOptions}
            onSearch={(val) => setNameOptions(searchStocks(val).slice(0, 10))}
            onSelect={(_val, opt) => { form.setFieldsValue({ name: opt.name, code: opt.code }); setCodeOptions([]); handleCodeSelect(opt.code, opt); }}
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
            <Form.Item name="currentPrice" label="当前价（自动获取）">
              <InputNumber placeholder="自动获取" style={{ width: '100%' }} min={0} precision={2} disabled />
            </Form.Item>
          </>
        ) : (
          <>
            <Form.Item name="shares" label="目标权重 (%)" rules={[{ required: true, message: '请输入目标权重' }]}>
              <InputNumber placeholder="如 20" style={{ width: '100%' }} min={0.01} max={100} precision={2} suffix="%" />
            </Form.Item>
            <Form.Item name="avgCost" label="平均成本" rules={[{ required: true, message: '请输入平均成本' }]}>
              <InputNumber placeholder="如 12.50" style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
            <Form.Item label="当前价（自动获取）">
              <InputNumber value={form.getFieldValue('currentPrice')} style={{ width: '100%' }} disabled />
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
    persistFunds,
  } = useFundPortfolio();

  const navigate = useNavigate();

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
          const today = res.tradeDate!;
          const newFunds = funds.map((f) => {
            if (f.id !== fund.id) return f;
            const newPositions = f.positions.map((p) => {
              const pd = res.prices![p.code];
              if (!pd) return p;
              return { ...p, currentPrice: pd.currentPrice, prevClose: pd.prevClose };
            });
            const totalMV = newPositions.reduce((sum, p) => {
              const pd = res.prices![p.code];
              const price = pd ? pd.currentPrice : (p.currentPrice ?? p.avgCost);
              return sum + p.shares * price;
            }, 0);
            const nav = f.initialCapital > 0 ? totalMV / f.initialCapital : 1;
            let newNavHistory = f.navHistory;
            const exists = f.navHistory.some((n) => n.date === today);
            if (exists) {
              newNavHistory = f.navHistory.map((n) => n.date === today ? { ...n, nav, cumulativeNav: nav, marketValue: totalMV } : n);
            } else {
              newNavHistory = [...f.navHistory, { date: today, nav, cumulativeNav: nav, marketValue: totalMV }].sort((a, b) => a.date.localeCompare(b.date));
            }
            return { ...f, positions: newPositions, navHistory: newNavHistory, lastSyncDate: today };
          });
          persistFunds(newFunds);
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
        const today = res.tradeDate!;
        const shouldRecordNAV = currentFund.lastSyncDate !== today;
        const fundId = currentFund.id;

        // 构建完整的更新后基金对象，单次 persist 避免多次 setState 时序问题
        const newFunds = funds.map((f) => {
          if (f.id !== fundId) return f;

          // 更新所有持仓价格
          const newPositions = f.positions.map((p) => {
            const pd = res.prices![p.code];
            if (!pd) return p;
            return { ...p, currentPrice: pd.currentPrice, prevClose: pd.prevClose };
          });

          // 计算总市值（用最新价格）
          const totalMV = newPositions.reduce((sum, p) => {
            const pd = res.prices![p.code];
            const price = pd ? pd.currentPrice : (p.currentPrice ?? p.avgCost);
            return sum + p.shares * price;
          }, 0);
          const nav = f.initialCapital > 0 ? totalMV / f.initialCapital : 1;

          // 更新 navHistory
          let newNavHistory = f.navHistory;
          if (shouldRecordNAV) {
            const exists = f.navHistory.some((n) => n.date === today);
            if (exists) {
              newNavHistory = f.navHistory.map((n) => n.date === today ? { ...n, nav, cumulativeNav: nav, marketValue: totalMV } : n);
            } else {
              newNavHistory = [...f.navHistory, { date: today, nav, cumulativeNav: nav, marketValue: totalMV }].sort((a, b) => a.date.localeCompare(b.date));
            }
          }

          return {
            ...f,
            positions: newPositions,
            navHistory: newNavHistory,
            lastSyncDate: shouldRecordNAV ? today : f.lastSyncDate,
          };
        });

        // 直接调用 persistFunds 单次更新所有数据（positions + navHistory + lastSyncDate）
        persistFunds(newFunds);

        message.success(`数据已更新 (${today})`);
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
        return `${data.name}: ¥${(data.value || 0).toLocaleString()} (${data.percent.toFixed(1)}%)`;
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
      title: '名称/代码',
      key: 'nameCode',
      width: 130,
      render: (_: unknown, record: Position) => (
        <div style={{ lineHeight: 1.4 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{record.name}</div>
          <div style={{ fontSize: 11, color: '#888' }}>{record.code}</div>
        </div>
      ),
    },
    {
      title: '成本/现价',
      key: 'costPrice',
      width: 144,
      align: 'right' as const,
      render: (_: unknown, record: Position & { currentPrice: number; profitPercent: number }) => {
        const pctColor = record.profitPercent > 0 ? '#ff4d4f' : record.profitPercent < 0 ? '#52c41a' : '#888';
        return (
          <div style={{ lineHeight: 1.4, textAlign: 'right' }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: pctColor }}>{record.avgCost.toFixed(2)}</span>
              <span style={{ color: '#aaa', margin: '0 4px' }}>→</span>
              <span style={{ color: pctColor }}>{record.currentPrice.toFixed(2)}</span>
            </div>
            <div style={{ fontSize: 11, color: pctColor }}>
              {record.profitPercent >= 0 ? '+' : ''}{record.profitPercent.toFixed(1)}%
            </div>
          </div>
        );
      },
    },
    {
      title: '持仓',
      key: 'shares',
      width: 104,
      align: 'right' as const,
      render: (_: unknown, record: Position) => (
        <div style={{ lineHeight: 1.4, textAlign: 'right' }}>
          <div style={{ fontSize: 13 }}>{(record.shares || 0).toLocaleString()}</div>
          <div style={{ fontSize: 11, color: '#888' }}>股</div>
        </div>
      ),
    },
    {
      title: '持仓盈亏',
      key: 'profit',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, record: Position & { profit: number; profitPercent: number }) => {
        const color = record.profit > 0 ? '#ff4d4f' : record.profit < 0 ? '#52c41a' : '#888';
        return (
          <div style={{ lineHeight: 1.4, textAlign: 'right' }}>
            <div style={{ fontSize: 11, color }}>{record.profitPercent >= 0 ? '+' : ''}{record.profitPercent.toFixed(1)}%</div>
            <div style={{ fontSize: 13, color }}>{record.profit >= 0 ? '+' : ''}{(Math.round(record.profit) || 0).toLocaleString()}</div>
          </div>
        );
      },
    },
    {
      title: '当日盈亏',
      key: 'dailyReturn',
      width: 96,
      align: 'right' as const,
      render: (_: unknown, record: Position & { dailyReturn: number; prevClose?: number; currentPrice: number }) => {
        const dr = record.dailyReturn;
        const color = dr > 0 ? '#ff4d4f' : dr < 0 ? '#52c41a' : '#888';
        const icon = dr > 0 ? <ArrowUpOutlined /> : dr < 0 ? <ArrowDownOutlined /> : null;
        const change = record.prevClose ? (record.currentPrice - record.prevClose) * (record.shares || 0) : 0;
        return (
          <div style={{ lineHeight: 1.4, textAlign: 'right' }}>
            <div style={{ fontSize: 11, color }}>
              {icon}{dr !== 0 ? `${dr > 0 ? '+' : ''}${dr.toFixed(2)}%` : '0.00%'}
            </div>
            <div style={{ fontSize: 13, color }}>
              {change >= 0 ? '+' : ''}{(Math.round(change) || 0).toLocaleString()}
            </div>
          </div>
        );
      },
    },
    {
      title: '仓位',
      key: 'weight',
      width: 88,
      align: 'right' as const,
      render: (_: unknown, record: Position & { weight: number }) => (
        <span style={{ fontSize: 13 }}>{record.weight.toFixed(1)}%</span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Position) => (
        <Space size="small" onClick={(e) => e.stopPropagation()}>
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
        <Space style={{ marginBottom: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBackToDashboard}>
            返回九宫格
          </Button>
        </Space>
      </div>

      <FundSwitcher
        funds={funds}
        currentFundId={currentFund.id}
        onSelect={selectFund}
        onAdd={(name, ic) => addFund(name, ic)}
        onUpdate={updateFund}
        onDelete={deleteFund}
      />

      <div style={{ fontSize: 32, fontWeight: 700, color: theme === 'dark' ? '#fff' : '#333', marginBottom: 16 }}>
        {currentFund.name}
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
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
            style={{ width: '100%' }}
            onRow={(_, index) => ({ onClick: () => navigate(`/stock/${stats.positions[index!].code}`), style: { cursor: 'pointer' } })}
            summary={() => (
              <Table.Summary>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>
                    <strong>股票合计</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>¥{stats.totalMarketValue.toLocaleString()}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <strong>{stats.positions.reduce((s, p) => s + p.shares, 0).toLocaleString()}</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <div style={{ lineHeight: 1.4, textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: stats.totalProfit >= 0 ? '#ff4d4f' : '#52c41a' }}>
                        {stats.profitPercent >= 0 ? '+' : ''}{stats.profitPercent.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 13, color: stats.totalProfit >= 0 ? '#ff4d4f' : '#52c41a' }}>
                        {stats.totalProfit >= 0 ? '+' : ''}{Math.round(stats.totalProfit).toLocaleString()}
                      </div>
                    </div>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    <div style={{ lineHeight: 1.4, textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: stats.dailyReturn > 0 ? '#ff4d4f' : stats.dailyReturn < 0 ? '#52c41a' : '#888' }}>
                        {stats.dailyReturn !== 0 ? `${stats.dailyReturn > 0 ? '+' : ''}${stats.dailyReturn.toFixed(2)}%` : '0.00%'}
                      </div>
                      <div style={{ fontSize: 13, color: stats.dailyReturn > 0 ? '#ff4d4f' : stats.dailyReturn < 0 ? '#52c41a' : '#888' }}>
                        {(() => {
                          const totalChange = stats.positions.reduce((s, p) => {
                            const curr = (p.currentPrice ?? p.avgCost) * p.shares;
                            const prev = (p.prevClose ?? p.currentPrice ?? p.avgCost) * p.shares;
                            return s + curr - prev;
                          }, 0);
                          return `${totalChange >= 0 ? '+' : ''}${Math.round(totalChange).toLocaleString()}`;
                        })()}
                      </div>
                    </div>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <strong>{(stats.totalMarketValue / stats.initialCapital * 100).toFixed(1)}%</strong>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} />
                </Table.Summary.Row>
                {stats.cash > 0 ? (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <span style={{ color: '#888' }}>现金</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <span style={{ color: '#888' }}>¥{(stats.cash || 0).toLocaleString()}</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <span style={{ color: '#888' }}>—</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <span style={{ color: '#888' }}>—</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right">
                      <span style={{ color: '#888' }}>—</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right">
                      <span style={{ color: '#888' }}>{((stats.cash || 0) / (stats.initialCapital || 1) * 100).toFixed(1)}%</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} />
                  </Table.Summary.Row>
                ) : null}
              </Table.Summary>
            )}
          />
        ) : (
          <Empty description="暂无持仓，点击「添加持仓」添加" />
        )}
      </Card>

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
              { title: '净值', dataIndex: 'nav', width: 100, align: 'right' as const, render: (v: number) => v.toFixed(4) },
              { title: '市值（元）', dataIndex: 'marketValue', width: 150, align: 'right' as const, render: (v: number) => v.toLocaleString('zh-CN', { maximumFractionDigits: 0 }) },
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
          />
        </Card>
      )}

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
