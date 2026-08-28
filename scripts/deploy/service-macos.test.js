import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const RUN_SERVER_SCRIPT = fileURLToPath(new URL('./run-production-server.sh', import.meta.url));
const SERVICE_SCRIPT = fileURLToPath(new URL('./service-macos.sh', import.meta.url));

async function writeExecutable(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function runCommand(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      ...options,
    });
    return { status: 0, ...result };
  } catch (error) {
    return {
      status: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

async function makeFixture({ occupiedPortPid = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'shifeng-macos-service-test-'));
  const home = join(root, 'home');
  const deployRoot = join(home, 'services', 'shifeng & investment');
  const current = join(deployRoot, 'current');
  const fakeNode = join(root, 'bin', 'node');
  const fakeLaunchctl = join(root, 'bin', 'launchctl');
  const fakeLsof = join(root, 'bin', 'lsof');
  const launchctlLog = join(root, 'launchctl.log');
  const serverEnv = join(home, '.config', 'shifeng-investment', 'server.env');

  await mkdir(join(current, 'server'), { recursive: true });
  await writeFile(join(current, 'server', 'index.js'), 'console.log("fixture");\n');
  await writeExecutable(fakeNode, [
    '#!/usr/bin/env bash',
    'printf "args=%s\\n" "$*"',
    'printf "HOST=%s\\n" "${HOST:-}"',
    'printf "PORT=%s\\n" "${PORT:-}"',
    'printf "APP_MARKER=%s\\n" "${APP_MARKER:-}"',
    'printf "cwd=%s\\n" "$PWD"',
    '',
  ].join('\n'));
  await writeExecutable(fakeLaunchctl, [
    '#!/usr/bin/env bash',
    'if [[ "${1:-}" == "print" ]]; then exit 1; fi',
    `printf '%s\\n' "$*" >> ${JSON.stringify(launchctlLog)}`,
    '',
  ].join('\n'));
  await writeExecutable(fakeLsof, [
    '#!/usr/bin/env bash',
    occupiedPortPid ? `printf '%s\\n' ${JSON.stringify(occupiedPortPid)}` : 'exit 1',
    '',
  ].join('\n'));
  await mkdir(dirname(serverEnv), { recursive: true });
  await writeFile(serverEnv, 'APP_MARKER=loaded-from-server-env\n');

  return {
    root,
    home,
    deployRoot,
    current,
    fakeNode,
    fakeLaunchctl,
    fakeLsof,
    launchctlLog,
    serverEnv,
  };
}

test('production launcher loads server env and execs the configured node binary', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runCommand('/bin/bash', [RUN_SERVER_SCRIPT], {
    env: {
      ...process.env,
      HOME: fixture.home,
      SHIFENG_DEPLOY_ROOT: fixture.deployRoot,
      SHIFENG_NODE_BIN: fixture.fakeNode,
      SHIFENG_SERVER_ENV_FILE: fixture.serverEnv,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /args=server\/index\.js/);
  assert.match(result.stdout, /HOST=127\.0\.0\.1/);
  assert.match(result.stdout, /PORT=3000/);
  assert.match(result.stdout, /APP_MARKER=loaded-from-server-env/);
  assert.match(result.stdout, new RegExp(`cwd=${fixture.current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('service install renders and boots only the application launch agent', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(join(fixture.current, 'scripts', 'deploy'), { recursive: true });
  await writeFile(join(fixture.current, 'scripts', 'deploy', 'run-production-server.sh'), '#!/usr/bin/env bash\n');

  const result = await runCommand('/bin/bash', [SERVICE_SCRIPT, 'install'], {
    env: {
      ...process.env,
      HOME: fixture.home,
      SHIFENG_DEPLOY_ROOT: fixture.deployRoot,
      SHIFENG_NODE_BIN: fixture.fakeNode,
      SHIFENG_LAUNCHCTL_BIN: fixture.fakeLaunchctl,
      SHIFENG_LSOF_BIN: fixture.fakeLsof,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const plistPath = join(fixture.home, 'Library', 'LaunchAgents', 'com.shifeng-investment.server.plist');
  const plist = await readFile(plistPath, 'utf8');
  assert.match(plist, /com\.shifeng-investment\.server/);
  assert.match(plist, /run-production-server\.sh/);
  assert.match(plist, /shifeng &amp; investment/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.doesNotMatch(plist, /cloudflared|tunnel\.token/);

  const launchctlCalls = await readFile(fixture.launchctlLog, 'utf8');
  assert.match(launchctlCalls, /bootstrap gui\/\d+/);
  assert.match(launchctlCalls, /kickstart -k gui\/\d+\/com\.shifeng-investment\.server/);
});

test('service install refuses to kill an unknown process already listening on port 3000', async (t) => {
  const fixture = await makeFixture({ occupiedPortPid: '4242' });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await mkdir(join(fixture.current, 'scripts', 'deploy'), { recursive: true });
  await writeFile(join(fixture.current, 'scripts', 'deploy', 'run-production-server.sh'), '#!/usr/bin/env bash\n');

  const result = await runCommand('/bin/bash', [SERVICE_SCRIPT, 'install'], {
    env: {
      ...process.env,
      HOME: fixture.home,
      SHIFENG_DEPLOY_ROOT: fixture.deployRoot,
      SHIFENG_NODE_BIN: fixture.fakeNode,
      SHIFENG_LAUNCHCTL_BIN: fixture.fakeLaunchctl,
      SHIFENG_LSOF_BIN: fixture.fakeLsof,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /port 3000.*PID 4242/i);
  assert.doesNotMatch(result.stderr, /killed|terminated/i);
});

test('service restart kickstarts the existing application service without reinstalling it', async (t) => {
  const fixture = await makeFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));

  const result = await runCommand('/bin/bash', [SERVICE_SCRIPT, 'restart'], {
    env: {
      ...process.env,
      HOME: fixture.home,
      SHIFENG_DEPLOY_ROOT: fixture.deployRoot,
      SHIFENG_LAUNCHCTL_BIN: fixture.fakeLaunchctl,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const launchctlCalls = await readFile(fixture.launchctlLog, 'utf8');
  assert.match(launchctlCalls, /^kickstart -k gui\/\d+\/com\.shifeng-investment\.server\n$/);
});
