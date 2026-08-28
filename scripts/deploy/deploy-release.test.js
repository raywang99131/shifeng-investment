import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const MODULE_PATH = new URL('./deploy-release.mjs', import.meta.url);
const SHA_ONE = '1111111111111111111111111111111111111111';
const SHA_TWO = '2222222222222222222222222222222222222222';
const SHA_THREE = '3333333333333333333333333333333333333333';
const SHA_FOUR = '4444444444444444444444444444444444444444';

async function loadDeploymentModule() {
  try {
    return await import(MODULE_PATH.href);
  } catch {
    return {};
  }
}

async function writeFixtureFile(root, relativePath, content) {
  const absolutePath = join(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function createArchive(fixtureRoot, {
  sha,
  artifactNews = `{"version":"seed-${sha.slice(0, 1)}"}\n`,
  includeFundsSeed = false,
  metadataSha = sha,
} = {}) {
  const payloadRoot = await mkdtemp(join(tmpdir(), 'shifeng-deploy-payload-'));
  const artifactRoot = join(fixtureRoot, 'artifacts', sha);
  await mkdir(artifactRoot, { recursive: true });
  await writeFixtureFile(payloadRoot, 'package.json', '{"name":"fixture","type":"module"}\n');
  await writeFixtureFile(payloadRoot, 'package-lock.json', '{"name":"fixture","lockfileVersion":3}\n');
  await writeFixtureFile(payloadRoot, 'server/index.js', 'console.log("server");\n');
  await writeFixtureFile(payloadRoot, 'dist/index.html', '<main>fixture</main>\n');
  await writeFixtureFile(payloadRoot, 'dist/build-meta.json', `${JSON.stringify({ git: metadataSha })}\n`);
  await writeFixtureFile(payloadRoot, 'server/data/news.json', artifactNews);
  if (includeFundsSeed) {
    await writeFixtureFile(payloadRoot, 'server/data/funds.json', '{"funds":[{"id":"seed"}]}\n');
  }
  await writeFixtureFile(payloadRoot, 'scripts/deploy/persistent-paths.txt', [
    'server/data/news.json',
    'server/data/funds.json',
    'server/data/tmt-margin/',
    '',
  ].join('\n'));

  const archivePath = join(artifactRoot, `shifeng-investment-${sha}.tar.gz`);
  const checksumPath = join(artifactRoot, `shifeng-investment-${sha}.sha256`);
  await execFileAsync('tar', ['-czf', archivePath, '-C', payloadRoot, '.']);
  const checksum = await sha256File(archivePath);
  await writeFile(checksumPath, `${checksum}  ${basename(archivePath)}\n`);
  await rm(payloadRoot, { recursive: true, force: true });
  return { archivePath, checksumPath };
}

async function makeFixture({ legacyNews } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'shifeng-deploy-test-'));
  const deployRoot = join(root, 'deployment');
  const legacyRoot = join(root, 'legacy');
  if (legacyNews !== undefined) {
    await writeFixtureFile(legacyRoot, 'server/data/news.json', legacyNews);
  }
  return { root, deployRoot, legacyRoot };
}

function successfulDependencies(overrides = {}) {
  return {
    installDependencies: async () => {},
    restartService: async () => {},
    checkHealth: async () => {},
    now: () => new Date('2026-08-28T08:00:00.000Z'),
    ...overrides,
  };
}

async function deployFixture(module, fixture, {
  sha,
  artifactNews,
  includeFundsSeed,
  metadataSha,
  checksumPath: checksumOverride,
  dependencies = successfulDependencies(),
  keepReleases = 3,
} = {}) {
  const artifact = await createArchive(fixture.root, {
    sha,
    artifactNews,
    includeFundsSeed,
    metadataSha,
  });
  return module.deployRelease({
    archivePath: artifact.archivePath,
    checksumPath: checksumOverride || artifact.checksumPath,
    sha,
    deployRoot: fixture.deployRoot,
    legacyRoot: fixture.legacyRoot,
    keepReleases,
  }, dependencies);
}

async function currentSha(deployRoot) {
  return basename(await readlink(join(deployRoot, 'current')));
}

async function releaseShas(deployRoot) {
  return (await readdir(join(deployRoot, 'releases')))
    .filter((entry) => /^[0-9a-f]{40}$/.test(entry))
    .sort();
}

test('persistent manifest rejects absolute and parent traversal paths', async () => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.validatePersistentPath, 'function', 'deployment path validator is missing');
  assert.throws(() => module.validatePersistentPath('/tmp/data'), /relative/);
  assert.throws(() => module.validatePersistentPath('../outside'), /parent traversal/);
  assert.throws(() => module.validatePersistentPath('server/data/../../outside'), /parent traversal/);
  assert.equal(module.validatePersistentPath('server/data/news.json'), 'server/data/news.json');
});

test('first deployment migrates legacy data and links it into the release', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture({ legacyNews: '{"version":"legacy"}\n' });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await deployFixture(module, fixture, { sha: SHA_ONE });
  const sharedNews = join(fixture.deployRoot, 'shared/runtime/server/data/news.json');
  assert.equal(await readFile(sharedNews, 'utf8'), '{"version":"legacy"}\n');
  assert.equal(await realpath(join(result.releaseDir, 'server/data/news.json')), await realpath(sharedNews));
  assert.equal(await currentSha(fixture.deployRoot), SHA_ONE);
});

test('second deployment preserves shared data instead of replacing it with artifact seed data', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await deployFixture(module, fixture, { sha: SHA_ONE });
  const sharedNews = join(fixture.deployRoot, 'shared/runtime/server/data/news.json');
  await writeFile(sharedNews, '{"version":"live"}\n');
  await deployFixture(module, fixture, {
    sha: SHA_TWO,
    artifactNews: '{"version":"seed-two"}\n',
  });

  assert.equal(await readFile(join(fixture.deployRoot, 'current/server/data/news.json'), 'utf8'), '{"version":"live"}\n');
});

test('missing persistent JSON files are initialized with valid application data', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await deployFixture(module, fixture, { sha: SHA_ONE, includeFundsSeed: false });
  const funds = JSON.parse(await readFile(join(fixture.deployRoot, 'current/server/data/funds.json'), 'utf8'));
  assert.deepEqual(funds, { funds: [], lastUpdated: null });
});

test('checksum mismatch is rejected before a release is installed', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const badChecksum = join(fixture.root, 'bad.sha256');
  await writeFile(badChecksum, `${'0'.repeat(64)}  release.tar.gz\n`);

  await assert.rejects(() => deployFixture(module, fixture, {
    sha: SHA_ONE,
    checksumPath: badChecksum,
  }), /checksum mismatch/);
  await assert.rejects(() => readlink(join(fixture.deployRoot, 'current')));
});

test('build metadata mismatch is rejected before dependency installation', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  let installs = 0;

  await assert.rejects(() => deployFixture(module, fixture, {
    sha: SHA_ONE,
    metadataSha: SHA_TWO,
    dependencies: successfulDependencies({ installDependencies: async () => { installs += 1; } }),
  }), /build metadata sha mismatch/);
  assert.equal(installs, 0);
});

test('dependency installation failure leaves the current release unchanged', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await deployFixture(module, fixture, { sha: SHA_ONE });
  await assert.rejects(() => deployFixture(module, fixture, {
    sha: SHA_TWO,
    dependencies: successfulDependencies({
      installDependencies: async () => { throw new Error('npm failed'); },
    }),
  }), /npm failed/);
  assert.equal(await currentSha(fixture.deployRoot), SHA_ONE);
});

test('failed post-switch health check restores and restarts the previous release', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await deployFixture(module, fixture, { sha: SHA_ONE });
  let restarts = 0;

  await assert.rejects(() => deployFixture(module, fixture, {
    sha: SHA_TWO,
    dependencies: successfulDependencies({
      restartService: async () => { restarts += 1; },
      checkHealth: async (sha) => { if (sha === SHA_TWO) throw new Error('unhealthy'); },
    }),
  }), /unhealthy/);
  assert.equal(await currentSha(fixture.deployRoot), SHA_ONE);
  assert.equal(restarts, 2);
});

test('successful deployment keeps the active release and two previous releases', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  await deployFixture(module, fixture, { sha: SHA_ONE });
  await deployFixture(module, fixture, { sha: SHA_TWO });
  await deployFixture(module, fixture, { sha: SHA_THREE });
  await deployFixture(module, fixture, { sha: SHA_FOUR });

  assert.deepEqual(await releaseShas(fixture.deployRoot), [SHA_TWO, SHA_THREE, SHA_FOUR]);
  assert.equal(await currentSha(fixture.deployRoot), SHA_FOUR);
});

test('an existing deployment lock prevents concurrent release switching', async (t) => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.deployRelease, 'function', 'deployment installer is missing');
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(join(fixture.deployRoot, 'deploy.lock'), { recursive: true });

  await assert.rejects(() => deployFixture(module, fixture, { sha: SHA_ONE }), /deployment already running/);
});

test('deploy env parser accepts only literal machine deployment settings', async () => {
  const module = await loadDeploymentModule();
  assert.equal(typeof module.parseDeployEnv, 'function', 'deploy env parser is missing');
  assert.deepEqual(module.parseDeployEnv([
    '# local paths only',
    'SHIFENG_DEPLOY_ROOT="/Users/runner/services/shifeng-investment"',
    'SHIFENG_KEEP_RELEASES=3',
    '',
  ].join('\n')), {
    SHIFENG_DEPLOY_ROOT: '/Users/runner/services/shifeng-investment',
    SHIFENG_KEEP_RELEASES: '3',
  });
  assert.throws(() => module.parseDeployEnv('CLOUDFLARE_TUNNEL_TOKEN=$(steal-token)'), /unsupported/);
  assert.throws(() => module.parseDeployEnv('SHIFENG_DEPLOY_ROOT'), /invalid/);
});
