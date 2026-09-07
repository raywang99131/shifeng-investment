import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_SECRETS = ['GITHUB_DISPATCH_TOKEN', 'RESEARCH_PUBLISH_TOKEN'];
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

// Workers Builds variables belong to the build process. Wrangler needs an
// explicit secrets file to install those same values as Worker bindings.
export function deployCloudWorker({
  root = REPO_ROOT,
  env = process.env,
  preview = false,
  dryRun = false,
} = {}) {
  const missing = REQUIRED_SECRETS.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing build secrets: ${missing.join(', ')}`);

  const directory = mkdtempSync(path.join(tmpdir(), 'shifeng-worker-secrets-'));
  try {
    const secretsFile = path.join(directory, 'secrets.json');
    writeFileSync(secretsFile, JSON.stringify(Object.fromEntries(
      REQUIRED_SECRETS.map((name) => [name, env[name]]),
    )), { mode: 0o600, flag: 'wx' });

    const args = [
      path.join(root, 'node_modules/wrangler/bin/wrangler.js'),
      ...(preview ? ['versions', 'upload'] : ['deploy']),
      '--secrets-file', secretsFile,
      ...(dryRun ? ['--dry-run'] : []),
    ];
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw new Error('Unable to start Wrangler', { cause: result.error });
    return result.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !['--preview', '--dry-run'].includes(arg))) {
      throw new Error('Usage: deploy-cloud-worker.mjs [--preview] [--dry-run]');
    }
    process.exitCode = deployCloudWorker({
      preview: args.includes('--preview'),
      dryRun: args.includes('--dry-run'),
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
