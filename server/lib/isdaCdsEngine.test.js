import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { priceCdsBatch } from './isdaCdsEngine.js';

const records = [{ id: 'oracle', cleanPrice: 96.5, discountCurve: { curveId: 'curve', asOf: '2026-09-11' } }];
const good = { schemaVersion: 1, engine: 'QuantLib ISDA', engineVersion: '1.43', modelVersion: 'quantlib-isda-v2', rows: [{
  id: 'oracle', spreadBp: 187, roundTripPrice: 96.5, priceResidual: 0, curveId: 'curve', curveAsOf: '2026-09-11',
  modelVersion: 'quantlib-isda-v2', stepInDate: '2026-09-12', cashSettlementDate: '2026-09-16', accrualRebatePer100: 0.23,
}] };
function fakeSpawn(payload, exitCode = 0) {
  return (_python, args, options) => {
    assert.equal(options.shell, false);
    assert.equal(args.length, 1);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit('close', null, 'SIGKILL');
    child.stdin.on('finish', () => {
      child.stdout.write(JSON.stringify(payload));
      child.emit('close', exitCode);
    });
    return child;
  };
}
test('accepts only a matching complete priced batch', async () => {
  const result = await priceCdsBatch(records, { spawnImpl: fakeSpawn(good) });
  assert.equal(result.rows[0].spreadBp, 187);
});
test('rejects missing, duplicated and mismatched output and unbounded model residual', async () => {
  for (const rows of [[], [...good.rows, ...good.rows], [{ ...good.rows[0], id: 'wrong' }],
    [{ ...good.rows[0], curveId: 'other' }], [{ ...good.rows[0], spreadBp: null }],
    [{ ...good.rows[0], roundTripPrice: 90 }], [{ ...good.rows[0], priceResidual: .1 }]]) {
    await assert.rejects(priceCdsBatch(records, { spawnImpl: fakeSpawn({ ...good, rows }) }));
  }
});
test('propagates a failed engine without publishing a partial result', async () => {
  await assert.rejects(priceCdsBatch(records, { spawnImpl: fakeSpawn({ error: { message: 'missing QuantLib' } }, 1) }), /failed/i);
});
test('kills a stalled engine on timeout and on broken input', async () => {
  for (const brokenInput of [false, true]) {
    let killed = false;
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { killed = true; };
      if (brokenInput) child.stdin.on('finish', () => child.stdin.emit('error', new Error('broken pipe')));
      return child;
    };
    await assert.rejects(priceCdsBatch(records, { spawnImpl, timeoutMs: 10 }), brokenInput ? /input failed/ : /timed out/);
    assert.equal(killed, true);
  }
});
test('bounds combined output and rejects oversized row batches before spawning', async () => {
  let killed = false;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { killed = true; };
    child.stdin.on('finish', () => child.stderr.write(Buffer.alloc(8 * 1024 * 1024 + 1)));
    return child;
  };
  await assert.rejects(priceCdsBatch(records, { spawnImpl }), /output exceeds/);
  assert.equal(killed, true);
  await assert.rejects(priceCdsBatch(Array(5001).fill(records[0]), { spawnImpl: () => { throw new Error('must not spawn'); } }), /batch size/);
});
