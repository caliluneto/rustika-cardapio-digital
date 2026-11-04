import { defineConfig } from 'vitest/config';

/**
 * PostgreSQL integration suite (writes to cardapio_digital_test). Never part of `npm test`:
 * - files use the `.integration.ts` suffix, outside Vitest's default `*.test.ts` pattern;
 * - only this config includes them, via `npm run test:integration:db`;
 * - globalSetup and every file require RUSTIKA_DB_INTEGRATION=1 and
 *   RUSTIKA_DB_INTEGRATION_CONFIRM=WRITE_CARDAPIO_DIGITAL_TEST;
 * - each file runs the database preflight before its first write.
 */
export default defineConfig({
  test: {
    include: ['tests/integration-db/**/*.integration.ts'],
    globalSetup: ['tests/integration-db/globalSetup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
