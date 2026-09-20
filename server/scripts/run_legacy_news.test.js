import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run_legacy_news.py', import.meta.url));
const projectPython = fileURLToPath(new URL('../data/python-venv/bin/python3', import.meta.url));

test('legacy news runner supports modern annotations on the project Python', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shifeng-news-runner-'));
  const script = path.join(tempRoot, 'typed_news_script.py');
  fs.writeFileSync(script, [
    'import sys',
    'def normalize(value: str | None) -> list[str]:',
    '    return [value] if value else []',
    'print(normalize(sys.argv[1]))',
  ].join('\n'));

  try {
    const result = spawnSync(projectPython, [runner, script, 'latest'], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "['latest']");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
