export const MAX_INTERNAL_JSON_BYTES = 128 * 1024;

export class BoundedBodyError extends Error {}

const declaredLength = (request: Request, maximum: number): void => {
  const header = request.headers.get('content-length');
  if (header === null) return;
  if (!/^\d+$/.test(header)) throw new BoundedBodyError('Invalid request body');
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length > maximum) throw new BoundedBodyError('Invalid request body');
};

/** Reads JSON without ever buffering more than the configured number of bytes. */
export async function readBoundedJson(request: Request, maximum = MAX_INTERNAL_JSON_BYTES): Promise<unknown> {
  declaredLength(request, maximum);
  const mimeType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mimeType !== 'application/json' || !request.body) throw new BoundedBodyError('Invalid request body');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new BoundedBodyError('Invalid request body');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new BoundedBodyError('Invalid request body'); }
}
