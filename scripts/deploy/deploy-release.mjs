#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path, { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/i;
const SERVICE_LABEL = 'com.shifeng-investment.server';
const DEFAULT_DEPLOY_ROOT = join(homedir(), 'services', 'shifeng-investment');
const DEFAULT_DEPLOY_ENV_FILE = join(homedir(), '.config', 'shifeng-investment', 'deploy.env');
const ALLOWED_DEPLOY_ENV_KEYS = new Set([
  'SHIFENG_DEPLOY_ROOT',
  'SHIFENG_LEGACY_ROOT',
  'SHIFENG_KEEP_RELEASES',
]);
const DEFAULT_JSON_CONTENT = new Map([
  ['server/data/calendar/events.json', { schemaVersion: 1, updatedAt: null, sources: {}, events: [] }],
  ['server/data/funds.json', { funds: [], lastUpdated: null }],
  ['server/data/news.json', { entries: [], lastUpdated: null }],
  ['server/data/macd_cache.json', {}],
  ['server/data/tungsten-price-history.json', { version: 1, updatedAt: null, series: {} }],
  ['server/data/x-followers.json', { updatedAt: null, source: null, accountCount: 0, accounts: {}, warnings: [] }],
]);

function assertFullGitSha(sha) {
  if (!FULL_SHA_PATTERN.test(String(sha || ''))) {
    throw new Error('release sha must be a full 40-character git sha');
  }
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertInside(root, target, label, { allowRoot = false } = {}) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  const relation = relative(normalizedRoot, normalizedTarget);
  if ((!allowRoot && relation === '') || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`${label} must stay inside the deployment root`);
  }
  return normalizedTarget;
}

function validateDeployRoot(deployRoot) {
  const normalized = resolve(deployRoot);
  if (normalized === resolve('/') || normalized === resolve(homedir())) {
    throw new Error('deployment root is too broad');
  }
  return normalized;
}

export function validatePersistentPath(input) {
  const raw = String(input || '').trim().replaceAll('\\', '/');
  if (!raw) throw new Error('persistent path cannot be empty');
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
    throw new Error('persistent path must be relative');
  }
  const segments = raw.split('/');
  if (segments.includes('..')) throw new Error('persistent path cannot contain parent traversal');
  const directory = raw.endsWith('/');
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new Error('persistent path must be a project-relative file or directory');
  }
  return directory ? `${normalized}/` : normalized;
}

export async function readPersistentPaths(manifestPath) {
  const lines = (await readFile(manifestPath, 'utf8')).split(/\r?\n/);
  const seen = new Set();
  const paths = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const validated = validatePersistentPath(trimmed);
    if (!seen.has(validated)) {
      seen.add(validated);
      paths.push(validated);
    }
  }
  if (paths.length === 0) throw new Error('persistent path manifest is empty');
  return paths;
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function verifyChecksum(archivePath, checksumPath) {
  const expected = (await readFile(checksumPath, 'utf8')).trim().split(/\s+/)[0];
  if (!CHECKSUM_PATTERN.test(expected)) throw new Error('release checksum file is invalid');
  const actual = await sha256File(archivePath);
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error('release checksum mismatch');
}

function validateArchiveEntry(entry) {
  const normalized = String(entry || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized) return;
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new Error(`release archive contains an absolute path: ${entry}`);
  }
  if (normalized.split('/').includes('..')) {
    throw new Error(`release archive contains parent traversal: ${entry}`);
  }
}

async function verifyArchiveEntries(archivePath) {
  const { stdout } = await execFileAsync('tar', ['-tzf', archivePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  stdout.split(/\r?\n/).filter(Boolean).forEach(validateArchiveEntry);
}

async function writeDefaultPersistentFile(sharedPath, persistentPath) {
  const content = DEFAULT_JSON_CONTENT.has(persistentPath)
    ? `${JSON.stringify(DEFAULT_JSON_CONTENT.get(persistentPath), null, 2)}\n`
    : persistentPath.endsWith('.json')
      ? '{}\n'
      : '';
  await writeFile(sharedPath, content);
}

async function linkPersistentPaths({ stagingDir, sharedRuntimeDir, legacyRoot, persistentPaths, deployRoot }) {
  for (const persistentPathWithType of persistentPaths) {
    const isDirectory = persistentPathWithType.endsWith('/');
    const persistentPath = persistentPathWithType.replace(/\/$/, '');
    const sharedPath = assertInside(deployRoot, join(sharedRuntimeDir, persistentPath), 'shared runtime path');
    const releasePath = assertInside(deployRoot, join(stagingDir, persistentPath), 'release runtime path');

    if (!await pathExists(sharedPath)) {
      const legacyPath = legacyRoot ? resolve(legacyRoot, persistentPath) : null;
      await mkdir(dirname(sharedPath), { recursive: true });
      if (legacyPath && await pathExists(legacyPath)) {
        await cp(legacyPath, sharedPath, { recursive: true, preserveTimestamps: true, dereference: false });
      } else if (await pathExists(releasePath)) {
        await cp(releasePath, sharedPath, { recursive: true, preserveTimestamps: true, dereference: false });
      } else if (isDirectory) {
        await mkdir(sharedPath, { recursive: true });
      } else {
        await writeDefaultPersistentFile(sharedPath, persistentPath);
      }
    }

    await rm(releasePath, { recursive: true, force: true });
    await mkdir(dirname(releasePath), { recursive: true });
    await symlink(sharedPath, releasePath);
  }
}

async function readCurrentTarget(currentLink, deployRoot) {
  if (!await pathExists(currentLink)) return null;
  const target = await readlink(currentLink);
  const resolved = resolve(dirname(currentLink), target);
  return assertInside(deployRoot, resolved, 'current release target');
}

async function replaceCurrentSymlink(currentLink, target, deployRoot) {
  const safeTarget = assertInside(deployRoot, target, 'new current release target');
  const temporaryLink = assertInside(
    deployRoot,
    join(deployRoot, `.current-${process.pid}-${Date.now()}`),
    'temporary current link',
  );
  await rm(temporaryLink, { recursive: true, force: true });
  await symlink(safeTarget, temporaryLink);
  await rename(temporaryLink, currentLink);
}

export async function pruneReleases({ releasesDir, activeReleaseDir, keep = 3, deployRoot = dirname(releasesDir) }) {
  const safeReleasesDir = assertInside(deployRoot, releasesDir, 'releases directory');
  const safeActive = assertInside(deployRoot, activeReleaseDir, 'active release');
  const entries = await readdir(safeReleasesDir, { withFileTypes: true });
  const releases = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !FULL_SHA_PATTERN.test(entry.name)) continue;
    const releasePath = assertInside(deployRoot, join(safeReleasesDir, entry.name), 'release cleanup target');
    const stats = await lstat(releasePath);
    releases.push({ path: releasePath, name: entry.name, mtimeMs: stats.mtimeMs });
  }
  releases.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
  const retained = new Set([safeActive]);
  for (const release of releases) {
    if (retained.size >= keep) break;
    retained.add(release.path);
  }
  const removed = [];
  for (const release of releases) {
    if (retained.has(release.path)) continue;
    await rm(release.path, { recursive: true, force: true });
    removed.push(release.path);
  }
  return removed;
}

async function appendDeploymentLog(deployRoot, message) {
  const logPath = assertInside(deployRoot, join(deployRoot, 'shared', 'logs', 'deployments.log'), 'deployment log');
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`);
}

function defaultDependencies(deployRoot) {
  return {
    installDependencies: async (releaseDir) => {
      await execFileAsync('npm', ['ci', '--omit=dev'], {
        cwd: releaseDir,
        env: process.env,
        maxBuffer: 16 * 1024 * 1024,
      });
    },
    restartService: async () => {
      const serviceScript = join(deployRoot, 'current', 'scripts', 'deploy', 'service-macos.sh');
      const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
      const command = await pathExists(plistPath) ? 'restart' : 'install';
      await execFileAsync('/bin/bash', [serviceScript, command], {
        env: { ...process.env, SHIFENG_DEPLOY_ROOT: deployRoot },
        maxBuffer: 16 * 1024 * 1024,
      });
    },
    checkHealth: async (expectedSha) => {
      const deadline = Date.now() + 45_000;
      let lastError = new Error('server did not become healthy');
      while (Date.now() < deadline) {
        try {
          const response = await fetch('http://127.0.0.1:3000/api/health');
          const body = await response.json();
          if (response.ok && body?.status === 'ok') {
            const metadataResponse = await fetch('http://127.0.0.1:3000/api/build-meta');
            const metadata = await metadataResponse.json();
            if (!metadataResponse.ok || metadata?.git !== expectedSha) {
              throw new Error(`build metadata sha mismatch: expected ${expectedSha}, received ${metadata?.git || 'missing'}`);
            }
            return;
          }
          lastError = new Error(`health endpoint returned ${response.status}`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
      }
      throw lastError;
    },
    now: () => new Date(),
  };
}

export async function deployRelease(options, dependencyOverrides = {}) {
  const {
    archivePath,
    checksumPath,
    sha,
    legacyRoot = null,
    keepReleases = 3,
  } = options || {};
  assertFullGitSha(sha);
  if (!archivePath) throw new Error('--archive is required');
  if (!checksumPath) throw new Error('--checksum is required');
  const deployRoot = validateDeployRoot(options?.deployRoot || DEFAULT_DEPLOY_ROOT);
  const keep = Number(keepReleases);
  if (!Number.isInteger(keep) || keep < 1 || keep > 10) throw new Error('keep releases must be an integer from 1 to 10');

  await mkdir(deployRoot, { recursive: true });
  const releasesDir = assertInside(deployRoot, join(deployRoot, 'releases'), 'releases directory');
  const sharedRuntimeDir = assertInside(deployRoot, join(deployRoot, 'shared', 'runtime'), 'shared runtime directory');
  const lockDir = assertInside(deployRoot, join(deployRoot, 'deploy.lock'), 'deployment lock');
  const currentLink = assertInside(deployRoot, join(deployRoot, 'current'), 'current link');
  await mkdir(releasesDir, { recursive: true });
  await mkdir(sharedRuntimeDir, { recursive: true });

  try {
    await mkdir(lockDir);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('deployment already running');
    throw error;
  }

  let stagingDir = null;
  try {
    await verifyChecksum(resolve(archivePath), resolve(checksumPath));
    await verifyArchiveEntries(resolve(archivePath));
    stagingDir = await mkdtemp(join(releasesDir, `.${sha}.staging-`));
    assertInside(deployRoot, stagingDir, 'release staging directory');
    await execFileAsync('tar', ['-xzf', resolve(archivePath), '-C', stagingDir], { maxBuffer: 16 * 1024 * 1024 });

    const metadataPath = assertInside(deployRoot, join(stagingDir, 'dist', 'build-meta.json'), 'build metadata');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (metadata?.git !== sha) {
      throw new Error(`build metadata sha mismatch: expected ${sha}, received ${metadata?.git || 'missing'}`);
    }

    const persistentPaths = await readPersistentPaths(join(stagingDir, 'scripts', 'deploy', 'persistent-paths.txt'));
    const dependencies = { ...defaultDependencies(deployRoot), ...dependencyOverrides };
    await dependencies.installDependencies(stagingDir);
    await linkPersistentPaths({
      stagingDir,
      sharedRuntimeDir,
      legacyRoot: legacyRoot ? resolve(legacyRoot) : null,
      persistentPaths,
      deployRoot,
    });

    const finalReleaseDir = assertInside(deployRoot, join(releasesDir, sha), 'final release directory');
    const previousTarget = await readCurrentTarget(currentLink, deployRoot);
    if (await pathExists(finalReleaseDir)) {
      if (previousTarget === finalReleaseDir) {
        await rm(stagingDir, { recursive: true, force: true });
        stagingDir = null;
        await dependencies.restartService();
        await dependencies.checkHealth(sha);
        return { releaseDir: finalReleaseDir, previousReleaseDir: previousTarget, reused: true };
      }
      await rm(finalReleaseDir, { recursive: true, force: true });
    }
    await rename(stagingDir, finalReleaseDir);
    stagingDir = null;
    await replaceCurrentSymlink(currentLink, finalReleaseDir, deployRoot);

    try {
      await dependencies.restartService();
      await dependencies.checkHealth(sha);
    } catch (error) {
      if (previousTarget) {
        await replaceCurrentSymlink(currentLink, previousTarget, deployRoot);
        await dependencies.restartService();
      }
      await appendDeploymentLog(deployRoot, `FAILED sha=${sha} rolledBackTo=${previousTarget ? basename(previousTarget) : 'none'}`);
      throw error;
    }

    await pruneReleases({ releasesDir, activeReleaseDir: finalReleaseDir, keep, deployRoot });
    await appendDeploymentLog(deployRoot, `SUCCESS sha=${sha} previous=${previousTarget ? basename(previousTarget) : 'none'}`);
    return { releaseDir: finalReleaseDir, previousReleaseDir: previousTarget, reused: false };
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    await rm(lockDir, { recursive: true, force: true });
  }
}

export function parseDeployEnv(text) {
  const values = {};
  for (const [index, line] of String(text || '').split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) throw new Error(`invalid deploy.env line ${index + 1}`);
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!ALLOWED_DEPLOY_ENV_KEYS.has(key)) throw new Error(`unsupported deploy.env key: ${key}`);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadDeployEnv(filePath) {
  try {
    return parseDeployEnv(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function parseCliArgs(argv) {
  const allowed = new Set(['--archive', '--checksum', '--sha']);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag)) throw new Error(`unknown argument: ${flag || '(empty)'}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    values[flag.slice(2)] = value;
  }
  return values;
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const deployEnvFile = process.env.SHIFENG_DEPLOY_ENV_FILE || DEFAULT_DEPLOY_ENV_FILE;
  const fileEnv = await loadDeployEnv(deployEnvFile);
  const deployRoot = process.env.SHIFENG_DEPLOY_ROOT || fileEnv.SHIFENG_DEPLOY_ROOT || DEFAULT_DEPLOY_ROOT;
  const legacyRoot = process.env.SHIFENG_LEGACY_ROOT || fileEnv.SHIFENG_LEGACY_ROOT || null;
  const keepReleases = process.env.SHIFENG_KEEP_RELEASES || fileEnv.SHIFENG_KEEP_RELEASES || 3;
  const result = await deployRelease({ ...cli, deployRoot, legacyRoot, keepReleases });
  process.stdout.write(`Active release: ${basename(result.releaseDir)}\n`);
  process.stdout.write(`Previous release: ${result.previousReleaseDir ? basename(result.previousReleaseDir) : 'none'}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
