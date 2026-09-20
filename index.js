import { fileURLToPath } from 'node:url';
import { createEtfMonitorSupervisor } from './server/lib/etfMonitorProcess.js';
import { configureProjectPythonRuntime } from './server/lib/pythonRuntime.js';

const localEnvFile = process.env.SHIFENG_LOCAL_ENV_FILE
  || fileURLToPath(new URL('./.env.local', import.meta.url));

try {
  process.loadEnvFile(localEnvFile);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

configureProjectPythonRuntime();
const etfMonitorSupervisor = createEtfMonitorSupervisor();

try {
  await etfMonitorSupervisor.start();
} catch (error) {
  console.error(`[etf-monitor] startup failed; main API will continue in degraded mode: ${error.message}`);
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await etfMonitorSupervisor.stop();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

const apiPort = Number(process.env.PORT || 3000);
const configuredHost = process.env.HOST || '127.0.0.1';
const apiHost = configuredHost === '0.0.0.0' ? '127.0.0.1' : configuredHost;
const apiUrl = `http://${apiHost.includes(':') ? `[${apiHost === '::' ? '::1' : apiHost}]` : apiHost}:${apiPort}`;

async function backendIsRunning() {
  try {
    const response = await fetch(`${apiUrl}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok && (await response.json()).status === 'ok';
  } catch {
    return false;
  }
}

if (await backendIsRunning()) {
  console.log(`[project] 复用已运行的主站：${apiUrl}；ETF 监控已按启动配置检查。`);
} else {
  await import('./server/index.js');
}
