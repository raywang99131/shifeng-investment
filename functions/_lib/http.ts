/**
 * Common HTTP helpers for Cloudflare Pages Functions.
 * - JSON response with CORS headers
 * - Error response
 * - Origin-aware CORS (echo request origin in dev, allow all in prod)
 */

const ALLOW_HEADERS = 'Content-Type, Authorization, X-Requested-With';
const ALLOW_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function jsonResponse(
  request: Request,
  data: unknown,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    headers.set(k, v);
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(
  request: Request,
  status: number,
  message: string,
  extra: Record<string, unknown> = {}
): Response {
  return jsonResponse(request, { success: false, error: message, ...extra }, { status });
}

export function handleOptions(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}
