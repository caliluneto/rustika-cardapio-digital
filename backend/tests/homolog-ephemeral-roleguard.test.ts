import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_EPHEMERAL_ADMIN_ROLE as ADMIN,
  PROJECT_ROLES_SQL,
  assertExpectedAdminIdentity,
  assertOnlyEphemeralAdminRole,
  assertOnlyPostgresDatabase,
  classifyProjectRoles,
} from './homolog-ephemeral/roleGuard';

describe('roles permitidas no PostgreSQL efemero', () => {
  it('somente a role administrativa legitima: permitido (inicio e apos o cleanup)', () => {
    expect(() => assertOnlyEphemeralAdminRole([ADMIN], ADMIN)).not.toThrow();
  });

  it('role administrativa ausente: falha', () => {
    expect(() => assertOnlyEphemeralAdminRole([], ADMIN)).toThrow(/deve existir/);
  });

  it('identidade administrativa inesperada: falha', () => {
    expect(() => assertExpectedAdminIdentity('rustika_eph_admin2')).toThrow(/inesperada/);
    expect(() => assertOnlyEphemeralAdminRole(['rustika_outra'], 'rustika_outra')).toThrow(/inesperada/);
    expect(() => assertOnlyEphemeralAdminRole([ADMIN], 'postgres')).toThrow(/inesperada/);
  });

  it('outra role rustika_* preexistente: falha', () => {
    expect(() => assertOnlyEphemeralAdminRole([ADMIN, 'rustika_qualquer'], ADMIN)).toThrow(/rustika_qualquer/);
  });

  it('outra role cardapio_* preexistente: falha', () => {
    expect(() => assertOnlyEphemeralAdminRole([ADMIN, 'cardapio_app'], ADMIN)).toThrow(/cardapio_app/);
  });

  it('residuos de roles criadas pelo ensaio: falha', () => {
    for (const role of ['cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_migrator', 'cardapio_homolog_app',
      'cardapio_homolog_placeholder', 'cardapio_homolog_bootstrap', 'rustika_homolog_marker']) {
      expect(() => assertOnlyEphemeralAdminRole([ADMIN, role], ADMIN), role).toThrow(role);
    }
  });

  it('a excecao e por igualdade exata, nunca por prefixo', () => {
    expect(classifyProjectRoles([ADMIN, `${ADMIN}_x`, `x${ADMIN}`], ADMIN).unexpected).toEqual([`${ADMIN}_x`, `x${ADMIN}`]);
    expect(() => assertOnlyEphemeralAdminRole([`${ADMIN}_x`], ADMIN)).toThrow();
  });

  it('banco residual inesperado: falha; somente postgres: permitido', () => {
    expect(() => assertOnlyPostgresDatabase(['postgres'])).not.toThrow();
    expect(() => assertOnlyPostgresDatabase(['postgres', 'cardapio_digital_test'])).toThrow(/cardapio_digital_test/);
    expect(() => assertOnlyPostgresDatabase([])).toThrow();
  });

  it('a consulta nao exclui a administrativa por SQL generico e cobre cardapio_ e rustika_', () => {
    expect(PROJECT_ROLES_SQL).toContain("LIKE 'cardapio\\_%'");
    expect(PROJECT_ROLES_SQL).toContain("LIKE 'rustika\\_%'");
    expect(PROJECT_ROLES_SQL).not.toMatch(/<>|NOT IN|!=/);
  });

  it('a suite efemera usa o guard no inicio e no cleanup e nao remove a role administrativa', () => {
    const source = fs.readFileSync(path.join(__dirname, 'homolog-ephemeral', 'provisioning.ephemeral.ts'), 'utf8');
    expect(source).toContain('assertOnlyEphemeralAdminRole');
    expect(source.match(/assertOnlyEphemeralAdminRole\(/g)!.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('assertOnlyPostgresDatabase');
    const allRoles = /const ALL_ROLES = \[([^\]]*)\]/.exec(source)![1]!;
    expect(allRoles).not.toContain('rustika_eph_admin');
    expect(source).not.toMatch(/DROP ROLE[^\n]*(ADMIN_USER|rustika_eph_admin)/);
    expect(source).not.toMatch(/rolname\s+LIKE[^\n]*\bDROP\b/);
  });
});
