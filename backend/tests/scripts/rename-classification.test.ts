import { describe, expect, it } from 'vitest';
import { APPROVED_RENAMES, classifyRenames, SECTIONS } from '../../scripts/homolog/schemaSnapshot';

const before = { database: 'cardapio_digital_test', projectRoles: ['cardapio_dev_app', 'cardapio_homolog_bootstrap', 'cardapio_migrator', 'cardapio_test_app'] };
const after = { database: 'cardapio_digital_homolog', projectRoles: ['cardapio_homolog_app', 'cardapio_homolog_bootstrap', 'cardapio_homolog_migrator', 'cardapio_homolog_placeholder'] };

describe('renomeações legítimas × alterações inesperadas', () => {
  it('reconhece exatamente as quatro renomeações aprovadas (banco + 3 roles) e mantém o bootstrap', () => {
    const report = classifyRenames(before, after);
    expect(report.unexpected).toEqual([]);
    expect(report.renamed).toHaveLength(4);
    expect(report.renamed).toEqual(expect.arrayContaining([
      { from: 'cardapio_digital_test', to: 'cardapio_digital_homolog' }, { from: 'cardapio_test_app', to: 'cardapio_homolog_app' },
      { from: 'cardapio_migrator', to: 'cardapio_homolog_migrator' }, { from: 'cardapio_dev_app', to: 'cardapio_homolog_placeholder' },
    ]));
    expect(Object.keys(APPROVED_RENAMES)).toHaveLength(4);
  });

  it('role não renomeada, role extra, destino trocado, banco errado e role sumida são inesperados', () => {
    expect(classifyRenames(before, { ...after, projectRoles: [...after.projectRoles.filter((r) => r !== 'cardapio_homolog_app'), 'cardapio_test_app'] }).unexpected.length).toBeGreaterThan(0);
    expect(classifyRenames(before, { ...after, projectRoles: [...after.projectRoles, 'cardapio_intruso'] }).unexpected.join(' ')).toMatch(/cardapio_intruso/);
    expect(classifyRenames(before, { ...after, database: 'cardapio_digital_dev' }).unexpected.join(' ')).toMatch(/banco/);
    expect(classifyRenames(before, { ...after, projectRoles: after.projectRoles.filter((r) => r !== 'cardapio_homolog_bootstrap') }).unexpected.join(' ')).toMatch(/bootstrap/);
    expect(classifyRenames(before, { ...after, projectRoles: after.projectRoles.map((r) => (r === 'cardapio_homolog_migrator' ? 'cardapio_outro' : r)) }).unexpected.length).toBeGreaterThan(0);
  });

  it('o snapshot cobre todos os tipos de objeto exigidos na revisão', () => {
    for (const section of ['schemas', 'tables', 'columns', 'constraints', 'indexes', 'enums', 'sequences', 'functions', 'views', 'triggers', 'policies', 'owners', 'tableAcls', 'columnAcls', 'defaultAcls', 'roles', 'memberships', 'settings', 'databaseProps']) {
      expect(SECTIONS as readonly string[]).toContain(section);
    }
  });
});
