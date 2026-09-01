import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEFAULT_STARTUP_TIMEOUT_MS = 45_000;
const DEFAULT_PROBE_INTERVAL_MS = 1_000;
const DEFAULT_RESTART_DELAY_MS = 5_000;


async function probeHealth(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}


function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}


export function createEtfMonitorSupervisor({
  env = process.env,
  projectRoot = PROJECT_ROOT,
  spawnImpl = spawn,
  healthProbe = probeHealth,
  sleepImpl = sleep,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  logger = console,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  restartDelayMs = DEFAULT_RESTART_DELAY_MS,
} = {}) {
  const enabled = env.ETF_MONITOR_ENABLED !== '0'
    && env.DISABLE_BACKGROUND_JOBS !== '1';
  const port = String(env.ETF_MONITOR_PORT || '8000');
  const baseUrl = String(
    env.ETF_MONITOR_URL || `http://127.0.0.1:${port}`,
  ).replace(/\/+$/, '');
  const python = env.ETF_MONITOR_PYTHON
    || env.SHIFENG_PYTHON_BIN
    || env.PYTHON
    || 'python3';
  const appDir = path.join(projectRoot, 'server', 'etf_monitor');
  env.ETF_MONITOR_URL = baseUrl;

  let child = null;
  let startPromise = null;
  let restartTimer = null;
  let ready = false;
  let stopping = false;

  const scheduleRestart = () => {
    if (stopping || restartTimer !== null) return;
    restartTimer = setTimeoutImpl(async () => {
      restartTimer = null;
      try {
        await start();
      } catch (error) {
        logger.error(`[etf-monitor] restart failed: ${error.message}`);
        scheduleRestart();
      }
    }, restartDelayMs);
  };

  const handleChildExit = (managedChild, code, signal) => {
    if (child !== managedChild) return;
    child = null;
    ready = false;
    if (stopping) return;
    logger.warn(
      `[etf-monitor] process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}); restart scheduled`,
    );
    scheduleRestart();
  };

  const waitUntilHealthy = async () => {
    const attempts = Math.max(1, Math.ceil(startupTimeoutMs / probeIntervalMs));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await healthProbe(baseUrl)) return true;
      if (child === null) break;
      if (attempt < attempts - 1) await sleepImpl(probeIntervalMs);
    }
    return false;
  };

  const start = async () => {
    if (!enabled || stopping || ready) return;
    if (startPromise) return startPromise;

    startPromise = (async () => {
      if (await healthProbe(baseUrl)) {
        ready = true;
        logger.info(`[etf-monitor] using healthy service at ${baseUrl}`);
        return;
      }

      const args = [
        '-m', 'uvicorn', 'app.main:app',
        '--app-dir', appDir,
        '--host', '127.0.0.1',
        '--port', port,
      ];
      const managedChild = spawnImpl(python, args, {
        cwd: projectRoot,
        env,
        stdio: 'inherit',
      });
      child = managedChild;
      managedChild.once('exit', (code, signal) => {
        handleChildExit(managedChild, code, signal);
      });
      managedChild.once('error', (error) => {
        logger.error(`[etf-monitor] process error: ${error.message}`);
      });

      if (!await waitUntilHealthy()) {
        throw new Error(`service did not become healthy at ${baseUrl}`);
      }
      ready = true;
      logger.info(`[etf-monitor] service ready at ${baseUrl}`);
    })();

    try {
      await startPromise;
    } finally {
      startPromise = null;
    }
  };

  const stop = async () => {
    stopping = true;
    ready = false;
    if (restartTimer !== null) {
      clearTimeoutImpl(restartTimer);
      restartTimer = null;
    }
    const managedChild = child;
    if (managedChild === null) return;
    const exited = new Promise((resolve) => managedChild.once('exit', resolve));
    managedChild.kill('SIGTERM');
    await Promise.race([exited, sleepImpl(2_000)]);
  };

  return {
    baseUrl,
    enabled,
    start,
    stop,
  };
}
