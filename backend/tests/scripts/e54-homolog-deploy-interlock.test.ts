import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { E4_ALT_TARGET } from '../../scripts/bootstrap/exceptionalMigratorBootstrap';
import { evaluateE53History, evaluateE53Identity, type E53IdentityRow } from '../../scripts/homolog/e53ReadOnlyVerification';
import { HOMOLOG_CATEGORY_MIGRATION, HOMOLOG_EXPECTED_MIGRATIONS } from '../../scripts/homolog/homologMigrationChain';

const cluster = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const head = (): E53IdentityRow => ({
  database: E4_ALT_TARGET.database, databaseOid: E4_ALT_TARGET.databaseOid,
  currentUser: E4_ALT_TARGET.migratorRole, sessionUser: E4_ALT_TARGET.migratorRole,
  databaseOwner: E4_ALT_TARGET.migratorRole, elevatedRole: false,
  serverVersionNum: 180007, projectId: E4_ALT_TARGET.projectId,
  branchId: E4_ALT_TARGET.branchId, markerComment: `rustika-homolog-cluster:${cluster}`,
});
const nine = () => HOMOLOG_EXPECTED_MIGRATIONS.slice(0, 9).map((m) => ({
  ...m, finished: true, rolledBack: false, logsPresent: false,
}));

describe('E5.4 — interlock do deploy definitivo sem conexão remota', () => {
  it('aceita identidade E5.3 e exatamente nove checksums históricos íntegros', () => {
    expect(evaluateE53Identity(head(), cluster)).toEqual({ problems: [], branchReported: true });
    expect(evaluateE53History(nine())).toEqual([]);
    expect(HOMOLOG_CATEGORY_MIGRATION.checksum).toBe('5a5a2ff3266f912b16991c4dec264db0c719add6cb0c0c58b26e241c96d0216d');
  });

  it.each([
    ['OID', { databaseOid: '1' }],
    ['branch incorreta', { branchId: 'br-outra-branch' }],
    ['branch ausente', { branchId: null }],
    ['role', { currentUser: 'cardapio_homolog_app' }],
    ['projeto', { projectId: 'aged-other-12345678' }],
    ['banco', { database: 'postgres' }],
    ['owner', { databaseOwner: 'neondb_owner' }],
  ] as const)('recusa %s', (_name, patch) => {
    const result = evaluateE53Identity({ ...head(), ...patch }, cluster);
    expect(result.problems.length > 0 || !result.branchReported).toBe(true);
  });

  it('recusa migration inesperada, checksum divergente e tentativa parcial da décima', () => {
    const extra = [...nine(), { name: '20261201000000_unknown', checksum: '0'.repeat(64), finished: true, rolledBack: false, logsPresent: false }];
    expect(evaluateE53History(extra).length).toBeGreaterThan(0);
    const badChecksum = nine(); badChecksum[8] = { ...badChecksum[8]!, checksum: '0'.repeat(64) };
    expect(evaluateE53History(badChecksum).join(' ')).toMatch(/checksum/);
    const partial = [...nine(), { ...HOMOLOG_CATEGORY_MIGRATION, finished: false, rolledBack: false, logsPresent: true }];
    expect(evaluateE53History(partial).length).toBeGreaterThan(0);
  });

  it('executa o Prisma somente após preflight; a migration fixada repete os gates dentro da transação', () => {
    const wrapper = fs.readFileSync(path.join(process.cwd(), 'scripts', 'prisma-run.ts'), 'utf8');
    const preflight = wrapper.indexOf('runSerializableReadOnlyTransaction(client, async (tx) => {');
    const child = wrapper.indexOf('result = spawnSync(');
    expect(preflight).toBeGreaterThan(0);
    expect(wrapper).toContain('evaluateE53Identity(head, database.clusterId!)');
    expect(wrapper).toContain('!identity.branchReported');
    expect(wrapper).toContain('evaluateE53History(rows)');
    expect(wrapper).toContain('strictTargetUrlProblem(database)');
    expect(wrapper).toContain('readNeonServerFacts(database.databaseUrl');
    expect(preflight).toBeLessThan(child);
    expect(wrapper).not.toContain("return fail('NO-GO: identidade/histórico foram conferidos");
    const sql = fs.readFileSync(path.join(process.cwd(), 'prisma-homolog', 'migrations', HOMOLOG_CATEGORY_MIGRATION.name, 'migration.sql'), 'utf8');
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf("current_setting('neon.branch_id', true)"));
    expect(sql.indexOf("current_setting('neon.branch_id', true)")).toBeLessThan(sql.indexOf('GRANT INSERT (id, public_key'));
    expect(sql.indexOf('GRANT UPDATE (name, description')).toBeLessThan(sql.lastIndexOf('COMMIT;'));
    expect(sql).toContain("IS DISTINCT FROM '57355'");
    expect(sql).toContain('Historical migration chain is not exactly 9/9');
  });
});
