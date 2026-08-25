import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

describe('ice-cds collector worker', () => {
  it('exposes only a non-sensitive liveness response', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('https://collector.test/healthz'),
      {} as never,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'ice-cds-collector' });
  });
});
