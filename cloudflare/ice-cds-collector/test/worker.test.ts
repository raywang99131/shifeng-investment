import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('ice-cds collector worker', () => {
  it('exposes only a non-sensitive liveness response', async () => {
    const response = await exports.default.fetch('https://collector.test/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'ice-cds-collector' });
  });
});
