export type FlagshipPriceKind = 'fixed' | 'range' | 'tiered' | 'missing';

export interface FlagshipPriceValue {
  /** Exact numeric text transcribed from the supplied image. */
  raw: string;
  lower: number | null;
  upper: number | null;
  kind: FlagshipPriceKind;
}

export interface FlagshipPriceRow {
  id: string;
  sourceOrder: number;
  model: string;
  sourceStar: boolean;
  score: number | null;
  scoreRaw: string;
  input: FlagshipPriceValue;
  output: FlagshipPriceValue;
  note: string;
  outputSuffix?: string;
  highlighted?: boolean;
}

export const FLAGSHIP_PRICE_SNAPSHOT = {
  date: '2026-10-13',
  title: '主流大模型旗舰版 API 价格与智能指数对比',
  team: '建投AI互联网团队',
  credit: '中信建投AI互联网团队整理',
  imageUrl: '/assets/research/flagship-api-intelligence-2026-10-13.jpg',
  sourceLabel: '用户提供截图；图中注明厂商官网、Artificial Analysis、中信建投整理',
  unit: '美元 / 百万 tokens',
  indexVersion: null,
} as const;

const fixed = (raw: string): FlagshipPriceValue => ({ raw, lower: Number(raw), upper: Number(raw), kind: 'fixed' });
const interval = (raw: string, lower: number, upper: number, kind: 'range' | 'tiered' = 'range'): FlagshipPriceValue => ({ raw, lower, upper, kind });
const missing = (): FlagshipPriceValue => ({ raw: '', lower: null, upper: null, kind: 'missing' });

/** Image order, stars, exceptions and displayed precision are preserved. This is not a live API feed. */
export const FLAGSHIP_PRICE_ROWS: readonly FlagshipPriceRow[] = [
  { id: 'claude-opus-5-5', sourceOrder: 1, model: 'Claude Opus 5.5', sourceStar: false, score: 58, scoreRaw: '58', input: fixed('4'), output: fixed('20'), note: '' },
  { id: 'claude-sonnet-5-5', sourceOrder: 2, model: 'Claude Sonnet 5.5', sourceStar: true, score: 56, scoreRaw: '56', input: fixed('2'), output: fixed('10'), note: '' },
  { id: 'muse-wonder-full', sourceOrder: 3, model: 'Muse Wonder Full', sourceStar: true, score: 56, scoreRaw: '56', input: missing(), output: missing(), note: '仅订阅制 · 无API刊例价', highlighted: true },
  { id: 'claude-fable-5-1', sourceOrder: 4, model: 'Claude Fable 5.1', sourceStar: false, score: 53, scoreRaw: '53', input: fixed('10'), output: fixed('50'), note: '' },
  { id: 'gpt-6-astra', sourceOrder: 5, model: 'GPT-6 Astra', sourceStar: false, score: 53, scoreRaw: '53', input: fixed('10'), output: fixed('50'), note: '' },
  { id: 'gemini-4-argon', sourceOrder: 6, model: 'Gemini 4 Argon', sourceStar: true, score: 53, scoreRaw: '53', input: fixed('2'), output: fixed('10'), note: '首发', outputSuffix: '（首发）' },
  { id: 'gpt-6-1-sol', sourceOrder: 7, model: 'GPT-6.1 Sol', sourceStar: true, score: 52, scoreRaw: '52', input: fixed('2'), output: fixed('10'), note: '' },
  { id: 'muse-wonder', sourceOrder: 8, model: 'Muse Wonder', sourceStar: true, score: 52, scoreRaw: '52', input: fixed('4'), output: fixed('20'), note: '', highlighted: true },
  { id: 'claude-opus-5', sourceOrder: 9, model: 'Claude Opus 5', sourceStar: false, score: 51, scoreRaw: '51', input: fixed('5'), output: fixed('25'), note: '' },
  { id: 'muse-spark-1-3', sourceOrder: 10, model: 'Muse Spark 1.3', sourceStar: false, score: 48, scoreRaw: '48', input: fixed('1.25'), output: fixed('4.25'), note: '' },
  { id: 'gpt-6-sol', sourceOrder: 11, model: 'GPT-6 Sol', sourceStar: false, score: 48, scoreRaw: '48', input: fixed('2'), output: fixed('10'), note: '' },
  { id: 'gpt-5-6-sol', sourceOrder: 12, model: 'GPT-5.6 Sol', sourceStar: false, score: 47, scoreRaw: '47', input: fixed('4'), output: fixed('20'), note: '' },
  { id: 'grok-4-7', sourceOrder: 13, model: 'Grok 4.7', sourceStar: false, score: 46, scoreRaw: '46', input: fixed('2'), output: fixed('6'), note: '' },
  { id: 'glm-5-3', sourceOrder: 14, model: 'GLM-5.3', sourceStar: false, score: 45, scoreRaw: '45', input: fixed('1.4'), output: fixed('4.4'), note: '' },
  { id: 'qwen-3-8-max-0902', sourceOrder: 15, model: 'Qwen3.8-Max(0902)', sourceStar: false, score: 45, scoreRaw: '45', input: fixed('2'), output: fixed('6'), note: '' },
  { id: 'kimi-k3', sourceOrder: 16, model: 'Kimi K3', sourceStar: false, score: 44, scoreRaw: '44', input: fixed('3'), output: fixed('15'), note: '' },
  { id: 'grok-4-6', sourceOrder: 17, model: 'Grok 4.6', sourceStar: false, score: 44, scoreRaw: '44', input: fixed('2'), output: fixed('6'), note: '' },
  { id: 'claude-haiku-5-5', sourceOrder: 18, model: 'Claude Haiku 5.5', sourceStar: true, score: 43, scoreRaw: '43', input: interval('0.10 / 0.50', 0.1, 0.5, 'tiered'), output: interval('0.50 / 2.50', 0.5, 2.5, 'tiered'), note: '≤100K / >100K' },
  { id: 'gemini-3-8-flash', sourceOrder: 19, model: 'Gemini 3.8 Flash', sourceStar: false, score: 41, scoreRaw: '41', input: fixed('0.75'), output: fixed('3.75'), note: '限时', outputSuffix: '（限时）' },
  { id: 'ling-3-1-flash', sourceOrder: 20, model: 'Ling 3.1 Flash', sourceStar: true, score: 41, scoreRaw: '41', input: missing(), output: missing(), note: '官方刊例价未核实' },
  { id: 'deepseek-v4-1-flash', sourceOrder: 21, model: 'DeepSeek V4.1-Flash', sourceStar: false, score: 39, scoreRaw: '39', input: interval('0.15~0.30', 0.15, 0.3), output: interval('0.60~1.20', 0.6, 1.2), note: '' },
  { id: 'gemini-3-7-flash', sourceOrder: 22, model: 'Gemini 3.7 Flash', sourceStar: false, score: 39, scoreRaw: '39', input: fixed('0.75'), output: fixed('3.75'), note: '限时', outputSuffix: '（限时）' },
  { id: 'gpt-6-luna', sourceOrder: 23, model: 'GPT-6 Luna', sourceStar: false, score: 38, scoreRaw: '38', input: fixed('0.1'), output: fixed('0.5'), note: '' },
  { id: 'mistral-large-4', sourceOrder: 24, model: 'Mistral Large 4', sourceStar: true, score: 38, scoreRaw: '38', input: fixed('0.68'), output: fixed('2.09'), note: 'Preview · 首发半价' },
  { id: 'gpt-5-6-luna', sourceOrder: 25, model: 'GPT-5.6 Luna', sourceStar: false, score: 37, scoreRaw: '37', input: fixed('0.2'), output: fixed('1.2'), note: '' },
  { id: 'deepseek-v4-pro', sourceOrder: 26, model: 'DeepSeek V4-Pro', sourceStar: false, score: 36, scoreRaw: '36', input: interval('0.66~1.32', 0.66, 1.32), output: interval('1.98~3.96', 1.98, 3.96), note: '' },
  { id: 'minimax-m3', sourceOrder: 27, model: 'MiniMax M3', sourceStar: false, score: 29, scoreRaw: '29', input: fixed('0.3'), output: fixed('1.2'), note: '' },
  { id: 'minimax-m3-1-flash', sourceOrder: 28, model: 'MiniMax M3.1 Flash', sourceStar: true, score: null, scoreRaw: '未收录', input: missing(), output: missing(), note: 'Preview · 仅订阅制' },
  { id: 'longcat-2-5-preview', sourceOrder: 29, model: 'LongCat 2.5 Preview', sourceStar: true, score: null, scoreRaw: '未收录', input: fixed('0.3'), output: fixed('1.2'), note: '限时', outputSuffix: '（限时）' },
];

export const flagshipModelLabel = (row: FlagshipPriceRow) => `${row.model}${row.sourceStar ? ' ★' : ''}`;

const exportColumns = ['快照日期', '原图顺序', '模型（含原图星标）', 'AA 智能指数', '输入价（美元/百万tokens）', '输出价（美元/百万tokens）', '备注', '来源'];
const exportRows = () => FLAGSHIP_PRICE_ROWS.map(row => [
  FLAGSHIP_PRICE_SNAPSHOT.date, String(row.sourceOrder), flagshipModelLabel(row), row.scoreRaw,
  row.input.raw || '未列示', row.output.raw || '未列示', row.note,
  FLAGSHIP_PRICE_SNAPSHOT.sourceLabel,
]);

export function buildFlagshipPriceTsv(): string {
  return [exportColumns, ...exportRows()].map(row => row.map(value => value.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

export function buildFlagshipPriceCsv(): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [exportColumns, ...exportRows()].map(row => row.map(quote).join(',')).join('\r\n');
}
