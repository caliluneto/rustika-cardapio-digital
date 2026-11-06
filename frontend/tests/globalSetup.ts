import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 3D.3.21-B: fixtures sinteticas e ISOLADAS da execucao, criadas pelo harness aprovado
 * (backend/tests/integration-db/e2e). Substitui o antigo `node seed_raw.js`, que fazia DELETE global
 * nas tabelas de pedidos/sessoes/convites e tinha credencial embutida: ele NAO e mais invocado.
 *
 * O processo filho imprime UMA linha JSON no stdout (inclui a senha efemera do admin sintetico, que
 * nunca e registrada em log nem em disco). Os logs humanos saem pelo stderr do filho.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '../../backend');
const tsxCli = path.join(backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const ENV_KEYS = [
  'RUSTIKA_E2E_RUN_ID', 'RUSTIKA_E2E_ADMIN_EMAIL', 'RUSTIKA_E2E_ADMIN_PASSWORD',
  'RUSTIKA_E2E_COMANDA', 'RUSTIKA_E2E_PRODUCT_NAME', 'RUSTIKA_E2E_PRODUCT_PRICE_CENTS', 'RUSTIKA_E2E_STATE_DIR',
  'RUSTIKA_E2E_ORDER_OPS', // 3D.4.1: "enabled" quando a jornada inclui a operacao administrativa de pedidos
  'RUSTIKA_E2E_PRODUCT_AVAILABILITY', 'RUSTIKA_E2E_UNKNOWN_PRODUCT_NAME', 'RUSTIKA_E2E_BLOCKED_PRODUCT_NAME', // 3D.4.2 (opt-in)
] as const;

export default async function globalSetup(): Promise<void> {
  console.log('Global Setup: criando fixtures isoladas da execucao (manifesto + role dedicada)...');
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [tsxCli, 'tests/integration-db/e2e/run-setup.ts'], {
      cwd: backendDir, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 120_000,
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    throw new Error(`Global Setup abortado (codigo ${status ?? '?'}): nenhuma jornada sera executada. Veja a mensagem acima.`);
  }
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  let values: Record<string, string>;
  try { values = JSON.parse(line) as Record<string, string>; } catch { throw new Error('Global Setup: o setup nao devolveu o ambiente esperado.'); }
  for (const key of ENV_KEYS) {
    if (!values[key]) throw new Error(`Global Setup: variavel ${key} ausente na resposta do setup.`);
    process.env[key] = values[key];
  }
  console.log(`Global Setup: fixtures prontas (execucao ${values.RUSTIKA_E2E_RUN_ID}).`);
}
