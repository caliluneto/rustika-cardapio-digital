import { defineConfig, devices } from '@playwright/test';

/**
 * E2E real contra cardapio_digital_test. A jornada ESCREVE no PostgreSQL Test: so roda com
 * autorizacao especifica (ver backend/docs/e2e-real.md).
 *
 * - variaveis via `env`, nunca `set X=y && cmd` (no cmd.exe isso grava "y " e desligou a guarda
 *   NODE_ENV=test => DB_PROFILE=app-test);
 * - `reuseExistingServer: false`: uma execucao anterior reaproveitou um Vite antigo sem as variaveis do E2E.
 * - portas ISOLADAS (backend 4100, frontend 5174): nao colidem com os servidores de desenvolvimento
 *   (4000/5173) e, se estiverem ocupadas, o Playwright FALHA em vez de reaproveitar;
 * - a configuracao se recusa a carregar sem a confirmacao explicita, ANTES de subir qualquer servidor;
 * - fixtures: backend/tests/integration-db/e2e (setup + manifesto + teardown cirurgico). O antigo
 *   backend/seed_raw.js (DELETE global, credencial embutida) NAO e mais invocado.
 */
if (process.env.RUSTIKA_E2E_CONFIRM !== 'RUN_E2E_ON_CARDAPIO_DIGITAL_TEST') {
  throw new Error('E2E com escrita no PostgreSQL Test bloqueado: defina RUSTIKA_E2E_CONFIRM=RUN_E2E_ON_CARDAPIO_DIGITAL_TEST (ver backend/docs/e2e-real.md). Nenhum servidor foi iniciado.');
}

const API_PORT = '4100';
const WEB_PORT = '5174';
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'on-first-retry',
  },
  timeout: 60000,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'backend-test',
      command: 'npx tsx src/server.ts',
      cwd: '../backend',
      env: { PORT: API_PORT, NODE_ENV: 'test', DB_PROFILE: 'app-test', CORS_ORIGIN: WEB_ORIGIN },
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      name: 'frontend-e2e',
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: {
        VITE_API_URL: `http://localhost:${API_PORT}/api`,
        VITE_ORDER_SUBMISSION: 'enabled',
        VITE_CATALOG_MODE: 'api',
      },
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  globalSetup: './tests/globalSetup.ts',
  globalTeardown: './tests/globalTeardown.ts',
});
