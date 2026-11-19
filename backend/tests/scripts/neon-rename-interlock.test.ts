// Fase A.1 — integração dos 3 arquivos órfãos do clone 165719f4 (neonMembershipPolicy, renameInterlock,
// neonReplayPreflight). Sem rede, sem Neon. Cobre as 9 categorias pedidas; identidade/TLS/projeto/endpoint em si
// já têm suíte própria (neon-server-identity.test.ts, external-tls-check.test.ts) — aqui só o contrato novo.
import { describe, expect, it } from 'vitest';
import { evaluatePreRenameMembershipRecovery, evaluateRecoveredMemberships, type PreRenameRecoveryFacts, type NeonMembershipRow } from '../../scripts/homolog/neonMembershipPolicy';
import { evaluateRenameGate, runRenameInterlock, type RenameGateFacts, type RenameInterlockDriver } from '../../scripts/homolog/renameInterlock';
import { evaluateNeonReplayHistory, type ReplayMigrationRow } from '../../scripts/homolog/neonReplayPreflight';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';

const ADMIN = 'neondb_owner';
const adminOnlyRow: NeonMembershipRow = { grantedRole: 'cardapio_migrator', memberRole: ADMIN, grantorRole: 'cloud_admin', grantorIsSuperuser: true, admin: true, set: false, inherit: false };
const tempRow: NeonMembershipRow = { grantedRole: 'cardapio_migrator', memberRole: ADMIN, grantorRole: ADMIN, grantorIsSuperuser: false, admin: false, set: true, inherit: true };
const baseFacts = (patch: Partial<PreRenameRecoveryFacts> = {}): PreRenameRecoveryFacts => ({
  database: 'postgres', currentUser: ADMIN, sessionUser: ADMIN, expectedAdminUser: ADMIN,
  projectIdentityValid: true, markerIdentityValid: true, replayDatabaseExists: true, finalDatabaseExists: false,
  legacyMigratorExists: true, finalMigratorExists: false, replayDatabaseOwner: 'cardapio_migrator',
  memberships: [adminOnlyRow, tempRow], ...patch,
});

describe('A.1 — neonMembershipPolicy', () => {
  it('membership SET/INHERIT temporária + ADMIN-only legítima: aprovado (pré-rename)', () => {
    expect(evaluatePreRenameMembershipRecovery(baseFacts())).toEqual([]);
  });
  it('grantor inesperado na membership temporária: reprovado', () => {
    const bad = { ...tempRow, grantorRole: 'outro_admin' };
    expect(evaluatePreRenameMembershipRecovery(baseFacts({ memberships: [adminOnlyRow, bad] })).join(' ')).toMatch(/membership inesperada|temporária ausente/);
  });
  it('role inesperada conectada: reprovado', () => {
    expect(evaluatePreRenameMembershipRecovery(baseFacts({ currentUser: 'outro' })).join(' ')).toMatch(/executor administrativo inesperado/);
  });
  it('banco incorreto: reprovado', () => {
    expect(evaluatePreRenameMembershipRecovery(baseFacts({ database: 'cardapio_digital_homolog' })).join(' ')).toMatch(/banco postgres/);
  });
  it('estado de rename incompleto (banco final já existe): reprovado', () => {
    expect(evaluatePreRenameMembershipRecovery(baseFacts({ finalDatabaseExists: true })).join(' ')).toMatch(/não é pré-rename/);
  });
  it('membership ADMIN-only legítima pós-rename: aprovado; SET/INHERIT residual: reprovado', () => {
    expect(evaluateRecoveredMemberships([adminOnlyRow], ADMIN)).toEqual([]);
    expect(evaluateRecoveredMemberships([adminOnlyRow, tempRow], ADMIN).join(' ')).toMatch(/SET ou INHERIT residual/);
  });
});

const ALL_MIGRATIONS: ReadonlyArray<{ name: string; checksum: string }> = [...EXPECTED_MIGRATIONS, ...PENDING_MIGRATIONS];
const migRows = (n: 7 | 8 | 9): ReplayMigrationRow[] => ALL_MIGRATIONS.slice(0, n).map((m) => ({
  name: m.name, checksum: m.checksum, startedAt: new Date('2026-01-01'), finishedAt: new Date('2026-01-01T00:00:01Z'), rolledBackAt: null, appliedStepsCount: 1, logs: null,
}));

describe('A.1 — neonReplayPreflight.evaluateNeonReplayHistory (9ª migration via PENDING_MIGRATIONS)', () => {
  it('7/9 e 9/9 íntegros: aprovado', () => {
    expect(evaluateNeonReplayHistory(migRows(7), 'status').ok).toBe(true);
    const nine = evaluateNeonReplayHistory(migRows(9), 'status');
    expect(nine.ok).toBe(true);
    if (nine.ok) expect(nine.appliedCount).toBe(9);
  });
  it('8/9 é incidente: reprovado', () => {
    const r = evaluateNeonReplayHistory(migRows(8), 'status');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(' ')).toMatch(/8\/9 é incidente/);
  });
  it('migration duplicada: reprovado', () => {
    const rows = migRows(7); rows[6] = { ...rows[5]! };
    expect(evaluateNeonReplayHistory(rows, 'status').ok).toBe(false);
  });
});

describe('A.1 — renameInterlock', () => {
  const okFacts = (patch: Partial<RenameGateFacts> = {}): RenameGateFacts => ({
    identityProblems: [], migrations: migRows(9), replayDatabaseExists: true, finalDatabaseExists: false,
    finalRolesPresent: [], databaseOwner: 'cardapio_migrator', objectOwnershipValid: true, aclValid: true,
    membershipsValid: true, activeConnections: 1, allowConnections: true, ...patch,
  });
  it('pré-freeze íntegro: aprovado', () => { expect(evaluateRenameGate(okFacts(), 'pre-freeze')).toEqual([]); });
  it('projeto/cluster incorreto (identityProblems não vazio): reprovado em qualquer fase', () => {
    expect(evaluateRenameGate(okFacts({ identityProblems: ['neon.project_id difere do esperado'] }), 'pre-freeze').length).toBeGreaterThan(0);
  });
  it('estado de rename incompleto (destino final já existe): reprovado', () => {
    expect(evaluateRenameGate(okFacts({ finalDatabaseExists: true }), 'pre-freeze').join(' ')).toMatch(/destino final já existe/);
  });
  it('ausência de autorização (execute=false): só simula, nunca chama freeze/rename', async () => {
    let called = false;
    const driver: RenameInterlockDriver = {
      acquireOperationalLock: async () => {}, inspectPreFreeze: async () => okFacts(),
      freezeReplayDatabase: async () => { called = true; }, inspectReplayAfterFreeze: async () => okFacts({ allowConnections: false }),
      closeReplayVerifier: async () => {}, inspectReadyToRename: async () => okFacts({ allowConnections: false, activeConnections: 0 }),
      executeRename: async () => { called = true; },
    };
    const result = await runRenameInterlock(driver, false);
    expect(result).toEqual({ status: 'simulated', phase: 'pre-freeze' });
    expect(called).toBe(false);
  });
  it('execute=true com tudo íntegro: renomeia; bloqueado se pré-freeze falhar', async () => {
    const driver: RenameInterlockDriver = {
      acquireOperationalLock: async () => {}, inspectPreFreeze: async () => okFacts(),
      freezeReplayDatabase: async () => {}, inspectReplayAfterFreeze: async () => okFacts({ allowConnections: false }),
      closeReplayVerifier: async () => {}, inspectReadyToRename: async () => okFacts({ allowConnections: false, activeConnections: 0 }),
      executeRename: async () => {},
    };
    expect(await runRenameInterlock(driver, true)).toEqual({ status: 'renamed' });
    const blocked: RenameInterlockDriver = { ...driver, inspectPreFreeze: async () => okFacts({ finalDatabaseExists: true }) };
    expect((await runRenameInterlock(blocked, true)).status).toBe('blocked');
  });
});
