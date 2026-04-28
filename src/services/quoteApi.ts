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