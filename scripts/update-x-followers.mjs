#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_ACCOUNTS_FILE = path.join(os.homedir(), 'Documents', 'x_opencli', 'accounts.txt');
const DEFAULT_OUTPUT_FILE = path.join(process.cwd(), 'server', 'data', 'x-followers.json');
const OPENCLI_COMMAND = process.env.OPENCLI_COMMAND
  || (fs.existsSync(path.join(os.homedir(), '.npm-global', 'bin', 'opencli')) ? path.join(os.homedir(), '.npm-global', 'bin', 'opencli') : 'opencli');
const EXTRA_BIN_PATHS = [
  path.join(os.homedir(), '.npm-global', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
].filter((candidate) => fs.existsSync(candidate));

const env = {
  ...process.env,
  PATH: [...EXTRA_BIN_PATHS, process.env.PATH || ''].join(':'),
  OPENCLI_COMMAND,
};

function parseArgs(argv) {
  const result = {
    accountsFile: DEFAULT_ACCOUNTS_FILE,
    accounts: '',
    output: DEFAULT_OUTPUT_FILE,
    concurrency: 3,
    timeoutMs: 90000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--accounts-file') result.accountsFile = argv[++index] || result.accountsFile;
    else if (arg === '--accounts') result.accounts = argv[++index] || '';
    else if (arg === '--output') result.output = argv[++index] || result.output;
    else if (arg === '--concurrency') result.concurrency = Math.max(1, Number(argv[++index] || result.concurrency));
    else if (arg === '--timeout-ms') result.timeoutMs = Math.max(10000, Number(argv[++index] || result.timeoutMs));
  }

  return result;
}

function cleanHandle(handle = '') {
  return String(handle).trim().replace(/^@/, '');
}

function loadAccounts(args) {
  if (args.accounts) {
    return args.accounts.split(',').map(cleanHandle).filter(Boolean);
  }

  return fs.readFileSync(args.accountsFile, 'utf8')
    .split(/\r?\n/)
    .map(cleanHandle)
    .filter((line) => line && !line.startsWith('#'));
}

function loadExisting(outputFile) {
  try {
    const payload = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    return {
      updatedAt: payload.updatedAt || '',
      accounts: payload.accounts && typeof payload.accounts === 'object' ? payload.accounts : {},
    };
  } catch {
    return { updatedAt: '', accounts: {} };
  }
}

function extractJsonArray(text) {
  const raw = String(text || '');
  let start = raw.indexOf('[');
  while (start !== -1) {
    let end = raw.lastIndexOf(']');
    while (end > start) {
      const candidate = raw.slice(start, end + 1);
      try {
        const payload = JSON.parse(candidate);
        if (Array.isArray(payload)) return payload;
      } catch {
        end = raw.lastIndexOf(']', end - 1);
        continue;
      }
      end = raw.lastIndexOf(']', end - 1);
    }
    start = raw.indexOf('[', start + 1);
  }
  return [];
}

function runProfile(handle, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn(OPENCLI_COMMAND, ['twitter', 'profile', handle, '-f', 'json'], {
      cwd: process.cwd(),
      env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // best effort
      }
      finish({ ok: false, handle, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    proc.stdout.on('data', (data) => { stdout += data.toString('utf8'); });
    proc.stderr.on('data', (data) => { stderr += data.toString('utf8'); });
    proc.on('close', (code) => {
      if (code !== 0) {
        finish({ ok: false, handle, error: stderr || `exit ${code}` });
        return;
      }

      const profile = extractJsonArray(stdout)[0];
      if (!profile || typeof profile !== 'object') {
        finish({ ok: false, handle, error: 'empty profile payload' });
        return;
      }

      finish({ ok: true, handle, profile });
    });
    proc.on('error', (error) => {
      finish({ ok: false, handle, error: error.message });
    });
  });
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }));

  return results;
}

const args = parseArgs(process.argv.slice(2));
const accounts = Array.from(new Set(loadAccounts(args)));
const existing = loadExisting(args.output);
const results = await runWithConcurrency(accounts, args.concurrency, (handle) => runProfile(handle, args.timeoutMs));
const mergedAccounts = { ...existing.accounts };
const warnings = [];

results.forEach((result) => {
  if (!result?.ok) {
    warnings.push(`${result?.handle || 'unknown'}: ${result?.error || 'failed'}`);
    return;
  }

  const handle = cleanHandle(result.profile.screen_name || result.handle);
  const key = handle.toLowerCase();
  mergedAccounts[key] = {
    handle,
    name: result.profile.name || handle,
    followers: Number(result.profile.followers || 0),
    following: Number(result.profile.following || 0),
    tweets: Number(result.profile.tweets || 0),
    verified: Boolean(result.profile.verified),
    updatedAt: new Date().toISOString(),
  };
});

const output = {
  updatedAt: new Date().toISOString(),
  source: 'opencli twitter profile',
  accountCount: Object.keys(mergedAccounts).length,
  accounts: mergedAccounts,
  warnings,
};

fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, `${JSON.stringify(output, null, 2)}\n`);

try {
  fs.rmSync(`${args.output}.lock`, { force: true });
} catch {
  // best effort
}

console.log(JSON.stringify({
  ok: true,
  output: args.output,
  requested: accounts.length,
  updated: results.filter((result) => result?.ok).length,
  total: Object.keys(mergedAccounts).length,
  warnings: warnings.slice(0, 5),
}, null, 2));
