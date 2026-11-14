import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  getBackendRoot,
  loadDatabaseProfile,
  redactSecrets,
  SecretsConfigError,
} from '../src/config/secrets';
import {
  authorizePrismaInvocation,
  checkDeployConfirmation,
  evaluateMigrateDevDatabaseUrl,
  evaluateMigrateDevServerIdentity,
  evaluateProductInsertIdentityColumnsMigrationSql,
  isHomologMigrationProfile,
  MIGRATE_DEV_PROBE_APPLICATION,
  MIGRATE_DEV_PROFILE,
  parsePrismaInvocation,
  PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME,
  type MigrateDevServerFacts,
} from './prisma-run-policy';
import {
  verifyAppliedMigrationPrefix,
  verifyMigrationDirectory,
  type AppliedMigration,
} from './bootstrap/migrationIntegrity';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from './bootstrap/expectedMigrations';
import { PrismaClient } from '@prisma/client';
import { evaluateServerIdentity, readServerFacts } from '../src/config/serverIdentity';
import { evaluateNeonServerIdentity, readNeonServerFacts } from '../src/config/neonServerIdentity';

function fail(message: string): number {
  console.error(`[prisma-run] ${redactSecrets(message)}`);
  return 1;
}

async function main(): Promise<number> {
  const parsed = parsePrismaInvocation(process.argv.slice(2));

  if (!parsed.ok) {
    return fail(parsed.error);
  }

  const confirmation = checkDeployConfirmation(parsed.value);

  if (!confirmation.ok) {
    return fail(confirmation.error);
  }

  const backendRoot = getBackendRoot();
  const prismaCli = path.join(
    backendRoot,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );

  if (!fs.existsSync(prismaCli)) {
    return fail(
      'Prisma CLI local não encontrado. Execute npm install no diretório backend.',
    );
  }

  let database;

  try {
    database = loadDatabaseProfile(parsed.value.profileName, {
      purpose: parsed.value.purpose,
    });
  } catch (error) {
    const message =
      error instanceof SecretsConfigError || error instanceof Error
        ? error.message
        : 'Erro desconhecido ao carregar o perfil de banco.';

    return fail(message);
  }

  const authorization = authorizePrismaInvocation(parsed.value, database);

  if (!authorization.ok) {
    return fail(authorization.error);
  }

  let verifiedDevClient: PrismaClient | undefined;
  if (
    parsed.value.profileName === MIGRATE_DEV_PROFILE &&
    parsed.value.migrationSubcommand === 'deploy'
  ) {
    const urlProblems = evaluateMigrateDevDatabaseUrl(database.databaseUrl);
    if (urlProblems.length > 0) {
      return fail(`Endpoint migrate-dev recusado: ${urlProblems.join(' ')}`);
    }

    const migrationsDirectory = path.join(backendRoot, 'prisma', 'migrations');
    const diskProblems = verifyMigrationDirectory(migrationsDirectory, PENDING_MIGRATIONS);
    if (diskProblems.length > 0) {
      return fail(`Integridade das migrations violada: ${diskProblems.join(' ')}`);
    }

    const pendingMigration = PENDING_MIGRATIONS.find(
      (migration) => migration.name === PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME,
    );
    if (!pendingMigration || PENDING_MIGRATIONS.length !== 1) {
      return fail(
        `Inventário da migration pendente ${PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME} é inválido; nada foi executado.`,
      );
    }
    let pendingSql: string;
    try {
      pendingSql = fs.readFileSync(
        path.join(migrationsDirectory, pendingMigration.name, 'migration.sql'),
        'utf8',
      );
    } catch {
      return fail('Não foi possível reler a migration pendente após validar o inventário; nada foi executado.');
    }
    const pendingProblems = evaluateProductInsertIdentityColumnsMigrationSql(pendingSql, {
      migrationName: pendingMigration.name,
      database: database.database,
    });
    if (pendingProblems.length > 0) {
      return fail(`Conteúdo/GRANTs da migration pendente recusados: ${pendingProblems.join(' ')}`);
    }

    const probeUrl = new URL(database.databaseUrl);
    probeUrl.searchParams.set('connection_limit', '1');
    probeUrl.searchParams.set('application_name', MIGRATE_DEV_PROBE_APPLICATION);
    const client = new PrismaClient({ datasources: { db: { url: probeUrl.toString() } } });
    try {
      const preflight = await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const facts = (await tx.$queryRaw<MigrateDevServerFacts[]>`
          SELECT current_database() AS database,
                 current_user::text AS "currentUser",
                 session_user::text AS "sessionUser",
                 host(inet_server_addr()) AS "serverAddress",
                 host(inet_client_addr()) AS "clientAddress",
                 inet_server_port() AS "serverPort",
                 pg_get_userbyid(d.datdba) AS "databaseOwner",
                 current_setting('server_version_num')::int AS "serverVersionNum",
                 version() AS "fullVersion",
                 a.application_name AS "applicationName",
                 a.backend_type AS "backendType",
                 COALESCE(s.ssl, false) AS ssl,
                 pg_is_in_recovery() AS "inRecovery",
                 current_setting('neon.project_id', true) AS "neonProjectId",
                 (SELECT count(*)::int FROM pg_settings
                   WHERE name ILIKE '%neon%' OR setting ILIKE '%neon%') AS "neonSettingCount",
                 (SELECT count(*)::int FROM pg_settings
                   WHERE name ILIKE 'pgbouncer%' OR setting ILIKE '%pgbouncer%' OR setting ILIKE '%pooler%')
                   AS "poolerSignalCount",
                 EXISTS (SELECT 1 FROM pg_roles
                   WHERE rolname = 'rustika_homolog_marker') AS "homologMarker",
                 EXISTS (SELECT 1 FROM pg_roles r
                   WHERE r.rolname = current_user
                     AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls))
                   AS "unsafeRoleAttributes",
                 EXISTS (SELECT 1 FROM pg_auth_members m
                   WHERE m.member IN (SELECT oid FROM pg_roles
                     WHERE rolname IN ('cardapio_migrator', 'cardapio_dev_app', 'cardapio_test_app')))
                   AS "unsafeRoleMemberships"
          FROM pg_database d
          JOIN pg_stat_activity a ON a.pid = pg_backend_pid()
          LEFT JOIN pg_stat_ssl s ON s.pid = a.pid
          WHERE d.datname = current_database()`)[0];
        const migrations = await tx.$queryRaw<AppliedMigration[]>`
          SELECT migration_name AS name,
                 checksum,
                 finished_at IS NOT NULL AS finished,
                 rolled_back_at IS NOT NULL AS "rolledBack"
          FROM public._prisma_migrations
          ORDER BY started_at, migration_name`;
        return { facts, migrations };
      });

      if (!preflight.facts) {
        await client.$disconnect().catch(() => undefined);
        return fail('Identidade PostgreSQL do migrate-dev não retornou fatos; nada foi executado.');
      }
      const identityProblems = evaluateMigrateDevServerIdentity(preflight.facts);
      if (identityProblems.length > 0) {
        await client.$disconnect().catch(() => undefined);
        return fail(`Identidade PostgreSQL do migrate-dev recusada: ${identityProblems.join(' ')}`);
      }
      const historyProblems = verifyAppliedMigrationPrefix(preflight.migrations, EXPECTED_MIGRATIONS, pendingMigration);
      if (historyProblems.length > 0) {
        await client.$disconnect().catch(() => undefined);
        return fail(`Histórico das migrations anteriores recusado: ${historyProblems.join(' ')}`);
      }
      verifiedDevClient = client;
    } catch {
      await client.$disconnect().catch(() => undefined);
      return fail('Não foi possível comprovar a identidade PostgreSQL e o histórico do migrate-dev em transação somente leitura; nada foi executado.');
    }
  }

  if (parsed.value.migrationSubcommand && isHomologMigrationProfile(database.profile)) {
    // Integridade das migrations (nomes + SHA-256) antes de qualquer conexão da homologação.
    const problems = verifyMigrationDirectory(path.join(backendRoot, 'prisma', 'migrations'));
    if (problems.length > 0) {
      return fail(`Integridade das migrations violada: ${problems.join(' ')}`);
    }

    // Identidade do SERVIDOR (somente leitura): hostname não basta. Cluster marcado, TLS efetivo, sem bancos Dev/Shadow.
    // ponytail: Neon replay profile uses evaluateNeonServerIdentity; dedicated profiles use evaluateServerIdentity.
    if (database.profile === 'migrate-homolog-replay' && database.projectId) {
      try {
        const facts = await readNeonServerFacts(database.databaseUrl, database.host ?? '');
        const identityProblems = evaluateNeonServerIdentity(facts, {
          phase: 'replay',
          expectedProjectId: database.projectId,
          expectedClusterId: database.clusterId ?? '',
          expectedUser: database.user,
          expectedDatabase: database.database,
        });
        if (identityProblems.length > 0) return fail(`Identidade do servidor não confere: ${identityProblems.join(' ')}`);
      } catch {
        return fail('Não foi possível verificar a identidade do servidor de homologação; nada foi executado.');
      }
    } else {
      const client = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
      try {
        const identityProblems = evaluateServerIdentity(await readServerFacts(client), {
          phase: database.environment === 'homolog-replay' ? 'replay' : 'final',
          expectedClusterId: database.clusterId ?? '',
          expectedUser: database.user,
        });
        if (identityProblems.length > 0) return fail(`Identidade do servidor não confere: ${identityProblems.join(' ')}`);
      } catch {
        return fail('Não foi possível verificar a identidade do servidor de homologação; nada foi executado.');
      } finally {
        await client.$disconnect().catch(() => undefined);
      }
    }
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: database.databaseUrl,
  };

  if (database.shadowDatabaseUrl) {
    childEnv.SHADOW_DATABASE_URL = database.shadowDatabaseUrl;
  } else {
    delete childEnv.SHADOW_DATABASE_URL;
  }

  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(
      process.execPath,
      [prismaCli, ...parsed.value.prismaArgs],
      {
        cwd: backendRoot,
        env: childEnv,
        encoding: 'utf8',
      },
    );
  } finally {
    await verifiedDevClient?.$disconnect().catch(() => undefined);
  }

  if (result.error) {
    return fail(`Falha ao executar o Prisma: ${result.error.message}`);
  }

  if (result.stdout) {
    process.stdout.write(redactSecrets(result.stdout));
  }

  if (result.stderr) {
    process.stderr.write(redactSecrets(result.stderr));
  }

  return result.status ?? 1;
}

main().then((code) => process.exit(code));
