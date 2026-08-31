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
