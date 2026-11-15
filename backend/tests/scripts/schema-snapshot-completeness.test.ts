import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OPTIONAL_SECTIONS, REQUIRED_NON_EMPTY_SECTIONS, SECTIONS, diffSnapshots, fingerprint, snapshotCompletenessProblems,
} from '../../scripts/homolog/schemaSnapshot';
import type { SchemaSnapshot } from '../../scripts/homolog/schemaSnapshot';

const full = (): SchemaSnapshot => {
  const snapshot = Object.fromEntries(SECTIONS.map((section) => [section, [] as string[]])) as unknown as SchemaSnapshot;
  for (const section of REQUIRED_NON_EMPTY_SECTIONS) snapshot[section] = [`${section}-item`];
  snapshot.migrations = ['m1:aaa:true:false'];
  return snapshot;
};
const DEFAULT_ACL = 'migrator:public:r:runtime:SELECT:false';

describe('completude do snapshot e default ACLs', () => {
  it('defaultAcls (e demais opcionais) vazias antes e depois: equivalência válida e snapshot completo', () => {
    const before = full(); const after = full();
    expect(before.defaultAcls).toEqual([]);
    expect(diffSnapshots(before, after)).toEqual([]);
    expect(fingerprint(after)).toBe(fingerprint(before));
    expect(snapshotCompletenessProblems(after)).toEqual([]);
  });

  it('default ACL criada somente depois: divergência detectada', () => {
    const before = full(); const after = { ...full(), defaultAcls: [DEFAULT_ACL] };
    expect(diffSnapshots(before, after)).toEqual([{ section: 'defaultAcls', onlyInA: [], onlyInB: [DEFAULT_ACL] }]);
    expect(fingerprint(after)).not.toBe(fingerprint(before));
  });

  it('default ACL removida após o rename: divergência detectada', () => {
    const before = { ...full(), defaultAcls: [DEFAULT_ACL] }; const after = full();
    expect(diffSnapshots(before, after)).toEqual([{ section: 'defaultAcls', onlyInA: [DEFAULT_ACL], onlyInB: [] }]);
    expect(fingerprint(after)).not.toBe(fingerprint(before));
  });

  it('default ACL alterada: divergência detectada', () => {
    const before = { ...full(), defaultAcls: [DEFAULT_ACL] };
    const after = { ...full(), defaultAcls: ['migrator:public:r:runtime:INSERT:false'] };
    expect(diffSnapshots(before, after)).toHaveLength(1);
    expect(diffSnapshots(before, after)[0]!.section).toBe('defaultAcls');
    expect(fingerprint(after)).not.toBe(fingerprint(before));
  });

  it('mesmo schema e ACLs com ordem diferente: comparação estável', () => {
    const a = { ...full(), defaultAcls: [DEFAULT_ACL, 'migrator:*:S:runtime:USAGE:false'] };
    const b = { ...full(), defaultAcls: ['migrator:*:S:runtime:USAGE:false', DEFAULT_ACL] };
    expect(diffSnapshots(a, b)).toEqual([]);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('objetos obrigatórios ausentes: falha, uma seção por vez', () => {
    for (const section of REQUIRED_NON_EMPTY_SECTIONS) {
      const snapshot = { ...full(), [section]: [] as string[] };
      expect(snapshotCompletenessProblems(snapshot), section).toContain(`seção obrigatória vazia: ${section}`);
    }
  });

  it('roles desconhecidas: falha em qualquer seção que cita roles, inclusive as opcionais', () => {
    for (const section of ['tableAcls', 'columnAcls', 'defaultAcls', 'owners', 'roles', 'memberships', 'settings', 'schemas', 'policies'] as const) {
      const snapshot = { ...full(), [section]: [...full()[section], 'x:?cardapio_outra:SELECT:false'] };
      expect(snapshotCompletenessProblems(snapshot), section).toContain(`role desconhecida em ${section}`);
    }
  });

  it('não transforma o snapshot em opcional: somente as seções esperadas são opcionais', () => {
    expect([...OPTIONAL_SECTIONS].sort()).toEqual(['defaultAcls', 'functions', 'memberships', 'policies', 'settings', 'triggers', 'views']);
    expect(REQUIRED_NON_EMPTY_SECTIONS).toEqual(expect.arrayContaining(['tables', 'columns', 'constraints', 'indexes', 'tableAcls', 'columnAcls', 'owners', 'roles']));
    expect(REQUIRED_NON_EMPTY_SECTIONS).not.toContain('defaultAcls');
  });

  it('o coletor continua lendo pg_default_acl e a suíte efêmera usa a verificação de completude', () => {
    const collector = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'homolog', 'schemaSnapshot.ts'), 'utf8');
    expect(collector).toContain('FROM pg_default_acl');
    expect(collector).toMatch(/owners: \[[^\n]*defaultAcls/);
    const suite = fs.readFileSync(path.join(__dirname, '..', 'homolog-ephemeral', 'provisioning.ephemeral.ts'), 'utf8');
    expect(suite).toContain('snapshotCompletenessProblems(snapshotB)');
    expect(suite).not.toContain('não pode estar vazia');
    expect(suite).toContain('diffSnapshots(snapshotA, snapshotB)');
    expect(suite).toContain('fingerprint(snapshotB)).toBe(fingerprint(snapshotA)');
  });
});
