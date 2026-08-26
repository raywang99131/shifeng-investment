import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { importIceCdsCloudSeed } from '../lib/iceCdsCloudSeed.js';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
if (!file) throw new Error('Usage: npm run import:ice-cds-cloud-seed -- --file <seed.json>');
const seed = JSON.parse(await readFile(file, 'utf8'));
const results = await importIceCdsCloudSeed({
  seed,
  baseUrl: process.env.ICE_CDS_COLLECTOR_BASE_URL,
  writeToken: process.env.ICE_CDS_COLLECTOR_WRITE_TOKEN,
});
process.stdout.write(`Imported ${results.length} idempotent ICE CDS seed upload(s).\n`);
