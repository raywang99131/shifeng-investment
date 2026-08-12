import fs from 'fs';
import path from 'path';

const root = path.resolve('server/data/research/earnings');
const negativeForecastTypes = new Set(['预减', '首亏', '续亏', '略减', '增亏']);
const strictlyNegativePercentTypes = new Set(['预减', '首亏', '略减', '增亏']);

const patterns = [
  { name: '摘要重复预告期', test: (entry) => /预告期[:：]/.test(entry.summary || '') },
  { name: '摘要含公告模板', test: (entry) => /证券代码|证券简称|公告编号|本公司及董事会|虚假记载|本期业绩预计情况/.test(entry.summary || '') },
  { name: '摘要重复利润区间', test: (entry) => /预计实现归属于上市公司股东的净利润|项目 本报告期/.test(entry.summary || '') },
  { name: '无效原因摘要', test: (entry) => /公告未披露具体原因/.test(entry.summary || '') },
];

function trimDecimals(value, decimals) {
  const fixed = Number(value).toFixed(decimals);
  if (decimals <= 0) return fixed;
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function formatWanValue(value) {
  if (Math.abs(value) >= 10000) return `${trimDecimals(value / 10000, 2)}亿元`;
  return `${trimDecimals(value, 0)}万元`;
}

function expectedProfitRange(item) {
  const low = item.lowWan;
  const high = item.highWan;
  if (typeof low !== 'number' && typeof high !== 'number') return '';
  if ((low ?? 0) === 0 && (high ?? 0) === 0) return '';
  if (typeof low === 'number' && typeof high === 'number' && low !== high) {
    return `${formatWanValue(low)}~${formatWanValue(high)}`;
  }
  return formatWanValue(typeof high === 'number' ? high : low);
}

function formatPercentValue(value) {
  const label = trimDecimals(value, 0);
  if (Number(label) === 0) return '0%';
  return `${value >= 0 ? '+' : ''}${label}%`;
}

function expectedPercentRange(item) {
  const low = item.lowPct;
  const high = item.highPct;
  if (typeof low !== 'number' && typeof high !== 'number') return '';
  if ((low ?? 0) === 0 && (high ?? 0) === 0) return '';
  if (typeof low === 'number' && typeof high === 'number' && low !== high) {
    return `${formatPercentValue(low)}~${formatPercentValue(high)}`;
  }
  return formatPercentValue(typeof high === 'number' ? high : low);
}

function isNegativeForecastType(value) {
  return negativeForecastTypes.has(String(value || ''));
}

function isStrictlyNegativePercentType(value) {
  return strictlyNegativePercentTypes.has(String(value || ''));
}

function getEntryForecastType(entry) {
  return String(entry.summary || '').match(/^【([^】]+)】/)?.[1] || '';
}

function sameNumberOrNull(left, right) {
  const normalizedLeft = typeof left === 'number' ? left : null;
  const normalizedRight = typeof right === 'number' ? right : null;
  return normalizedLeft === normalizedRight;
}

function hasRealScope(value) {
  return String(value || '')
    .split(/[;；,，、/|｜\n]+/)
    .some((label) => label.trim() && label.trim() !== '其他');
}

function getFocusPriority(item) {
  if (item.subsetHit === true) return 0;
  if (item.subsetHit === undefined && hasRealScope(item.subset)) return 0;
  if (item.focusHit === true) return 1;
  return 2;
}

function checkFocusPriorityOrder(date, listName, items) {
  let previousPriority = -1;
  for (const item of items) {
    const priority = getFocusPriority(item);
    if (priority < previousPriority) {
      issues.push({
        date,
        code: item.code,
        name: item.name,
        reason: `${listName} 未优先展示标的池子集命中`,
        text: JSON.stringify({ subset: item.subset, subsetHit: item.subsetHit, focusHit: item.focusHit }),
      });
      return;
    }
    previousPriority = priority;
  }
}

function readSummaries() {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const date = file.replace(/\.json$/, '');
      const data = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      return { date, data };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

const issues = [];

for (const { date, data } of readSummaries()) {
  const entries = [...(data.topGood || []), ...(data.topBad || [])];
  const itemByCode = new Map((data.allItems || []).map((item) => [item.code, item]));
  checkFocusPriorityOrder(date, '利好 TOP5', data.topGood || []);
  checkFocusPriorityOrder(date, '利空 TOP5', data.topBad || []);
  checkFocusPriorityOrder(date, '全部业绩预告', data.allItems || []);
  for (const item of data.allItems || []) {
    if (item.lowPct === 0 && item.highPct === 0) {
      issues.push({
        date,
        code: item.code,
        name: item.name,
        reason: '同比区间 0/0 应视为缺失',
        text: JSON.stringify({
          forecastType: item.forecastType,
          lowPct: item.lowPct,
          highPct: item.highPct,
          reason: item.reason,
        }),
      });
    }

    if (
      item.lowWan === 0
      && item.highWan === 0
      && ((typeof item.lowPct === 'number' && item.lowPct !== 0)
        || (typeof item.highPct === 'number' && item.highPct !== 0))
    ) {
      issues.push({
        date,
        code: item.code,
        name: item.name,
        reason: '净利润区间 0/0 但已有同比，应重新抓取净利润',
        text: JSON.stringify({
          forecastType: item.forecastType,
          lowWan: item.lowWan,
          highWan: item.highWan,
          prevWan: item.prevWan,
          lowPct: item.lowPct,
          highPct: item.highPct,
        }),
      });
    }

    if (
      typeof item.lowWan === 'number'
      && typeof item.highWan === 'number'
      && Math.max(Math.abs(item.lowWan), Math.abs(item.highWan)) <= 10
      && (Math.abs(item.lowPct ?? 0) >= 50 || Math.abs(item.highPct ?? 0) >= 50)
    ) {
      issues.push({
        date,
        code: item.code,
        name: item.name,
        reason: '净利润区间异常小，疑似误抓日期或每股收益',
        text: JSON.stringify({
          forecastType: item.forecastType,
          lowWan: item.lowWan,
          highWan: item.highWan,
          prevWan: item.prevWan,
          lowPct: item.lowPct,
          highPct: item.highPct,
        }),
      });
    }

    if (!isStrictlyNegativePercentType(item.forecastType)) continue;
    for (const field of ['lowPct', 'highPct']) {
      if (typeof item[field] === 'number' && item[field] > 0) {
        issues.push({
          date,
          code: item.code,
          name: item.name,
          reason: `负向预告 ${field} 不得为正数`,
          text: JSON.stringify({
            forecastType: item.forecastType,
            lowPct: item.lowPct,
            highPct: item.highPct,
          }),
        });
      }
    }
  }

  for (const entry of entries) {
    const entryForecastType = getEntryForecastType(entry);
    if (isStrictlyNegativePercentType(entryForecastType)) {
      if (typeof entry.score === 'number' && entry.score > 0) {
        issues.push({
          date,
          code: entry.code,
          name: entry.name,
          reason: '负向预告 TOP5 分数不得为正数',
          text: JSON.stringify({ score: entry.score, scoreLabel: entry.scoreLabel, summary: entry.summary }),
        });
      }
      if (/\+\d/.test(`${entry.scoreLabel || ''} ${entry.summary || ''}`)) {
        issues.push({
          date,
          code: entry.code,
          name: entry.name,
          reason: '负向预告文案不得显示正号同比',
          text: `${entry.scoreLabel || ''} ${entry.summary || ''}`,
        });
      }
    }

    if (entry.name && entry.title?.includes(entry.name)) {
      issues.push({
        date,
        code: entry.code,
        name: entry.name,
        reason: '标题重复公司名',
        text: entry.title,
      });
    }

    for (const pattern of patterns) {
      if (pattern.test(entry)) {
        issues.push({
          date,
          code: entry.code,
          name: entry.name,
          reason: pattern.name,
          text: entry.summary,
        });
      }
    }

    const item = itemByCode.get(entry.code);
    if (!item) continue;

    const profitRange = expectedProfitRange(item);
    if (profitRange && !String(entry.summary || '').includes(profitRange)) {
      issues.push({
        date,
        code: entry.code,
        name: entry.name,
        reason: `摘要利润区间与结构化字段不一致，应含 ${profitRange}`,
        text: entry.summary,
      });
    }
    if (
      profitRange
      && (!sameNumberOrNull(entry.lowWan, item.lowWan)
        || !sameNumberOrNull(entry.highWan, item.highWan)
        || !sameNumberOrNull(entry.prevWan, item.prevWan))
    ) {
      issues.push({
        date,
        code: entry.code,
        name: entry.name,
        reason: 'TOP5 缺少或错配净利润结构化字段',
        text: `top=${JSON.stringify({
          lowWan: entry.lowWan,
          highWan: entry.highWan,
          prevWan: entry.prevWan,
        })} all=${JSON.stringify({
          lowWan: item.lowWan,
          highWan: item.highWan,
          prevWan: item.prevWan,
        })}`,
      });
    }

    const percentRange = expectedPercentRange(item);
    if (percentRange && !String(entry.summary || '').includes(percentRange)) {
      issues.push({
        date,
        code: entry.code,
        name: entry.name,
        reason: `摘要同比区间与结构化字段不一致，应含 ${percentRange}`,
        text: entry.summary,
      });
    }
  }
}

if (issues.length > 0) {
  console.error(`业绩预告展示文案检查失败：${issues.length} 个问题`);
  for (const issue of issues) {
    console.error(`- ${issue.date} ${issue.code} ${issue.name}：${issue.reason}`);
    console.error(`  ${issue.text}`);
  }
  process.exit(1);
}

console.log('业绩预告展示文案检查通过');
