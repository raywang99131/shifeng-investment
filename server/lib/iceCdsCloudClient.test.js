import assert from 'node:assert/strict';
import test from 'node:test';
import { IceCdsCloudClientError, createIceCdsCloudClient } from './iceCdsCloudClient.js';

const companies = [
  ['Oracle', 216, 95.01, 'ORCLE.SNRFOR.USD.XR14.100.2031-06-20'],
  ['CoreWeave', 800, 90.01, 'COREWEI.SNRFOR.USD.XR14.500.2031-06-20'],
  ['NVIDIA', 87, 100.55, 'NVIDIA.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Amazon', 66, 101.46, 'AMZN.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Google', 60, 101.74, 'ALPHINC.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Microsoft', 49, 102.2, 'MSFT.SNRFOR.USD.XR14.100.2031-06-20'],
  ['Meta', 97, 100.12, 'METAPL.SNRFOR.USD.XR14.100.2031-06-20'],
].map(([company, spreadBp, eodPrice, instrumentName]) => ({ company, spreadBp, eodPrice, instrumentName, qualityStatus: 'model-derived' }));

const latestPayload = {
  data: {
    asOf: '2026-08-24',
    batchId: 'ice-20260824-cloud',
    revision: 1,
    sourceKind: 'ice_eod_isda',
    publishedAt: '2026-08-25T00:00:00.000Z',
    companies,
  },
};

test('pins the bearer token to the configured HTTPS collector host and fixed read route', async () => {
  const requests = [];
  const client = createIceCdsCloudClient({
    baseUrl: 'https://collector.example/collector',
    readToken: 'read-only-token',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json(latestPayload);
    },
  });

  const latest = await client.latest();

  assert.equal(latest.data.batchId, 'ice-20260824-cloud');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://collector.example/collector/v1/cds/latest');
  assert.equal(requests[0].options.headers.authorization, 'Bearer read-only-token');
  assert.equal(requests[0].options.redirect, 'error');
  assert.throws(() => createIceCdsCloudClient({
    baseUrl: 'http://collector.example', readToken: 'read-only-token',
  }), (error) => error instanceof IceCdsCloudClientError && error.code === 'INVALID_CONFIGURATION');
});

test('returns stable safe errors for collector HTTP failures and malformed data', async () => {
  const httpClient = createIceCdsCloudClient({
    baseUrl: 'https://collector.example',
    readToken: 'read-only-token',
    fetchImpl: async () => new Response('upstream details read-only-token', { status: 503 }),
  });
  await assert.rejects(() => httpClient.latest(), (error) => error instanceof IceCdsCloudClientError
    && error.code === 'HTTP_ERROR' && !error.message.includes('read-only-token'));

  const malformedClient = createIceCdsCloudClient({
    baseUrl: 'https://collector.example', readToken: 'read-only-token',
    fetchImpl: async () => Response.json({ data: { asOf: 'not-a-date', companies: [] } }),
  });
  await assert.rejects(() => malformedClient.latest(), (error) => error instanceof IceCdsCloudClientError
    && error.code === 'INVALID_RESPONSE');
});

test('aborts a collector read at the configured timeout without leaking credentials', async () => {
  const client = createIceCdsCloudClient({
    baseUrl: 'https://collector.example', readToken: 'read-only-token', timeoutMs: 1,
    fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('request aborted')));
    }),
  });

  await assert.rejects(() => client.latest(), (error) => error instanceof IceCdsCloudClientError
    && error.code === 'TIMEOUT' && !error.message.includes('read-only-token'));
});
