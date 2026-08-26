import path from 'node:path';
import process from 'node:process';
import { writeFile } from 'node:fs/promises';
import { buildIceCdsCloudSeed } from '../lib/iceCdsCloudSeed.js';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const root = process.cwd();
const out = option('--out');
if (!out) throw new Error('Usage: npm run build:ice-cds-cloud-seed -- --out <seed.json> [--generated-at <ISO>]');
const seed = await buildIceCdsCloudSeed({
  workbookFile: option('--workbook') ?? path.join(root, 'server/data/ai-dashboard/ice-cds/ice-cds-history.xlsx'),
  snapshotFile: option('--snapshot') ?? path.join(root, 'server/data/ai-dashboard/ice-cds/ice-cds-history.json'),
  generatedAt: option('--generated-at'),
});
await writeFile(out, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
process.stdout.write(`Wrote deterministic ICE CDS seed: ${out}\n`);
