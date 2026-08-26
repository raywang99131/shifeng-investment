export class FixedSourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FixedSourceError';
    this.code = code;
  }
}

export interface FetchFixedSourceOptions {
  acceptedContentTypes: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  allowedHost?: string;
}

const matchesContentType = (received: string | null, accepted: readonly string[]): boolean => {
  const mimeType = received?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return accepted.some((value) => value.toLowerCase() === mimeType);
};

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    throw new FixedSourceError('SOURCE_RESPONSE_TOO_LARGE', 'Source response exceeded the configured size limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new FixedSourceError('SOURCE_RESPONSE_TOO_LARGE', 'Source response exceeded the configured size limit');
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function fetchFixedSource(
  fetchImpl: typeof fetch,
  url: string,
  options: FetchFixedSourceOptions,
): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new FixedSourceError('SOURCE_URL_NOT_ALLOWED', 'Source URL is not allowed'); }
  if (parsed.protocol !== 'https:' || (options.allowedHost && parsed.hostname !== options.allowedHost)) {
    throw new FixedSourceError('SOURCE_URL_NOT_ALLOWED', 'Source URL is not allowed');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetchImpl(parsed.toString(), {
      headers: { Accept: options.acceptedContentTypes.join(', ') },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new FixedSourceError('SOURCE_HTTP_STATUS', `Source returned HTTP ${response.status}`);
    if (!matchesContentType(response.headers.get('content-type'), options.acceptedContentTypes)) {
      throw new FixedSourceError('SOURCE_CONTENT_TYPE_INVALID', 'Source response content type is invalid');
    }
    return await readLimited(response, options.maxBytes);
  } catch (error) {
    if (error instanceof FixedSourceError) throw error;
    if (controller.signal.aborted) throw new FixedSourceError('SOURCE_TIMEOUT', 'Source request timed out');
    throw new FixedSourceError('SOURCE_FETCH_FAILED', 'Source request failed');
  } finally {
    clearTimeout(timeout);
  }
}
