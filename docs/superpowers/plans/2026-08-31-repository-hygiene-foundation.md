# Repository Hygiene Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove provably invalid repository artifacts, add an executable repository-layout contract, and provide one reliable root verification command before any directory relocation begins.

**Architecture:** This plan implements only Wave 1 of the approved repository-structure design. A Node test reads Git's tracked-file index and enforces repository hygiene; a small Node launcher selects the non-Worker Node test files explicitly; the root package remains the command facade while the existing Cloudflare, Express, React, and Python locations stay unchanged.

**Tech Stack:** Node.js 24 ESM, Node test runner, npm scripts, Git, Markdown

**Spec:** `docs/superpowers/specs/2026-08-31-repository-structure-cleanup-design.md`

## Global Constraints

- Do not change investment data, news, research, AI dashboard, or quantitative-strategy behavior.
- Do not change existing HTTP API paths or frontend routes.
- Do not upgrade React, Express, Vite, Wrangler, Node, or Python dependencies.
- Keep root command names stable; internal script paths may change.
- Keep `dist/` at the repository root throughout this plan.
- Keep Cloudflare Worker name, domain, D1 database, R2 bucket, and secret names unchanged.
- Keep GitHub Actions triggers, Shanghai-date semantics, and failure reporting unchanged.
- Keep Node API default port and `/api/*` paths unchanged.
- Never read, copy, or commit `.env.local`, Tunnel tokens, Cloudflare secrets, or GitHub tokens.
- Retain root `Dockerfile` and `railway.json`; their external usage is outside Wave 1.
- Work only in the isolated `codex/repository-structure-cleanup` worktree.

---

### Task 1: Enforce the tracked-file hygiene contract and remove invalid artifacts

**Files:**
- Create: `tests/repositoryStructure.test.js`
- Delete: `quote_service/__pycache__/main.cpython-38.pyc`
- Delete: `quote_service/routers/__pycache__/__init__.cpython-38.pyc`
- Delete: `quote_service/routers/__pycache__/quotes.cpython-38.pyc`
- Delete: `quote_service/services/__pycache__/__init__.cpython-38.pyc`
- Delete: `quote_service/services/__pycache__/akshareFetcher.cpython-38.pyc`
- Delete: `docker-compose.yml`
- Delete: `Dockerfile.server`
- Delete: `Dockerfile.web`
- Delete: `nginx.conf`
- Test: `tests/repositoryStructure.test.js`

**Interfaces:**
- Consumes: the repository index returned by `git ls-files -z`.
- Produces: a repository contract that rejects tracked cache/build artifacts and the retired three-container stack while protecting current deployment entrypoints.

- [ ] **Step 1: Write the failing tracked-file contract**

Create `tests/repositoryStructure.test.js` with:

```js
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)

test('generated caches and build outputs are not tracked', () => {
  const generated = trackedFiles.filter((file) => (
    file.includes('/__pycache__/')
    || file.endsWith('.pyc')
    || file === 'dist'
    || file.startsWith('dist/')
    || file === 'node_modules'
    || file.startsWith('node_modules/')
  ))

  assert.deepEqual(generated, [])
})

test('retired three-container deployment files are absent', () => {
  const retired = new Set([
    'docker-compose.yml',
    'Dockerfile.server',
    'Dockerfile.web',
    'nginx.conf',
  ])

  assert.deepEqual(trackedFiles.filter((file) => retired.has(file)), [])
})

test('current deployment entrypoints remain tracked', () => {
  for (const file of [
    'Dockerfile',
    'railway.json',
    'wrangler.jsonc',
    'worker/index.ts',
    'server/index.js',
    'src/main.tsx',
  ]) {
    assert.ok(trackedFiles.includes(file), `${file} must remain tracked`)
  }
})
```

- [ ] **Step 2: Run the contract and verify the expected failure**

Run: `node --test tests/repositoryStructure.test.js`

Expected: two failing tests. The generated-artifact test must list the five tracked `.pyc` files, and the retired-deployment test must list `docker-compose.yml`, `Dockerfile.server`, `Dockerfile.web`, and `nginx.conf`. The current-entrypoint test must pass.

- [ ] **Step 3: Delete only the exact rejected files**

Run the following deletion as one reviewed Git operation:

```bash
git rm \
  quote_service/__pycache__/main.cpython-38.pyc \
  quote_service/routers/__pycache__/__init__.cpython-38.pyc \
  quote_service/routers/__pycache__/quotes.cpython-38.pyc \
  quote_service/services/__pycache__/__init__.cpython-38.pyc \
  quote_service/services/__pycache__/akshareFetcher.cpython-38.pyc \
  docker-compose.yml \
  Dockerfile.server \
  Dockerfile.web \
  nginx.conf
```

Do not delete root `Dockerfile` or `railway.json`.

- [ ] **Step 4: Run the contract and verify it passes**

Run: `node --test tests/repositoryStructure.test.js`

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Verify the clean-clone Docker failure evidence is encoded by the contract**

Run: `git grep -n -E 'Dockerfile\.server|Dockerfile\.web|docker-compose\.yml|nginx\.conf' -- ':!docs/**' || true`

Expected: no runtime or configuration references. Historical design and plan documents may still name the deleted files.

- [ ] **Step 6: Commit the hygiene contract and deletions**

```bash
git add tests/repositoryStructure.test.js
git commit -m "chore: remove invalid repository artifacts"
```

---

### Task 2: Add one deterministic Node test launcher and root verification commands

**Files:**
- Create: `scripts/run-node-tests.mjs`
- Create: `scripts/run-node-tests.test.mjs`
- Modify: `package.json`
- Test: `scripts/run-node-tests.test.mjs`

**Interfaces:**
- Consumes: project root plus the fixed test roots `scripts`, `server`, and `tests`.
- Produces: `collectNodeTestFiles(projectRoot, roots?) -> Promise<string[]>`, `npm run test:node`, `npm test`, and `npm run verify`.

- [ ] **Step 1: Write the failing test-file discovery test**

Create `scripts/run-node-tests.test.mjs` with:

```js
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { collectNodeTestFiles } from './run-node-tests.mjs'

test('collectNodeTestFiles returns sorted Node tests from approved roots only', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shifeng-node-tests-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await mkdir(path.join(root, 'scripts'), { recursive: true })
  await mkdir(path.join(root, 'server', 'lib'), { recursive: true })
  await mkdir(path.join(root, 'tests'), { recursive: true })
  await mkdir(path.join(root, 'worker'), { recursive: true })
  await writeFile(path.join(root, 'scripts', 'z.test.mjs'), '')
  await writeFile(path.join(root, 'server', 'lib', 'a.test.js'), '')
  await writeFile(path.join(root, 'tests', 'b.test.js'), '')
  await writeFile(path.join(root, 'worker', 'ignored.test.ts'), '')
  await writeFile(path.join(root, 'tests', 'ignored.ts'), '')

  assert.deepEqual(await collectNodeTestFiles(root), [
    'scripts/z.test.mjs',
    'server/lib/a.test.js',
    'tests/b.test.js',
  ])
})
```

- [ ] **Step 2: Run the discovery test and verify the expected failure**

Run: `node --test scripts/run-node-tests.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/run-node-tests.mjs`.

- [ ] **Step 3: Implement the minimal deterministic launcher**

Create `scripts/run-node-tests.mjs` with:

```js
import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ROOTS = ['scripts', 'server', 'tests']

async function walk(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(entryPath))
    } else if (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.mjs')) {
      files.push(entryPath)
    }
  }
  return files
}

export async function collectNodeTestFiles(projectRoot, roots = DEFAULT_ROOTS) {
  const files = []
  for (const root of roots) {
    files.push(...await walk(path.join(projectRoot, root)))
  }
  return files
    .map((file) => path.relative(projectRoot, file).split(path.sep).join('/'))
    .sort()
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) {
  const projectRoot = process.cwd()
  const files = await collectNodeTestFiles(projectRoot)
  if (files.length === 0) {
    throw new Error('No Node test files found')
  }
  const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  process.exitCode = result.status ?? 1
}
```

- [ ] **Step 4: Run the discovery test and verify it passes**

Run: `node --test scripts/run-node-tests.test.mjs`

Expected: 1 test passes, 0 fail.

- [ ] **Step 5: Add unified root commands**

In `package.json`, add these scripts without changing dependency versions or existing command names:

```json
"test:node": "node scripts/run-node-tests.mjs",
"test": "npm run test:node && npm run test:worker",
"verify": "npm run build && npm test"
```

- [ ] **Step 6: Run the complete Node suite through the new launcher**

Run: `npm run test:node`

Expected: 243 tests pass, 0 fail: the previous 239 Node tests plus three repository-structure tests and one launcher test. Tests that open loopback ports must be run in an environment that permits local sockets.

- [ ] **Step 7: Commit the test launcher and root commands**

```bash
git add package.json scripts/run-node-tests.mjs scripts/run-node-tests.test.mjs
git commit -m "test: add unified repository verification commands"
```

---

### Task 3: Document runtime and deployment boundaries

**Files:**
- Modify: `tests/repositoryStructure.test.js`
- Modify: `README.md`
- Test: `tests/repositoryStructure.test.js`

**Interfaces:**
- Consumes: the README visible to GitHub visitors.
- Produces: an enforced `项目结构与运行边界` section describing current runtime units, active cloud paths, retained legacy API, and local verification commands.

- [ ] **Step 1: Write the failing README contract**

Append these imports and test behavior to `tests/repositoryStructure.test.js`; merge the `readFileSync` import with existing imports rather than duplicating an import declaration:

```js
import { readFileSync } from 'node:fs'

test('README documents runtime and deployment boundaries', () => {
  const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')

  assert.match(readme, /^## 项目结构与运行边界$/m)
  assert.match(readme, /Cloudflare Worker/)
  assert.match(readme, /本地 Legacy API/)
  assert.match(readme, /npm run verify/)
  assert.match(readme, /代码上传到 GitHub 不等于运行环境已经配置完成/)
})
```

- [ ] **Step 2: Run the README contract and verify the expected failure**

Run: `node --test tests/repositoryStructure.test.js`

Expected: the three existing structure tests pass; the README contract fails because the heading and exact deployment warning are absent.

- [ ] **Step 3: Add the runtime-boundary documentation**

Insert the following section in `README.md` immediately after the title and before `公告监控云端版`:

```markdown
## 项目结构与运行边界

本仓库是一个多运行时项目，不是只有一个前端和一个可独立上传即运行的后端。代码上传到 GitHub 不等于运行环境已经配置完成；Cloudflare、GitHub Actions 和本地服务仍需要各自的环境变量、Secret、数据库、对象存储和 Python 依赖。

| 运行单元 | 当前目录 | 用途 | 运行位置 |
| --- | --- | --- | --- |
| React/Vite 前端 | `src/`、`public/` | 网站界面 | Cloudflare Worker 静态资产或本地 Vite |
| Cloudflare Worker | `worker/` | 研究 API、静态资产和旧 API 代理 | Cloudflare |
| Node/Express API | `server/` | 尚未云化的接口和本地任务 | 本地 Legacy API/Tunnel |
| Python 研究任务 | `automation/research-tasks/` | 公告、业绩和风险报告 | GitHub Actions |
| Python 行情与市场任务 | `quote_service/`、`macd screener/`、`server/price_tracking/` | 行情、拥挤度和价格数据 | 本地服务或定时任务 |

根 `Dockerfile` 和 `railway.json` 暂时作为待确认的灾备部署入口保留；已失效的三容器 Compose 配置不再属于支持范围。

在开始开发或目录迁移前运行：

```bash
npm ci
npm run verify
```

`npm run verify` 会依次执行生产构建、Node 测试和 Cloudflare Worker 测试。
```

- [ ] **Step 4: Run the README contract and verify it passes**

Run: `node --test tests/repositoryStructure.test.js`

Expected: 4 tests pass, 0 fail.

- [ ] **Step 5: Commit the documented boundary**

```bash
git add README.md tests/repositoryStructure.test.js
git commit -m "docs: explain repository runtime boundaries"
```

---

### Task 4: Verify Wave 1 from a tracked-files perspective

**Files:**
- Verify only; no production-file changes expected.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: evidence that the cleanup did not change application behavior and that the repository contract is enforceable from the root command.

- [ ] **Step 1: Run the unified verification command**

Run: `npm run verify`

Expected: Vite production build exits 0, 244 Node tests pass, and 38 Worker tests pass. Run with loopback-socket permission because existing API and Worker tests bind to `127.0.0.1`.

- [ ] **Step 2: Run the existing root Python regression suite**

Run: `python3 -m unittest discover -s tests -p 'test_*.py' -q`

Expected: all discovered tests pass. This plan does not install or change Python dependencies.

- [ ] **Step 3: Verify tracked-file hygiene directly**

Run: `git ls-files | rg '(^|/)__pycache__/|\.pyc$|^dist/|^node_modules/|^(docker-compose\.yml|Dockerfile\.server|Dockerfile\.web|nginx\.conf)$'`

Expected: exit 1 with no output because no forbidden path is tracked.

- [ ] **Step 4: Verify protected deployment entrypoints remain**

Run: `git ls-files Dockerfile railway.json wrangler.jsonc worker/index.ts server/index.js src/main.tsx`

Expected: all six paths are printed.

- [ ] **Step 5: Review the final diff and worktree state**

Run: `git diff origin/main...HEAD --stat && git status --short --branch`

Expected: only the approved design/plan, Task 1 cleanup, verification tooling, and README changes differ from `origin/main`; the branch is clean and ahead of `origin/main` by the expected commits.

## Deferred Plans

After Wave 1 is verified, create separate implementation plans for:

1. Moving `src/`, `public/`, and `index.html` into `frontend/` while keeping root build commands and root `dist/`.
2. Moving Node, Worker, Python services, and jobs into `backend/` one runtime at a time.
3. Classifying runtime data and consolidating Cloudflare, serverless, Docker, and Railway deployment configuration.

