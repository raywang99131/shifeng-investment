import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeComputeQuote } from './aiComputeData.js';
import {
  AI_COMPUTE_SOURCE_REGISTRY,
  createAiComputeCollector,
  createComputeSourceAdapter,
} from './aiComputeSources.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, 'fixtures/ai-compute/aws-pricing.html'), 'utf8');
const aws = AI_COMPUTE_SOURCE_REGISTRY.find((row) => row.id === 'aws-ec2-pricing');
const document = { text: html, finalUrl: aws.entryUrl, retrievedAt: '2026-08-23T00:00:00.000Z' };

test('compute registry covers the five required official platforms', () => {
  assert.deepEqual(new Set(AI_COMPUTE_SOURCE_REGISTRY.map((row) => row.platform)), new Set(['AWS', 'Azure', 'Google Cloud', 'CoreWeave', 'Lambda']));
});

test('official compute adapter parses instance, GPU count, region, and billing mode before price', () => {
  const quotes = createComputeSourceAdapter(aws).parseDocument(document);
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].instanceSpec, 'p5.48xlarge');
  assert.equal(quotes[0].gpuCount, 8);
  assert.equal(quotes[0].region, 'us-east-1');
  assert.equal(quotes[0].billingMode, 'on_demand');
  assert.equal(quotes[0].pricePerGpuHour, 12.29);
  assert.equal(quotes[1].billingMode, 'spot');
});

test('compute collector retains exact-key history and reports unavailable dynamic calculators', async () => {
  const azure = AI_COMPUTE_SOURCE_REGISTRY.find((row) => row.id === 'azure-vm-pricing');
  const collector = createAiComputeCollector({
    registry: [aws, azure],
    documentClient: {
      async fetchDocument(definition) {
        if (definition.id === 'azure-vm-pricing') throw new Error('dynamic calculator unavailable');
        return document;
      },
    },
  });
  const result = await collector({ previous: { computeRental: [] }, generatedAt: '2026-08-23T00:00:00.000Z' });
  assert.equal(result.source.status, 'ready');
  assert.equal(result.source.stale, true);
  assert.equal(result.payload.computeRental.length, 2);
  assert.equal(result.payload.computeSourceReports.find((row) => row.sourceId === 'azure-vm-pricing').status, 'error');
});

test('compute collector keeps verified ledger row counts when an official page is reachable but unparseable', async () => {
  const collector = createAiComputeCollector({
    registry: [aws],
    documentClient: { async fetchDocument() { return { ...document, text: '<main>official pricing</main>' }; } },
  });
  const result = await collector({
    previous: { computeRental: [], computeSourceReports: [{ sourceId: aws.id, rows: 3, asOf: '2026-08-22', message: '核验台账保留 3 条精确报价。' }] },
    generatedAt: '2026-08-23T00:00:00.000Z',
  });
  assert.equal(result.payload.computeSourceReports[0].rows, 3);
  assert.match(result.payload.computeSourceReports[0].message, /核验台账/);
  assert.equal(result.payload.computeSourceReports[0].status, 'unavailable');
  assert.equal(result.payload.computeSourceReports[0].asOf, null);
  assert.equal(result.source.status, 'error');
  assert.equal(result.source.stale, true);
});

const tracked = (overrides = {}) => normalizeComputeQuote({
  platform: 'AWS', gpu: 'NVIDIA H100 80GB', instanceSpec: 'p5.48xlarge', gpuCount: 8,
  region: 'US East (N. Virginia)', billingMode: 'capacity_block', currency: 'USD',
  instanceHourlyPrice: 34.608, asOf: '2026-08-24', sourceLabel: 'AWS 官网',
  sourceUrl: 'https://aws.amazon.com/ec2/capacityblocks/pricing/', retrievedAt: '2026-08-24T01:00:00Z',
  ...overrides,
});

test('official page layouts yield fresh daily quotes for the monitored instances', () => {
  const cases = [
    ['aws', 'aws-ec2-pricing', tracked(), 41.528 / 8],
    ['lambda', 'lambda-cloud-pricing', tracked({ platform: 'Lambda', gpu: 'NVIDIA H100 SXM 80GB', instanceSpec: '1-GPU plan', gpuCount: 1, region: 'global availability', billingMode: 'on_demand', sourceUrl: 'https://lambda.ai/instances' }), 4.29],
    ['coreweave', 'coreweave-pricing', tracked({ platform: 'CoreWeave', gpu: 'NVIDIA HGX H100 80GB', instanceSpec: 'HGX H100 8-GPU', region: 'US', billingMode: 'spot', sourceUrl: 'https://coreweave.com/pricing' }), 19.71 / 8],
    ['gcp', 'gcp-gpu-pricing', tracked({ platform: 'Google Cloud', instanceSpec: 'a3-highgpu-8g', region: 'listed regions', billingMode: 'spot', sourceUrl: 'https://cloud.google.com/products/compute/pricing/accelerator-optimized' }), 50.458920548 / 8],
  ];
  for (const [file, id, previous, expected] of cases) {
    const definition = AI_COMPUTE_SOURCE_REGISTRY.find(row => row.id === id);
    const quotes = createComputeSourceAdapter(definition).parseDocument({
      text: fs.readFileSync(path.join(__dirname, `fixtures/ai-compute/${file}-official.html`), 'utf8'),
      finalUrl: previous.sourceUrl, retrievedAt: '2026-09-11T01:00:00Z',
    }, [previous]);
    assert.equal(quotes.length, 1, file);
    assert.equal(quotes[0].pricePerGpuHour, expected, file);
    assert.equal(quotes[0].quoteKey, previous.quoteKey, file);
    assert.equal(quotes[0].asOf, '2026-09-11');
  }
});

test('daily refresh retains unchanged prices each day and does not date-stamp failed fetches', async () => {
  let retrievedAt = '2026-09-09T16:30:00Z';
  let fail = false;
  const collector = createAiComputeCollector({ registry: [aws], documentClient: {
    async fetchDocument() {
      if (fail) throw new Error('network unavailable');
      return { ...document, retrievedAt };
    },
  } });
  const first = await collector({ generatedAt: retrievedAt });
  retrievedAt = '2026-09-10T16:30:00Z';
  const second = await collector({ previous: first.payload, generatedAt: retrievedAt });
  assert.deepEqual([...new Set(second.payload.computeRental.map(row => row.asOf))], ['2026-09-11', '2026-09-10']);
  assert.equal(second.payload.computeRental.length, 4);
  fail = true;
  const failed = await collector({ previous: second.payload, generatedAt: '2026-09-12T01:00:00Z' });
  assert.deepEqual(failed.payload.computeRental, second.payload.computeRental);
  assert.equal(failed.payload.computeSourceReports[0].asOf, '2026-09-11');
  assert.equal(failed.source.status, 'error');
});
