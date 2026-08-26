import { ICE_CDS_CONTRACT_REGISTRY } from './iceCdsRegistry.js';

const ROUTES = new Set(['/v1/cds/latest', '/v1/cds/history', '/v1/cds/health', '/v1/cds/export-source']);
const COMPANY_SET = new Set(ICE_CDS_CONTRACT_REGISTRY.map((row) => row.company));

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
    && Number.isFinite(row.spreadBp)
    && Number.isFinite(row.eodPrice)
    && nonEmpty(row.instrumentName)
    && nonEmpty(row.qualityStatus);
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
    url.search = queryParameters(query).toString();
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
      return { data: payload.data.map((row) => normalizeBatch(row)), nextCursor: payload.nextCursor };
    }),
    health: () => request('/v1/cds/health', undefined, normalizeHealth),
    exportSource: (query) => request('/v1/cds/export-source', query, (payload) => {
      if (!object(payload) || !Array.isArray(payload.data) || !(payload.nextCursor === null || typeof payload.nextCursor === 'string')) {
        throw new IceCdsCloudClientError('INVALID_RESPONSE', 'Cloud collector returned an invalid response');
      }
      return payload;
    }),
  };
}
