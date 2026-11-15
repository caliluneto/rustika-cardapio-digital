import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NATIVE_SPECIAL_ROLES, REQUIRED_NON_EMPTY_SECTIONS, SECTIONS, aliasRole, diffSnapshots, fingerprint, snapshotCompletenessProblems,
} from '../../scripts/homolog/schemaSnapshot';
import type { SchemaSnapshot } from '../../scripts/homolog/schemaSnapshot';

const snapshot = (overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot => {
  const base = Object.fromEntries(SECTIONS.map((section) => [section, [] as string[]])) as unknown as SchemaSnapshot;
  for (const section of REQUIRED_NON_EMPTY_SECTIONS) base[section] = [`${section}-item`];
  base.schemas = [`public:${aliasRole('pg_database_owner')}`];
  base.migrations = ['m1:aaa:true:false'];
  return { ...base, ...overrides };
};

describe('proprietário nativo pg_database_owner', () => {
  it('schema public pertencente a pg_database_owner: completo (sem role desconhecida)', () => {
    expect(aliasRole('pg_database_owner')).toBe('pg_database_owner');
    expect(snapshot().schemas).toEqual(['public:pg_database_owner']);
    expect(snapshotCompletenessProblems(snapshot())).toEqual([]);
  });

  it('role legítima já mapeada continua mapeada', () => {
    expect(aliasRole('cardapio_homolog_migrator')).toBe('migrator');
    expect(aliasRole('cardapio_test_app')).toBe('runtime');
    expect(aliasRole('PUBLIC')).toBe('PUBLIC');
    expect(snapshotCompletenessProblems(snapshot({ schemas: ['public:migrator'] }))).toEqual([]);
  });

  it('role desconhecida comum é rejeitada', () => {
    expect(aliasRole('intruso')).toBe('?intruso');
    expect(snapshotCompletenessProblems(snapshot({ schemas: ['public:?intruso'] }))).toContain('role desconhecida em schemas');
  });

  it('role desconhecida com prefixo pg_ é rejeitada (a exceção é por nome exato, lista fechada)', () => {
    for (const role of ['pg_monitor', 'pg_database_owner2', 'pg_database_owne', 'xpg_database_owner', 'PG_DATABASE_OWNER', 'pg_write_all_data']) {
      expect(aliasRole(role), role).toBe(`?${role}`);
      expect(snapshotCompletenessProblems(snapshot({ schemas: [`public:${aliasRole(role)}`] })), role).toContain('role desconhecida em schemas');
    }
    expect([...NATIVE_SPECIAL_ROLES]).toEqual(['pg_database_owner']);
  });

  it('alteração inesperada do proprietário é detectada, e o fingerprint muda', () => {
    const before = snapshot(); const after = snapshot({ schemas: ['public:migrator'] });
    expect(diffSnapshots(before, after)).toEqual([{ section: 'schemas', onlyInA: ['public:pg_database_owner'], onlyInB: ['public:migrator'] }]);
    expect(fingerprint(after)).not.toBe(fingerprint(before));
  });

  it('ownership equivalente antes/depois: sem divergência e mesmo fingerprint', () => {
    expect(diffSnapshots(snapshot(), snapshot())).toEqual([]);
    expect(fingerprint(snapshot())).toBe(fingerprint(snapshot()));
  });

  it('ACLs continuam validadas (role desconhecida em tableAcls falha; grantee nativo no schema não é falso positivo)', () => {
    expect(snapshotCompletenessProblems(snapshot({ tableAcls: ['t:?intruso:SELECT:false'] }))).toContain('role desconhecida em tableAcls');
    expect(snapshotCompletenessProblems(snapshot({ schemaAcls: ['schema:public:pg_database_owner:USAGE:false'] }))).toEqual([]);
  });

  it('defaultAcls vazia continua permitida', () => {
    expect(snapshot().defaultAcls).toEqual([]);
    expect(snapshotCompletenessProblems(snapshot())).toEqual([]);
  });

  it('schemas continua em ROLE_BEARING_SECTIONS e o coletor continua incluindo o dono do schema', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'homolog', 'schemaSnapshot.ts'), 'utf8');
    expect(source).toMatch(/ROLE_BEARING_SECTIONS[^=]*=\s*\[[^\]]*'schemas'/);
    expect(source).toContain('pg_get_userbyid(nspowner)');
    expect(source).not.toMatch(/startsWith\('pg_'\)|\^pg_|LIKE 'pg_/);
  });
});
