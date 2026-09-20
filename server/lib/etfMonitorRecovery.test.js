import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEtfMonitorSupervisor } from './etfMonitorProcess.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const python = process.env.ETF_MONITOR_PYTHON || path.join(root, 'server/data/etf-python-venv/bin/python3');

// Exercise the actual Python watchdog -> process exit -> Node restart chain,
// isolated from production ports, market data, email and the production database.
test('a blocked real Python poll exits and is automatically replaced by a working service', {
  skip: !existsSync(python), timeout: 20_000,
}, async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'etf-recovery-'));
  const appDir = path.join(temporary, 'server/etf_monitor/app');
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, '__init__.py'), '');
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  await writeFile(path.join(appDir, 'main.py'), `
import app
import importlib.util
import os
from pathlib import Path
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
app.__path__.append(os.environ['REAL_ETF_APP'])
spec = importlib.util.spec_from_file_location('real_etf_main', Path(os.environ['REAL_ETF_APP']) / 'main.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
from app.config import Settings
from app.trading_calendar import TradingDayResolution
marker = Path(os.environ['HANG_MARKER'])
started = time.monotonic()
class Calendar:
    def resolve(self, day):
        return TradingDayResolution(True, 'confirmed')
class Market:
    def fetch_intraday_candles(self, symbol):
        if not marker.exists():
            marker.write_text('first process entered blocked request')
            threading.Event().wait(30)
        return []
app = module.create_app(
    settings=Settings(email_enabled=False, scheduler_enabled=True, poll_stall_timeout_seconds=0.3),
    market_data_client=Market(), trading_calendar=Calendar(),
    scheduler_now=lambda: datetime(2026, 9, 16, 10, 0, tzinfo=ZoneInfo('Asia/Shanghai')) + timedelta(seconds=time.monotonic()-started),
)
`);
  const children = [];
  let logs = '';
  const supervisor = createEtfMonitorSupervisor({
    projectRoot: temporary,
    env: { ...process.env, EMAIL_ENABLED: 'false', DISABLE_BACKGROUND_JOBS: '0',
      ETF_MONITOR_ENABLED: '1', ETF_MONITOR_PORT: String(port),
      ETF_MONITOR_URL: `http://127.0.0.1:${port}`, ETF_MONITOR_PYTHON: python,
      DB_PATH: path.join(temporary, 'test.db'),
      REAL_ETF_APP: path.join(root, 'server/etf_monitor/app'), HANG_MARKER: path.join(temporary, 'hung'),
    },
    spawnImpl: (command, args, options) => {
      const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', (chunk) => { logs += chunk; });
      child.stderr.on('data', (chunk) => { logs += chunk; });
      children.push(child);
      return child;
    },
    startupTimeoutMs: 4000, probeIntervalMs: 50, restartDelayMs: 100,
    logger: { info() {}, warn() {}, error() {} },
  });
  t.after(async () => {
    await supervisor.stop();
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
    await rm(temporary, { recursive: true, force: true });
  });
  await supervisor.start().catch(() => {});
  const deadline = Date.now() + 10_000;
  let recovered = false;
  while (Date.now() < deadline) {
    if (children.length >= 2) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) });
        const health = await response.json();
        if (health.scheduler.last_poll_success && !health.scheduler.stalled) { recovered = true; break; }
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(recovered, true, logs);
  assert.equal(children[0].exitCode, 1, logs);
  assert.match(logs, /exiting for supervisor restart/);
});
