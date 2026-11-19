import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PENDING_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import { CATEGORY_CRUD_MIGRATION_NAME, homologDeployCompatibilityProblem } from '../../scripts/prisma-run-policy';
import { HOMOLOG_CATEGORY_MIGRATION, HOMOLOG_EXPECTED_MIGRATIONS, verifyHomologAppliedPrefix, verifyHomologMigrationChain } from '../../scripts/homolog/homologMigrationChain';

const sql = fs.readFileSync(path.join(process.cwd(), 'prisma', 'migrations', CATEGORY_CRUD_MIGRATION_NAME, 'migration.sql'), 'utf8');

describe('10ª migration: compatibilidade da homologação', () => {
  it('registra exatamente a migration local e não altera privilégios de admins nem memberships', () => {
    expect(PENDING_MIGRATIONS.some((migration) => migration.name === CATEGORY_CRUD_MIGRATION_NAME)).toBe(true);
    expect(sql).toContain("current_database() = 'cardapio_digital_dev'");
    expect(sql).toContain("current_database() = 'cardapio_digital_test'");
    expect(sql).toContain("current_user <> 'cardapio_migrator'");
    expect(sql).toContain("current_setting('server_version_num')::int < 180000");
    expect(sql).toContain("RAISE EXCEPTION 'Unauthorized database'");
    expect(sql).not.toMatch(/GRANT[^;]*\badmins\b/i);
    expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+ROLE\b|\bGRANT\s+\w+\s+TO\s+\w+\s+WITH\s+SET\b/i);
    expect(sql).toContain('GRANT INSERT (id, public_key, name, description, display_order, is_active, updated_at)');
    expect(sql).toContain('GRANT UPDATE (name, description, display_order, updated_at)');
    expect(sql).not.toMatch(/GRANT DELETE|GRANT UPDATE \(public_key|GRANT UPDATE \(is_active/i);
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;\s*$/);
  });

  it('bloqueia deploy definitivo e replay, mas não confunde status read-only com autorização', () => {
    for (const profileName of ['migrate-homolog', 'migrate-homolog-replay']) {
      expect(homologDeployCompatibilityProblem({ profileName, migrationSubcommand: 'deploy' }, PENDING_MIGRATIONS)).toMatch(/bloqueado/);
      expect(homologDeployCompatibilityProblem({ profileName, migrationSubcommand: 'status' }, PENDING_MIGRATIONS)).toBeNull();
    }
    expect(homologDeployCompatibilityProblem({ profileName: 'migrate-dev', migrationSubcommand: 'deploy' }, PENDING_MIGRATIONS)).toBeNull();
  });

  it('aceita apenas cadeia remota explícita: nove SQLs históricos byte-idênticos e décimo distinto com checksum próprio', () => {
    const chain = verifyHomologMigrationChain(process.cwd());
    expect(chain.problems).toEqual([]);
    expect(chain.schemaPath).toMatch(/prisma-homolog[\\/]schema\.prisma$/);
    expect(HOMOLOG_EXPECTED_MIGRATIONS).toHaveLength(10);
    expect(HOMOLOG_CATEGORY_MIGRATION.checksum).not.toBe(PENDING_MIGRATIONS[1]?.checksum);
    expect(homologDeployCompatibilityProblem({ profileName: 'migrate-homolog', migrationSubcommand: 'deploy' }, PENDING_MIGRATIONS, chain.problems.length === 0)).toBeNull();
    expect(homologDeployCompatibilityProblem({ profileName: 'migrate-homolog-replay', migrationSubcommand: 'deploy' }, PENDING_MIGRATIONS, true)).toMatch(/bloqueado/);
  });

  it('recusa histórico remoto parcial, falho, checksum local dez e ordem incorreta antes de deploy', () => {
    const valid = HOMOLOG_EXPECTED_MIGRATIONS.map((migration) => ({ ...migration, finished: true, rolledBack: false }));
    expect(verifyHomologAppliedPrefix(valid.slice(0, 9))).toEqual([]);
    expect(verifyHomologAppliedPrefix(valid)).toEqual([]);
    expect(verifyHomologAppliedPrefix(valid.slice(0, 8))).not.toEqual([]);
    expect(verifyHomologAppliedPrefix([...valid.slice(0, 9), { ...valid[9]!, checksum: PENDING_MIGRATIONS[1]!.checksum }]).join(' ')).toMatch(/checksum/);
    expect(verifyHomologAppliedPrefix([...valid.slice(0, 9), { ...valid[9]!, finished: false }]).join(' ')).toMatch(/falha/);
    expect(verifyHomologAppliedPrefix([...valid.slice(0, 8), valid[9]!, valid[8]!]).join(' ')).toMatch(/ordem/);
  });

  it('recusa variante alterada, schema divergente e migration não inventariada sem abrir banco', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-e51-chain-'));
    try {
      fs.cpSync(path.join(process.cwd(), 'prisma-homolog'), path.join(root, 'prisma-homolog'), { recursive: true });
      fs.mkdirSync(path.join(root, 'prisma', 'migrations'), { recursive: true });
      fs.copyFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), path.join(root, 'prisma', 'schema.prisma'));
      fs.copyFileSync(path.join(process.cwd(), 'prisma', 'migrations', 'migration_lock.toml'), path.join(root, 'prisma', 'migrations', 'migration_lock.toml'));
      for (const migration of HOMOLOG_EXPECTED_MIGRATIONS) {
        const target = path.join(root, 'prisma', 'migrations', migration.name);
        fs.mkdirSync(target);
        fs.copyFileSync(path.join(process.cwd(), 'prisma', 'migrations', migration.name, 'migration.sql'), path.join(target, 'migration.sql'));
      }
      expect(verifyHomologMigrationChain(root).problems).toEqual([]);
      const variant = path.join(root, 'prisma-homolog', 'migrations', CATEGORY_CRUD_MIGRATION_NAME, 'migration.sql');
      fs.appendFileSync(variant, '\n-- tampered');
      expect(verifyHomologMigrationChain(root).problems.join(' ')).toMatch(/Checksum da homologação/);
      fs.copyFileSync(path.join(process.cwd(), 'prisma-homolog', 'migrations', CATEGORY_CRUD_MIGRATION_NAME, 'migration.sql'), variant);
      fs.appendFileSync(path.join(root, 'prisma-homolog', 'schema.prisma'), '\n// tampered');
      expect(verifyHomologMigrationChain(root).problems.join(' ')).toMatch(/Schema Prisma/);
      fs.copyFileSync(path.join(process.cwd(), 'prisma-homolog', 'schema.prisma'), path.join(root, 'prisma-homolog', 'schema.prisma'));
      fs.mkdirSync(path.join(root, 'prisma-homolog', 'migrations', '20270101000000_unknown'));
      expect(verifyHomologMigrationChain(root).problems.join(' ')).toMatch(/Conjunto de migrations/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('a trava fica antes da leitura de credenciais e de qualquer conexão no wrapper', () => {
    const wrapper = fs.readFileSync(path.join(process.cwd(), 'scripts', 'prisma-run.ts'), 'utf8');
    expect(wrapper.indexOf('homologDeployCompatibilityProblem(parsed.value, PENDING_MIGRATIONS, !!homologChain)')).toBeGreaterThan(0);
    expect(wrapper.indexOf('homologDeployCompatibilityProblem(parsed.value, PENDING_MIGRATIONS, !!homologChain)'))
      .toBeLessThan(wrapper.indexOf('loadDatabaseProfile(parsed.value.profileName'));
  });
});
