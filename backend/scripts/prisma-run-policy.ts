import type { DatabaseSecrets, RequestedPurpose } from '../src/config/secrets';

export const MIGRATE_TEST_PROFILE = 'migrate-test';
export const MIGRATE_TEST_DATABASE = 'cardapio_digital_test';
export const DEPLOY_CONFIRMATION_ENV = 'CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION';
export const DEPLOY_CONFIRMATION_VALUE = 'APPLY_CARDAPIO_DIGITAL_TEST';
export const MIGRATE_DEV_PROFILE = 'migrate-dev';
export const MIGRATE_DEV_DATABASE = 'cardapio_digital_dev';
export const MIGRATE_DEV_USER = 'cardapio_migrator';
export const MIGRATE_DEV_HOST = '127.0.0.1';
export const MIGRATE_DEV_PORT = 5432;
export const MIGRATE_DEV_CONFIRMATION_ENV = 'CARDAPIO_MIGRATE_DEV_CONFIRMATION';
export const MIGRATE_DEV_CONFIRMATION_VALUE = 'APPLY_RF006_TO_CARDAPIO_DIGITAL_DEV';
export const MIGRATE_DEV_PROBE_APPLICATION = 'rustika-rf006-migrate-dev-preflight';
export const RF006_MIGRATION_NAME = '20261110000000_rf006_product_crud_privilege';
export const PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME = '20261114000000_product_insert_identity_columns';
// Homologação remota. Perfil, banco e confirmação PRÓPRIOS; a confirmação do Test local não vale aqui.
// Banco definitivo `cardapio_digital_homolog`; o replay das migrations históricas usa perfil, banco transitório e confirmação próprios.
export const MIGRATE_HOMOLOG_PROFILE = 'migrate-homolog';
export const MIGRATE_HOMOLOG_DATABASE = 'cardapio_digital_homolog';
export const HOMOLOG_DEPLOY_CONFIRMATION_ENV = 'CARDAPIO_MIGRATE_HOMOLOG_CONFIRMATION';
export const HOMOLOG_DEPLOY_CONFIRMATION_VALUE = 'APPLY_RUSTIKA_HOMOLOG_MIGRATIONS';
export const MIGRATE_REPLAY_PROFILE = 'migrate-homolog-replay';
export const MIGRATE_REPLAY_DATABASE = 'cardapio_digital_test';
export const REPLAY_CONFIRMATION_ENV = 'CARDAPIO_MIGRATE_HOMOLOG_REPLAY_CONFIRMATION';
export const REPLAY_CONFIRMATION_VALUE = 'REPLAY_HISTORICAL_MIGRATIONS_RUSTIKA_HOMOLOG';

interface HomologMigrationRule { environment: 'homolog' | 'homolog-replay'; database: string; confirmationEnv: string; confirmationValue: string }
const HOMOLOG_MIGRATION_RULES: Record<string, HomologMigrationRule> = {
  [MIGRATE_HOMOLOG_PROFILE]: { environment: 'homolog', database: MIGRATE_HOMOLOG_DATABASE, confirmationEnv: HOMOLOG_DEPLOY_CONFIRMATION_ENV, confirmationValue: HOMOLOG_DEPLOY_CONFIRMATION_VALUE },
  [MIGRATE_REPLAY_PROFILE]: { environment: 'homolog-replay', database: MIGRATE_REPLAY_DATABASE, confirmationEnv: REPLAY_CONFIRMATION_ENV, confirmationValue: REPLAY_CONFIRMATION_VALUE },
};
export const isHomologMigrationProfile = (name: string): boolean => name in HOMOLOG_MIGRATION_RULES;

const EXISTING_COMMANDS = new Set(['validate', 'generate']);
const BLOCKED_COMMANDS = new Set(['dev', 'reset', 'resolve', 'db', 'push', 'seed']);

export type MigrationSubcommand = 'status' | 'deploy';

export interface ParsedPrismaInvocation {
  profileName: string;
  purpose: RequestedPurpose;
  prismaArgs: string[];
  migrationSubcommand?: MigrationSubcommand;
}

export type ParsePrismaInvocationResult =
  | { ok: true; value: ParsedPrismaInvocation }
  | { ok: false; error: string };

export type AuthorizationResult =
  | { ok: true }
  | { ok: false; error: string };

export interface MigrateDevServerFacts {
  database: string;
  currentUser: string;
  sessionUser: string;
  serverAddress: string | null;
  clientAddress: string | null;
  serverPort: number | null;
  databaseOwner: string | null;
  serverVersionNum: number;
  fullVersion: string;
  applicationName: string;
  backendType: string;
  ssl: boolean;
  inRecovery: boolean;
  neonProjectId: string | null;
  neonSettingCount: number;
  poolerSignalCount: number;
  homologMarker: boolean;
  unsafeRoleAttributes: boolean;
  unsafeRoleMemberships: boolean;
}

export function parsePrismaInvocation(
  argv: readonly string[],
): ParsePrismaInvocationResult {
  const [profileName, command, ...args] = argv;

  if (!profileName || !command) {
    return {
      ok: false,
      error:
        'Uso: tsx scripts/prisma-run.ts <perfil> <validate|generate|migrate> [argumentos]',
    };
  }

  if (EXISTING_COMMANDS.has(command)) {
    return {
      ok: true,
      value: {
        profileName,
        purpose: 'any',
        prismaArgs: [command, ...args],
      },
    };
  }

  if (BLOCKED_COMMANDS.has(command)) {
    return {
      ok: false,
      error: `Comando bloqueado: ${command}. Permitidos: validate, generate, migrate status, migrate deploy.`,
    };
  }

  if (command !== 'migrate') {
    return {
      ok: false,
      error: `Comando não permitido nesta fase: ${command}. Permitidos: validate, generate, migrate status, migrate deploy.`,
    };
  }

  if (
    profileName !== MIGRATE_TEST_PROFILE &&
    profileName !== MIGRATE_DEV_PROFILE &&
    !isHomologMigrationProfile(profileName)
  ) {
    return {
      ok: false,
      error: `O comando migrate exige exclusivamente o perfil ${MIGRATE_TEST_PROFILE}.`,
    };
  }

  if (args.length === 0) {
    return {
      ok: false,
      error: 'Informe migrate status ou migrate deploy.',
    };
  }

  if (args.length > 1) {
    return {
      ok: false,
      error: 'migrate status e migrate deploy não aceitam argumentos adicionais.',
    };
  }

  const subcommand = args[0];

  if (subcommand !== 'status' && subcommand !== 'deploy') {
    return {
      ok: false,
      error: `Subcomando migrate bloqueado ou desconhecido: ${subcommand}. Permitidos: status, deploy.`,
    };
  }

  if (profileName === MIGRATE_DEV_PROFILE && subcommand !== 'deploy') {
    return {
      ok: false,
      error: `O perfil ${MIGRATE_DEV_PROFILE} permite exclusivamente migrate deploy.`,
    };
  }

  return {
    ok: true,
    value: {
      profileName,
      purpose: 'migration',
      prismaArgs: ['migrate', subcommand],
      migrationSubcommand: subcommand,
    },
  };
}

export function checkDeployConfirmation(
  invocation: ParsedPrismaInvocation,
  env: NodeJS.ProcessEnv = process.env,
): AuthorizationResult {
  if (invocation.migrationSubcommand !== 'deploy') {
    return { ok: true };
  }

  if (invocation.profileName === MIGRATE_DEV_PROFILE) {
    return env[MIGRATE_DEV_CONFIRMATION_ENV] === MIGRATE_DEV_CONFIRMATION_VALUE
      ? { ok: true }
      : {
          ok: false,
          error: `Confirmação específica ausente para migrate deploy do Dev. Defina ${MIGRATE_DEV_CONFIRMATION_ENV}=${MIGRATE_DEV_CONFIRMATION_VALUE} apenas no ambiente desta execução.`,
        };
  }

  const homologRule = HOMOLOG_MIGRATION_RULES[invocation.profileName];
  if (homologRule) {
    return env[homologRule.confirmationEnv] === homologRule.confirmationValue
      ? { ok: true }
      : {
          ok: false,
          error: `Confirmação explícita ausente para migrate deploy da homologação. Defina ${homologRule.confirmationEnv}=${homologRule.confirmationValue} apenas no ambiente desta execução.`,
        };
  }

  if (env[DEPLOY_CONFIRMATION_ENV] !== DEPLOY_CONFIRMATION_VALUE) {
    return {
      ok: false,
      error: `Confirmação explícita ausente para migrate deploy. Defina ${DEPLOY_CONFIRMATION_ENV}=${DEPLOY_CONFIRMATION_VALUE} apenas no ambiente desta execução.`,
    };
  }

  return { ok: true };
}

export function authorizePrismaInvocation(
  invocation: ParsedPrismaInvocation,
  database: Pick<DatabaseSecrets, 'profile' | 'purpose' | 'database' | 'user' | 'environment'>,
  env: NodeJS.ProcessEnv = process.env,
): AuthorizationResult {
  if (!invocation.migrationSubcommand) {
    return { ok: true };
  }

  if (invocation.profileName === MIGRATE_DEV_PROFILE || database.profile === MIGRATE_DEV_PROFILE) {
    if (
      invocation.profileName !== MIGRATE_DEV_PROFILE ||
      invocation.migrationSubcommand !== 'deploy' ||
      database.profile !== MIGRATE_DEV_PROFILE ||
      database.purpose !== 'migration' ||
      database.environment !== undefined ||
      database.database !== MIGRATE_DEV_DATABASE ||
      database.user !== MIGRATE_DEV_USER
    ) {
      return {
        ok: false,
        error: `migrate deploy no Dev exige exclusivamente perfil ${MIGRATE_DEV_PROFILE}, banco ${MIGRATE_DEV_DATABASE} e role ${MIGRATE_DEV_USER}.`,
      };
    }
    return checkDeployConfirmation(invocation, env);
  }

  if (isHomologMigrationProfile(invocation.profileName) || isHomologMigrationProfile(database.profile)) {
    const rule = HOMOLOG_MIGRATION_RULES[invocation.profileName];
    if (!rule || database.profile !== invocation.profileName || database.purpose !== 'migration' ||
        database.environment !== rule.environment || database.database !== rule.database) {
      return { ok: false, error: `O comando migrate da homologação exige perfil de migração, ambiente ${rule?.environment ?? 'homolog'} e banco ${rule?.database ?? MIGRATE_HOMOLOG_DATABASE} coerentes com o perfil.` };
    }
    return checkDeployConfirmation(invocation, env);
  }

  if (database.profile !== MIGRATE_TEST_PROFILE) {
    return {
      ok: false,
      error: `O comando migrate exige exclusivamente o perfil ${MIGRATE_TEST_PROFILE}.`,
    };
  }

  if (database.purpose !== 'migration') {
    return {
      ok: false,
      error: 'O perfil usado por migrate deve ter finalidade migration.',
    };
  }

  if (database.database !== MIGRATE_TEST_DATABASE) {
    return {
      ok: false,
      error: `O comando migrate exige exclusivamente o banco ${MIGRATE_TEST_DATABASE}.`,
    };
  }

  return checkDeployConfirmation(invocation, env);
}

export function evaluateMigrateDevDatabaseUrl(databaseUrl: string): string[] {
  const problems: string[] = [];
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return ['DATABASE_URL do migrate-dev é inválida.'];
  }

  const decode = (value: string): string => {
    try { return decodeURIComponent(value); } catch { return ''; }
  };
  const database = decode(url.pathname.replace(/^\//, ''));
  const user = decode(url.username);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') problems.push('protocolo deve ser postgresql.');
  if (url.hostname !== MIGRATE_DEV_HOST) problems.push(`host deve ser exatamente ${MIGRATE_DEV_HOST}.`);
  if (url.port !== String(MIGRATE_DEV_PORT)) problems.push(`porta deve ser explicitamente ${MIGRATE_DEV_PORT}.`);
  if (database !== MIGRATE_DEV_DATABASE) problems.push(`banco deve ser ${MIGRATE_DEV_DATABASE}.`);
  if (user !== MIGRATE_DEV_USER) problems.push(`role deve ser ${MIGRATE_DEV_USER}.`);
  if (!url.password) problems.push('senha do migrate-dev está ausente.');
  if (url.hash) problems.push('fragmento na DATABASE_URL não é permitido.');

  const parameters = [...url.searchParams.entries()];
  if (
    parameters.length !== 1 ||
    parameters[0]?.[0] !== 'schema' ||
    parameters[0]?.[1] !== 'public'
  ) {
    problems.push('a URL local deve conter somente schema=public; pooler, túnel e parâmetros extras são recusados.');
  }
  return problems;
}

export function evaluateMigrateDevServerIdentity(facts: MigrateDevServerFacts): string[] {
  const problems: string[] = [];
  if (facts.database !== MIGRATE_DEV_DATABASE) problems.push(`banco real diferente de ${MIGRATE_DEV_DATABASE}.`);
  if (facts.currentUser !== MIGRATE_DEV_USER || facts.sessionUser !== MIGRATE_DEV_USER) {
    problems.push(`current_user e session_user devem ser ${MIGRATE_DEV_USER}.`);
  }
  if (facts.serverAddress !== MIGRATE_DEV_HOST || facts.clientAddress !== MIGRATE_DEV_HOST) {
    problems.push(`servidor e cliente devem ser loopback IPv4 ${MIGRATE_DEV_HOST}; conexão remota ou túnel recusado.`);
  }
  if (facts.serverPort !== MIGRATE_DEV_PORT) problems.push(`porta real do servidor deve ser ${MIGRATE_DEV_PORT}.`);
  if (facts.databaseOwner !== MIGRATE_DEV_USER) problems.push(`owner do banco deve ser ${MIGRATE_DEV_USER}.`);
  if (facts.serverVersionNum < 170000) problems.push('PostgreSQL real deve ser versão 17 ou superior.');
  if (!/^PostgreSQL\s/i.test(facts.fullVersion) || /neon|pgbouncer|pooler|supabase/i.test(facts.fullVersion)) {
    problems.push('assinatura do servidor não corresponde a PostgreSQL local direto.');
  }
  if (facts.applicationName !== MIGRATE_DEV_PROBE_APPLICATION || facts.backendType !== 'client backend') {
    problems.push('sessão real do preflight não foi identificada como backend direto esperado.');
  }
  if (facts.ssl) problems.push('conexão SSL inesperada no endpoint local; túnel ou endpoint remoto recusado.');
  if (facts.inRecovery) problems.push('servidor em recovery/standby não é permitido.');
  if (facts.neonProjectId !== null || facts.neonSettingCount !== 0) problems.push('sinal de Neon detectado.');
  if (facts.poolerSignalCount !== 0) problems.push('sinal de pooler detectado.');
  if (facts.homologMarker) problems.push('marca de homologação detectada.');
  if (facts.unsafeRoleAttributes) problems.push('cardapio_migrator possui atributo administrativo inesperado.');
  if (facts.unsafeRoleMemberships) problems.push('membership de role inesperado para as identidades do Dev.');
  return problems;
}

export interface ProductInsertIdentityMigrationContext {
  /** Name read from the single pending migration directory. */
  migrationName: string;
  /** Database confirmed by the wrapper from the loaded profile. */
  database: string;
}

const PRODUCT_INSERT_IDENTITY_RULES: Record<string, { targetRole: string; otherRole: string }> = {
  [MIGRATE_DEV_DATABASE]: { targetRole: 'cardapio_dev_app', otherRole: 'cardapio_test_app' },
  [MIGRATE_TEST_DATABASE]: { targetRole: 'cardapio_test_app', otherRole: 'cardapio_dev_app' },
};

/**
 * Conteúdo/ACL da migration pendente que fecha o INSERT de products.id/updated_at.
 * Fecha por padrão: nome, banco, role, pré/pós-condições, GRANT único e ausência de SQL extra.
 * O checksum continua sendo verificado por `verifyMigrationDirectory`/`verifyAppliedMigrationPrefix`.
 */
export function evaluateProductInsertIdentityColumnsMigrationSql(
  sql: string,
  context: ProductInsertIdentityMigrationContext,
): string[] {
  const problems: string[] = [];
  if (context.migrationName !== PRODUCT_INSERT_IDENTITY_COLUMNS_MIGRATION_NAME) {
    problems.push('A migration pendente deve ser exatamente a de identidade de INSERT em products.id/updated_at.');
  }

  const normalized = sql.replace(/\r\n/g, '\n');
  const executable = normalized.replace(/--[^\n]*/g, '');
  const compact = executable.replace(/\s+/g, ' ').trim();
  const grantMarker = /EXECUTE\s+format/i;
  const grantIndex = executable.search(grantMarker);
  const pre = (grantIndex >= 0 ? executable.slice(0, grantIndex) : executable).replace(/\s+/g, ' ');
  const post = (grantIndex >= 0 ? executable.slice(grantIndex) : '').replace(/\s+/g, ' ');
  const requireFragment = (source: string, fragment: string, message: string): void => {
    if (!source.includes(fragment)) problems.push(message);
  };

  if (!/^\s*BEGIN;\s*SET LOCAL search_path = pg_catalog;\s*DO \$security\$[\s\S]*\$security\$;\s*COMMIT;\s*$/i.test(executable)) {
    problems.push('A migration deve permanecer transacional, com search_path fixo em pg_catalog e um único bloco DO $security$.');
  }
  if ((executable.match(/\$security\$/g) ?? []).length !== 2) {
    problems.push('A migration deve conter exatamente um bloco DO $security$ delimitado.');
  }

  const rules = PRODUCT_INSERT_IDENTITY_RULES[context.database];
  if (!rules) {
    problems.push(`Banco não autorizado para esta migration: ${context.database}; permitidos apenas ${MIGRATE_DEV_DATABASE} e ${MIGRATE_TEST_DATABASE}.`);
  }
  for (const [database, rule] of Object.entries(PRODUCT_INSERT_IDENTITY_RULES)) {
    const branch = `current_database() = '${database}' THEN target_role := '${rule.targetRole}'; other_role := '${rule.otherRole}';`;
    requireFragment(compact, branch, `Seleção de banco/role inválida para ${database}: esperado ${rule.targetRole} e ${rule.otherRole}.`);
  }
  if ((executable.match(/current_database\(\)\s*=/g) ?? []).length !== 2) {
    problems.push('A migration deve selecionar exatamente os bancos Dev e Test, sem ramo adicional.');
  }
  if ((executable.match(/target_role\s*:=/g) ?? []).length !== 2 ||
      (executable.match(/other_role\s*:=/g) ?? []).length !== 2) {
    problems.push('A migration deve atribuir target_role/other_role somente nos dois ramos de banco autorizados.');
  }
  requireFragment(compact, "RAISE EXCEPTION 'Unauthorized database'", 'A migration deve falhar fechada para banco não autorizado.');

  requireFragment(compact, "current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'", 'A migration deve exigir current_user e session_user cardapio_migrator.');
  requireFragment(compact, 'pg_get_userbyid(datdba)', 'A migration deve conferir o owner real do banco.');
  requireFragment(compact, "current_setting('server_version_num')::int < 170000", 'A migration deve exigir PostgreSQL 17 ou superior.');
  requireFragment(compact, 'pg_auth_members', 'A migration deve recusar memberships de role.');
  requireFragment(compact, 'rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls', 'A migration deve recusar atributos administrativos nas roles.');
  requireFragment(compact, "to_regclass('public.products') IS NULL", 'A migration deve exigir a tabela public.products.');

  const expectedPre = "IF NOT has_column_privilege(target_role, 'public.products', 'name', 'INSERT') " +
    "OR NOT has_column_privilege(target_role, 'public.products', 'category_id', 'INSERT') " +
    "OR has_column_privilege(target_role, 'public.products', 'id', 'INSERT') " +
    "OR has_column_privilege(target_role, 'public.products', 'updated_at', 'INSERT') " +
    "OR has_table_privilege(target_role, 'public.products', 'UPDATE') " +
    "OR has_table_privilege(target_role, 'public.products', 'INSERT') " +
    "OR NOT has_table_privilege(target_role, 'public.products', 'DELETE') " +
    "OR NOT has_table_privilege(target_role, 'public.products', 'SELECT') THEN";
  requireFragment(pre, expectedPre, 'Pré-condição ausente ou divergente: exige o ACL da RF006 e a ausência de INSERT em id/updated_at.');
  requireFragment(compact, "RAISE EXCEPTION 'Unexpected prior ACL: apply 20261110000000_rf006_product_crud_privilege first'", 'A migration deve abortar quando a RF006 não estiver aplicada.');

  const expectedGrant = 'GRANT INSERT (id, updated_at) ON TABLE public.products TO %I';
  const dynamicGrants = [...executable.matchAll(/EXECUTE\s+format\('([^']*)'\s*,\s*target_role\s*\)/gi)]
    .map((match) => match[1]!.replace(/\s+/g, ' ').trim());
  const directGrants = [...executable.replace(/'(?:''|[^'])*'/g, "''").matchAll(/\bGRANT\b/gi)];
  if (directGrants.length !== 0 ||
      dynamicGrants.length !== 1 ||
      dynamicGrants[0] !== expectedGrant) {
    problems.push('A migration deve conter exatamente um GRANT INSERT (id, updated_at) em public.products para target_role.');
  }
  if ((executable.match(/\bEXECUTE\s+format\b/gi) ?? []).length !== 1) {
    problems.push('A migration deve executar exatamente um comando dinâmico.');
  }

  const expectedPost = "IF NOT has_column_privilege(target_role, 'public.products', 'id', 'INSERT') " +
    "OR NOT has_column_privilege(target_role, 'public.products', 'updated_at', 'INSERT') " +
    "OR has_column_privilege(target_role, 'public.products', 'id', 'INSERT WITH GRANT OPTION') " +
    "OR has_column_privilege(target_role, 'public.products', 'updated_at', 'INSERT WITH GRANT OPTION') " +
    "OR has_table_privilege(target_role, 'public.products', 'UPDATE') " +
    "OR has_table_privilege(target_role, 'public.products', 'INSERT') " +
    "OR NOT has_table_privilege(target_role, 'public.products', 'DELETE') " +
    'OR EXISTS (';
  requireFragment(post, expectedPost, 'Pós-condição ausente ou divergente: exige id/updated_at INSERT sem GRANT OPTION e sem INSERT/UPDATE de tabela.');
  requireFragment(post, 'a.attname NOT IN ( ' +
    "'public_key','source_code','source_name','source_group','name','description','ingredients', " +
    "'price','image_url','image_alt','category_id','is_active','availability_state', " +
    "'id','updated_at' )", 'A pós-condição deve permitir INSERT apenas nas colunas revisadas de products.');
  requireFragment(post, "has_column_privilege(target_role, a.attrelid, a.attnum, 'INSERT')", 'A pós-condição deve varrer o ACL de coluna de products.');
  requireFragment(compact, "RAISE EXCEPTION 'Unexpected privileges after granting product id/updated_at INSERT'", 'A migration deve abortar se a pós-condição divergir.');

  const sqlWithoutStrings = executable.replace(/'(?:''|[^'])*'/g, "''");
  if (/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+(?:public\.)?[a-z_][a-z0-9_]*\s+SET|ALTER\s+(?:TABLE|ROLE|DATABASE|SCHEMA)|CREATE\s+(?:TABLE|ROLE|DATABASE|SCHEMA|INDEX)|DROP\s+(?:TABLE|ROLE|DATABASE|SCHEMA|INDEX)|TRUNCATE\b|COPY\b|MERGE\b|VACUUM\b|REINDEX\b|SET\s+ROLE\b|SET\s+SESSION\s+AUTHORIZATION)\b/i.test(sqlWithoutStrings)) {
    problems.push('A migration contém DDL/DML ou troca de identidade não permitida.');
  }
  if (/\bGRANT\s+(?:ALL|TRUNCATE|REFERENCES|TRIGGER)\b|\bWITH\s+GRANT\s+OPTION\b/i.test(sqlWithoutStrings)) {
    problems.push('A migration contém GRANT amplo ou GRANT OPTION proibido.');
  }
  if (/\bPUBLIC\b/.test(executable)) {
    problems.push('A migration não pode conceder privilégios a PUBLIC.');
  }
  if (/cardapio_test_fixtures|cardapio_homolog|rustika_homolog_marker/i.test(executable)) {
    problems.push('A migration menciona role/banco fora do escopo Dev/Test autorizado.');
  }

  return problems;
}

export function evaluateRf006MigrationSql(sql: string): string[] {
  const problems: string[] = [];
  const normalized = sql.replace(/\r\n/g, '\n');
  const executableSql = normalized.replace(/--[^\n]*/g, '');
  const dynamicGrants = [...normalized.matchAll(/EXECUTE\s+format\('GRANT\s+([^']+)'\s*,\s*target_role\s*\);/gi)]
    .map((match) => match[1]!.replace(/\s+/g, ' ').trim());
  const expectedGrants = [
    'INSERT (public_key, source_code, source_name, source_group, name, description, ingredients, price, image_url, image_alt, category_id, is_active, availability_state) ON TABLE public.products TO %I',
    'UPDATE (name, description, ingredients, price, image_url, image_alt, updated_at) ON TABLE public.products TO %I',
    'DELETE ON TABLE public.products TO %I',
  ];

  if (dynamicGrants.length !== expectedGrants.length || expectedGrants.some((grant) => !dynamicGrants.includes(grant))) {
    problems.push('RF006 deve conter somente os três GRANTs esperados em public.products.');
  }
  if (!/BEGIN;[\s\S]*SET LOCAL search_path = pg_catalog;[\s\S]*COMMIT;\s*$/i.test(normalized)) {
    problems.push('RF006 deve permanecer transacional e fixar search_path em pg_catalog.');
  }
  if (!normalized.includes("current_database() = 'cardapio_digital_dev'") ||
      !normalized.includes("current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'")) {
    problems.push('RF006 não contém as guardas obrigatórias de banco e role do Dev.');
  }
  if (/no DELETE/i.test(normalized) && dynamicGrants.includes(expectedGrants[2]!)) {
    problems.push('RF006 contradiz o próprio cabeçalho: afirma ausência de DELETE e concede DELETE.');
  }
  if (!/OR\s+NOT\s+has_table_privilege\(target_role,\s*'public\.products',\s*'DELETE'\)/i.test(normalized)) {
    problems.push('RF006 não confirma o GRANT DELETE na pós-condição; a forma atual aborta após concedê-lo.');
  }
  const sqlWithoutStrings = executableSql.replace(/'(?:''|[^'])*'/g, "''");
  if (
    dynamicGrants.some((grant) => /WITH\s+GRANT\s+OPTION|^TRUNCATE\b|^REFERENCES\b|^TRIGGER\b/i.test(grant)) ||
    /\bGRANT\s+(?:TRUNCATE|REFERENCES|TRIGGER)\b|\bWITH\s+GRANT\s+OPTION\b/i.test(sqlWithoutStrings)
  ) {
    problems.push('RF006 contém privilégio ou GRANT OPTION proibido.');
  }
  return problems;
}
