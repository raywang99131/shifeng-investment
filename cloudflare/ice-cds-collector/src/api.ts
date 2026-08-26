import { constantTimeBearerEquals } from './auth';
import { COLLECTOR_OBJECT_NAME } from './collector';
import { parseManualImport, ManualImportValidationError } from './manualImport';
import { CollectorRepository } from './repository';
import type { Env } from './types';

const MAX_IMPORT_BYTES = 128 * 1024;
const MAX_HISTORY_LIMIT = 366;
const MAX_EXPORT_LIMIT = 500;

const error = (status: number, code: string, message: string): Response => Response.json(
  { error: { code, message } }, { status },
);

const invalid = (): Response => error(400, 'INVALID_REQUEST', 'Invalid request');
const unauthorized = (): Response => error(401, 'UNAUTHORIZED', 'Unauthorized');
const notFound = (): Response => error(404, 'NOT_FOUND', 'Not found');
const unavailable = (): Response => error(503, 'SERVICE_UNAVAILABLE', 'Service unavailable');

const validDate = (value: string | null): value is string => {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

const one = (parameters: URLSearchParams, name: string, required = false): string | null => {
  const values = parameters.getAll(name);
  if (values.length > 1 || (required && values.length !== 1)) throw new Error('invalid');
  return values[0] ?? null;
};

const positiveInteger = (value: string | null, fallback: number, maximum: number): number => {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error('invalid');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) throw new Error('invalid');
  return number;
};

const historyQuery = (url: URL) => {
  const from = one(url.searchParams, 'from', true);
  const to = one(url.searchParams, 'to', true);
  const cursor = one(url.searchParams, 'cursor');
  const limit = positiveInteger(one(url.searchParams, 'limit'), 90, MAX_HISTORY_LIMIT);
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('invalid');
  if (cursor !== null) {
    const match = cursor.match(/^(\d{4}-\d{2}-\d{2})\|(\d+)$/);
    if (!match || !validDate(match[1]) || !Number.isSafeInteger(Number(match[2]))) throw new Error('invalid');
  }
  return { from, to, cursor, limit };
};

const exportQuery = (url: URL) => {
  const cursor = one(url.searchParams, 'cursor');
  const limit = positiveInteger(one(url.searchParams, 'limit'), MAX_EXPORT_LIMIT, MAX_EXPORT_LIMIT);
  if (cursor !== null && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))) throw new Error('invalid');
  return { cursor, limit };
};

const readJsonBody = async (request: Request): Promise<unknown> => {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES) throw new ManualImportValidationError('Manual import is invalid');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new ManualImportValidationError('Manual import is invalid');
  try { return JSON.parse(text); } catch { throw new ManualImportValidationError('Manual import is invalid'); }
};

const forwardWrite = async (env: Env, path: '/import' | '/collect-now', body?: string): Promise<Response> => {
  try {
    const stub = env.CDS_COLLECTOR.get(env.CDS_COLLECTOR.idFromName(COLLECTOR_OBJECT_NAME));
    const response = await stub.fetch(`https://collector.internal${path}`, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body,
    });
    if (!response.ok) return error(502, 'INTERNAL_WRITE_FAILED', 'Internal write failed');
    return new Response(await response.text(), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch {
    return error(502, 'INTERNAL_WRITE_FAILED', 'Internal write failed');
  }
};

async function handleRead(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await constantTimeBearerEquals(request, env.READ_TOKEN))) return unauthorized();
  const repository = new CollectorRepository(env.DB);
  if (request.method !== 'GET') return notFound();
  try {
    if (url.pathname === '/v1/cds/latest') {
      const latest = await repository.latestBatchSnapshot();
      if (!latest) return error(404, 'NO_PUBLISHED_BATCH', 'No published batch');
      return Response.json({ data: {
        asOf: latest.clearingDate,
        batchId: latest.batchId,
        revision: latest.revision,
        sourceKind: 'ice_eod_isda',
        publishedAt: latest.publishedAt,
        companies: latest.companies,
      } });
    }
    if (url.pathname === '/v1/cds/history') {
      const query = historyQuery(url);
      try { return Response.json(await repository.history(query)); } catch { return unavailable(); }
    }
    if (url.pathname === '/v1/cds/export-source') {
      const query = exportQuery(url);
      try { return Response.json(await repository.exportSource(query)); } catch { return unavailable(); }
    }
    if (url.pathname === '/v1/cds/health') {
      const [health, partialDates] = await Promise.all([repository.health(new Date()), repository.listPartialDates()]);
      return Response.json({ data: { ...health, partialDates } });
    }
    return notFound();
  } catch {
    return url.pathname === '/v1/cds/history' || url.pathname === '/v1/cds/export-source' ? invalid() : unavailable();
  }
}

async function handleInternal(request: Request, env: Env, url: URL): Promise<Response> {
  if (!(await constantTimeBearerEquals(request, env.WRITE_TOKEN))) return unauthorized();
  if (request.method !== 'POST') return notFound();
  try {
    if (url.pathname === '/internal/v1/cds/collect-now') return forwardWrite(env, '/collect-now');
    if (url.pathname === '/internal/v1/cds/import') {
      const manual = parseManualImport(await readJsonBody(request));
      return forwardWrite(env, '/import', JSON.stringify(manual));
    }
    return notFound();
  } catch {
    return invalid();
  }
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return Response.json({ ok: true, service: 'ice-cds-collector' });
  }
  if (url.pathname.startsWith('/v1/')) return handleRead(request, env, url);
  if (url.pathname.startsWith('/internal/')) return handleInternal(request, env, url);
  return notFound();
}
