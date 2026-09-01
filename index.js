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

await import('./server/index.js');
