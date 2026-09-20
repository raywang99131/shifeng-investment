import { createIceCdsPipelineFromEnv } from '../lib/iceCdsPipeline.js';

const result = await createIceCdsPipelineFromEnv().refreshComparison();
process.stdout.write(`${JSON.stringify({ status: result.status, asOf: result.asOf,
  modelVersion: result.modelVersion, engineVersion: result.engineVersion,
  observations: result.observationCount, companies: result.companies.length, message: result.message }, null, 2)}\n`);
if (result.status === 'error' || result.status === 'unavailable') process.exitCode = 1;
