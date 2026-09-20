import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaultCdsPython } from '../lib/isdaCdsEngine.js';

const result = spawnSync(process.env.ICE_CDS_PYTHON || defaultCdsPython, [
  '-m', 'unittest', 'discover', '-s', fileURLToPath(new URL('../cds_pricing/', import.meta.url)), '-v',
], { stdio: 'inherit', shell: false });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
