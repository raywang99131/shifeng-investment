import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deployCloudWorker } from './deploy-cloud-worker.mjs';

function fixture(t, exitCode = 0) {
  const root = mkdtempSync(path.join(tmpdir(), 'cloud-deploy-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'node_modules/wrangler/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'wrangler.js'), `
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    const file = args[args.indexOf('--secrets-file') + 1];
    fs.writeFileSync(process.env.DEPLOY_TEST_REPORT, JSON.stringify({
      args, cwd: process.cwd(), file,
      fileMode: fs.statSync(file).mode & 0o777,
      dirMode: fs.statSync(path.dirname(file)).mode & 0o777,
      secrets: JSON.parse(fs.readFileSync(file, 'utf8')),
    }));
    process.exit(${exitCode});
  `);
  const report = path.join(root, 'report.json');
  return {
    root, report,
    env: {
      ...process.env,
      GITHUB_DISPATCH_TOKEN: 'test-dispatch-value',
      RESEARCH_PUBLISH_TOKEN: 'test-publish-"quoted"-value',
      UNRELATED_SECRET: 'must-not-be-uploaded',
      DEPLOY_TEST_REPORT: report,
    },
  };
}

test('supplies build secrets to deployment in a private temporary JSON file, then removes it', (t) => {
  const f = fixture(t);
  assert.equal(deployCloudWorker(f), 0);
  const report = JSON.parse(readFileSync(f.report, 'utf8'));
  assert.deepEqual(report.args, ['deploy', '--secrets-file', report.file]);
  assert.equal(report.cwd, realpathSync(f.root));
  assert.deepEqual(report.secrets, {
    GITHUB_DISPATCH_TOKEN: 'test-dispatch-value',
    RESEARCH_PUBLISH_TOKEN: 'test-publish-"quoted"-value',
  });
  assert.equal(report.fileMode, 0o600);
  assert.equal(report.dirMode, 0o700);
  assert.equal(existsSync(path.dirname(report.file)), false);
  assert.equal(report.args.some((arg) => arg.includes('test-dispatch-value')), false);
});

test('preview uploads a version without publishing traffic', (t) => {
  const f = fixture(t);
  assert.equal(deployCloudWorker({ ...f, preview: true }), 0);
  const report = JSON.parse(readFileSync(f.report, 'utf8'));
  assert.deepEqual(report.args, ['versions', 'upload', '--secrets-file', report.file]);
});

test('dry run forwards the no-upload flag to Wrangler', (t) => {
  const f = fixture(t);
  assert.equal(deployCloudWorker({ ...f, dryRun: true }), 0);
  const report = JSON.parse(readFileSync(f.report, 'utf8'));
  assert.deepEqual(report.args, ['deploy', '--secrets-file', report.file, '--dry-run']);
});

test('a failed deploy propagates its exit code and still removes the secret file', (t) => {
  const f = fixture(t, 7);
  assert.equal(deployCloudWorker(f), 7);
  const report = JSON.parse(readFileSync(f.report, 'utf8'));
  assert.equal(existsSync(path.dirname(report.file)), false);
});

test('missing or blank required secrets stop before invoking Wrangler', (t) => {
  const f = fixture(t);
  for (const value of [undefined, '', '   ']) {
    assert.throws(
      () => deployCloudWorker({ ...f, env: { ...f.env, RESEARCH_PUBLISH_TOKEN: value } }),
      /Missing build secrets: RESEARCH_PUBLISH_TOKEN/,
    );
    assert.equal(existsSync(f.report), false);
  }
});
