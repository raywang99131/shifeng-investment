import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defaultCdsPython } from '../lib/isdaCdsEngine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const configured = process.env.ICE_CDS_PYTHON;
const python = configured || defaultCdsPython;
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.status}`);
}
if (!configured && !fs.existsSync(python)) {
  const base = process.env.CDS_SETUP_PYTHON || 'python3';
  run(base, ['-m', 'venv', path.dirname(path.dirname(python))]);
}
run(python, ['-m', 'pip', 'install', '--no-cache-dir', '-r', path.join(here, '../cds_pricing/requirements.txt')]);
run(python, [path.join(here, '../cds_pricing/pricer.py'), '--self-check']);
