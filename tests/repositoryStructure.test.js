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
