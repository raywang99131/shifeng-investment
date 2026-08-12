export interface SpotRefreshPayload<T> {
  success?: boolean;
  data?: T | null;
  generatedAt?: string | null;
  cached?: boolean;
  stale?: boolean;
  staleDataDate?: string | null;
  refreshError?: string | null;
  error?: string | { message?: string } | null;
}

export interface SpotRefreshState<T> {
  data: T | null;
  generatedAt: string;
  cached: boolean;
  stale: boolean;
  staleDataDate: string;
  refreshError: string;
}

const payloadError = <T>(payload: SpotRefreshPayload<T>) => {
  if (payload.refreshError) return payload.refreshError;
  if (typeof payload.error === 'string') return payload.error;
  return payload.error?.message || '';
};

export function deriveSpotRefreshState<T>(payload: SpotRefreshPayload<T>): SpotRefreshState<T> {
  const data = payload.data || null;
  const tradingDate = (data as { trading_congestion?: { date?: string } } | null)?.trading_congestion?.date || '';
  const stale = Boolean(payload.stale || (!payload.success && data));
  return {
    data,
    generatedAt: payload.generatedAt || '',
    cached: Boolean(payload.cached || stale),
    stale,
    staleDataDate: stale ? String(payload.staleDataDate || tradingDate || '') : '',
    refreshError: stale ? payloadError(payload) : '',
  };
}

function displayTradeDate(value: string) {
  if (!value) return '';
  if (value.includes('-')) return value;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return value;
}

export function staleRefreshDescription<T>(state: SpotRefreshState<T>) {
  if (!state.stale) return '';
  const dateText = state.staleDataDate ? `${displayTradeDate(state.staleDataDate)} 的` : '';
  const base = `当前展示${dateText}最近一次成功数据。`;
  return state.refreshError ? `${base}刷新失败原因：${state.refreshError}` : base;
}
