import test from 'node:test';
import assert from 'node:assert/strict';

test('all failed content channels make the news refresh fail', async () => {
  const moduleUrl = new URL(`./newsIntelligenceHealth.js?test=${Date.now()}`, import.meta.url);
  const healthModule = await import(moduleUrl.href).catch(() => ({}));

  assert.equal(typeof healthModule.assertNewsChannelsAvailable, 'function');
  assert.throws(
    () => healthModule.assertNewsChannelsAvailable([
      { channel: 'rss-openai-blog', ok: false, stderr: 'spawn ENOENT' },
      { channel: 'wechat', ok: false, stderr: 'spawn ENOENT' },
      { channel: 'newsletter', ok: false, stderr: 'spawn ENOENT' },
    ]),
    /新闻采集器不可用.*3 个内容渠道全部失败/,
  );
});
