# Shifeng Investment Whole-App Automatic Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Actions pipeline that packages the complete Shifeng Investment application and safely deploys it to the always-on Mac after every merge to `main`.

**Architecture:** A GitHub-hosted build job creates a checksum-protected release artifact from tracked application files plus the compiled `dist`. A `[self-hosted, shifeng-prod]` job installs that artifact into versioned releases on the always-on Mac, links persistent runtime data from a shared directory, switches an atomic `current` symlink, restarts a dedicated launchd service, verifies health/build metadata, and rolls back on failure. Cloudflare Tunnel remains an independent process forwarding the domain to `127.0.0.1:3000`.

**Tech Stack:** GitHub Actions YAML, Node.js 24, npm, Node built-in test runner, Bash, macOS launchd, Express health/build-meta endpoints.

**Spec:** `docs/superpowers/specs/2026-08-28-whole-app-automatic-deployment-design.md`

## Global Constraints

- Automatic production deployment triggers only from `main`; manual `workflow_dispatch` is also allowed.
- The production runner selector is exactly `[self-hosted, shifeng-prod]`.
- Build and deployment require Node.js 24.
- The default deployment root is `$HOME/services/shifeng-investment`; `SHIFENG_DEPLOY_ROOT` may override it.
- Application secrets stay in `$HOME/.config/shifeng-investment/server.env`; machine-only deployment settings stay in `$HOME/.config/shifeng-investment/deploy.env`.
- Never package `.git`, `node_modules`, `.env*`, `server.env`, Tunnel tokens, runner tokens, logs, or untracked runtime data.
- Never restart, reconfigure, or read credentials from Cloudflare Tunnel during application deployment.
- Preserve every path listed in `scripts/deploy/persistent-paths.txt` under `shared/runtime`.
- Keep the active release plus the two newest previous releases.
- A failed health or build-metadata check must restore the previous `current` target.
- Tests use temporary directories and injected service/health functions; they must not touch real launchd, Tunnel processes, or `$HOME/services`.

---

### Task 1: Deterministic release artifact builder

**Files:**
- Create: `scripts/deploy/create-release.mjs`
- Create: `scripts/deploy/create-release.test.js`

**Interfaces:**
- Consumes: a Git working tree containing a completed `dist`, `--sha <40-hex>`, `--run-id <string>`, and `--output-dir <path>`.
- Produces: `<output-dir>/shifeng-investment-<sha>.tar.gz`, matching `.sha256`, and a `dist/build-meta.json` whose `git` field is the full SHA.
- Exports: `isExcludedReleasePath(relativePath: string): boolean` and `createRelease(options): Promise<{ archivePath: string, checksumPath: string, sha256: string }>`.

- [ ] **Step 1: Write the failing release-builder tests**

Create a temporary Git fixture, stage representative frontend/backend/Python files, leave `.env.local`, `node_modules/junk`, and `server/data/tmt-margin/private.json` untracked, then invoke the builder and inspect the tar listing:

```js
test('release contains tracked app code and dist but excludes local state', async () => {
  const result = await runFixtureBuilder();
  const entries = await listTarEntries(result.archivePath);
  assert(entries.includes('server/index.js'));
  assert(entries.includes('scripts/example.py'));
  assert(entries.includes('dist/index.html'));
  assert(entries.includes('dist/build-meta.json'));
  assert(!entries.some((entry) => entry.includes('.env')));
  assert(!entries.some((entry) => entry.includes('node_modules')));
  assert(!entries.includes('server/data/tmt-margin/private.json'));
});

test('release checksum matches the archive bytes', async () => {
  const result = await runFixtureBuilder();
  assert.equal(await sha256File(result.archivePath), result.sha256);
  assert.match(await readFile(result.checksumPath, 'utf8'), new RegExp(`^${result.sha256}  `));
});

test('release metadata records the full git sha and run id', async () => {
  const result = await runFixtureBuilder({ sha: FIXTURE_SHA, runId: '12345' });
  const metadata = await readTarJson(result.archivePath, 'dist/build-meta.json');
  assert.equal(metadata.git, FIXTURE_SHA);
  assert.equal(metadata.runId, '12345');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/deploy/create-release.test.js`

Expected: FAIL because `scripts/deploy/create-release.mjs` does not exist.

- [ ] **Step 3: Implement the minimal deterministic builder**

Implement `createRelease()` with Node built-ins and system `git`/`tar`:

```js
const excluded = [
  /(^|\/)\.git(?:\/|$)/,
  /(^|\/)node_modules(?:\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)server\.env$/,
  /(^|\/)(?:tunnel|runner).*(?:token|credentials?)(?:\.|$)/i,
];

export function isExcludedReleasePath(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  return excluded.some((pattern) => pattern.test(normalized));
}

export async function createRelease({ projectRoot, outputDir, sha, runId }) {
  assertFullGitSha(sha);
  const tracked = (await execFileText('git', ['ls-files', '-z'], { cwd: projectRoot }))
    .split('\0').filter(Boolean).filter((file) => !isExcludedReleasePath(file) && !file.startsWith('dist/'));
  const stagingRoot = await mkdtemp(join(tmpdir(), 'shifeng-release-'));
  for (const relativePath of tracked) {
    const destination = join(stagingRoot, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(projectRoot, relativePath), destination);
  }
  await cp(join(projectRoot, 'dist'), join(stagingRoot, 'dist'), { recursive: true });
  await writeFile(join(stagingRoot, 'dist/build-meta.json'), JSON.stringify({
    buildId: `${new Date().toISOString()} (git:${sha.slice(0, 12)})`,
    builtAt: new Date().toISOString(),
    git: sha,
    runId,
  }, null, 2));
  const archivePath = join(outputDir, `shifeng-investment-${sha}.tar.gz`);
  await execFileAsync('tar', ['-czf', archivePath, '-C', stagingRoot, '.']);
  const sha256 = await sha256File(archivePath);
  const checksumPath = join(outputDir, `shifeng-investment-${sha}.sha256`);
  await writeFile(checksumPath, `${sha256}  ${basename(archivePath)}\n`);
  return { archivePath, checksumPath, sha256 };
}
```

The CLI must parse only the three documented flags, print artifact paths without environment contents, and exit nonzero for a missing `dist/index.html` or invalid SHA.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test scripts/deploy/create-release.test.js`

Expected: PASS for inclusion, exclusion, checksum, metadata, missing-dist, and invalid-SHA cases.

- [ ] **Step 5: Commit the release builder**

```bash
git add scripts/deploy/create-release.mjs scripts/deploy/create-release.test.js
git commit -m "build: create deterministic production release"
```

---

### Task 2: Persistent runtime manifest and safe release installer

**Files:**
- Create: `scripts/deploy/persistent-paths.txt`
- Create: `scripts/deploy/deploy-release.mjs`
- Create: `scripts/deploy/deploy-release.test.js`
- Modify: `scripts/deploy/create-release.mjs`
- Modify: `scripts/deploy/create-release.test.js`

**Interfaces:**
- Consumes: `--archive <path>`, `--checksum <path>`, `--sha <40-hex>`, optional `SHIFENG_DEPLOY_ROOT`, `SHIFENG_LEGACY_ROOT`, and `SHIFENG_KEEP_RELEASES` (default `3`).
- Produces: `releases/<sha>`, `current -> releases/<sha>`, persistent links into `shared/runtime`, deployment logs, and rollback to the previous symlink on post-switch failure.
- Extends the builder output with a standalone `<output-dir>/deploy-release.mjs` copied from the tracked deployment module, allowing the production job to run without a Git checkout.
- Exports: `validatePersistentPath(path: string): string`, `readPersistentPaths(path: string): Promise<string[]>`, `deployRelease(options, dependencies): Promise<DeploymentResult>`, and `pruneReleases(options): Promise<string[]>`.
- `dependencies` has exact call signatures: `installDependencies(releaseDir): Promise<void>`, `restartService(): Promise<void>`, `checkHealth(expectedSha): Promise<void>`, and `now(): Date`.

- [ ] **Step 1: Write failing validation and persistence tests**

```js
test('persistent manifest rejects absolute and parent traversal paths', () => {
  assert.throws(() => validatePersistentPath('/tmp/data'), /relative/);
  assert.throws(() => validatePersistentPath('../outside'), /parent traversal/);
  assert.equal(validatePersistentPath('server/data/news.json'), 'server/data/news.json');
});

test('first deployment migrates legacy data and links it into the release', async () => {
  const fixture = await makeDeploymentFixture({ legacyNews: '{"version":"legacy"}' });
  const result = await deployFixture(fixture, { sha: SHA_ONE });
  assert.equal(await readFile(join(fixture.root, 'shared/runtime/server/data/news.json'), 'utf8'), '{"version":"legacy"}');
  assert.equal(await realpath(join(result.releaseDir, 'server/data/news.json')),
    join(fixture.root, 'shared/runtime/server/data/news.json'));
});

test('second deployment preserves shared data instead of replacing it with artifact seed data', async () => {
  const fixture = await makeDeploymentFixture();
  await deployFixture(fixture, { sha: SHA_ONE });
  await writeFile(join(fixture.root, 'shared/runtime/server/data/news.json'), '{"version":"live"}');
  await deployFixture(fixture, { sha: SHA_TWO, artifactNews: '{"version":"seed-two"}' });
  assert.equal(await readFile(join(fixture.root, 'current/server/data/news.json'), 'utf8'), '{"version":"live"}');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/deploy/deploy-release.test.js --test-name-pattern='persistent|manifest|migrates'`

Expected: FAIL because the manifest and deployment module do not exist.

- [ ] **Step 3: Add the exact persistent-path manifest**

```text
server/data/calendar/events.json
server/data/funds.json
server/data/news.json
server/data/macd_cache.json
server/data/price-tracking/
server/data/python-venv/
server/data/quant/
server/data/research/
server/data/tmt-margin/
server/data/ai-dashboard/
server/data/tungsten-price-history.json
server/data/x-followers.json
server/public/reports/
server/price_tracking/price_summarized_optimized.xlsx
server/price_tracking/.price_summarized_optimized.last-good.xlsx
server/price_tracking/price_summarized_optimized.akshare_update_log.csv
```

- [ ] **Step 4: Implement checksum, extraction, and shared-data linking**

Implement these rules in `deployRelease()`:

```js
const expected = (await readFile(checksumPath, 'utf8')).trim().split(/\s+/)[0];
const actual = await sha256File(archivePath);
if (actual !== expected) throw new Error('release checksum mismatch');

await mkdir(releasesDir, { recursive: true });
await mkdir(sharedRuntimeDir, { recursive: true });
await execFileAsync('tar', ['-xzf', archivePath, '-C', stagingDir]);
await dependencies.installDependencies(stagingDir);

for (const persistentPath of persistentPaths) {
  const sharedPath = join(sharedRuntimeDir, persistentPath);
  const releasePath = join(stagingDir, persistentPath);
  if (!await pathExists(sharedPath)) {
    const legacyPath = legacyRoot ? join(legacyRoot, persistentPath) : null;
    await mkdir(dirname(sharedPath), { recursive: true });
    if (legacyPath && await pathExists(legacyPath)) {
      await cp(legacyPath, sharedPath, { recursive: true, preserveTimestamps: true });
    } else if (await pathExists(releasePath)) {
      await cp(releasePath, sharedPath, { recursive: true, preserveTimestamps: true });
    } else if (persistentPath.endsWith('/')) {
      await mkdir(sharedPath, { recursive: true });
    } else {
      await writeFile(sharedPath, '');
    }
  }
  await rm(releasePath, { recursive: true, force: true });
  await mkdir(dirname(releasePath), { recursive: true });
  await symlink(sharedPath, releasePath);
}
```

Use `lstat`/`realpath` checks to ensure every staging, release, shared, and prune target remains below the normalized deployment root. Acquire the deployment lock with an exclusive lock directory; if it already exists, exit with `deployment already running`. Remove only the lock created by the current process.

- [ ] **Step 5: Run persistence tests and verify GREEN**

Run: `node --test scripts/deploy/deploy-release.test.js --test-name-pattern='persistent|manifest|migrates'`

Expected: PASS and no files created outside the test temporary root.

- [ ] **Step 6: Write failing switch, install-failure, rollback, and pruning tests**

```js
test('dependency installation failure leaves the current release unchanged', async () => {
  const fixture = await deployedFixture(SHA_ONE);
  await assert.rejects(() => deployFixture(fixture, {
    sha: SHA_TWO,
    installDependencies: async () => { throw new Error('npm failed'); },
  }), /npm failed/);
  assert.equal(await currentSha(fixture.root), SHA_ONE);
});

test('failed post-switch health check restores and restarts the previous release', async () => {
  const fixture = await deployedFixture(SHA_ONE);
  let restarts = 0;
  await assert.rejects(() => deployFixture(fixture, {
    sha: SHA_TWO,
    restartService: async () => { restarts += 1; },
    checkHealth: async (sha) => { if (sha === SHA_TWO) throw new Error('unhealthy'); },
  }), /unhealthy/);
  assert.equal(await currentSha(fixture.root), SHA_ONE);
  assert.equal(restarts, 2);
});

test('successful deployment keeps active plus two previous releases', async () => {
  const fixture = await deployedFixture(SHA_ONE, SHA_TWO, SHA_THREE);
  await deployFixture(fixture, { sha: SHA_FOUR });
  assert.deepEqual(await releaseShas(fixture.root), [SHA_TWO, SHA_THREE, SHA_FOUR]);
});
```

- [ ] **Step 7: Implement atomic switch, verified restart, rollback, and bounded pruning**

Use a temporary symlink inside the deployment root and `rename()` to replace `current`. After switching:

```js
const previousTarget = await readCurrentTarget(currentLink);
await replaceCurrentSymlink(currentLink, finalReleaseDir);
try {
  await dependencies.restartService();
  await dependencies.checkHealth(sha);
} catch (error) {
  if (previousTarget) {
    await replaceCurrentSymlink(currentLink, previousTarget);
    await dependencies.restartService();
  }
  throw error;
}
await pruneReleases({ releasesDir, activeReleaseDir: finalReleaseDir, keep: 3 });
```

The real `checkHealth(expectedSha)` polls `http://127.0.0.1:3000/api/health` for at most 45 seconds, then fetches `/api/build-meta` and requires `metadata.git === expectedSha`. The CLI loads `deploy.env` through a strict `KEY=VALUE` parser that accepts only `SHIFENG_DEPLOY_ROOT`, `SHIFENG_LEGACY_ROOT`, and `SHIFENG_KEEP_RELEASES`; it never evaluates shell text.

- [ ] **Step 8: Run the complete installer tests and verify GREEN**

Run: `node --test scripts/deploy/deploy-release.test.js`

Expected: PASS for checksum mismatch, lock contention, persistence, install failure, successful switch, health rollback, metadata mismatch, and pruning.

- [ ] **Step 9: Commit the safe release installer**

```bash
git add scripts/deploy/persistent-paths.txt scripts/deploy/deploy-release.mjs scripts/deploy/deploy-release.test.js
git commit -m "feat: install production releases with rollback"
```

---

### Task 3: Dedicated macOS application service

**Files:**
- Create: `scripts/deploy/run-production-server.sh`
- Create: `scripts/deploy/service-macos.sh`
- Create: `scripts/deploy/service-macos.test.js`

**Interfaces:**
- Consumes: `SHIFENG_DEPLOY_ROOT`, optional `$HOME/.config/shifeng-investment/server.env`, a `current` release link, and commands `install`, `restart`, or `status`.
- Produces: `$HOME/Library/LaunchAgents/com.shifeng-investment.server.plist`, Node logs in `shared/logs`, and a launchd-managed Node process bound to `127.0.0.1:3000`.
- `deploy-release.mjs` calls `scripts/deploy/service-macos.sh install` on first deployment and `restart` on every switch/rollback.

- [ ] **Step 1: Write failing service-contract tests**

```js
test('production launcher loads server env and execs the configured node binary', async () => {
  const fixture = await makeServiceFixture();
  const result = await runProductionLauncher(fixture, {
    SHIFENG_NODE_BIN: fixture.fakeNode,
    SHIFENG_SERVER_ENV_FILE: fixture.serverEnv,
  });
  assert.match(result.stdout, /server\/index\.js/);
  assert.match(result.stdout, /HOST=127\.0\.0\.1/);
  assert.match(result.stdout, /PORT=3000/);
});

test('service helper renders only the application launch agent', async () => {
  const plist = await renderFixturePlist();
  assert.match(plist, /com\.shifeng-investment\.server/);
  assert.match(plist, /run-production-server\.sh/);
  assert.doesNotMatch(plist, /cloudflared|tunnel\.token/);
  assert.match(plist, /RunAtLoad/);
  assert.match(plist, /KeepAlive/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/deploy/service-macos.test.js`

Expected: FAIL because both service scripts are missing.

- [ ] **Step 3: Implement the production launcher**

`run-production-server.sh` must use this behavior:

```bash
#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${SHIFENG_DEPLOY_ROOT:-$HOME/services/shifeng-investment}"
SERVER_ENV_FILE="${SHIFENG_SERVER_ENV_FILE:-$HOME/.config/shifeng-investment/server.env}"
if [[ -f "$SERVER_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SERVER_ENV_FILE"
  set +a
fi
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3000}"
cd "$DEPLOY_ROOT/current"
exec "${SHIFENG_NODE_BIN:-node}" server/index.js
```

The documentation will warn that `server.env` is trusted local shell syntax, readable only by the runner user, and must never be committed.

- [ ] **Step 4: Implement install/restart/status service commands**

`service-macos.sh` must resolve `node` once during `install`, XML-escape every interpolated path, write the plist with mode `600`, bootstrap it into `gui/$(id -u)`, and use `launchctl kickstart -k` for restart. Before first bootstrap, if another process owns port 3000, exit with a message that names the PID and asks the operator to stop the legacy server; never kill an unknown process automatically.

The plist template must interpolate XML-escaped runtime values and contain:

```xml
<key>Label</key><string>com.shifeng-investment.server</string>
<key>ProgramArguments</key>
<array><string>/bin/bash</string><string>${DEPLOY_ROOT_XML}/current/scripts/deploy/run-production-server.sh</string></array>
<key>WorkingDirectory</key><string>${DEPLOY_ROOT_XML}/current</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
```

It must set `SHIFENG_DEPLOY_ROOT` and the resolved `SHIFENG_NODE_BIN` in `EnvironmentVariables`, and write stdout/stderr to `DEPLOY_ROOT/shared/logs/server.out.log` and `server.err.log`.

- [ ] **Step 5: Run service tests and verify GREEN**

Run: `node --test scripts/deploy/service-macos.test.js`

Expected: PASS without calling the host's real `launchctl`.

- [ ] **Step 6: Commit the macOS service**

```bash
git add scripts/deploy/run-production-server.sh scripts/deploy/service-macos.sh scripts/deploy/service-macos.test.js
git commit -m "feat: manage production server with launchd"
```

---

### Task 4: Production GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy-production.yml`
- Create: `scripts/deploy/workflow.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: pushes to `main` or manual dispatch; the release builder from Task 1; self-hosted runner label `shifeng-prod`.
- Produces: a 7-day `shifeng-production-<sha>` artifact and one serialized production deployment.
- Adds npm command: `npm run test:deploy` -> `node --test scripts/deploy/*.test.js`.

- [ ] **Step 1: Write the failing workflow contract test**

```js
test('production workflow builds on GitHub and deploys only on shifeng-prod', async () => {
  const yaml = await readFile('.github/workflows/deploy-production.yml', 'utf8');
  assert.match(yaml, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(yaml, /node-version:\s*['"]?24['"]?/);
  assert.match(yaml, /runs-on:\s*\[self-hosted,\s*shifeng-prod\]/);
  assert.match(yaml, /retention-days:\s*7/);
  assert.match(yaml, /scripts\/deploy\/create-release\.mjs/);
  assert.match(yaml, /scripts\/deploy\/deploy-release\.mjs/);
  assert.match(yaml, /cancel-in-progress:\s*false/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/deploy/workflow.test.js`

Expected: FAIL because the workflow is missing.

- [ ] **Step 3: Implement the workflow and npm test entry**

The workflow structure must be:

```yaml
name: Deploy production

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: shifeng-investment-production
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run test:deploy
      - run: npm run build
      - run: node scripts/deploy/create-release.mjs --sha "$GITHUB_SHA" --run-id "$GITHUB_RUN_ID" --output-dir .release
      - uses: actions/upload-artifact@v4
        with:
          name: shifeng-production-${{ github.sha }}
          path: .release/
          retention-days: 7
  deploy:
    needs: build
    runs-on: [self-hosted, shifeng-prod]
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: shifeng-production-${{ github.sha }}
          path: artifact
      - run: node artifact/deploy-release.mjs --archive "artifact/shifeng-investment-${GITHUB_SHA}.tar.gz" --checksum "artifact/shifeng-investment-${GITHUB_SHA}.sha256" --sha "$GITHUB_SHA"
```

The release builder must copy the standalone `deploy-release.mjs` into `.release` so the deploy job does not need `actions/checkout` and does not maintain a Git repository on the production computer.

- [ ] **Step 4: Run workflow and deployment tests and verify GREEN**

Run: `npm run test:deploy`

Expected: all release builder, installer, service, and workflow contract tests PASS.

- [ ] **Step 5: Commit the workflow**

```bash
git add .github/workflows/deploy-production.yml scripts/deploy/workflow.test.js package.json
git commit -m "ci: deploy whole application from main"
```

---

### Task 5: Operator guide and complete verification

**Files:**
- Create: `docs/automatic-deployment.md`
- Modify: `scripts/tunnel.env.example`

**Interfaces:**
- Consumes: the completed workflow and the already-registered `shifeng-prod` runner/Tunnel.
- Produces: a short one-time checklist for the always-on computer and a normal daily workflow for the development computer.

- [ ] **Step 1: Write the exact one-time setup guide**

Document these commands for the always-on Mac without including real credentials:

```bash
mkdir -p "$HOME/.config/shifeng-investment"
chmod 700 "$HOME/.config/shifeng-investment"
touch "$HOME/.config/shifeng-investment/server.env"
chmod 600 "$HOME/.config/shifeng-investment/server.env"
```

Explain that `deploy.env` is optional and needed only to migrate runtime data from an existing server directory:

```text
SHIFENG_LEGACY_ROOT=/absolute/path/to/the/currently-running/shifeng-investment
```

Include the exact checks:

```bash
node --version
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/build-meta
launchctl print "gui/$(id -u)/com.shifeng-investment.server"
```

State plainly that the existing Cloudflare Tunnel remains separate and must target `http://localhost:3000`; after the always-on site is verified, the duplicate Tunnel replica on the development computer should be stopped to prevent Cloudflare from routing users to two different code versions.

- [ ] **Step 2: Clarify the Tunnel example without coupling it to deployment**

Add these exact comments to the beginning of `scripts/tunnel.env.example`:

```bash
# This file configures Cloudflare Tunnel networking only.
# The production deployment workflow never reads or packages the real tunnel.env file.
# Put application environment variables in ~/.config/shifeng-investment/server.env instead.
```

- [ ] **Step 3: Run all automated verification**

Run:

```bash
npm run test:deploy
npm run build
node --test server/startup.test.js
git diff --check
```

Expected: every command exits `0`; `dist/build-meta.json` may be generated only inside the ignored `dist` directory.

- [ ] **Step 4: Inspect release contents for accidental secrets or runtime data**

Run:

```bash
node scripts/deploy/create-release.mjs --sha "$(git rev-parse HEAD)" --run-id local-verification --output-dir /tmp/shifeng-release-verification
tar -tzf "/tmp/shifeng-release-verification/shifeng-investment-$(git rev-parse HEAD).tar.gz"
```

Expected: the listing contains `server/index.js`, `macd screener/tmt_margin.py`, Python scripts, `package.json`, and `dist/index.html`; it contains no `.git`, `node_modules`, `.env`, Tunnel token, or untracked runtime file.

- [ ] **Step 5: Commit documentation and final verification updates**

```bash
git add docs/automatic-deployment.md scripts/tunnel.env.example
git commit -m "docs: explain production deployment operation"
```

- [ ] **Step 6: Prepare the production handoff**

Report the implementation branch and commits, the exact checks that passed, and these two remaining external actions: merge the deployment PR into `main`, then watch the first `Deploy production` workflow run on the always-on computer. Do not claim the domain is updated until `/api/build-meta` on that computer reports the merged full SHA.
