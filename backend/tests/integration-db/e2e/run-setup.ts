/**
 * E2E fixture setup. WRITES to cardapio_digital_test through the dedicated fixtures role.
 * Prints exactly ONE line to stdout: the JSON environment for the browser run (it contains the
 * ephemeral password of the synthetic admin: the caller must not echo it). Everything else -> stderr.
 *
 *   cd backend; tsx tests/integration-db/e2e/run-setup.ts   (needs the gates, see docs/e2e-real.md)
 */
import { guardedLaunch } from './launch-env'; // 1º import: fotografa o ambiente antes do Prisma carregar o .env
import { assertE2eGate } from './gate';
import { redactSecrets } from '../../../src/config/secrets';
import { e2eSetup } from './lifecycle';
import { realLifecycleDeps } from './real';

async function main() {
  guardedLaunch(assertE2eGate);
  const { env } = await e2eSetup(realLifecycleDeps());
  process.stdout.write(`${JSON.stringify(env)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${redactSecrets(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(2);
});
