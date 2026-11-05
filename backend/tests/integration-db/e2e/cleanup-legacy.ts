/**
 * Removes the residue of the old E2E setup (backend/seed_raw.js). DRY-RUN by default.
 *
 *   tsx tests/integration-db/e2e/cleanup-legacy.ts             # lista, nao apaga
 *   tsx tests/integration-db/e2e/cleanup-legacy.ts --execute   # apaga (exige RUSTIKA_E2E_LEGACY_CLEANUP)
 *   ... --scope blocker --expect-invitation <uuid> --expect-session <uuid>   # (3D.3.23-B) só comanda 999999 + esse convite + essa sessão
 *
 * Needs the integration and E2E gates. Writes only with --execute, only the fixed legacy ids, and
 * only when every identifying attribute matches (see legacy.ts).
 */
import { guardedLaunch } from './launch-env'; // 1º import: fotografa o ambiente antes do Prisma carregar o .env
import { redactSecrets } from '../../../src/config/secrets';
import { openIntegrationDatabases } from '../support/databases';
import { assertE2eGate, assertLegacyCleanupGate, E2eAbort } from './gate';
import { cleanLegacy } from './legacy';

async function main() {
  const args = process.argv.slice(2);
  const scopeIndex = args.indexOf('--scope');
  const scopeValue = scopeIndex >= 0 ? args[scopeIndex + 1] : 'full';
  if (scopeValue !== 'full' && scopeValue !== 'blocker') throw new E2eAbort(['--scope aceita apenas full ou blocker']);
  const flagValue = (flag: string): string | undefined => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const consumed = new Set<number>();
  for (const flag of ['--scope', '--expect-invitation', '--expect-session']) { const i = args.indexOf(flag); if (i >= 0) { consumed.add(i); consumed.add(i + 1); } }
  const extra = args.filter((arg, index) => arg !== '--execute' && !consumed.has(index));
  if (extra.length) throw new E2eAbort([`argumento desconhecido: ${extra.join(' ')}`]);
  const execute = process.argv.includes('--execute');
  guardedLaunch(execute ? assertLegacyCleanupGate : assertE2eGate);
  // allowLeftovers + allowCollisions: the legacy residue is exactly a collision; identity, migrations,
  // ACL, pg_hba and the advisory lock are still enforced by the preflight.
  const dbs = await openIntegrationDatabases(process.env, undefined, true, true);
  try {
    const result = await cleanLegacy(dbs.fixtures, { execute, scope: scopeValue, expect: scopeValue === 'blocker' ? { invitationId: flagValue('--expect-invitation') ?? '', sessionId: flagValue('--expect-session') ?? '' } : undefined });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!execute) process.stderr.write('[e2e] dry-run: nada foi apagado. Use --execute para remover.\n');
  } finally {
    await dbs.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${redactSecrets(error instanceof Error ? error.message : String(error))}\n`);
  process.exit(2);
});
