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

export async function fetchKline(code: string, count = 60): Promise<{
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
  const res = await fetch(`/api/kline?code=${code}&count=${count}`);
  return res.json();
}