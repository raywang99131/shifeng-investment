export async function syncPrices(req: { fundId: string; codes: string[] }): Promise<{
  success: boolean;
  tradeDate?: string;
  prices?: Record<string, { currentPrice: number; pctChg: number; prevClose: number }>;
  error?: string;
}> {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
}

export async function fetchKline(code: string, count = 60, period: 'daily' | 'weekly' | 'monthly' | '15min' | '30min' | '60min' = 'daily'): Promise<{
  success: boolean;
  code: string;
  data?: Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    pct_chg: number;
  }>;
  error?: string;
}> {
  const res = await fetch(`/api/kline?code=${code}&count=${count}&period=${period}`);
  return res.json();
}

export async function syncHKPrices(codes: string[]): Promise<{
  success: boolean;
  tradeDate?: string;
  prices?: Record<string, { currentPrice: number; pctChg: number; prevClose: number }>;
  error?: string;
}> {
  const res = await fetch('/api/sync/hk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes }),
  });
  return res.json();
}

export async function syncUSPrices(codes: string[]): Promise<{
  success: boolean;
  tradeDate?: string;
  prices?: Record<string, { currentPrice: number; pctChg: number; prevClose: number }>;
  error?: string;
}> {
  const res = await fetch('/api/sync/us', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes }),
  });
  return res.json();
}

export async function syncJPQuotes(codes: string[]): Promise<{
  success: boolean;
  tradeDate?: string;
  prices?: Record<string, { currentPrice: number; pctChg: number; prevClose: number }>;
  error?: string;
}> {
  const res = await fetch('/api/sync/jp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes }),
  });
  return res.json();
}

export async function syncKRQuotes(codes: string[]): Promise<{
  success: boolean;
  tradeDate?: string;
  prices?: Record<string, { currentPrice: number; pctChg: number; prevClose: number }>;
  error?: string;
}> {
  const res = await fetch('/api/sync/kr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codes }),
  });
  return res.json();
}
