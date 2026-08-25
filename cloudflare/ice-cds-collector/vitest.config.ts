import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const configPath = fileURLToPath(new URL('./wrangler.test.jsonc', import.meta.url));
const migrationsPath = fileURLToPath(new URL('./migrations', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath },
    miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations(migrationsPath) } },
  }))],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
});
