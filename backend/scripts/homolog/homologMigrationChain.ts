import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from '../bootstrap/expectedMigrations';
import { verifyAppliedMigrationPrefix, type AppliedMigration } from '../bootstrap/migrationIntegrity';
import { CATEGORY_CRUD_MIGRATION_NAME, PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME } from '../prisma-run-policy';

/** Historical entries share the same bytes. Only migration ten has environment-specific, pinned SQL. */
export const HOMOLOG_CATEGORY_MIGRATION = {
  name: CATEGORY_CRUD_MIGRATION_NAME,
  checksum: '5a5a2ff3266f912b16991c4dec264db0c719add6cb0c0c58b26e241c96d0216d',
} as const;
const ninth = PENDING_MIGRATIONS.find((migration) => migration.name === PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME);
if (!ninth) throw new Error('Historical migration nine is not pinned.');
export const HOMOLOG_EXPECTED_MIGRATIONS = [...EXPECTED_MIGRATIONS, ninth, HOMOLOG_CATEGORY_MIGRATION] as const;

/** Deploy é permitido somente sobre o histórico 9/9 conhecido ou sobre o mesmo 10/10 já aplicado. */
export function verifyHomologAppliedPrefix(rows: readonly AppliedMigration[]): string[] {
  const problems = verifyAppliedMigrationPrefix(rows, HOMOLOG_EXPECTED_MIGRATIONS);
  if (rows.length < 9 || rows.length > 10) problems.push('Deploy exige histórico remoto completo 9/9 ou 10/10.');
  return problems;
}

const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Fail closed before credentials are loaded or a remote connection is opened. Never constructs an ad-hoc SQL chain. */
export function verifyHomologMigrationChain(backendRoot: string): { schemaPath: string; problems: string[] } {
  const source = path.join(backendRoot, 'prisma');
  const mirror = path.join(backendRoot, 'prisma-homolog');
  const schemaPath = path.join(mirror, 'schema.prisma');
  const problems: string[] = [];
  try {
    if (digest(path.join(source, 'schema.prisma')) !== digest(schemaPath)) problems.push('Schema Prisma de homologação divergente.');
    const directory = path.join(mirror, 'migrations');
    if (digest(path.join(source, 'migrations', 'migration_lock.toml')) !== digest(path.join(directory, 'migration_lock.toml'))) {
      problems.push('Lock do provedor Prisma de homologação divergente.');
    }
    const names = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    if (names.join(',') !== HOMOLOG_EXPECTED_MIGRATIONS.map((migration) => migration.name).sort().join(',')) {
      problems.push('Conjunto de migrations da homologação divergente.');
    }
    for (const migration of HOMOLOG_EXPECTED_MIGRATIONS) {
      const file = path.join(directory, migration.name, 'migration.sql');
      if (digest(file) !== migration.checksum) problems.push(`Checksum da homologação divergente: ${migration.name}.`);
      if (migration.name !== CATEGORY_CRUD_MIGRATION_NAME &&
          digest(file) !== digest(path.join(source, 'migrations', migration.name, 'migration.sql'))) {
        problems.push(`Migration histórica diverge do original: ${migration.name}.`);
      }
    }
    const localTenth = PENDING_MIGRATIONS.find((migration) => migration.name === CATEGORY_CRUD_MIGRATION_NAME);
    if (!localTenth || digest(path.join(source, 'migrations', CATEGORY_CRUD_MIGRATION_NAME, 'migration.sql')) !== localTenth.checksum ||
        localTenth.checksum === HOMOLOG_CATEGORY_MIGRATION.checksum) {
      problems.push('Migration local dez foi alterada ou confundida com a variante remota.');
    }
  } catch {
    problems.push('Cadeia de homologação incompleta ou ilegível.');
  }
  return { schemaPath, problems };
}
