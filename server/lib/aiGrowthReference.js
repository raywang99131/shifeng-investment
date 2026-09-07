import fs from 'node:fs';

const REFERENCE_FILE = new URL('../data/ai-dashboard/growth-reference.json', import.meta.url);
const DAY_MS = 86_400_000;

export function readGrowthReference() {
  return JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'));
}

// Only the arithmetic used by the reviewed sheet is supported. Never execute spreadsheet text.
function numericValue(cells, expression, visiting = new Set()) {
  const text = String(expression ?? '').trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^[A-Z]+\d+$/.test(text)) {
    if (visiting.has(text)) throw new Error(`Circular reference: ${text}`);
    const cell = cells[text];
    return numericValue(cells, cell?.formula ?? cell?.value, new Set([...visiting, text]));
  }
  const operation = text.match(/^([A-Z]+\d+|\d+(?:\.\d+)?)\s*([+/])\s*([A-Z]+\d+|\d+(?:\.\d+)?)$/);
  if (!operation) return null;
  const left = numericValue(cells, operation[1], visiting);
  const right = numericValue(cells, operation[3], visiting);
  if (left === null || right === null || (operation[2] === '/' && right === 0)) return null;
  return operation[2] === '+' ? left + right : left / right;
}

function excelDate(serial) {
  if (!Number.isFinite(serial) || serial < 40_000 || serial > 60_000) throw new Error('Invalid source date');
  return new Date(Date.UTC(1899, 11, 30) + serial * DAY_MS).toISOString().slice(0, 10);
}

function amount(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { value: raw };
  const text = String(raw ?? '').trim();
  const range = text.match(/^(\d+(?:\.\d+)?)[-–](\d+(?:\.\d+)?)$/);
  if (range) return { value: (Number(range[1]) + Number(range[2])) / 2, valueLow: Number(range[1]), valueHigh: Number(range[2]) };
  const bound = text.match(/^(\d+(?:\.\d+)?)\+$/);
  if (bound) return { value: Number(bound[1]), valueQualifier: 'lower-bound' };
  const dated = text.match(/^月(?:底|中)(\d+(?:\.\d+)?)亿$/);
  return dated ? { value: Number(dated[1]) } : null;
}

function summarize(records, now) {
  const groups = new Map();
  for (const record of records) {
    const seriesId = `${record.company}:${record.seriesKind}:${record.sourceLabel}`;
    const group = groups.get(seriesId) || [];
    group.push(record);
    groups.set(seriesId, group);
  }
  return [...groups.entries()].map(([seriesId, points]) => {
    const actualPoints = points.filter((p) => p.kind === 'actual').sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .map((point, index, all) => {
        const previous = all[index - 1];
        const comparable = previous && !point.comparisonNote && !previous.valueQualifier && !point.valueQualifier && !previous.valueHigh && !point.valueHigh;
        const monthIndex = (p) => Number(p.month.slice(0, 4)) * 12 + Number(p.month.slice(5, 7));
        return {
          ...point,
          momAbsolute: comparable ? point.value - previous.value : null,
          momPercent: comparable && previous.value ? (point.value - previous.value) / previous.value : null,
          comparisonLabel: comparable ? `${previous.datePrecision === 'month' ? previous.month : previous.observedAt} → ${point.datePrecision === 'month' ? point.month : point.observedAt}` : null,
          consecutiveMonth: Boolean(comparable && point.datePrecision === 'month' && previous.datePrecision === 'month' && monthIndex(point) - monthIndex(previous) === 1),
        };
      });
    const latestActual = actualPoints.at(-1) || null;
    return {
      company: points[0].company, seriesId, seriesKind: points[0].seriesKind, sourceLabel: points[0].sourceLabel,
      actualPoints, forecastPoints: points.filter((p) => p.kind === 'forecast').sort((a, b) => a.observedAt.localeCompare(b.observedAt)),
      latestActual, stale: !latestActual || now - Date.parse(latestActual.observedAt) > 18 * DAY_MS,
    };
  });
}

export function buildGrowthReference(reference, { now = new Date() } = {}) {
  const { cells } = reference;
  const records = [];
  const otherRevenue = [];
  const monthlyColumns = ['B', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const point = (company, cell, observedAt, values, overrides = {}) => ({
    company, observedAt, month: observedAt.slice(0, 7), ...values,
    kind: observedAt > (reference.monthlySourceUpdatedAt || reference.sourceUpdatedAt) ? 'forecast' : 'actual',
    seriesKind: 'reference', sourceLabel: '飞书月度跟踪', datePrecision: 'month',
    sourceUrl: reference.url, sourceCell: cell, sourceKind: 'named-third-party',
    originalValue: cells[cell]?.value, originalUnit: reference.units.monthly,
    currency: 'USD', unitScale: 100_000_000,
    methodology: '原表月度跟踪；月标签不代表具体披露日',
    commentary: cells[cell]?.comment || '',
    ...overrides,
  });
  for (let row = 3; row <= 26; row += 1) {
    const date = excelDate(numericValue(cells, `A${row}`));
    for (const column of monthlyColumns) {
      const address = `${column}${row}`;
      const value = amount(cells[address]?.value);
      if (!value) continue;
      const record = point(cells[`${column}2`].value, address, date, value);
      const annual = /全年收入|全年收入指引|CEO口径，收入/.test(record.commentary);
      if (annual) otherRevenue.push({ ...record, metricKind: 'annual-revenue', methodology: '全年收入 / 收入指引，非 ARR' });
      else records.push(record);
    }
  }
  // Mixed prose cells contain different dates and estimates; preserve each stated figure independently.
  records.push(
    point('Anthropic', 'B20', '2026-05-01', { value: 470 }, { datePrecision: 'month-start', methodology: '原表注明月初官方口径；久谦调研转述' }),
    point('Anthropic', 'B20', '2026-05-31', { value: 525, valueLow: 500, valueHigh: 550 }, { kind: 'forecast', methodology: '原表当时的月底预期' }),
    point('Anthropic', 'B21', '2026-06-01', { value: 500, valueQualifier: 'lower-bound' }, { datePrecision: 'month-start', methodology: '原表注明 Yipit 月初 500+；硅谷 650 为另一口径，见备注', commentary: cells.B21.value }),
    point('Anthropic', 'B21', '2026-06-30', { value: 700 }, { kind: 'forecast', methodology: '原表当时的月末预测', commentary: cells.B21.value }),
  );
  for (let row = 42; row <= 46; row += 1) {
    for (const [column, company] of [['B', 'Anthropic'], ['C', 'OpenAI']]) {
      const address = `${column}${row}`;
      records.push(point(company, address, excelDate(numericValue(cells, `A${row}`)), { value: numericValue(cells, address) * 10 }, {
        sourceLabel: 'Yipit', seriesKind: 'estimate', datePrecision: 'day', originalUnit: reference.units.yipit,
        methodology: 'Yipit 年化收入估算；十亿美元 × 10 换算为亿美元；保留每次观测',
      }));
    }
  }
  // User-supplied excerpts are not attributed to Yipit without a named report.
  // Their stated month-end extrapolations stay in the notes, outside historical ARR.
  for (const report of reference.reportRecords || []) {
    const rawValue = numericValue(cells, report.sourceCell);
    if (rawValue === null || rawValue <= 0) throw new Error(`Invalid report ARR: ${report.sourceCell}`);
    records.push(point(report.company, report.sourceCell, excelDate(numericValue(cells, report.dateCell)), { value: Number((rawValue * 10).toFixed(8)) }, {
      kind: 'actual', sourceLabel: report.sourceLabel, sourceKind: 'estimate', seriesKind: 'estimate',
      datePrecision: 'day', originalUnit: 'USD billion', preliminary: report.preliminary,
      methodology: report.methodology,
      commentary: cells[report.commentaryCell]?.value || '', reportSummary: report.reportSummary,
      comparisonNote: report.comparisonNote,
    }));
  }
  for (const official of reference.officialRecords || []) {
    if (!['OpenAI', 'Anthropic'].includes(official.entity) || !official.unit.startsWith('USD billion')) continue;
    records.push(point(official.entity, official.id, official.asOf, { value: official.value * 10 }, {
      sourceLabel: official.entity, seriesKind: 'official', sourceKind: 'official', sourceUrl: official.sourceUrl,
      sourceCell: undefined, datePrecision: 'day', originalValue: official.value, originalUnit: official.unit,
      methodology: official.methodology, commentary: '保留已核验台账中的公司官网历史披露。',
      ...(official.unit.includes('lower bound') ? { valueQualifier: 'lower-bound' } : {}),
    }));
  }
  const valuations = [];
  for (let row = 3; row <= 24; row += 1) {
    for (const [column, multipleColumn] of [['O', 'P'], ['Q', 'R'], ['S', 'T'], ['U', 'V'], ['W', 'X']]) {
      const address = `${column}${row}`;
      const formula = cells[`${multipleColumn}${row}`]?.formula;
      const operands = formula?.match(/^([A-Z]+\d+|\d+(?:\.\d+)?)\/([A-Z]+\d+|\d+(?:\.\d+)?)$/);
      const rawValue = cells[address]?.value;
      const value = amount(rawValue) || (typeof rawValue === 'string' && rawValue.match(/^h轮(\d+)亿$/) ? { value: Number(rawValue.match(/\d+/)[0]) } : null);
      const assumed = !value && operands;
      const valuationValue = value?.value ?? (assumed ? numericValue(cells, operands[1]) : null);
      if (valuationValue === null || valuationValue === undefined) continue;
      const asOf = excelDate(numericValue(cells, `N${row}`));
      const denominator = operands ? numericValue(cells, operands[2]) : null;
      const denominatorRow = operands?.[2].match(/^[A-Z]+(\d+)$/)?.[1];
      const arrAsOf = denominatorRow ? excelDate(numericValue(cells, `A${denominatorRow}`)) : null;
      const forwardDenominator = Boolean(arrAsOf && arrAsOf > asOf);
      const multipleKind = cells[`${multipleColumn}2`].value;
      const prior = records.filter((p) => p.company === cells[`${column}2`].value && p.seriesKind === 'reference'
        && p.kind === 'actual' && p.observedAt <= asOf)
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
      const historical = !assumed && multipleKind === 'P/ARR' && !prior?.valueQualifier ? prior : null;
      const note = [cells[address]?.comment, formula ? `原表公式：${formula}` : '原表未提供倍数公式',
        forwardDenominator ? '分母使用估值月份之后的数据，属于前瞻配对。' : '',
        operands && !denominatorRow ? '分母为原表公式中的假设值，未提供明确观测日期。' : '',
        assumed ? '估值单元格为空；该估值仅来自倍数公式中的假设。' : '',
        multipleKind === 'P/S' ? '分母为收入，不能与 P/ARR 直接比较。' : '',
      ].filter(Boolean).join(' ');
      valuations.push({
        company: cells[`${column}2`].value, asOf, datePrecision: 'month', sourceCell: address,
        valuationLow: value?.valueLow ?? valuationValue, valuationHigh: value?.valueHigh ?? valuationValue,
        valuationBasis: assumed ? 'formula-assumption' : 'reference',
        arrValue: denominator, arrAsOf, arrSeriesKind: 'reference', arrSourceLabel: '原表公式',
        parrLow: denominator ? (value?.valueLow ?? valuationValue) / denominator : null,
        parrHigh: denominator ? (value?.valueHigh ?? valuationValue) / denominator : null,
        multipleKind, forwardDenominator, formula, sourceLabel: '飞书月度跟踪', sourceUrl: reference.url, note,
        historicalArrAsOf: historical?.observedAt || null,
        historicalArrValue: historical?.value ?? null,
        historicalParrLow: historical ? (value?.valueLow ?? valuationValue) / (historical.valueHigh ?? historical.value) : null,
        historicalParrHigh: historical ? (value?.valueHigh ?? valuationValue) / (historical.valueLow ?? historical.value) : null,
      });
    }
  }
  return {
    companies: summarize(records, now), valuations, otherRevenue,
    reference: { title: reference.title, sheet: reference.sheet, url: reference.url, retrievedAt: reference.retrievedAt,
      sourceUpdatedAt: reference.sourceUpdatedAt,
      note: reference.note || '已核对的飞书表格快照，保留公司官网历史披露。图中只展示历史 ARR；点颜色标示来源，区间点使用中点定位。' },
  };
}

export function createGrowthReferenceCollector() {
  return async ({ now = new Date() } = {}) => {
    const reference = readGrowthReference();
    const data = buildGrowthReference(reference, { now });
    const asOf = data.companies.map((s) => s.latestActual?.observedAt || '').sort().at(-1);
    return {
      payload: { arrAndValuation: data },
      source: { status: 'ready', stale: now - Date.parse(asOf) > 18 * DAY_MS, asOf, url: reference.url,
        message: `已核对的表格快照；最近观测 ${asOf}；导入于 ${reference.retrievedAt.slice(0, 10)}，刷新不会视作新增观测` },
    };
  };
}
