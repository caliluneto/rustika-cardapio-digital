import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import {
  evaluatePreRenameMembershipRecovery,
  evaluateRecoveredMemberships,
  type NeonMembershipRow,
  type PreRenameRecoveryFacts,
} from '../../scripts/homolog/neonMembershipPolicy';

const admin = 'neondb_owner';
const temporary = (inherit: boolean): NeonMembershipRow => ({
  grantedRole: 'cardapio_migrator', memberRole: admin, grantorRole: admin,
  grantorIsSuperuser: false, admin: false, set: true, inherit,
});
const adminOnly: NeonMembershipRow = {
  grantedRole: 'cardapio_migrator', memberRole: admin, grantorRole: 'cloud_admin',
  grantorIsSuperuser: true, admin: true, set: false, inherit: false,
};
const good = (memberships: NeonMembershipRow[], changes: Partial<PreRenameRecoveryFacts> = {}): PreRenameRecoveryFacts => ({
  database: 'postgres', currentUser: admin, sessionUser: admin, expectedAdminUser: admin,
  projectIdentityValid: true, markerIdentityValid: true, replayDatabaseExists: true,
  finalDatabaseExists: false, legacyMigratorExists: true, finalMigratorExists: false,
  replayDatabaseOwner: 'cardapio_migrator', memberships, ...changes,
});

describe('contrato público da recuperação de membership Neon pré-rename', () => {
  it.each([false, true])('aceita a única membership temporária com SET e INHERIT=%s', (inherit) => {
    expect(evaluatePreRenameMembershipRecovery(good([adminOnly, temporary(inherit)]))).toEqual([]);
    expect(evaluateRecoveredMemberships([adminOnly], admin)).toEqual([]);
  });

  it('preserva ADMIN-only, mas bloqueia reexecução quando a temporária já não existe', () => {
    expect(evaluatePreRenameMembershipRecovery(good([adminOnly])).join(' ')).toMatch(/reexecução.*bloqueado/);
  });

  it('bloqueia executor, banco, estado pós-rename e owner incorretos', () => {
    for (const changes of [
      { currentUser: 'outro' }, { database: 'cardapio_digital_test' },
      { replayDatabaseExists: false, finalDatabaseExists: true, legacyMigratorExists: false, finalMigratorExists: true },
      { replayDatabaseOwner: 'neondb_owner' }, { projectIdentityValid: false },
    ]) expect(evaluatePreRenameMembershipRecovery(good([adminOnly, temporary(false)], changes)).length).toBeGreaterThan(0);
  });

  it('bloqueia membership inesperada de runtime e resíduos SET/INHERIT', () => {
    const runtime: NeonMembershipRow = { ...temporary(false), memberRole: 'cardapio_test_app' };
    expect(evaluatePreRenameMembershipRecovery(good([adminOnly, temporary(false), runtime])).join(' ')).toMatch(/inesperada/);
    expect(evaluateRecoveredMemberships([adminOnly, temporary(true)], admin).join(' ')).toMatch(/SET ou INHERIT/);
  });

  it('um checkout público não contém nem exige scripts administrativos privados', () => {
    const ownSource = fs.readFileSync(path.join(process.cwd(), 'tests/scripts/neon-membership-grant.test.ts'), 'utf8');
    const privatePath = ['ops', 'homolog', 'sql', 'neon'].join('/');
    expect(ownSource).not.toContain(`${privatePath}/`);
  });

  it('as nove migrations públicas permanecem intactas', () => {
    const names = fs.readdirSync(path.join(process.cwd(), 'prisma/migrations')).filter((p) => /^\d{14}_/.test(p)).sort();
    expect(names).toEqual(EXPECTED_MIGRATIONS.map(({ name }) => name));
  });
});
