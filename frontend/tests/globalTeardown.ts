import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 3D.3.21-B: verificacao (somente leitura) do pedido persistido + limpeza CIRURGICA das linhas da
 * propria execucao, guiada pelo manifesto. Roda mesmo quando a jornada falha. Se o banco contiver algo
 * que o manifesto nao explica, aborta ANTES de apagar e mantem o manifesto (nada de limpeza improvisada):
 * nesse caso use `npm run e2e:teardown` no backend depois de investigar.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '../../backend');
const tsxCli = path.join(backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

export default async function globalTeardown(): Promise<void> {
  console.log('Global Teardown: verificando o pedido e removendo somente as fixtures desta execucao...');
  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, [tsxCli, 'tests/integration-db/e2e/run-teardown.ts'], {
      cwd: backendDir, env: process.env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', timeout: 120_000,
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    throw new Error(status === 3
      ? 'Global Teardown: fixtures removidas, mas a VERIFICACAO do pedido persistido FALHOU (veja o motivo acima).'
      : `Global Teardown abortado (codigo ${status ?? '?'}): nada foi apagado e o manifesto foi mantido. Investigue e rode "npm run e2e:teardown" no backend.`);
  }
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '{}';
  const result = JSON.parse(line) as { runId: string; verification: { ok: boolean; orderNumber: number | null } | null; remaining: Record<string, number> };
  console.log(`Global Teardown: execucao ${result.runId} limpa; pedido verificado: ${result.verification?.ok ? `sim (n. ${result.verification.orderNumber})` : 'n/a'}; residuos: ${JSON.stringify(result.remaining)}`);
}
