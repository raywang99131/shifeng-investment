import { describe, expect, it } from 'vitest';
import { BoundedBodyError, MAX_INTERNAL_JSON_BYTES, readBoundedJson } from '../src/body';

describe('bounded JSON reader', () => {
  it('cancels a multi-chunk body without Content-Length once its cumulative bytes exceed the limit', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"payload":"'));
        controller.enqueue(new Uint8Array(MAX_INTERNAL_JSON_BYTES));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request('https://collector.test/internal/v1/cds/import', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: stream,
    });
    await expect(readBoundedJson(request)).rejects.toBeInstanceOf(BoundedBodyError);
    expect(cancelled).toBe(true);
  });

  it('rejects malformed, negative, and over-limit declared Content-Length without parsing the payload', async () => {
    for (const contentLength of ['-1', 'abc', String(MAX_INTERNAL_JSON_BYTES + 1)]) {
      const request = new Request('https://collector.test/internal/v1/cds/import', {
        method: 'POST', headers: { 'content-type': 'application/json', 'content-length': contentLength }, body: '{}',
      });
      await expect(readBoundedJson(request)).rejects.toBeInstanceOf(BoundedBodyError);
    }
  });
});
