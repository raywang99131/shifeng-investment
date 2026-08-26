import { normalizeCdsDataset } from './aiCdsData.js';
import { ICE_CDS_CONTRACT_REGISTRY } from './iceCdsRegistry.js';

const COMPANY_ORDER = ICE_CDS_CONTRACT_REGISTRY.map((row) => row.company);
const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function completeBatch(value) {
  const asOf = value?.asOf || value?.clearingDate;
  const expected = new Set(COMPANY_ORDER);
  if (!value || !validDate(asOf) || value.sourceKind !== 'ice_eod_isda' || !Array.isArray(value.companies)
    || value.companies.length !== COMPANY_ORDER.length || new Set(value.companies.map((row) => row?.company)).size !== COMPANY_ORDER.length
    || !value.companies.every((row) => expected.has(row?.company) && Number.isFinite(row.spreadBp)
      && Number.isFinite(row.eodPrice) && typeof row.instrumentName === 'string' && row.instrumentName && typeof row.qualityStatus === 'string' && row.qualityStatus)) {
    throw new Error('Cloud collector did not return a complete seven-company batch');
  }
  return { ...value, asOf };
}

function dateOffset(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function priorMonth(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const targetMonth = value.getUTCMonth() - 1;
  const year = value.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = (targetMonth + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), lastDay))).toISOString().slice(0, 10);
}

function absoluteChanges(points, currentDate) {
  const byDate = new Map();
  for (const point of points) {
    if (!validDate(point.date) || point.date > currentDate || !Number.isFinite(point.valueBp)) continue;
    const existing = byDate.get(point.date);
    if (!existing || (existing.sourceKind === 'screenshot_backfill' && point.sourceKind !== 'screenshot_backfill')) byDate.set(point.date, point);
  }
  const history = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const currentIndex = history.findIndex((point) => point.date === currentDate);
  if (currentIndex < 0) return { oneDayBp: null, sevenDayBp: null, oneMonthBp: null };
  const current = history[currentIndex];
  const latestAtOrBefore = (target) => history.filter((point) => point.date <= target).at(-1) || null;
  const prior = history[currentIndex - 1] || null;
  const difference = (priorPoint) => priorPoint ? current.valueBp - priorPoint.valueBp : null;
  return {
    oneDayBp: difference(prior),
    sevenDayBp: difference(latestAtOrBefore(dateOffset(currentDate, -7))),
    oneMonthBp: difference(latestAtOrBefore(priorMonth(currentDate))),
  };
}

function collectionFromHealth(health = {}) {
  const partialDates = Array.isArray(health.partialDates) ? health.partialDates : [];
  return {
    lastCollectedAt: health.lastSourceSuccessAt || null,
    lastPublishedDate: health.lastPublishedDate || null,
    nextAlarmAt: health.nextAlarmAt || null,
    partialDates,
    consecutiveFailures: Number.isSafeInteger(health.consecutiveFailures) ? health.consecutiveFailures : 0,
    state: health.stale ? 'stale' : partialDates.length > 0 ? 'partial' : 'healthy',
  };
}

function pointFromCloud(batch, row) {
  return {
    date: batch.asOf,
    valueBp: row.spreadBp,
    eodPrice: row.eodPrice,
    instrumentName: row.instrumentName,
    qualityStatus: row.qualityStatus,
    sourceKind: 'ice_eod_isda',
    revision: batch.revision,
  };
}

export function markIceCdsCloudSourceError(cds5y, checkedAt) {
  return {
    ...(cds5y || {}),
    collection: {
      ...(cds5y?.collection || {}),
      state: 'source-error',
      lastCollectedAt: cds5y?.collection?.lastCollectedAt || null,
      lastPublishedDate: cds5y?.collection?.lastPublishedDate || cds5y?.asOf || null,
      nextAlarmAt: cds5y?.collection?.nextAlarmAt || null,
      partialDates: Array.isArray(cds5y?.collection?.partialDates) ? cds5y.collection.partialDates : [],
      consecutiveFailures: Math.max(1, Number(cds5y?.collection?.consecutiveFailures || 0) + 1),
    },
    ...(checkedAt ? { lastCheckedAt: checkedAt } : {}),
  };
}

export function projectIceCdsCloud({ previous, latest, history, health, checkedAt } = {}) {
  const latestBatch = completeBatch(latest?.data || latest);
  const historyBatches = Array.isArray(history?.data) ? history.data.map(completeBatch) : [];
  const batchesById = new Map();
  for (const batch of [...historyBatches, latestBatch]) {
    const key = `${batch.asOf}|${batch.revision}|${batch.batchId}`;
    batchesById.set(key, batch);
  }
  const batches = [...batchesById.values()].sort((left, right) => left.asOf.localeCompare(right.asOf) || left.revision - right.revision);
  const companyHistory = new Map(COMPANY_ORDER.map((company) => [company, new Map()]));
  for (const company of previous?.companies || []) {
    const points = companyHistory.get(company?.company);
    if (!points) continue;
    for (const point of company.history || []) {
      if (!validDate(point?.date) || !Number.isFinite(point?.valueBp)) continue;
      const sourceKind = point.sourceKind || previous.sourceKind || 'ice_eod_isda';
      points.set(`${point.date}|${sourceKind}`, { ...point, sourceKind });
    }
  }
  for (const batch of batches) {
    for (const row of batch.companies) {
      const points = companyHistory.get(row.company);
      const key = `${batch.asOf}|ice_eod_isda`;
      const candidate = pointFromCloud(batch, row);
      const existing = points.get(key);
      if (!existing || Number(existing.revision || 0) <= batch.revision) points.set(key, candidate);
    }
  }
  const companies = COMPANY_ORDER.map((company) => {
    const historyPoints = [...companyHistory.get(company).values()]
      .sort((left, right) => left.date.localeCompare(right.date) || left.sourceKind.localeCompare(right.sourceKind));
    const latestPoint = historyPoints.filter((point) => point.sourceKind === 'ice_eod_isda').at(-1);
    if (!latestPoint) throw new Error('Cloud collector did not return a complete seven-company batch');
    const historyForSnapshot = historyPoints.map(({ revision, ...point }) => point);
    return {
      company,
      latestBp: latestPoint.valueBp,
      latestEodPrice: latestPoint.eodPrice,
      latestInstrumentName: latestPoint.instrumentName,
      qualityStatus: latestPoint.qualityStatus,
      changes: absoluteChanges(historyForSnapshot, latestPoint.date),
      history: historyForSnapshot,
    };
  });
  const qualityStatus = companies.every((company) => company.qualityStatus === 'validated') ? 'validated' : 'model-derived';
  return normalizeCdsDataset({
    asOf: latestBatch.asOf,
    sourceKind: 'ice_eod_isda',
    sourceLabel: 'ICE EOD Price · ISDA 换算值',
    sourceUrl: 'https://www.ice.com/cds-settlement-prices/icc/single-name-instruments',
    batchId: latestBatch.batchId,
    qualityStatus,
    workbookAvailable: false,
    historyEstimated: true,
    note: '截图历史回填 + ICE EOD Price · 模型换算。ICE 点由云端完整批次提供，未经官方基准验证时不代表 ICE 官方 spread。',
    lastCheckedAt: checkedAt || null,
    collection: collectionFromHealth(health),
    companies,
  });
}
