import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const productionConfigs = [
  ['standard', new URL('../wrangler.jsonc', import.meta.url)],
  ['credential-preserving recovery', new URL('../wrangler.ai-dashboard-recovery.jsonc', import.meta.url)],
];

for (const [name, configUrl] of productionConfigs) {
  test(`${name} Worker config proxies legacy APIs through a dedicated Tunnel origin`, async () => {
    const config = JSON.parse(await readFile(configUrl, 'utf8'));
    const siteRoute = config.routes.find(({ pattern }) => pattern === 'www.shifeng-investment.com/*');
    const legacyOrigin = new URL(config.vars.LEGACY_API_ORIGIN);

    assert.ok(siteRoute, 'the public www route must remain attached to the Worker');
    assert.equal(legacyOrigin.protocol, 'https:');
    assert.equal(legacyOrigin.hostname, 'origin.shifeng-investment.com');
    assert.notEqual(legacyOrigin.hostname, 'www.shifeng-investment.com');
    assert.ok(
      config.routes.every(({ pattern }) => !pattern.startsWith(`${legacyOrigin.hostname}/`)),
      'the Tunnel origin must bypass the public Worker route',
    );
    if (name === 'credential-preserving recovery') {
      assert.equal(config.secrets, undefined, 'recovery deploys must not create or rotate credentials');
    }
  });
}
