import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { E4_ALT_EXPECTED_MIGRATIONS, E4_ALT_TARGET } from '../../scripts/bootstrap/exceptionalMigratorBootstrap';
import { evaluateE53History, evaluateE53Identity, type E53IdentityRow } from '../../scripts/homolog/e53ReadOnlyVerification';
import { HOMOLOG_EXPECTED_MIGRATIONS, verifyHomologMigrationChain } from '../../scripts/homolog/homologMigrationChain';

const cluster = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const identity = (): E53IdentityRow => ({
  database: E4_ALT_TARGET.database, databaseOid: E4_ALT_TARGET.databaseOid,
  currentUser: E4_ALT_TARGET.migratorRole, sessionUser: E4_ALT_TARGET.migratorRole,
  databaseOwner: E4_ALT_TARGET.migratorRole, elevatedRole: false, serverVersionNum: 180000,
  projectId: E4_ALT_TARGET.projectId, branchId: E4_ALT_TARGET.branchId,
  markerComment: `rustika-homolog-cluster:${cluster}`,
});
const nine = () => HOMOLOG_EXPECTED_MIGRATIONS.slice(0, 9).map((m) => ({
  ...m, finished: true, rolledBack: false, logsPresent: false,
}));

describe('E5.3 — verificação offline de identidade e histórico remoto', () => {
  it('vincula as nove migrations aos bytes locais e preserva a décima como somente pendente', () => {
    expect(verifyHomologMigrationChain(process.cwd()).problems).toEqual([]);
    expect(HOMOLOG_EXPECTED_MIGRATIONS.slice(0, 9)).toEqual(E4_ALT_EXPECTED_MIGRATIONS);
    expect(evaluateE53History(nine())).toEqual([]);
    expect(HOMOLOG_EXPECTED_MIGRATIONS[9]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('recusa linha extra, tentativa parcial da décima, checksum, ordem e falha/logs', () => {
    expect(evaluateE53History(nine().slice(0, 8)).join(' ')).toMatch(/9/);
    expect(evaluateE53History([...nine(), { ...HOMOLOG_EXPECTED_MIGRATIONS[9]!, finished: false, rolledBack: false, logsPresent: true }]).join(' ')).toMatch(/desconhecida|9|Logs/);
    const wrong = nine(); wrong[0] = { ...wrong[0]!, checksum: '0'.repeat(64) };
    expect(evaluateE53History(wrong).join(' ')).toMatch(/checksum/);
    const swapped = nine(); [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(evaluateE53History(swapped).join(' ')).toMatch(/ordem/);
    const failed = nine(); failed[0] = { ...failed[0]!, finished: false, rolledBack: true, logsPresent: true };
    expect(evaluateE53History(failed).join(' ')).toMatch(/falha|Logs/);
  });

  it('recusa OID, role, owner, projeto, branch divergente e marca; branch ausente não é inventada', () => {
    expect(evaluateE53Identity(identity(), cluster)).toEqual({ problems: [], branchReported: true });
    for (const patch of [
      { databaseOid: '1' }, { currentUser: 'cardapio_homolog_app' },
      { sessionUser: 'cardapio_homolog_app' }, { databaseOwner: 'neondb_owner' },
      { elevatedRole: true },
      { projectId: 'wrong-project-12345678' }, { branchId: 'br-wrong' },
      { markerComment: 'rustika-homolog-cluster:wrong' }, { serverVersionNum: 170000 },
    ]) expect(evaluateE53Identity({ ...identity(), ...patch }, cluster).problems.length).toBeGreaterThan(0);
    expect(evaluateE53Identity({ ...identity(), branchId: null }, cluster)).toEqual({ problems: [], branchReported: false });
  });

  it('o executor não altera migrations nem contém operações remotas adicionais', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'e53-neon-history-readonly.ts'), 'utf8');
    expect(script).toContain('runSerializableReadOnlyTransaction');
    expect(script).toContain("loadDatabaseProfile('migrate-homolog', { purpose: 'migration' })");
    expect(script).toContain('strictTargetUrlProblem(database)');
    expect(script).toContain("process.argv[2] !== '--authorize-read-only'");
    expect(script).toContain('E53_CONFIRMATION_ENV');
    expect(script).toContain('readNeonServerFacts');
    expect(script).toContain("current_setting('neon.branch_id', true)");
    expect(script).not.toContain('SET TRANSACTION READ ONLY'); // A imposição é feita no helper compartilhado.
    expect(script).not.toMatch(/migrate\s+(?:deploy|resolve)|collectExceptionalFacts|fingerprint\(|\b(?:INSERT INTO|DELETE FROM|UPDATE public\.|GRANT |REVOKE |ALTER ROLE|CREATE ROLE)\b/i);
  });
});
