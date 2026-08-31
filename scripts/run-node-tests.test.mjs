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
