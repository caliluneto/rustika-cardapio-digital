/**
 * E2E verification + surgical teardown. Reads the run manifest, verifies the persisted
 * order (read-only), deletes ONLY the run's rows and proves zero residue. Prints one JSON summary
 * (no secrets) to stdout. Exit 2: aborted before deleting; exit 3: cleaned up but verification failed.
 */
import { guardedLaunch } from './launch-env'; // 1º import: fotografa o ambiente antes do Prisma carregar o .env
import { assertE2eGate } from './gate';
import { redactSecrets } from '../../../src/config/secrets';
import { e2eTeardown } from './lifecycle';
import { realLifecycleDeps } from './real';

async function main() {
  guardedLaunch(assertE2eGate);
  const result = await e2eTeardown(realLifecycleDeps());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.verification && !result.verification.ok) {
    process.stderr.write(`[e2e] VERIFICAÇÃO FALHOU: ${result.verification.problems.join('; ')}\n`);
    process.exit(3);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${redactSecrets(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(2);
});
