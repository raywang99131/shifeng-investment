import { useState, useCallback, useMemo } from 'react';

export interface Position {
  code: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  profit: number;
  profitPercent: number;
  weight: number;
}

const STORAGE_KEY = 'shifeng_portfolio_positions';

const DEFAULT_POSITIONS: Position[] = [
  { code: '000001', name: '平安银行', shares: 10000, avgCost: 12.50, currentPrice: 13.20, marketValue: 132000, profit: 7000, profitPercent: 5.60, weight: 15.5 },
  { code: '600519', name: '贵州茅台', shares: 200, avgCost: 1680.00, currentPrice: 1750.50, marketValue: 350100, profit: 14100, profitPercent: 4.20, weight: 41.2 },
  { code: '000858', name: '五粮液', shares: 3000, avgCost: 145.00, currentPrice: 142.30, marketValue: 426900, profit: -8100, profitPercent: -1.86, weight: 42.7 },
  { code: '600036', name: '招商银行', shares: 5000, avgCost: 35.80, currentPrice: 36.50, marketValue: 182500, profit: 3500, profitPercent: 1.95, weight: 21.5 },
];

function loadPositions(): Position[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return DEFAULT_POSITIONS;
}

function savePositions(positions: Position[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // ignore
  }
}

function recalculate(positions: Position[]): Position[] {
  const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  return positions.map((p) => {
    const marketValue = p.shares * p.currentPrice;
    const cost = p.shares * p.avgCost;
    const profit = marketValue - cost;
    const profitPercent = cost > 0 ? (profit / cost) * 100 : 0;
    const weight = totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : 0;
    return { ...p, marketValue, profit, profitPercent, weight };
  });
}

interface UsePortfolioReturn {
  positions: Position[];
  totalMarketValue: number;
  totalProfit: number;
  totalProfitPercent: number;
  addPosition: (p: Omit<Position, 'marketValue' | 'profit' | 'profitPercent' | 'weight'>) => void;
  updatePosition: (code: string, updates: Partial<Omit<Position, 'marketValue' | 'profit' | 'profitPercent' | 'weight'>>) => void;
  deletePosition: (code: string) => void;
  refresh: () => void;
}

export function usePortfolio(): UsePortfolioReturn {
  const [positions, setPositions] = useState<Position[]>(() => {
    const loaded = loadPositions();
    return recalculate(loaded);
  });

  const addPosition = useCallback(
    (p: Omit<Position, 'marketValue' | 'profit' | 'profitPercent' | 'weight'>) => {
      setPositions((prev) => {
        const next = recalculate([...prev, { ...p, marketValue: 0, profit: 0, profitPercent: 0, weight: 0 }]);
        savePositions(next);
        return next;
      });
    },
    []
  );

  const updatePosition = useCallback(
    (code: string, updates: Partial<Omit<Position, 'marketValue' | 'profit' | 'profitPercent' | 'weight'>>) => {
      setPositions((prev) => {
        const next = recalculate(
          prev.map((p) => (p.code === code ? { ...p, ...updates } : p))
        );
        savePositions(next);
        return next;
      });
    },
    []
  );

  const deletePosition = useCallback((code: string) => {
    setPositions((prev) => {
      const next = recalculate(prev.filter((p) => p.code !== code));
      savePositions(next);
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    setPositions((prev) => {
      const next = recalculate([...prev]);
      savePositions(next);
      return next;
    });
  }, []);

  const totals = useMemo(() => {
    const totalMarketValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const totalCost = positions.reduce((sum, p) => sum + p.shares * p.avgCost, 0);
    const totalProfit = totalMarketValue - totalCost;
    const totalProfitPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    return { totalMarketValue, totalProfit, totalProfitPercent };
  }, [positions]);

  return {
    positions,
    ...totals,
    addPosition,
    updatePosition,
    deletePosition,
    refresh,
  };
}
