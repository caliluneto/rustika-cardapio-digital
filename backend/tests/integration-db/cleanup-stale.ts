/**
 * Removes fixtures left by interrupted integration runs (rows reachable from the run marker only).
 * Dry-run by default; `--execute` deletes. Same gate as the suite plus the identity preflight,
 * except that leftovers are expected here.
 *
 *   npm run test:integration:db:cleanup            # lista
 *   npm run test:integration:db:cleanup -- --execute
 */
import { redactSecrets } from '../../src/config/secrets';
import { openIntegrationDatabases } from './support/databases';
import { createRunIdentity, findStaleRunIds, FixtureRun } from './support/fixtures';
import { assertIntegrationGate } from './support/preflight';

async function main() {
  assertIntegrationGate(process.env);
  const execute = process.argv.includes('--execute');
  if (process.argv.slice(2).some((arg) => arg !== '--execute')) throw new Error('Argumento desconhecido.');
  const connections = await openIntegrationDatabases(process.env, undefined, true);
  const db = connections.fixtures;
  try {
    const runIds = await findStaleRunIds(db);
    console.log(`execuções com resíduos: ${runIds.length ? runIds.join(', ') : 'nenhuma'}`);
    for (const runId of runIds) {
      const run = new FixtureRun(db, createRunIdentity(runId));
      console.log(`${runId}: ${JSON.stringify(await run.remaining())}`);
      if (execute) console.log(`${runId}: removido ${JSON.stringify(await run.cleanup())}`);
    }
    if (!execute && runIds.length) console.log('Nada removido (dry-run). Use --execute para apagar.');
  } finally {
    await connections.close();
  }
}

main().catch((error: unknown) => {
  console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
