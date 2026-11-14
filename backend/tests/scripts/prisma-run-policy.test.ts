import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authorizePrismaInvocation,
  checkDeployConfirmation,
  DEPLOY_CONFIRMATION_ENV,
  DEPLOY_CONFIRMATION_VALUE,
  evaluateMigrateDevDatabaseUrl,
  evaluateMigrateDevServerIdentity,
  evaluateProductInsertIdentityColumnsMigrationSql,
  evaluateRf006MigrationSql,
  MIGRATE_DEV_CONFIRMATION_ENV,
  MIGRATE_DEV_CONFIRMATION_VALUE,
  MIGRATE_DEV_DATABASE,
  MIGRATE_DEV_PROBE_APPLICATION,
  MIGRATE_DEV_PROFILE,
  MIGRATE_TEST_DATABASE,
  parsePrismaInvocation,
  PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME,
  RF006_MIGRATION_NAME,
  type MigrateDevServerFacts,
  type ParsedPrismaInvocation,
} from '../../scripts/prisma-run-policy';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import { verifyAppliedMigrationPrefix } from '../../scripts/bootstrap/migrationIntegrity';

const migrationTestDatabase = {
  profile: 'migrate-test',
  purpose: 'migration' as const,
  database: 'cardapio_digital_test',
  user: 'cardapio_migrator',
};

const migrationDevDatabase = {
  profile: MIGRATE_DEV_PROFILE,
  purpose: 'migration' as const,
  database: 'cardapio_digital_dev',
  user: 'cardapio_migrator',
};

const runtimeTestDatabase = {
  profile: 'app-test',
  purpose: 'runtime' as const,
  database: 'cardapio_digital_test',
  user: 'cardapio_test_app',
};

const confirmedEnv = {
  [DEPLOY_CONFIRMATION_ENV]: DEPLOY_CONFIRMATION_VALUE,
};
const confirmedDevEnv = {
  [MIGRATE_DEV_CONFIRMATION_ENV]: MIGRATE_DEV_CONFIRMATION_VALUE,
};

function migrateInvocation(
  subcommand: 'status' | 'deploy',
  profile = 'migrate-test',
): ParsedPrismaInvocation {
  const parsed = parsePrismaInvocation([profile, 'migrate', subcommand]);

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  return parsed.value;
}

describe('parsePrismaInvocation', () => {
  it('preserva validate e generate com seus argumentos', () => {
    const validate = parsePrismaInvocation(['migrate-dev', 'validate']);
    const generate = parsePrismaInvocation([
      'app-dev',
      'generate',
      '--schema',
      'prisma/schema.prisma',
    ]);

    expect(validate).toEqual({
      ok: true,
      value: {
        profileName: 'migrate-dev',
        purpose: 'any',
        prismaArgs: ['validate'],
      },
    });
    expect(generate).toEqual({
      ok: true,
      value: {
        profileName: 'app-dev',
        purpose: 'any',
        prismaArgs: ['generate', '--schema', 'prisma/schema.prisma'],
      },
    });
  });

  it('permite migrate status com migrate-test', () => {
    expect(parsePrismaInvocation(['migrate-test', 'migrate', 'status'])).toEqual({
      ok: true,
      value: {
        profileName: 'migrate-test',
        purpose: 'migration',
        prismaArgs: ['migrate', 'status'],
        migrationSubcommand: 'status',
      },
    });
  });

  it('permite migrate deploy com migrate-test', () => {
    expect(parsePrismaInvocation(['migrate-test', 'migrate', 'deploy'])).toEqual({
      ok: true,
      value: {
        profileName: 'migrate-test',
        purpose: 'migration',
        prismaArgs: ['migrate', 'deploy'],
        migrationSubcommand: 'deploy',
      },
    });
  });

  it('permite exclusivamente migrate deploy com migrate-dev', () => {
    expect(parsePrismaInvocation([MIGRATE_DEV_PROFILE, 'migrate', 'deploy'])).toEqual({
      ok: true,
      value: {
        profileName: MIGRATE_DEV_PROFILE,
        purpose: 'migration',
        prismaArgs: ['migrate', 'deploy'],
        migrationSubcommand: 'deploy',
      },
    });
    expect(parsePrismaInvocation([MIGRATE_DEV_PROFILE, 'migrate', 'status'])).toMatchObject({ ok: false });
    expect(parsePrismaInvocation([MIGRATE_DEV_PROFILE, 'migrate', 'deploy', '--force'])).toMatchObject({ ok: false });
  });

  it.each([
    ['dev'],
    ['reset'],
    ['resolve'],
    ['unknown'],
  ])('bloqueia migrate %s', (subcommand) => {
    expect(
      parsePrismaInvocation(['migrate-test', 'migrate', subcommand]),
    ).toMatchObject({ ok: false });
  });

  it.each([
    ['db', 'push'],
    ['seed'],
    ['dev'],
    ['reset'],
    ['resolve'],
  ])('bloqueia o comando %s', (...command) => {
    expect(parsePrismaInvocation(['migrate-test', ...command])).toMatchObject({
      ok: false,
    });
  });

  it('rejeita migrate sem subcomando', () => {
    expect(parsePrismaInvocation(['migrate-test', 'migrate'])).toMatchObject({
      ok: false,
    });
  });

  it.each([
    ['app-test', 'migrate', 'status'],
    ['migrate-test', 'migrate', 'deploy', '--force'],
    ['migrate-test', 'migrate', 'status', 'extra'],
  ])('rejeita combinação não autorizada: %s', (...argv) => {
    expect(parsePrismaInvocation(argv)).toMatchObject({ ok: false });
  });
});

describe('checkDeployConfirmation', () => {
  it('exige confirmação antes de carregar credenciais para deploy', () => {
    expect(
      checkDeployConfirmation(migrateInvocation('deploy'), {}),
    ).toMatchObject({ ok: false });
  });

  it('aceita confirmação explícita para deploy', () => {
    expect(
      checkDeployConfirmation(migrateInvocation('deploy'), confirmedEnv),
    ).toEqual({ ok: true });
  });

  it('não exige confirmação para status', () => {
    expect(
      checkDeployConfirmation(migrateInvocation('status'), {}),
    ).toEqual({ ok: true });
  });

  it('exige a confirmação própria do Dev e não aceita a confirmação do Test', () => {
    const invocation = migrateInvocation('deploy', MIGRATE_DEV_PROFILE);
    expect(checkDeployConfirmation(invocation, {})).toMatchObject({ ok: false });
    expect(checkDeployConfirmation(invocation, confirmedEnv)).toMatchObject({ ok: false });
    expect(checkDeployConfirmation(invocation, confirmedDevEnv)).toEqual({ ok: true });
  });
});

describe('authorizePrismaInvocation', () => {
  it('autoriza comandos existentes sem confirmação', () => {
    const parsed = parsePrismaInvocation(['app-dev', 'validate']);

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(
      authorizePrismaInvocation(parsed.value, runtimeTestDatabase, {}),
    ).toEqual({ ok: true });
  });

  it('autoriza migrate status no banco de teste sem confirmação', () => {
    expect(
      authorizePrismaInvocation(migrateInvocation('status'), migrationTestDatabase, {}),
    ).toEqual({ ok: true });
  });

  it('recusa migrate deploy sem confirmação explícita', () => {
    expect(
      authorizePrismaInvocation(migrateInvocation('deploy'), migrationTestDatabase, {}),
    ).toMatchObject({ ok: false });
  });

  it('recusa migrate deploy com confirmação incorreta', () => {
    expect(
      authorizePrismaInvocation(migrateInvocation('deploy'), migrationTestDatabase, {
        [DEPLOY_CONFIRMATION_ENV]: 'VALOR_INCORRETO',
      }),
    ).toMatchObject({ ok: false });
  });

  it('autoriza migrate deploy com confirmação explícita', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('deploy'),
        migrationTestDatabase,
        confirmedEnv,
      ),
    ).toEqual({ ok: true });
  });

  it('autoriza somente migrate deploy coerente no perfil migrate-dev', () => {
    const invocation = migrateInvocation('deploy', MIGRATE_DEV_PROFILE);
    expect(authorizePrismaInvocation(invocation, migrationDevDatabase, confirmedDevEnv)).toEqual({ ok: true });
    expect(authorizePrismaInvocation(invocation, migrationDevDatabase, confirmedEnv)).toMatchObject({ ok: false });
    expect(authorizePrismaInvocation(invocation, { ...migrationDevDatabase, user: 'cardapio_dev_app' }, confirmedDevEnv)).toMatchObject({ ok: false });
    expect(authorizePrismaInvocation(invocation, { ...migrationDevDatabase, database: 'cardapio_digital_test' }, confirmedDevEnv)).toMatchObject({ ok: false });
    expect(authorizePrismaInvocation(invocation, { ...migrationDevDatabase, environment: 'homolog' as const }, confirmedDevEnv)).toMatchObject({ ok: false });
  });

  it('recusa perfil com finalidade incorreta', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('status'),
        runtimeTestDatabase,
        {},
      ),
    ).toMatchObject({ ok: false });
  });

  it('recusa perfil com nome incorreto', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('status'),
        {
          profile: 'migrate-dev',
          purpose: 'migration',
          database: 'cardapio_digital_test',
          user: 'cardapio_migrator',
        },
        {},
      ),
    ).toMatchObject({ ok: false });
  });

  it('recusa banco incorreto', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('deploy'),
        migrationDevDatabase,
        confirmedEnv,
      ),
    ).toMatchObject({ ok: false });
  });
});

const validDevUrl = 'postgresql://cardapio_migrator:segredo@127.0.0.1:5432/cardapio_digital_dev?schema=public';
const validServerFacts: MigrateDevServerFacts = {
  database: 'cardapio_digital_dev',
  currentUser: 'cardapio_migrator',
  sessionUser: 'cardapio_migrator',
  serverAddress: '127.0.0.1',
  clientAddress: '127.0.0.1',
  serverPort: 5432,
  databaseOwner: 'cardapio_migrator',
  serverVersionNum: 180006,
  fullVersion: 'PostgreSQL 18.6 on x86_64-windows',
  applicationName: MIGRATE_DEV_PROBE_APPLICATION,
  backendType: 'client backend',
  ssl: false,
  inRecovery: false,
  neonProjectId: null,
  neonSettingCount: 0,
  poolerSignalCount: 0,
  homologMarker: false,
  unsafeRoleAttributes: false,
  unsafeRoleMemberships: false,
};

describe('identidade independente do PostgreSQL migrate-dev', () => {
  it('aceita somente a URL direta e exata do Dev local', () => {
    expect(evaluateMigrateDevDatabaseUrl(validDevUrl)).toEqual([]);
  });

  it.each([
    ['host remoto', 'postgresql://cardapio_migrator:x@db.example:5432/cardapio_digital_dev?schema=public'],
    ['localhost ambíguo', 'postgresql://cardapio_migrator:x@localhost:5432/cardapio_digital_dev?schema=public'],
    ['porta implícita', 'postgresql://cardapio_migrator:x@127.0.0.1/cardapio_digital_dev?schema=public'],
    ['pooler', 'postgresql://cardapio_migrator:x@127.0.0.1:5432/cardapio_digital_dev?schema=public&pgbouncer=true'],
    ['banco incorreto', 'postgresql://cardapio_migrator:x@127.0.0.1:5432/cardapio_digital_test?schema=public'],
    ['role incorreta', 'postgresql://cardapio_dev_app:x@127.0.0.1:5432/cardapio_digital_dev?schema=public'],
  ])('recusa %s pela URL', (_case, url) => {
    expect(evaluateMigrateDevDatabaseUrl(url)).not.toEqual([]);
  });

  it('aceita fatos reais somente quando toda a identidade local é comprovada', () => {
    expect(evaluateMigrateDevServerIdentity(validServerFacts)).toEqual([]);
  });

  it.each([
    ['servidor remoto', { serverAddress: '10.0.0.5' }],
    ['cliente remoto/túnel', { clientAddress: '10.0.0.7' }],
    ['porta de pooler', { serverPort: 6432 }],
    ['role trocada', { currentUser: 'postgres' }],
    ['Neon', { neonProjectId: 'project-neon', neonSettingCount: 1 }],
    ['homologação', { homologMarker: true }],
    ['SSL inesperado', { ssl: true }],
    ['PgBouncer', { fullVersion: 'PgBouncer 1.24' }],
    ['sinal de pooler', { poolerSignalCount: 1 }],
    ['role privilegiada', { unsafeRoleAttributes: true }],
    ['membership inesperado', { unsafeRoleMemberships: true }],
  ])('recusa %s pelos fatos do servidor', (_case, override) => {
    expect(evaluateMigrateDevServerIdentity({ ...validServerFacts, ...override })).not.toEqual([]);
  });
});

describe('conteúdo e GRANTs da migration RF006', () => {
  const migrationFile = path.join(process.cwd(), 'prisma', 'migrations', RF006_MIGRATION_NAME, 'migration.sql');
  const currentSql = fs.readFileSync(migrationFile, 'utf8');
  const runnerSource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'prisma-run.ts'), 'utf8');

  it('aceita a migration corrigida com os três GRANTs esperados', () => {
    expect(evaluateRf006MigrationSql(currentSql)).toEqual([]);
  });

  it('recusa a forma incoerente que promete DELETE mas aborta após concedê-lo', () => {
    const inconsistent = currentSql.replace(
      "OR NOT has_table_privilege(target_role, 'public.products', 'DELETE')",
      "OR has_table_privilege(target_role, 'public.products', 'DELETE')",
    );
    expect(evaluateRf006MigrationSql(inconsistent).join(' ')).toMatch(/aborta após concedê-lo/i);
  });

  it('executa todos os gates do Dev antes de chamar o Prisma CLI', () => {
    const spawn = runnerSource.indexOf('spawnSync(');
    expect(spawn).toBeGreaterThan(0);
    for (const gate of [
      'checkDeployConfirmation(parsed.value)',
      'authorizePrismaInvocation(parsed.value, database)',
      'evaluateMigrateDevDatabaseUrl(database.databaseUrl)',
      'verifyMigrationDirectory(migrationsDirectory, PENDING_MIGRATIONS)',
      'evaluateProductInsertIdentityColumnsMigrationSql(pendingSql, {',
      "SET TRANSACTION READ ONLY",
      'evaluateMigrateDevServerIdentity(preflight.facts)',
      'verifyAppliedMigrationPrefix(preflight.migrations, EXPECTED_MIGRATIONS, pendingMigration)',
    ]) {
      expect(runnerSource.indexOf(gate), gate).toBeGreaterThan(0);
      expect(runnerSource.indexOf(gate), gate).toBeLessThan(spawn);
    }
  });
});

describe('conteúdo e GRANTs da migration pendente de identidade de INSERT', () => {
  const migrationFile = path.join(
    process.cwd(),
    'prisma',
    'migrations',
    PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME,
    'migration.sql',
  );
  const currentSql = fs.readFileSync(migrationFile, 'utf8');
  const devContext = { migrationName: PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME, database: MIGRATE_DEV_DATABASE };
  const testContext = { migrationName: PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME, database: MIGRATE_TEST_DATABASE };

  it('aceita a migration exata nos bancos Dev e Test autorizados', () => {
    expect(evaluateProductInsertIdentityColumnsMigrationSql(currentSql, devContext)).toEqual([]);
    expect(evaluateProductInsertIdentityColumnsMigrationSql(currentSql, testContext)).toEqual([]);
  });

  it('recusa migration com nome diferente do esperado', () => {
    const problems = evaluateProductInsertIdentityColumnsMigrationSql(currentSql, {
      ...devContext,
      migrationName: '20261114000000_outra_migration',
    });
    expect(problems.join(' ')).toMatch(/identidade de INSERT/i);
  });

  it('recusa banco fora de Dev/Test mesmo com SQL íntegro', () => {
    const problems = evaluateProductInsertIdentityColumnsMigrationSql(currentSql, {
      ...devContext,
      database: 'cardapio_digital_homolog',
    });
    expect(problems.join(' ')).toMatch(/Banco não autorizado/i);
  });

  it('recusa role destinatária divergente no ramo do banco autorizado', () => {
    const tampered = currentSql.replace(
      "current_database() = 'cardapio_digital_dev' THEN\n    target_role := 'cardapio_dev_app';",
      "current_database() = 'cardapio_digital_dev' THEN\n    target_role := 'cardapio_test_app';",
    );
    expect(tampered).not.toBe(currentSql);
    expect(evaluateProductInsertIdentityColumnsMigrationSql(tampered, devContext).join(' ')).toMatch(/Seleção de banco\/role inválida/i);
  });

  it('recusa GRANT amplo, coluna extra ou GRANT adicional', () => {
    const broad = currentSql.replace(
      'INSERT (id, updated_at) ON TABLE public.products',
      'INSERT ON TABLE public.products',
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(broad, devContext).join(' ')).toMatch(/exatamente um GRANT INSERT \(id, updated_at\)/i);

    const extraColumn = currentSql.replace(
      'INSERT (id, updated_at) ON TABLE public.products',
      'INSERT (id, updated_at, name) ON TABLE public.products',
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(extraColumn, devContext).join(' ')).toMatch(/exatamente um GRANT INSERT \(id, updated_at\)/i);

    const extraGrant = currentSql.replace(
      'COMMIT;',
      'GRANT INSERT ON TABLE public.products TO cardapio_dev_app;\nCOMMIT;',
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(extraGrant, devContext).join(' ')).toMatch(/exatamente um GRANT INSERT \(id, updated_at\)/i);
  });

  it('recusa DDL/DML, PUBLIC e referência a role/banco fora do escopo', () => {
    const dataChange = currentSql.replace(
      'COMMIT;',
      'UPDATE public.products SET name = name;\nCOMMIT;',
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(dataChange, devContext).join(' ')).toMatch(/DDL\/DML/i);

    const publicGrant = currentSql.replace(
      'COMMIT;',
      'GRANT SELECT ON TABLE public.products TO PUBLIC;\nCOMMIT;',
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(publicGrant, devContext).join(' ')).toMatch(/PUBLIC/i);

    const foreignRole = currentSql.replace(
      'END\n$security$;',
      "IF current_user = 'cardapio_test_fixtures' THEN NULL; END IF;\nEND\n$security$;",
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(foreignRole, devContext).join(' ')).toMatch(/fora do escopo/i);
  });

  it('recusa alteração de pré-condição, pós-condição ou identidade do migrator', () => {
    const weakenedPre = currentSql.replace(
      "IF NOT has_column_privilege(target_role, 'public.products', 'name', 'INSERT')",
      "IF has_column_privilege(target_role, 'public.products', 'name', 'INSERT')",
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(weakenedPre, devContext).join(' ')).toMatch(/Pré-condição/i);

    const weakenedPost = currentSql.replace(
      "IF NOT has_column_privilege(target_role, 'public.products', 'id', 'INSERT')",
      "IF has_column_privilege(target_role, 'public.products', 'id', 'INSERT')",
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(weakenedPost, devContext).join(' ')).toMatch(/Pós-condição/i);

    const wrongMigrator = currentSql.replace(
      "current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'",
      "current_user <> 'postgres' OR session_user <> 'postgres'",
    );
    expect(evaluateProductInsertIdentityColumnsMigrationSql(wrongMigrator, devContext).join(' ')).toMatch(/cardapio_migrator/i);
  });

  it('recusa checksum divergente e histórico fora de ordem antes do spawn', () => {
    const pending = PENDING_MIGRATIONS[0]!;
    const rows = [...EXPECTED_MIGRATIONS, pending].map(({ name, checksum }) => ({
      name,
      checksum,
      finished: true,
      rolledBack: false,
    }));
    expect(verifyAppliedMigrationPrefix(rows, EXPECTED_MIGRATIONS, pending)).toEqual([]);

    const divergent = rows.map((row) => row.name === pending.name ? { ...row, checksum: '0'.repeat(64) } : row);
    expect(verifyAppliedMigrationPrefix(divergent, EXPECTED_MIGRATIONS, pending).join(' ')).toMatch(/checksum gravado diverge/i);

    const outOfOrder = [...rows];
    [outOfOrder[6], outOfOrder[7]] = [outOfOrder[7]!, outOfOrder[6]!];
    expect(verifyAppliedMigrationPrefix(outOfOrder, EXPECTED_MIGRATIONS, pending).join(' ')).toMatch(/ordem de migrations divergente/i);
  });
});
