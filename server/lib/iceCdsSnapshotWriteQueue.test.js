import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueIceCdsSnapshotWrite } from './iceCdsSnapshotWriteQueue.js';

test('serializes delayed local and cloud snapshot writers so the later cloud batch retains unrelated data', async () => {
  const snapshot = { arrAndValuation: { companies: [{ company: 'Anthropic' }] }, creditRisk: { cds5y: { batchId: 'initial' } } };
  let releaseLocal;
  const localGate = new Promise((resolve) => { releaseLocal = resolve; });
  const local = enqueueIceCdsSnapshotWrite(async () => {
    await localGate;
    snapshot.creditRisk.cds5y = { batchId: 'local-20260824' };
  });
  const cloud = enqueueIceCdsSnapshotWrite(async () => {
    snapshot.creditRisk.cds5y = { batchId: 'cloud-20260825' };
  });
  releaseLocal();
  await Promise.all([local, cloud]);

  assert.equal(snapshot.creditRisk.cds5y.batchId, 'cloud-20260825');
  assert.deepEqual(snapshot.arrAndValuation.companies, [{ company: 'Anthropic' }]);
});
