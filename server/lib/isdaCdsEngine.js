import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIMIT = 8 * 1024 * 1024;
export const ISDA_MODEL_VERSION = 'quantlib-isda-v2';
export const defaultCdsPython = path.join(here, '../data/cds-python-venv/bin/python');

function validateResult(result, records) {
  if (result?.schemaVersion !== 1 || result.modelVersion !== ISDA_MODEL_VERSION
      || result.engineVersion !== '1.43' || !Array.isArray(result.rows) || result.rows.length !== records.length) {
    throw new Error('ISDA engine returned an incomplete or unsupported batch');
  }
  const expected = new Map(records.map(row => [row.id, row]));
  if (expected.size !== records.length) throw new Error('Duplicate pricing request IDs');
  for (const row of result.rows) {
    const input = expected.get(row.id);
    if (!input || row.curveId !== input.discountCurve.curveId || row.curveAsOf !== input.discountCurve.asOf
        || !Number.isFinite(row.spreadBp) || row.spreadBp < 0
        || !Number.isFinite(row.priceResidual) || row.priceResidual < 0 || row.priceResidual > .005
        || !Number.isFinite(row.roundTripPrice) || Math.abs(row.roundTripPrice - input.cleanPrice) > .005
        || row.modelVersion !== ISDA_MODEL_VERSION) {
      throw new Error('ISDA engine returned an invalid or mismatched observation');
    }
    expected.delete(row.id);
  }
  return result;
}

export async function priceCdsBatch(records, {
  pythonPath = process.env.ICE_CDS_PYTHON || defaultCdsPython,
  timeoutMs = 30_000,
  spawnImpl = spawn,
} = {}) {
  if (!Array.isArray(records) || !records.length || records.length > 5_000) throw new Error('Invalid ISDA batch size');
  const input = JSON.stringify({ schemaVersion: 1, records });
  if (Buffer.byteLength(input) > LIMIT) throw new Error('ISDA batch exceeds input limit');
  const payload = await new Promise((resolve, reject) => {
    const child = spawnImpl(pythonPath, [path.join(here, '../cds_pricing/pricer.py')], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let bytes = 0;
    const stdout = [];
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(new Error('ISDA engine timed out'));
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', () => finish(new Error('ISDA engine unavailable; run npm run setup:cds-pricing')));
    child.stdin.on('error', () => {
      finish(new Error('ISDA engine input failed'));
      child.kill('SIGKILL');
    });
    const collect = (chunk, destination) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > LIMIT) {
        finish(new Error('ISDA engine output exceeds limit'));
        child.kill('SIGKILL');
      } else if (destination) destination.push(Buffer.from(chunk));
    };
    child.stdout.on('data', chunk => collect(chunk, stdout));
    child.stderr.on('data', chunk => collect(chunk));
    child.on('close', code => {
      if (code !== 0) return finish(new Error('ISDA engine failed; verify runtime and curve inputs'));
      try { finish(null, JSON.parse(Buffer.concat(stdout).toString('utf8'))); }
      catch { finish(new Error('ISDA engine returned invalid JSON')); }
    });
    child.stdin.end(input);
  });
  return validateResult(payload, records);
}
