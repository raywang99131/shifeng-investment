import fs from 'node:fs/promises';
import { parseIceInstrumentName } from './iceCdsImport.js';
import { priceCdsBatch, ISDA_MODEL_VERSION } from './isdaCdsEngine.js';

const DAY = 86_400_000;
function realDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function key(row) { return `${row.clearingDate}|${row.company}|${row.instrumentName}`; }

export function validateStandardCurves(input) {
  if (!Array.isArray(input?.curves)) throw new Error('Standard curve file must contain curves');
  const byDate = new Map();
  for (const curve of input.curves) {
    if (!curve?.curveId || !realDate(curve.asOf) || !realDate(curve.marketDataAsOf)
        || curve.marketDataAsOf >= curve.asOf || Date.parse(curve.asOf) - Date.parse(curve.marketDataAsOf) > 7 * DAY
        || curve.currency !== 'USD' || curve.sourceKind !== 'isda-standard-rfr'
        || !/^https:\/\//.test(curve.sourceUrl || '') || byDate.has(curve.asOf)
        || !Array.isArray(curve.discountFactors) || curve.discountFactors.length < 2) {
      throw new Error('Invalid standard curve metadata or duplicate valuation date');
    }
    let previous = '';
    for (const point of curve.discountFactors) {
      if (!realDate(point.date) || point.date <= previous || !Number.isFinite(point.discountFactor) || point.discountFactor <= 0) {
        throw new Error('Invalid standard discount factors');
      }
      previous = point.date;
    }
    const first = curve.discountFactors[0];
    if (first.date !== curve.asOf || first.discountFactor !== 1) throw new Error('Standard curve must start at valuation date with DF=1');
    byDate.set(curve.asOf, curve);
  }
  return byDate;
}

function changes(history) {
  const current = history.at(-1);
  const previous = history.at(-2);
  const target = new Date(Date.parse(current.date) - 7 * DAY).toISOString().slice(0, 10);
  const week = history.findLast(point => point.date <= target);
  const diff = point => point && point.curveKind === current.curveKind
    && point.instrumentName === current.instrumentName ? current.newBp - point.newBp : null;
  return { oneDayBp: diff(previous), sevenDayBp: diff(week) };
}

export function comparisonFailure(previous, generatedAt, error) {
  return { ...previous, mode: 'parallel', modelVersion: ISDA_MODEL_VERSION, promotionEligible: false,
    status: 'error', asOf: previous?.asOf || null, lastAttemptAt: generatedAt,
    lastSuccessAt: previous?.lastSuccessAt || null, companies: previous?.companies || [],
    message: `新模型复算失败；保留上次成功结果。${error.message}` };
}

export function createIceCdsComparisonBuilder({
  priceBatch = priceCdsBatch,
  standardCurvesFile = process.env.ICE_CDS_STANDARD_CURVES_FILE || '',
  readFile = fs.readFile,
} = {}) {
  return async (state, { generatedAt, previous } = {}) => {
    try {
      const standard = standardCurvesFile ? validateStandardCurves(JSON.parse(await readFile(standardCurvesFile, 'utf8'))) : new Map();
      const curves = new Map(state.curves.map(curve => [curve.curveId, curve]));
      const raw = new Map(state.rawRows.map(row => [key(row), row]));
      const source = state.derivedRows.filter(row => row.modelVersion !== 'screenshot-backfill-v1');
      if (!source.length) return { mode: 'parallel', status: 'unavailable', modelVersion: ISDA_MODEL_VERSION,
        promotionEligible: false, asOf: null, lastAttemptAt: generatedAt, lastSuccessAt: null, companies: [],
        message: '等待可核对的 ICE 原始结算价；截图回填不参与新模型计算。' };
      const records = source.map(row => {
        const original = raw.get(key(row));
        if (!original) throw new Error(`Missing archived raw price: ${row.company} ${row.clearingDate}`);
        if (original.eodPrice !== row.eodPrice) throw new Error('Archived raw price and legacy observation differ');
        const discountCurve = standard.get(row.clearingDate) || curves.get(row.curveId);
        if (!discountCurve) throw new Error('Missing archived discount curve');
        const contract = parseIceInstrumentName(original.instrumentName);
        return { id: key(row), clearingDate: row.clearingDate, maturityDate: contract.maturityDate,
          cleanPrice: original.eodPrice, couponBp: contract.couponBp, recoveryRate: row.recoveryRate ?? .4,
          discountCurve };
      });
      const priced = await priceBatch(records);
      const output = new Map(priced.rows.map(row => [row.id, row]));
      if (output.size !== records.length) throw new Error('Incomplete parallel result');
      const grouped = new Map();
      for (const row of source) {
        const result = output.get(key(row));
        if (!result || !Number.isFinite(result.spreadBp)) throw new Error('Missing parallel observation');
        const standardCurve = standard.get(row.clearingDate);
        const point = { date: row.clearingDate, instrumentName: row.instrumentName,
          legacyBp: row.spreadBp, newBp: result.spreadBp, differenceBp: result.spreadBp - row.spreadBp,
          eodPrice: row.eodPrice, curveKind: standardCurve ? 'standard-rfr' : 'treasury-proxy',
          curveId: result.curveId, curveAsOf: result.curveAsOf,
          curveMarketDataAsOf: standardCurve?.marketDataAsOf || result.curveAsOf,
          priceResidual: result.priceResidual };
        if (!grouped.has(row.company)) grouped.set(row.company, []);
        grouped.get(row.company).push(point);
      }
      const companies = [...grouped].map(([company, history]) => {
        history.sort((a, b) => a.date.localeCompare(b.date));
        const latest = history.at(-1);
        const legacy = history.map(point => ({ ...point, newBp: point.legacyBp, curveKind: 'legacy' }));
        return { company, ...latest, newChanges: changes(history), legacyChanges: changes(legacy), history };
      });
      const kindCount = companies.filter(row => row.curveKind === 'standard-rfr').length;
      const status = kindCount === companies.length ? 'ready' : kindCount === 0 ? 'proxy' : 'mixed';
      return { mode: 'parallel', status, asOf: companies.map(row => row.date).sort().at(-1),
        lastAttemptAt: generatedAt, lastSuccessAt: generatedAt, sourceBatchId: state.batchId,
        modelVersion: ISDA_MODEL_VERSION, engineVersion: priced.engineVersion,
        promotionEligible: false, observationCount: records.length, companies,
        message: status === 'ready' ? '新模型并行核对中，使用已导入的标准利率曲线；尚未通过独立市场报价验证。'
          : '新模型并行核对中；标准利率曲线未覆盖的日期使用美国国债代理曲线，结果仍为估计值。' };
    } catch (error) { return comparisonFailure(previous, generatedAt, error); }
  };
}
