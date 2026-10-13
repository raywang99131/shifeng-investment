import assert from 'node:assert/strict';
import test from 'node:test';
import { FLAGSHIP_AA_VERIFIED } from '../src/pages/AIDashboard/flagshipAaVerified.ts';
import {
  LATEST_FLAGSHIP_COLUMNS,
  LATEST_FLAGSHIP_ROWS,
  LATEST_MODEL_REVIEW,
  buildLatestFlagshipCsv,
  buildLatestFlagshipTsv,
  latestFlagshipExportRows,
} from '../src/pages/AIDashboard/flagshipLatestSnapshot.ts';
import {
  FLAGSHIP_PRICE_ROWS,
  FLAGSHIP_PRICE_SNAPSHOT,
  buildFlagshipPriceCsv,
  type FlagshipPriceRow,
} from '../src/pages/AIDashboard/flagshipPriceSnapshot.ts';

const latest = (id: string): FlagshipPriceRow => {
  const row = LATEST_FLAGSHIP_ROWS.find(candidate => candidate.id === id);
  assert.ok(row, `Missing model: ${id}`);
  return row;
};

// These values come from the supplied image, independently of the refreshed dataset.
const imageRows = [
  ['claude-opus-5-5', '58', '4', '20'],
  ['claude-sonnet-5-5', '56', '2', '10'],
  ['muse-wonder-full', '56', '', ''],
  ['claude-fable-5-1', '53', '10', '50'],
  ['gpt-6-astra', '53', '10', '50'],
  ['gemini-4-argon', '53', '2', '10'],
  ['gpt-6-1-sol', '52', '2', '10'],
  ['muse-wonder', '52', '4', '20'],
  ['claude-opus-5', '51', '5', '25'],
  ['muse-spark-1-3', '48', '1.25', '4.25'],
  ['gpt-6-sol', '48', '2', '10'],
  ['gpt-5-6-sol', '47', '4', '20'],
  ['grok-4-7', '46', '2', '6'],
  ['glm-5-3', '45', '1.4', '4.4'],
  ['qwen-3-8-max-0902', '45', '2', '6'],
  ['kimi-k3', '44', '3', '15'],
  ['grok-4-6', '44', '2', '6'],
  ['claude-haiku-5-5', '43', '0.10 / 0.50', '0.50 / 2.50'],
  ['gemini-3-8-flash', '41', '0.75', '3.75'],
  ['ling-3-1-flash', '41', '', ''],
  ['deepseek-v4-1-flash', '39', '0.15~0.30', '0.60~1.20'],
  ['gemini-3-7-flash', '39', '0.75', '3.75'],
  ['gpt-6-luna', '38', '0.1', '0.5'],
  ['mistral-large-4', '38', '0.68', '2.09'],
  ['gpt-5-6-luna', '37', '0.2', '1.2'],
  ['deepseek-v4-pro', '36', '0.66~1.32', '1.98~3.96'],
  ['minimax-m3', '29', '0.3', '1.2'],
  ['minimax-m3-1-flash', '未收录', '', ''],
  ['longcat-2-5-preview', '未收录', '0.3', '1.2'],
];

// Parse the delivered CSV rather than splitting on commas inside quoted cells.
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && csv[index + 1] === '\n') index += 1;
      rows.push([...row, cell]);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  assert.equal(quoted, false, 'Unclosed CSV quote');
  rows.push([...row, cell]);
  return rows;
}

test('the original 29-model transcription keeps all historical values, stars and unknown index version', () => {
  assert.equal(FLAGSHIP_PRICE_SNAPSHOT.date, '2026-10-13');
  assert.equal(FLAGSHIP_PRICE_SNAPSHOT.indexVersion, null);
  assert.deepEqual(FLAGSHIP_PRICE_ROWS.map(row => [row.id, row.scoreRaw, row.input.raw, row.output.raw]), imageRows);
  assert.deepEqual(FLAGSHIP_PRICE_ROWS.map(row => row.sourceOrder), Array.from({ length: 29 }, (_, index) => index + 1));
  assert.deepEqual(FLAGSHIP_PRICE_ROWS.filter(row => row.sourceStar).map(row => row.sourceOrder), [2, 3, 6, 7, 8, 18, 20, 24, 28, 29]);
  assert.deepEqual(FLAGSHIP_PRICE_ROWS.filter(row => row.highlighted).map(row => row.id), ['muse-wonder-full', 'muse-wonder']);
  assert.equal(FLAGSHIP_PRICE_ROWS[19].note, '官方刊例价未核实');
  assert.equal(FLAGSHIP_PRICE_ROWS[23].note, 'Preview · 首发半价');
  assert.equal(parseCsv(buildFlagshipPriceCsv()).length, 30);
});

test('the refreshed snapshot contains 45 unique models and retains the original model identities', () => {
  assert.equal(LATEST_MODEL_REVIEW.date, '2026-10-13');
  assert.equal(LATEST_FLAGSHIP_ROWS.length, 45);
  assert.equal(new Set(LATEST_FLAGSHIP_ROWS.map(row => row.id)).size, 45);
  for (const original of FLAGSHIP_PRICE_ROWS) {
    const refreshed = latest(original.id);
    assert.equal(refreshed.model, original.model);
    assert.equal(refreshed.sourceOrder, original.sourceOrder);
    assert.equal(refreshed.sourceStar, original.sourceStar);
    assert.equal(refreshed.highlighted, original.highlighted);
  }
  const scores = LATEST_FLAGSHIP_ROWS.map(row => row.score ?? -1);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.deepEqual(LATEST_FLAGSHIP_ROWS.filter(row => row.score === null).map(row => row.id).sort(), [
    'glm-5-3-flashx', 'kimi-k2-8-preview', 'longcat-2-5-preview', 'minimax-m3-1-flash',
  ]);
});

test('all 41 scored rows resolve to the same AA v4.3.2 record and preserve evaluation configurations', () => {
  assert.equal(LATEST_MODEL_REVIEW.indexVersion, '4.3.2');
  assert.equal(FLAGSHIP_AA_VERIFIED.checkedDate, '2026-10-13');
  assert.equal(FLAGSHIP_AA_VERIFIED.models.length, 41);
  assert.equal(new Set(FLAGSHIP_AA_VERIFIED.models.map(model => model.slug)).size, 41);
  assert.equal(LATEST_FLAGSHIP_ROWS.filter(row => row.score !== null).length, 41);
  for (const evaluation of FLAGSHIP_AA_VERIFIED.models) {
    const original = evaluation.originalSourceOrder === null ? undefined : FLAGSHIP_PRICE_ROWS[evaluation.originalSourceOrder - 1];
    const row = latest(original?.id ?? evaluation.slug);
    assert.equal(evaluation.indexVersion, '4.3.2', row.id);
    assert.equal(row.score, Math.round(evaluation.scoreExact), row.id);
    assert.equal(row.scoreRaw, String(evaluation.scoreRounded), row.id);
    assert.equal(row.scoreSourceUrl, `https://artificialanalysis.ai/models/${evaluation.slug}`, row.id);
    assert.ok(row.evaluationLabel, `Missing evaluation configuration: ${row.id}`);
  }
  assert.equal(latest('qwen-3-8-max-0902').scoreSourceUrl, 'https://artificialanalysis.ai/models/qwen3-8-max');
  assert.match(latest('claude-opus-5-5').evaluationLabel!, /Max.*Default Fallback/);
  assert.equal(latest('grok-4-7').evaluationLabel, 'Xhigh');
});

test('GLM Flash uses the current 42 score while FlashX keeps its own price and no borrowed score', () => {
  const flash = latest('glm-5-3-flash');
  assert.deepEqual([flash.score, flash.input.lower, flash.cacheReadPrice, flash.output.lower], [42, .15, .03, .5]);
  assert.equal(flash.releasedAt, '2026-08-26');
  const flashX = latest('glm-5-3-flashx');
  assert.deepEqual([flashX.score, flashX.input.lower, flashX.cacheReadPrice, flashX.output.lower], [null, .37, .075, 1.25]);
  assert.equal(flashX.scoreRaw, '未收录');
  assert.equal(flashX.scoreSourceUrl, undefined);
  assert.equal(flashX.releasedAt, null);
});

test('monthly subscriptions and unavailable hosted tariffs never turn into token-price bars', () => {
  for (const id of ['muse-wonder-full', 'minimax-m3-1-flash', 'kimi-k2-8-preview', 'minicpm5-2b', 'k2-horizon-375b-a23b', 'k2-horizon-0-9b', 'k2-horizon-3-7b', 'k2-horizon-7b', 'k2-horizon-mova-36b-a4b']) {
    const row = latest(id);
    for (const price of [row.input, row.output]) {
      assert.equal(price.kind, 'missing', id);
      assert.equal(price.lower, null, id);
      assert.equal(price.upper, null, id);
      assert.equal(price.raw, '', id);
    }
  }
  assert.match(latest('muse-wonder-full').note, /\$50.*\$200.*月费/);
  assert.equal(latest('k2-horizon-375b-a23b').score, 31);
  assert.match(latest('k2-horizon-375b-a23b').detailNote!, /0\/0.*不代表.*免费/);
  assert.equal(latest('k2-horizon-0-9b').score, 3);
});

test('Ling first-party temporary free access remains a real zero and keeps the expiry uncertainty', () => {
  const row = latest('ling-3-1-flash');
  assert.deepEqual([row.input.raw, row.input.lower, row.output.raw, row.output.lower, row.cacheReadPrice], ['0', 0, '0', 0, 0]);
  assert.equal(row.input.kind, 'fixed');
  assert.equal(row.priceSourceUrl, 'https://developer.ant-ling.com/en/docs/models/price');
  assert.match(row.note, /限时免费.*正式价待公布/);
  assert.match(row.detailNote!, /精确结束日期未披露/);
});

test('the later DeepSeek change log supersedes the withdrawn shutdown plan and preserves V4 Pro service and tariffs', () => {
  const row = latest('deepseek-v4-pro');
  assert.equal(row.score, 36);
  assert.deepEqual([row.input.raw, row.output.raw], ['0.66 / 1.32', '1.98 / 3.96']);
  assert.equal(row.priceSourceUrl, 'https://api-docs.deepseek.com/updates/');
  assert.match(row.note, /继续提供.*低谷.*高峰/);
  assert.doesNotMatch(row.note, /路由|停服|弃用/);
  assert.match(row.detailNote!, /撤回.*停服安排.*9\/14后继续提供.*计费不变/);
  assert.match(row.detailNote!, /缓存0\.022\/0\.044/);
  assert.match(row.detailNote!, /临时路由说明已过时.*最新Change Log为准/);
  const original = FLAGSHIP_PRICE_ROWS.find(candidate => candidate.id === row.id)!;
  assert.deepEqual([original.input.raw, original.output.raw], ['0.66~1.32', '1.98~3.96']);
});

test('Gemini 3.7 Flash remains genuinely deprecated and routed, with historical prices kept only in the original view', () => {
  const row = latest('gemini-3-7-flash');
  assert.equal(row.score, 39);
  assert.equal(row.input.lower, null);
  assert.equal(row.output.lower, null);
  assert.match(row.note, /已弃用.*请求转至3\.8/);
  assert.match(row.detailNote!, /原3\.7模型评测/);
  const original = FLAGSHIP_PRICE_ROWS.find(candidate => candidate.id === row.id)!;
  assert.deepEqual([original.input.lower, original.output.lower], [.75, 3.75]);
});

test('context, time-of-day and promotion pairs retain both prices and the condition that selects them', () => {
  const pairs: Array<[string, number[], RegExp]> = [
    ['gpt-6-astra', [10, 20, 50, 75], /≤272K.*>272K/],
    ['claude-haiku-5-5', [.1, .5, .5, 2.5], /≤100K.*>100K/],
    ['minimax-m3', [.3, .6, 1.2, 2.4], /≤512K.*>512K/],
    ['deepseek-v4-1-flash', [.15, .3, .6, 1.2], /低谷.*高峰/],
    ['deepseek-v4-pro', [.66, 1.32, 1.98, 3.96], /继续提供.*低谷.*高峰/],
    ['mercury-2-5', [.04, .2, .15, .75], /80%优惠.*刊例/],
    ['solar-mini4', [.05, .1, .2, .4], /10\/22 UTC/],
    ['mistral-large-4', [.68, 1.36, 2.09, 4.18], /首发优惠.*常规价/],
  ];
  for (const [id, bounds, condition] of pairs) {
    const row = latest(id);
    assert.deepEqual([row.input.lower, row.input.upper, row.output.lower, row.output.upper], bounds, id);
    assert.equal(row.input.kind, 'tiered', id);
    assert.equal(row.output.kind, 'tiered', id);
    assert.match(row.note, condition);
    assert.match(row.priceSourceUrl!, /^https:\/\//);
  }
  assert.match(latest('deepseek-v4-1-flash').detailNote!, /北京时间09–12、14–18/);
  assert.match(latest('solar-mini4').detailNote!, /10-23 00:00 UTC（不含结束时刻）/);
  assert.match(latest('mercury-2-5').detailNote!, /结束日未披露/);
});

test('price bounds distinguish missing, zero and positive quotes and fit the displayed 0–100 scale', () => {
  for (const row of LATEST_FLAGSHIP_ROWS) {
    for (const price of [row.input, row.output]) {
      if (price.kind === 'missing') {
        assert.deepEqual([price.lower, price.upper, price.raw], [null, null, ''], row.id);
      } else {
        assert.ok(price.raw, row.id);
        assert.equal(typeof price.lower, 'number', row.id);
        assert.equal(typeof price.upper, 'number', row.id);
        assert.ok(Number.isFinite(price.lower) && Number.isFinite(price.upper), row.id);
        assert.ok(price.lower! >= 0 && price.upper! >= price.lower! && price.upper! <= 100, row.id);
      }
    }
  }
});

test('CSV and TSV deliver all 45 rows and 13 columns with source, version, configuration and conditions', () => {
  const csv = parseCsv(buildLatestFlagshipCsv());
  const tsv = buildLatestFlagshipTsv().split('\n').map(line => line.split('\t'));
  assert.equal(csv.length, 46);
  assert.equal(tsv.length, 46);
  assert.equal(LATEST_FLAGSHIP_COLUMNS.length, 13);
  assert.deepEqual(csv[0], [
    '核对日期', '显示顺序', '模型', 'AA 智能指数', '输入价（USD/百万tokens）', '输出价（USD/百万tokens）',
    '说明与条件', '价格来源', 'AA 指数版本', 'AA 评测配置', 'AA 来源', '官方发布日期', '缓存命中价（USD/百万tokens）',
  ]);
  assert.deepEqual(tsv, csv);
  assert.deepEqual(latestFlagshipExportRows(), csv.slice(1));
  csv.slice(1).forEach((cells, index) => {
    const row = LATEST_FLAGSHIP_ROWS[index];
    assert.equal(cells.length, 13, row.id);
    assert.equal(cells[0], '2026-10-13');
    assert.equal(cells[1], String(index + 1));
    assert.equal(cells[2], `${row.model}${row.sourceStar ? ' ★' : ''}`);
    assert.equal(cells[3], row.score === null ? '未收录' : String(row.score));
    assert.equal(cells[4], row.input.lower === null ? '未列示' : row.input.raw);
    assert.equal(cells[5], row.output.lower === null ? '未列示' : row.output.raw);
    if (row.priceSourceUrl) assert.equal(cells[7], row.priceSourceUrl);
    assert.equal(cells[8], '4.3.2');
    assert.equal(cells[10], row.scoreSourceUrl ?? '未收录');
    assert.equal(cells[11], row.releasedAt ?? '未独立核实');
    if (row.score !== null) assert.notEqual(cells[9], '未收录', row.id);
    if (row.note) assert.ok(cells[6].includes(row.note), row.id);
    if (row.detailNote) assert.ok(cells[6].includes(row.detailNote), row.id);
  });
  const exported = (id: string) => csv[LATEST_FLAGSHIP_ROWS.findIndex(row => row.id === id) + 1];
  assert.deepEqual(exported('ling-3-1-flash').slice(4, 6), ['0', '0']);
  assert.equal(exported('ling-3-1-flash')[12], '0');
  assert.deepEqual(exported('k2-horizon-375b-a23b').slice(4, 6), ['未列示', '未列示']);
  for (const id of ['k2-horizon-mova-36b-a4b', 'k2-horizon-7b', 'k2-horizon-3-7b', 'k2-horizon-0-9b']) {
    assert.equal(exported(id)[7], '未核实厂商 API 单价');
  }
  assert.deepEqual(exported('glm-5-3-flashx').slice(9, 11), ['未收录', '未收录']);
  assert.match(exported('solar-mini4')[6], /不含结束时刻/);
  assert.deepEqual(exported('deepseek-v4-pro').slice(4, 6), ['0.66 / 1.32', '1.98 / 3.96']);
  assert.equal(exported('deepseek-v4-pro')[7], 'https://api-docs.deepseek.com/updates/');
  assert.match(exported('deepseek-v4-pro')[6], /临时路由说明已过时.*最新Change Log为准/);
  assert.deepEqual(exported('gemini-3-7-flash').slice(4, 6), ['未列示', '未列示']);
});
