import { ICE_CDS_CONTRACT_REGISTRY } from './iceCdsRegistry.js';

const ROUTES = new Set(['/v1/cds/latest', '/v1/cds/history', '/v1/cds/health', '/v1/cds/export-source']);
const COMPANY_SET = new Set(ICE_CDS_CONTRACT_REGISTRY.map((row) => row.company));
const EXPORT_SECTIONS = new Set(['ice_eod_revisions', 'ice_eod_current', 'treasury_curves', 'cds_spread_revisions', 'published_batches', 'published_batch_current', 'seed_history']);
const MAX_CURSOR_LENGTH = 2_048;

export class IceCdsCloudClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IceCdsCloudClientError';
    this.code = code;
  }
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBaseUrl(value, allowHttpForTests) {
  if (!nonEmpty(value)) throw new IceCdsCloudClientError('INVALID_CONFIGURATION', 'Cloud collector URL is not configured');
  let url;
  try { url = new URL(value); } catch { throw new IceCdsCloudClientError('INVALID_CONFIGURATION', 'Cloud collector URL is invalid'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(allowHttpForTests && url.protocol === 'http:'))) {
    throw new IceCdsCloudClientError('INVALID_CONFIGURATION', 'Cloud collector URL must be a plain HTTPS URL');
  }
  return { origin: url.origin, basePath: url.pathname.replace(/\/+$/, '') };
}

function assertCompany(row) {
  return object(row)
    && COMPANY_SET.has(row.company)
    && Number.isFinite(row.spreadBp) && row.spreadBp >= 0
    && Number.isFinite(row.eodPrice) && row.eodPrice >= 0
    && nonEmpty(row.instrumentName)
    && row.qualityStatus === 'model-derived';
}

function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validHistoryCursor(value) {
  if (typeof value !== 'string' || value.length > 32) return false;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})\|([1-9]\d*)$/);
  return Boolean(match && validDate(match[1]) && Number.isSafeInteger(Number(match[2])));
}

// The Worker encodes its version-2 audit cursor in a v1 URL-safe opaque envelope.
function validExportCursor(value) {
  if (typeof value !== 'string' || !/^v1\.[A-Za-z0-9_-]{1,2048}$/.test(value) || value.length > MAX_CURSOR_LENGTH + 3) return false;
  try {
    const encoded = value.slice(3).replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const sections = ['ice_eod_revisions', 'ice_eod_current', 'treasury_curves', 'cds_spread_revisions', 'published_batches', 'published_batch_current', 'seed_history'];
    const watermarks = parsed?.watermarks;
    return exactKeys(parsed, ['v', 'section', 'key', 'watermarks', 'pointers']) && parsed.v === 2 && EXPORT_SECTIONS.has(parsed.section)
      && (parsed.key === null || (Number.isSafeInteger(parsed.key) && parsed.key >= 0))
      && exactKeys(watermarks, sections) && sections.every((section) => Number.isSafeInteger(watermarks[section]) && watermarks[section] >= 0)
      && exactKeys(parsed.pointers, ['iceCurrent', 'batchCurrent']) && /^[a-f0-9]{64}$/.test(parsed.pointers.iceCurrent) && /^[a-f0-9]{64}$/.test(parsed.pointers.batchCurrent);
  } catch { return false; }
}

function validHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function validAuditRecord(section, record) {
  if (section === 'ice_eod_revisions') {
    return exactKeys(record, ['revisionId', 'clearingDate', 'company', 'iceName', 'instrumentName', 'eodPrice', 'couponBp', 'payloadHash', 'retrievedAt', 'sourceUrl'])
      && positiveInteger(record.revisionId) && validDate(record.clearingDate) && COMPANY_SET.has(record.company)
      && nonEmpty(record.iceName) && nonEmpty(record.instrumentName) && Number.isFinite(record.eodPrice) && record.eodPrice >= 0
      && Number.isFinite(record.couponBp) && record.couponBp > 0 && /^[a-f0-9]{64}$/.test(record.payloadHash)
      && validTimestamp(record.retrievedAt) && validHttpsUrl(record.sourceUrl);
  }
  if (section === 'ice_eod_current') return exactKeys(record, ['clearingDate', 'company', 'revisionId'])
    && validDate(record.clearingDate) && COMPANY_SET.has(record.company) && positiveInteger(record.revisionId);
  if (section === 'treasury_curves') return exactKeys(record, ['curveId', 'asOf', 'currency', 'sourceLabel', 'sourceUrl', 'retrievedAt', 'payloadHash', 'nodes'])
    && nonEmpty(record.curveId) && validDate(record.asOf) && record.currency === 'USD' && nonEmpty(record.sourceLabel)
    && validHttpsUrl(record.sourceUrl) && validTimestamp(record.retrievedAt) && /^[a-f0-9]{64}$/.test(record.payloadHash)
    && Array.isArray(record.nodes) && record.nodes.length > 0 && record.nodes.every((node) => exactKeys(node, ['years', 'zeroRate']) && Number.isFinite(node.years) && node.years > 0 && Number.isFinite(node.zeroRate));
  if (section === 'cds_spread_revisions') return exactKeys(record, ['spreadRevisionId', 'clearingDate', 'company', 'iceRevisionId', 'curveId', 'instrumentName', 'maturityDate', 'eodPrice', 'couponBp', 'spreadBp', 'roundTripPrice', 'priceResidual', 'hazardRate', 'recoveryRate', 'modelVersion', 'qualityStatus', 'createdAt'])
    && positiveInteger(record.spreadRevisionId) && validDate(record.clearingDate) && COMPANY_SET.has(record.company)
    && positiveInteger(record.iceRevisionId) && nonEmpty(record.curveId) && nonEmpty(record.instrumentName) && validDate(record.maturityDate)
    && Number.isFinite(record.eodPrice) && record.eodPrice >= 0 && Number.isFinite(record.couponBp) && record.couponBp > 0
    && Number.isFinite(record.spreadBp) && record.spreadBp > 0 && Number.isFinite(record.roundTripPrice) && Number.isFinite(record.priceResidual)
    && Number.isFinite(record.hazardRate) && Number.isFinite(record.recoveryRate) && nonEmpty(record.modelVersion)
    && record.qualityStatus === 'model-derived' && validTimestamp(record.createdAt);
  if (section === 'published_batches') return exactKeys(record, ['batchId', 'clearingDate', 'revision', 'publishedAt', 'sourceKind', 'qualityStatus', 'rows'])
    && nonEmpty(record.batchId) && validDate(record.clearingDate) && positiveInteger(record.revision) && validTimestamp(record.publishedAt)
    && record.sourceKind === 'ice_eod_isda' && record.qualityStatus === 'model-derived' && Array.isArray(record.rows)
    && record.rows.length === COMPANY_SET.size && new Set(record.rows.map((row) => row?.company)).size === COMPANY_SET.size
    && record.rows.every((row) => exactKeys(row, ['company', 'spreadRevisionId']) && COMPANY_SET.has(row.company) && positiveInteger(row.spreadRevisionId));
  if (section === 'published_batch_current') return exactKeys(record, ['clearingDate', 'batchId']) && validDate(record.clearingDate) && nonEmpty(record.batchId);
  return exactKeys(record, ['observationDate', 'company', 'valueBp', 'sourceKind', 'sourceLabel', 'note', 'importedAt'])
    && validDate(record.observationDate) && COMPANY_SET.has(record.company) && Number.isFinite(record.valueBp)
    && record.sourceKind === 'screenshot_backfill' && nonEmpty(record.sourceLabel) && typeof record.note === 'string' && validTimestamp(record.importedAt);
}

function validAuditEntry(entry) {
  return exactKeys(entry, ['section', 'record']) && EXPORT_SECTIONS.has(entry.section) && validAuditRecord(entry.section, entry.record);
}

function normalizeBatch(value, { latest = false } = {}) {
  if (!object(value)) throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
  const asOf = latest ? value.asOf : value.clearingDate;
  if (!validDate(asOf) || !nonEmpty(value.batchId) || !Number.isSafeInteger(value.revision) || value.revision < 1
    || value.sourceKind !== 'ice_eod_isda' || !nonEmpty(value.publishedAt) || !Number.isFinite(Date.parse(value.publishedAt))
    || !Array.isArray(value.companies) || value.companies.length !== COMPANY_SET.size
    || new Set(value.companies.map((row) => row?.company)).size !== COMPANY_SET.size
    || !value.companies.every(assertCompany)) {
    throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
  }
  return { ...value, asOf };
}

function normalizeHealth(value) {
  if (!object(value) || !object(value.data)) throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
  const health = value.data;
  const nullableTimestamp = (field) => health[field] === null || (typeof health[field] === 'string' && Number.isFinite(Date.parse(health[field])));
  if (!nullableTimestamp('lastAlarmAt') || !nullableTimestamp('lastSourceSuccessAt') || !nullableTimestamp('nextAlarmAt')
    || (health.lastPublishedDate !== null && !validDate(health.lastPublishedDate))
    || !Number.isSafeInteger(health.consecutiveFailures) || health.consecutiveFailures < 0 || typeof health.stale !== 'boolean'
    || !Array.isArray(health.partialDates) || !health.partialDates.every((row) => object(row) && validDate(row.clearingDate)
      && Array.isArray(row.missingCompanies) && row.missingCompanies.every((company) => COMPANY_SET.has(company)))) {
    throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
  }
  return health;
}

function queryParameters(query) {
  if (query === undefined || query === null || query === '') return new URLSearchParams();
  if (query instanceof URLSearchParams) return new URLSearchParams(query);
  if (typeof query === 'string') return new URLSearchParams(query);
  if (!object(query)) throw new IceCdsCloudClientError('INVALID_REQUEST', 'Cloud collector request is invalid');
  return new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined || value === null ? [] : [[key, String(value)]]));
}

function validateQuery(route, parameters) {
  const values = (name) => parameters.getAll(name);
  const one = (name) => values(name).length <= 1 ? values(name)[0] : undefined;
  if (route === '/v1/cds/history') {
    const from = one('from'); const to = one('to'); const cursor = one('cursor'); const limit = one('limit');
    if (['from', 'to', 'cursor', 'limit'].some((name) => values(name).length > 1)
      || !validDate(from) || !validDate(to) || from > to || (cursor !== undefined && !validHistoryCursor(cursor))
      || (limit !== undefined && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 366))) {
      throw new IceCdsCloudClientError('INVALID_REQUEST', 'Cloud collector request is invalid');
    }
  }
  if (route === '/v1/cds/export-source') {
    const cursor = one('cursor'); const limit = one('limit');
    if (['cursor', 'limit'].some((name) => values(name).length > 1) || (cursor !== undefined && !validExportCursor(cursor))
      || (limit !== undefined && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 500))) {
      throw new IceCdsCloudClientError('INVALID_REQUEST', 'Cloud collector request is invalid');
    }
  }
}

export function createIceCdsCloudClient({
  baseUrl = process.env.ICE_CDS_COLLECTOR_BASE_URL,
  readToken = process.env.ICE_CDS_COLLECTOR_READ_TOKEN,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  allowHttpForTests = false,
} = {}) {
  const base = normalizeBaseUrl(baseUrl, allowHttpForTests);
  if (!nonEmpty(readToken) || typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new IceCdsCloudClientError('INVALID_CONFIGURATION', 'Cloud collector client is not configured');
  }

  const request = async (route, query, validate) => {
    if (!ROUTES.has(route)) throw new IceCdsCloudClientError('INVALID_REQUEST', 'Cloud collector request is invalid');
    const url = new URL(base.origin);
    url.pathname = `${base.basePath}${route}` || route;
    const parameters = queryParameters(query);
    validateQuery(route, parameters);
    url.search = parameters.toString();
    if (url.origin !== base.origin || !url.pathname.startsWith(`${base.basePath}${route}`)) {
      throw new IceCdsCloudClientError('INVALID_REQUEST', 'Cloud collector request is invalid');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Bearer ${readToken}` },
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.redirected) throw new IceCdsCloudClientError('REDIRECT_BLOCKED', 'Cloud collector redirect was blocked');
      if (!response.ok) throw new IceCdsCloudClientError('HTTP_ERROR', `Cloud collector returned HTTP ${response.status}`);
      let payload;
      try { payload = await response.json(); } catch { throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response'); }
      return validate(payload);
    } catch (error) {
      if (controller.signal.aborted) throw new IceCdsCloudClientError('TIMEOUT', `Cloud collector timed out after ${timeoutMs}ms`);
      if (error instanceof IceCdsCloudClientError) throw error;
      throw new IceCdsCloudClientError('REQUEST_FAILED', 'Cloud collector request failed');
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    latest: () => request('/v1/cds/latest', undefined, (payload) => {
      if (!object(payload) || !object(payload.data)) throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
      return { data: normalizeBatch(payload.data, { latest: true }) };
    }),
    history: (query) => request('/v1/cds/history', query, (payload) => {
      if (!object(payload) || !Array.isArray(payload.data) || !(payload.nextCursor === null || typeof payload.nextCursor === 'string')) {
        throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
      }
      if (payload.nextCursor !== null && !validHistoryCursor(payload.nextCursor)) throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
      return { data: payload.data.map((row) => normalizeBatch(row)), nextCursor: payload.nextCursor };
    }),
    health: () => request('/v1/cds/health', undefined, normalizeHealth),
    exportSource: (query) => request('/v1/cds/export-source', query, (payload) => {
      if (!object(payload) || !Array.isArray(payload.data) || !(payload.nextCursor === null || typeof payload.nextCursor === 'string')) {
        throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
      }
      if (payload.nextCursor !== null && !validExportCursor(payload.nextCursor)) throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
      if (!payload.data.every(validAuditEntry)) throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
      return payload;
    }),
  };
}
