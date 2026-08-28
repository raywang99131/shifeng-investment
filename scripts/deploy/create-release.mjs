#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const EXCLUDED_RELEASE_PATHS = [
  /(^|\/)\.git(?:\/|$)/,
  /(^|\/)node_modules(?:\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)server\.env$/,
  /(^|\/)(?:tunnel|runner).*(?:token|credentials?)(?:\.|$)/i,
  /(^|\/)\.DS_Store$/,
  /\.log$/i,
];

function assertFullGitSha(sha) {
  if (!FULL_SHA_PATTERN.test(String(sha || ''))) {
    throw new Error('release sha must be a full 40-character git sha');
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function execFileText(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  return stdout;
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export function isExcludedReleasePath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  return EXCLUDED_RELEASE_PATHS.some((pattern) => pattern.test(normalized));
}

export async function createRelease({
  projectRoot = process.cwd(),
  outputDir,
  sha,
  runId,
  builtAt = new Date(),
} = {}) {
  assertFullGitSha(sha);
  if (!outputDir) throw new Error('--output-dir is required');
  if (runId === undefined || runId === null || String(runId).trim() === '') {
    throw new Error('--run-id is required');
  }

  const normalizedProjectRoot = resolve(projectRoot);
  const normalizedOutputDir = isAbsolute(outputDir) ? resolve(outputDir) : resolve(normalizedProjectRoot, outputDir);
  const distRoot = join(normalizedProjectRoot, 'dist');
  if (!await pathExists(join(distRoot, 'index.html'))) {
    throw new Error('dist/index.html is missing; run npm run build first');
  }

  await mkdir(normalizedOutputDir, { recursive: true });
  const stagingRoot = await mkdtemp(join(tmpdir(), 'shifeng-release-'));
  try {
    const trackedOutput = await execFileText('git', ['ls-files', '-z'], { cwd: normalizedProjectRoot });
    const trackedFiles = trackedOutput
      .split('\0')
      .filter(Boolean)
      .filter((relativePath) => !relativePath.startsWith('dist/'))
      .filter((relativePath) => !isExcludedReleasePath(relativePath));

    for (const relativePath of trackedFiles) {
      const source = join(normalizedProjectRoot, relativePath);
      const destination = join(stagingRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { dereference: false, preserveTimestamps: true });
    }

    await cp(distRoot, join(stagingRoot, 'dist'), {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      filter: (source) => !isExcludedReleasePath(source.slice(distRoot.length + 1)),
    });

    const builtAtIso = builtAt instanceof Date ? builtAt.toISOString() : new Date(builtAt).toISOString();
    const buildMeta = {
      buildId: `${builtAtIso} (git:${sha.slice(0, 12)})`,
      builtAt: builtAtIso,
      git: sha,
      runId: String(runId),
    };
    await writeFile(join(stagingRoot, 'dist', 'build-meta.json'), `${JSON.stringify(buildMeta, null, 2)}\n`);

    const archiveName = `shifeng-investment-${sha}.tar.gz`;
    const archivePath = join(normalizedOutputDir, archiveName);
    const checksumPath = join(normalizedOutputDir, `shifeng-investment-${sha}.sha256`);
    await execFileAsync('tar', ['-czf', archivePath, '-C', stagingRoot, '.']);
    const sha256 = await sha256File(archivePath);
    await writeFile(checksumPath, `${sha256}  ${basename(archivePath)}\n`);

    return { archivePath, checksumPath, sha256 };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function parseCliArgs(argv) {
  const allowed = new Set(['--sha', '--run-id', '--output-dir']);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag)) throw new Error(`unknown argument: ${flag || '(empty)'}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
    values[flag.slice(2)] = value;
  }
  return {
    sha: values.sha,
    runId: values['run-id'],
    outputDir: values['output-dir'],
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await createRelease(options);
  process.stdout.write(`Release archive: ${result.archivePath}\n`);
  process.stdout.write(`Release checksum: ${result.checksumPath}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
