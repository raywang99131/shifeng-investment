import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { load as loadYaml } from 'js-yaml';

async function loadWorkflow() {
  try {
    return loadYaml(await readFile('.github/workflows/deploy-production.yml', 'utf8'));
  } catch {
    return null;
  }
}

function findStep(job, predicate) {
  return job.steps.find(predicate);
}

test('production workflow builds main and deploys only on the labeled self-hosted runner', async () => {
  const workflow = await loadWorkflow();
  assert(workflow && typeof workflow === 'object', 'production deployment workflow is missing or invalid');

  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.deepEqual(workflow.on.workflow_dispatch, {});
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.concurrency, {
    group: 'shifeng-investment-production',
    'cancel-in-progress': false,
  });

  const build = workflow.jobs.build;
  assert.equal(build['runs-on'], 'ubuntu-latest');
  assert.equal(findStep(build, (step) => step.uses === 'actions/setup-node@v4').with['node-version'], '24');
  assert(findStep(build, (step) => step.run === 'npm ci'));
  assert(findStep(build, (step) => step.run === 'npm run test:deploy'));
  assert(findStep(build, (step) => step.run === 'npm run build'));
  assert(findStep(build, (step) => step.run?.includes('scripts/deploy/create-release.mjs')));
  const upload = findStep(build, (step) => step.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.with['retention-days'], 7);

  const deploy = workflow.jobs.deploy;
  assert.equal(deploy.needs, 'build');
  assert.deepEqual(deploy['runs-on'], ['self-hosted', 'shifeng-prod']);
  assert.equal(findStep(deploy, (step) => step.uses === 'actions/setup-node@v4').with['node-version'], '24');
  assert(findStep(deploy, (step) => step.uses === 'actions/download-artifact@v4'));
  assert(findStep(deploy, (step) => step.run?.includes('artifact/deploy-release.mjs')));
  assert(!findStep(deploy, (step) => step.uses?.startsWith('actions/checkout')));
  assert.doesNotMatch(JSON.stringify(workflow), /cloudflared|tunnel\.token|CLOUDFLARE_TUNNEL_TOKEN/);
});

test('package exposes one command for all deployment tests', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(packageJson.scripts['test:deploy'], 'node --test scripts/deploy/*.test.js');
  assert.equal(typeof packageJson.devDependencies['js-yaml'], 'string');
});
