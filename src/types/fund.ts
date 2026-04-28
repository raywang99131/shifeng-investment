export interface Position {
  code: string;
  name: string;
  shares: number;
  avgCost: number;
  currentPrice?: number; // 当前价（用于计算市值和盈亏）
  prevClose?: number;    // 昨日收盘价（用于计算今日涨跌）
}

export interface NAVRecord {
  date: string;
  nav: number;
  cumulativeNav: number;
  marketValue: number;
}

export interface Fund {
  id: string;
  name: string;
  initialCapital: number; // 初始规模（单位：元）
  positions: Position[];
  navHistory: NAVRecord[];
  createdAt: string;
  shareToken?: string;
}
