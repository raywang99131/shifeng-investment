import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createEtfMonitorSupervisor } from './etfMonitorProcess.js';


function fakeSpawn(calls, children) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = (signal) => {
      child.killed = signal;
      child.emit('exit', 0, signal);
      return true;
    };
    calls.push({ command, args, options });
    children.push(child);
    return child;
  };
}


function sequenceProbe(values) {
  let latest = values.at(-1) ?? false;
  return async () => {
    if (values.length > 0) latest = values.shift();
    return latest;
  };
}


function restartHarness() {
  let scheduled = null;
  return {
    setTimeoutImpl(callback) {
      scheduled = callback;
      return 1;
    },
    clearTimeoutImpl() {
      scheduled = null;
    },
    async runScheduledRestart() {
      const callback = scheduled;
      scheduled = null;
      assert.ok(callback, 'restart should be scheduled');
      await callback();
    },
    hasScheduledRestart() {
      return scheduled !== null;
    },
  };
}


function createHarness({ probeValues = [false, true], env = {} } = {}) {
  const calls = [];
  const children = [];
  const restart = restartHarness();
  const supervisor = createEtfMonitorSupervisor({
    env: {
      ETF_MONITOR_ENABLED: '1',
      ETF_MONITOR_PORT: '8123',
      ETF_MONITOR_PYTHON: '/repo/python3',
      ...env,
    },
    projectRoot: '/repo',
    spawnImpl: fakeSpawn(calls, children),
    healthProbe: sequenceProbe([...probeValues]),
    sleepImpl: async () => {},
    setTimeoutImpl: restart.setTimeoutImpl,
    clearTimeoutImpl: restart.clearTimeoutImpl,
    logger: { info() {}, warn() {}, error() {} },
  });
  return { supervisor, calls, children, restart };
}


test('starts repository Uvicorn with the configured local port', async () => {
  const harness = createHarness();

  await harness.supervisor.start();

  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].command, '/repo/python3');
  assert.deepEqual(harness.calls[0].args, [
    '-m', 'uvicorn', 'app.main:app',
    '--app-dir', '/repo/server/etf_monitor',
    '--host', '127.0.0.1',
    '--port', '8123',
  ]);
  assert.equal(
    harness.calls[0].options.env.ETF_MONITOR_URL,
    'http://127.0.0.1:8123',
  );
});


test('reuses a healthy configured upstream without spawning', async () => {
  const harness = createHarness({
    probeValues: [true],
    env: { ETF_MONITOR_URL: 'http://127.0.0.1:9123' },
  });

  await harness.supervisor.start();

  assert.equal(harness.calls.length, 0);
});


test('restarts an unexpectedly exited managed child', async () => {
  const harness = createHarness({ probeValues: [false, true, false, true] });
  await harness.supervisor.start();

  harness.children[0].emit('exit', 1, null);
  assert.equal(harness.restart.hasScheduledRestart(), true);
  await harness.restart.runScheduledRestart();

  assert.equal(harness.calls.length, 2);
});


test('stop terminates the managed child without scheduling restart', async () => {
  const harness = createHarness();
  await harness.supervisor.start();

  await harness.supervisor.stop();

  assert.equal(harness.children[0].killed, 'SIGTERM');
  assert.equal(harness.restart.hasScheduledRestart(), false);
});
