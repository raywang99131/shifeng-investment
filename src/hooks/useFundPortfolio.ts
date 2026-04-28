import { useState, useCallback, useMemo } from 'react';
import { type Fund, type Position, type NAVRecord } from '../types/fund';

const STORAGE_KEY = 'shifeng_funds';

const DEFAULT_FUNDS: Fund[] = [
  {
    id: 'fund_1',
    name: '锋行成长1号',
    initialCapital: 1000000,
    positions: [
      { code: '600519', name: '贵州茅台', shares: 100, avgCost: 1680.00, currentPrice: 1680.00 },
      { code: '000858', name: '五粮液', shares: 2000, avgCost: 145.00, currentPrice: 145.00 },
      { code: '600036', name: '招商银行', shares: 5000, avgCost: 35.80, currentPrice: 35.80 },
      { code: '000001', name: '平安银行', shares: 5000, avgCost: 12.50, currentPrice: 12.50 },
    ],
    navHistory: [],
    createdAt: new Date().toISOString(),
  },
];

function generateId(): string {
  return `fund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadFunds(): Fund[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return DEFAULT_FUNDS;
}

function saveFunds(funds: Fund[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(funds));
  } catch {
    // ignore
  }
}

interface UseFundPortfolioReturn {
  funds: Fund[];
  currentFund: Fund | null;
  selectFund: (id: string) => void;
  addFund: (name: string, initialCapital: number) => void;
  updateFund: (id: string, updates: { name?: string; initialCapital?: number; navHistory?: NAVRecord[] }) => void;
  deleteFund: (id: string) => void;
  addPosition: (fundId: string, position: Omit<Position, never>) => void;
  updatePosition: (fundId: string, code: string, updates: Partial<Position>) => void;
  deletePosition: (fundId: string, code: string) => void;
  addNAVRecord: (fundId: string, record: NAVRecord) => void;
}

export function useFundPortfolio(): UseFundPortfolioReturn {
  const [funds, setFunds] = useState<Fund[]>(() => loadFunds());
  const [currentFundId, setCurrentFundId] = useState<string | null>(() => {
    const loaded = loadFunds();
    return loaded.length > 0 ? loaded[0].id : null;
  });

  const currentFund = useMemo(
    () => funds.find((f) => f.id === currentFundId) ?? null,
    [funds, currentFundId]
  );

  const selectFund = useCallback((id: string) => {
    setCurrentFundId(id);
  }, []);

  const persist = useCallback((newFunds: Fund[]) => {
    setFunds(newFunds);
    saveFunds(newFunds);
  }, []);

  const addFund = useCallback((name: string, initialCapital: number) => {
    const newFund: Fund = {
      id: generateId(),
      name,
      initialCapital,
      positions: [],
      navHistory: [],
      createdAt: new Date().toISOString(),
    };
    persist([...funds, newFund]);
    setCurrentFundId(newFund.id);
  }, [funds, persist]);

  const updateFund = useCallback((id: string, updates: { name?: string; initialCapital?: number }) => {
    persist(funds.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, [funds, persist]);

  const deleteFund = useCallback((id: string) => {
    const newFunds = funds.filter((f) => f.id !== id);
    persist(newFunds);
    if (currentFundId === id) {
      setCurrentFundId(newFunds.length > 0 ? newFunds[0].id : null);
    }
  }, [funds, persist, currentFundId]);

  const addPosition = useCallback((fundId: string, position: Omit<Position, never>) => {
    persist(funds.map((f) => {
      if (f.id !== fundId) return f;
      const exists = f.positions.some((p) => p.code === position.code);
      if (exists) return f;
      return { ...f, positions: [...f.positions, position] };
    }));
  }, [funds, persist]);

  const updatePosition = useCallback((fundId: string, code: string, updates: Partial<Position>) => {
    persist(funds.map((f) => {
      if (f.id !== fundId) return f;
      return {
        ...f,
        positions: f.positions.map((p) => (p.code === code ? { ...p, ...updates } : p)),
      };
    }));
  }, [funds, persist]);

  const deletePosition = useCallback((fundId: string, code: string) => {
    persist(funds.map((f) => {
      if (f.id !== fundId) return f;
      return { ...f, positions: f.positions.filter((p) => p.code !== code) };
    }));
  }, [funds, persist]);

  const addNAVRecord = useCallback((fundId: string, record: NAVRecord) => {
    persist(funds.map((f) => {
      if (f.id !== fundId) return f;
      const exists = f.navHistory.some((n) => n.date === record.date);
      if (exists) {
        return {
          ...f,
          navHistory: f.navHistory.map((n) => (n.date === record.date ? record : n)),
        };
      }
      return { ...f, navHistory: [...f.navHistory, record].sort((a, b) => a.date.localeCompare(b.date)) };
    }));
  }, [funds, persist]);

  return {
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
  };
}
