import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const WORKER_READY_URL = 'http://127.0.0.1:8788/api/research/cninfo/latest'
const READY_TIMEOUT_MS = 45_000

export function createDevCommands(projectRoot) {
  return {
    wrangler: {
      command: path.join(projectRoot, 'node_modules', '.bin', 'wrangler'),
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
    },
    vite: {
      command: path.join(projectRoot, 'node_modules', '.bin', 'vite'),
      args: [],
    },
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

class WorkerExitedEarlyError extends Error {}

function workerExitError(outcome) {
  if (outcome.error) {
    return new WorkerExitedEarlyError(`Cloud research Worker failed: ${outcome.error.message}`)
  }
  const detail = outcome.signal ? `signal ${outcome.signal}` : outcome.code
  return new WorkerExitedEarlyError(`Cloud research Worker exited early (${detail}).`)
}

export function watchProcessExit(workerProcess) {
  const tracker = {
    outcome: null,
    promise: null,
  }
  tracker.promise = new Promise((resolve) => {
    const settle = (outcome) => {
      if (tracker.outcome !== null) return
      tracker.outcome = outcome
      resolve(outcome)
    }
    workerProcess.once('exit', (code, signal) => {
      settle({ code, signal, error: null })
    })
    workerProcess.once('error', (error) => {
      settle({ code: null, signal: null, error })
    })
  })
  return tracker
}

export async function waitForCloudResearch(workerProcess, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? READY_TIMEOUT_MS
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 5_000
  const exitTracker = options.exitTracker ?? watchProcessExit(workerProcess)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (exitTracker.outcome !== null) {
      throw workerExitError(exitTracker.outcome)
    }
    if (workerProcess.exitCode !== null) {
      throw new Error(`Cloud research Worker exited early (${workerProcess.exitCode}).`)
    }

    const controller = new AbortController()
    const remainingMs = Math.max(1, deadline - Date.now())
    const currentAttemptTimeout = Math.min(attemptTimeoutMs, remainingMs)
    let timeoutId

    try {
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort()
          reject(new Error('Cloud research readiness request timed out.'))
        }, currentAttemptTimeout)
      })
      const workerExit = exitTracker.promise.then((outcome) => {
        throw workerExitError(outcome)
      })
      const response = await Promise.race([
        fetchImpl(WORKER_READY_URL, {
          headers: { 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        }),
        timeout,
        workerExit,
      ])
      const summary = response.ok ? await response.json() : null
      if (summary && typeof summary === 'object' && typeof summary.date === 'string') {
        return summary
      }
    } catch (error) {
      if (error instanceof WorkerExitedEarlyError || workerProcess.exitCode !== null) {
        throw error
      }
      // Wrangler is still starting.
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }

    const retryDelayMs = Math.min(250, Math.max(0, deadline - Date.now()))
    if (retryDelayMs > 0) await delay(retryDelayMs)
  }

  throw new Error(`Cloud research Worker did not become ready within ${timeoutMs} milliseconds.`)
}

function start(command, projectRoot) {
  return spawn(command.command, command.args, {
    cwd: projectRoot,
    stdio: 'inherit',
  })
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const commands = createDevCommands(projectRoot)
  const workerProcess = start(commands.wrangler, projectRoot)
  const workerExit = watchProcessExit(workerProcess)
  let viteProcess = null
  let shuttingDown = false

  const stopChildren = (signal = 'SIGTERM') => {
    if (shuttingDown) return
    shuttingDown = true
    if (viteProcess?.exitCode === null) viteProcess.kill(signal)
    if (workerProcess.exitCode === null) workerProcess.kill(signal)
  }

  process.once('SIGINT', () => stopChildren('SIGTERM'))
  process.once('SIGTERM', () => stopChildren('SIGTERM'))

  void workerExit.promise.then((outcome) => {
    if (!shuttingDown && viteProcess?.exitCode === null) {
      console.error(workerExitError(outcome).message)
      viteProcess.kill('SIGTERM')
    }
  })

  try {
    const summary = await waitForCloudResearch(workerProcess, { exitTracker: workerExit })
    if (workerExit.outcome !== null) throw workerExitError(workerExit.outcome)
    console.log(`云端公告数据已连接：${summary.date}`)
    viteProcess = start(commands.vite, projectRoot)

    const viteExitCode = await new Promise((resolve) => {
      viteProcess.once('exit', (code) => resolve(code ?? 1))
    })
    stopChildren()
    process.exitCode = viteExitCode
  } catch (error) {
    stopChildren()
    throw error
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
