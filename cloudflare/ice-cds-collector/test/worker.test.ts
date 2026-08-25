import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import testConfig from '../wrangler.test.jsonc?raw';

describe('ice-cds collector worker', () => {
  it('uses an explicitly non-deployable local test configuration', () => {
    expect(testConfig).toMatch(/^\/\/ LOCAL TEST ONLY — NEVER DEPLOY/m);
    const config = JSON.parse(testConfig.replace(/^\/\/.*\n/gm, '')) as Record<string, unknown>;
    expect(config.account_id).toBe('00000000000000000000000000000000');
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  it('exposes only a non-sensitive liveness response', async () => {
    const response = await exports.default.fetch('https://collector.test/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'ice-cds-collector' });
  });
});
