import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createDevCommands,
  waitForCloudResearch,
  watchProcessExit,
} from './dev-cloud-research.mjs'
import { createDevProxy } from './dev-routing.ts'

test('routes only research APIs to the cloud-backed local Worker', () => {
  const proxy = createDevProxy()

  const researchPattern = Object.keys(proxy)[0]
  assert.deepEqual(Object.keys(proxy), ['^/api/research(?:/|$)', '/api'])
  assert.equal(proxy[researchPattern].target, 'http://127.0.0.1:8788')
  assert.equal(proxy['/api'].target, 'http://127.0.0.1:3000')
  assert.equal(new RegExp(researchPattern).test('/api/research/cninfo/latest'), true)
  assert.equal(new RegExp(researchPattern).test('/api/researcher'), false)
})

test('starts Wrangler with remote D1 and R2 bindings before Vite', () => {
  const commands = createDevCommands('/project')

  assert.deepEqual(commands.wrangler, {
    command: '/project/node_modules/.bin/wrangler',
    args: [
      'dev',
      '--config',
      'wrangler.cloud-data.jsonc',
      '--env-file',
      '.dev.vars.example',
      '--ip',
      '127.0.0.1',
      '--port',
      '8788',
    ],
  })
  assert.deepEqual(commands.vite, {
    command: '/project/node_modules/.bin/vite',
    args: [],
  })
})

test('keeps production and test bindings local while the dev-only config is remote', async () => {
  const productionConfig = JSON.parse(
    await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  )
  const devConfig = JSON.parse(
    await readFile(new URL('../wrangler.cloud-data.jsonc', import.meta.url), 'utf8'),
  )

  assert.equal(productionConfig.d1_databases[0].remote, undefined)
  assert.equal(productionConfig.r2_buckets[0].remote, undefined)
  assert.equal(devConfig.d1_databases[0].remote, true)
  assert.equal(devConfig.r2_buckets[0].remote, true)
  assert.equal(devConfig.assets, undefined)
  assert.equal(devConfig.vars.DEV_RESEARCH_READ_ONLY, 'true')
  assert.deepEqual(devConfig.secrets.required, [
    'GITHUB_DISPATCH_TOKEN',
    'RESEARCH_PUBLISH_TOKEN',
  ])
})

test('bounds a stalled readiness request', async () => {
  const workerProcess = new EventEmitter()
  workerProcess.exitCode = null
  const startedAt = Date.now()

  await assert.rejects(
    waitForCloudResearch(workerProcess, {
      fetchImpl: () => new Promise(() => {}),
      timeoutMs: 40,
      attemptTimeoutMs: 10,
    }),
    /did not become ready within 40 milliseconds/,
  )
  assert.ok(Date.now() - startedAt < 1_000)
})

test('stops waiting as soon as Wrangler exits from a signal', async () => {
  const workerProcess = new EventEmitter()
  workerProcess.exitCode = null
  const exitTracker = watchProcessExit(workerProcess)
  setTimeout(() => {
    workerProcess.emit('exit', null, 'SIGTERM')
  }, 10)

  await assert.rejects(
    waitForCloudResearch(workerProcess, {
      fetchImpl: () => new Promise(() => {}),
      timeoutMs: 1_000,
      attemptTimeoutMs: 500,
      exitTracker,
    }),
    /exited early \(signal SIGTERM\)/,
  )
})

test('keeps the Wrangler exit result after readiness completes', async () => {
  const workerProcess = new EventEmitter()
  workerProcess.exitCode = null
  const exitTracker = watchProcessExit(workerProcess)

  await waitForCloudResearch(workerProcess, {
    fetchImpl: async () => new Response(JSON.stringify({ date: '2026-08-28' })),
    timeoutMs: 1_000,
    exitTracker,
  })
  workerProcess.emit('exit', 0, null)
  await exitTracker.promise

  assert.deepEqual(exitTracker.outcome, { code: 0, signal: null, error: null })
})
