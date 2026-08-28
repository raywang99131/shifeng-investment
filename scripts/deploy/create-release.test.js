import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(new URL('./create-release.mjs', import.meta.url));
const FIXTURE_SHA = '1234567890abcdef1234567890abcdef12345678';

async function writeFixtureFile(root, relativePath, content) {
  const absolutePath = join(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

async function makeFixture({ withDist = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'shifeng-release-builder-test-'));
  const outputDir = join(root, 'release-output');
  await execFileAsync('git', ['init', '-q'], { cwd: root });

  await writeFixtureFile(root, 'server/index.js', 'console.log("server");\n');
  await writeFixtureFile(root, 'scripts/example.py', 'print("python")\n');
  await writeFixtureFile(root, 'package.json', '{"name":"fixture","type":"module"}\n');
  await writeFixtureFile(root, 'package-lock.json', '{"name":"fixture","lockfileVersion":3}\n');
  await writeFixtureFile(root, '.env.local', 'SECRET=tracked-but-forbidden\n');
  await writeFixtureFile(root, 'node_modules/junk/index.js', 'forbidden\n');
  await execFileAsync('git', [
    'add', '-f',
    'server/index.js',
    'scripts/example.py',
    'package.json',
    'package-lock.json',
    '.env.local',
    'node_modules/junk/index.js',
  ], { cwd: root });

  await writeFixtureFile(root, 'server/data/tmt-margin/private.json', '{"private":true}\n');
  if (withDist) await writeFixtureFile(root, 'dist/index.html', '<main>production</main>\n');
  return { root, outputDir };
}

async function runBuilder(fixture, { sha = FIXTURE_SHA, runId = '98765' } = {}) {
  try {
    const result = await execFileAsync(process.execPath, [
      SCRIPT_PATH,
      '--sha', sha,
      '--run-id', runId,
      '--output-dir', fixture.outputDir,
    ], { cwd: fixture.root });
    return { status: 0, ...result };
  } catch (error) {
    return {
      status: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

async function listArchive(archivePath) {
  const { stdout } = await execFileAsync('tar', ['-tzf', archivePath]);
  return stdout.trim().split('\n').map((entry) => entry.replace(/^\.\//, '').replace(/\/$/, ''));
}

async function readArchiveJson(archivePath, relativePath) {
  const extractRoot = await mkdtemp(join(tmpdir(), 'shifeng-release-extract-'));
  try {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', extractRoot]);
    return JSON.parse(await readFile(join(extractRoot, relativePath), 'utf8'));
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

test('release contains tracked app code and built frontend but excludes local state', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runBuilder(fixture);
  assert.equal(result.status, 0, result.stderr);

  const archivePath = join(fixture.outputDir, `shifeng-investment-${FIXTURE_SHA}.tar.gz`);
  const entries = await listArchive(archivePath);
  assert(entries.includes('server/index.js'));
  assert(entries.includes('scripts/example.py'));
  assert(entries.includes('dist/index.html'));
  assert(entries.includes('dist/build-meta.json'));
  assert(!entries.some((entry) => entry.includes('.env')));
  assert(!entries.some((entry) => entry.includes('node_modules')));
  assert(!entries.includes('server/data/tmt-margin/private.json'));
});

test('release checksum matches the completed archive bytes', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runBuilder(fixture);
  assert.equal(result.status, 0, result.stderr);

  const archivePath = join(fixture.outputDir, `shifeng-investment-${FIXTURE_SHA}.tar.gz`);
  const checksumPath = join(fixture.outputDir, `shifeng-investment-${FIXTURE_SHA}.sha256`);
  const actual = await sha256File(archivePath);
  const checksumText = await readFile(checksumPath, 'utf8');
  assert.equal(checksumText, `${actual}  shifeng-investment-${FIXTURE_SHA}.tar.gz\n`);
});

test('release metadata records the full git sha and workflow run id', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runBuilder(fixture, { runId: '12345' });
  assert.equal(result.status, 0, result.stderr);

  const archivePath = join(fixture.outputDir, `shifeng-investment-${FIXTURE_SHA}.tar.gz`);
  const metadata = await readArchiveJson(archivePath, 'dist/build-meta.json');
  assert.equal(metadata.git, FIXTURE_SHA);
  assert.equal(metadata.runId, '12345');
  assert.match(metadata.builtAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('release builder rejects a missing production frontend', async (t) => {
  const fixture = await makeFixture({ withDist: false });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runBuilder(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dist\/index\.html is missing/);
});

test('release builder rejects a non-full git sha', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runBuilder(fixture, { sha: 'abc123' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /full 40-character git sha/);
});
