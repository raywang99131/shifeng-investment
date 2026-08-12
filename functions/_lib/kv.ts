/**
 * KV namespace accessor.
 * The namespace binding is set per environment via wrangler.toml
 * (local dev) or the Cloudflare Pages dashboard (production).
 *
 * In Pages Functions, the binding is exposed on the `env` object
 * of the onRequest handler.
 */

export interface NewsData {
  entries: NewsEntry[];
  lastUpdated: string | null;
}

export interface NewsEntry {
  id: string;
  type: string;
  news: NewsItem[];
  createdAt: string;
}

export interface NewsItem {
  category: string;
  title: string;
  source: string;
  time: string;
  url: string;
}

export interface FundsData {
  funds: FundRecord[];
  lastUpdated: string | null;
}

export interface FundRecord {
  id: string;
  name: string;
  market: string;
  positions: Position[];
  navHistory: NavPoint[];
  createdAt: string;
  [key: string]: unknown;
}

export interface Position {
  code: string;
  name: string;
  shares: number;
  costPrice: number;
  currentPrice: number;
  prevClose: number;
  [key: string]: unknown;
}

export interface NavPoint {
  date: string;
  nav: number;
  cumulativeNav: number;
  marketValue: number;
}

const EMPTY_NEWS: NewsData = { entries: [], lastUpdated: null };
const EMPTY_FUNDS: FundsData = { funds: [], lastUpdated: null };

export async function readNews(env: Env): Promise<NewsData> {
  try {
    const raw = await env.NEWS_DATA.get('data');
    if (!raw) return EMPTY_NEWS;
    return JSON.parse(raw) as NewsData;
  } catch (err) {
    console.error('readNews failed:', err);
    return EMPTY_NEWS;
  }
}

export async function writeNews(env: Env, data: NewsData): Promise<boolean> {
  try {
    await env.NEWS_DATA.put('data', JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('writeNews failed:', err);
    return false;
  }
}

export async function readFunds(env: Env): Promise<FundsData> {
  try {
    const raw = await env.FUNDS_DATA.get('data');
    if (!raw) return EMPTY_FUNDS;
    return JSON.parse(raw) as FundsData;
  } catch (err) {
    console.error('readFunds failed:', err);
    return EMPTY_FUNDS;
  }
}

export async function writeFunds(env: Env, data: FundsData): Promise<boolean> {
  try {
    await env.FUNDS_DATA.put('data', JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('writeFunds failed:', err);
    return false;
  }
}
