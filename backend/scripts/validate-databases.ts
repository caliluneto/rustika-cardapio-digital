import { PrismaClient } from '@prisma/client';
import {
  loadDatabaseProfile,
  redactSecrets,
  SecretsConfigError,
  type DatabaseSecrets,
} from '../src/config/secrets';

interface IdentityRow {
  current_user: string;
  current_database: string;
}

interface PrivilegeRow {
  can_create: boolean;
  can_use: boolean;
}

interface CheckResult {
  ok: boolean;
  label: string;
  detail: string;
}

const results: CheckResult[] = [];

function record(ok: boolean, label: string, detail: string): void {
  results.push({ ok, label, detail });
  console.log(`${ok ? '[OK]' : '[FALHA]'} ${label}: ${detail}`);
}

async function withClient<T>(
  url: string,
  operation: (client: PrismaClient) => Promise<T>,
): Promise<T> {
  const client = new PrismaClient({
    datasources: {
      db: {
        url,
      },
    },
  });

  try {
    return await operation(client);
  } finally {
    await client.$disconnect();
  }
}

async function readIdentity(client: PrismaClient): Promise<IdentityRow> {
  const rows = await client.$queryRaw<IdentityRow[]>`
    SELECT current_user AS current_user, current_database() AS current_database
  `;
  const row = rows[0];

  if (!row) {
    throw new Error('Consulta de identidade não retornou linhas.');
  }

  return row;
}

async function readPrivileges(client: PrismaClient): Promise<PrivilegeRow> {
  const rows = await client.$queryRaw<PrivilegeRow[]>`
    SELECT
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
      has_schema_privilege(current_user, 'public', 'USAGE') AS can_use
  `;
  const row = rows[0];

  if (!row) {
    throw new Error('Consulta de privilégios não retornou linhas.');
  }

  return row;
}

function crossDatabaseUrl(secrets: DatabaseSecrets, database: string): string {
  const url = new URL(secrets.databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export type ConnectionErrorKind =
  | 'connect-privilege-denied'
  | 'authentication-failed'
  | 'network-error'
  | 'unknown';

export interface ConnectionErrorClassification {
  kind: ConnectionErrorKind;
  sqlState: string | null;
  prismaCode: string | null;
  reason: string;
}

const SQLSTATE_ACCESS_DENIED = '42501';
const SQLSTATE_AUTH_CLASS = '28';
const SQLSTATE_CONNECTION_CLASS = '08';
const PRISMA_ACCESS_DENIED = 'P1010';
const PRISMA_AUTH_FAILED = 'P1000';
const PRISMA_NETWORK_CODES = new Set(['P1001', 'P1002', 'P1017']);

const CONNECT_DENIED_PATTERNS = [
  /permission denied for (?:the )?database/,
  /permission denied to connect/,
  /does not have (?:the )?connect privilege/,
  /denied access on the database/,
  /negada para (?:o )?banco de dados/,
  /permiss.o negada para (?:o )?banco de dados/,
  /permiss.o negada para conectar/,
  /(?:n.o|sem)\s+(?:tem\s+)?privil.gio\s+connect/,
  /usu.rio .* n.o tem privil.gio connect/,
];

const AUTH_FAILED_PATTERNS = [
  /authentication failed/,
  /password authentication failed/,
  /provided database credentials .* are not valid/,
  /no pg_hba\.conf entry/,
  /falha na autentica..o/,
  /autentica..o .* falhou/,
  /credenciais .* n.o s.o v.lidas/,
  /senha .* falhou/,
];

const NETWORK_ERROR_PATTERNS = [
  /can't reach database server/,
  /connection (?:refused|timed out|terminated|reset)/,
  /econnrefused|enotfound|etimedout|ehostunreach|enetunreach/,
  /n.o foi poss.vel conectar/,
  /tempo de conex.o esgotado/,
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMessage(message: string): string {
  return message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uFFFD/g, '?')
    .toLowerCase();
}

function normalizeSqlState(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  return /^[0-9]{2}[0-9A-Z]{3}$/.test(normalized) ? normalized : null;
}

function extractSqlState(error: unknown): string | null {
  const candidates: unknown[] = [];

  if (isObject(error)) {
    candidates.push(error.code, error.errorCode, error.sqlState, error.sqlstate);

    if (isObject(error.meta)) {
      candidates.push(
        error.meta.code,
        error.meta.sqlState,
        error.meta.sqlstate,
        error.meta.database_error_code,
      );
    }
  }

  for (const candidate of candidates) {
    const sqlState = normalizeSqlState(candidate);

    if (sqlState) {
      return sqlState;
    }
  }

  const message = errorMessage(error);
  const patterns = [
    /SQLSTATE(?:\[|\s*[:=]\s*)'?([0-9A-Z]{5})'?/i,
    /Code:\s*`([0-9A-Z]{5})`/i,
    /\bcode\s*[:=]\s*'?([0-9A-Z]{5})'?/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    const sqlState = normalizeSqlState(match?.[1]);

    if (sqlState) {
      return sqlState;
    }
  }

  return null;
}

function extractPrismaCode(error: unknown): string | null {
  const candidates: unknown[] = [];

  if (isObject(error)) {
    candidates.push(error.code, error.errorCode);

    if (isObject(error.meta)) {
      candidates.push(error.meta.code, error.meta.errorCode);
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^P\d{4}$/i.test(candidate)) {
      return candidate.toUpperCase();
    }
  }

  const match = /\b(P\d{4})\b/i.exec(errorMessage(error));

  return match?.[1]?.toUpperCase() ?? null;
}

export function classifyConnectionError(
  error: unknown,
): ConnectionErrorClassification {
  const sqlState = extractSqlState(error);
  const prismaCode = extractPrismaCode(error);
  const message = normalizeMessage(errorMessage(error));

  if (sqlState === SQLSTATE_ACCESS_DENIED) {
    return {
      kind: 'connect-privilege-denied',
      sqlState,
      prismaCode,
      reason: 'sqlstate-42501',
    };
  }

  if (sqlState?.startsWith(SQLSTATE_AUTH_CLASS)) {
    return {
      kind: 'authentication-failed',
      sqlState,
      prismaCode,
      reason: 'sqlstate-28xxx',
    };
  }

  if (sqlState?.startsWith(SQLSTATE_CONNECTION_CLASS)) {
    return {
      kind: 'network-error',
      sqlState,
      prismaCode,
      reason: 'sqlstate-08xxx',
    };
  }

  if (prismaCode === PRISMA_ACCESS_DENIED) {
    return {
      kind: 'connect-privilege-denied',
      sqlState,
      prismaCode,
      reason: 'prisma-p1010',
    };
  }

  if (prismaCode === PRISMA_AUTH_FAILED) {
    return {
      kind: 'authentication-failed',
      sqlState,
      prismaCode,
      reason: 'prisma-p1000',
    };
  }

  if (prismaCode && PRISMA_NETWORK_CODES.has(prismaCode)) {
    return {
      kind: 'network-error',
      sqlState,
      prismaCode,
      reason: `prisma-${prismaCode.toLowerCase()}`,
    };
  }

  if (CONNECT_DENIED_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      kind: 'connect-privilege-denied',
      sqlState,
      prismaCode,
      reason: 'mensagem-connect',
    };
  }

  if (AUTH_FAILED_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      kind: 'authentication-failed',
      sqlState,
      prismaCode,
      reason: 'mensagem-autenticacao',
    };
  }

  if (NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      kind: 'network-error',
      sqlState,
      prismaCode,
      reason: 'mensagem-rede',
    };
  }

  return {
    kind: 'unknown',
    sqlState,
    prismaCode,
    reason: 'nao-reconhecido',
  };
}

function describeConnectionFailure(
  classification: ConnectionErrorClassification,
  error: unknown,
): string {
  switch (classification.kind) {
    case 'connect-privilege-denied':
      return 'conexão negada (CONNECT)';
    case 'authentication-failed':
      return 'falha de autenticação';
    case 'network-error':
      return 'erro de rede';
    default:
      return `erro inesperado: ${redactSecrets(
        errorMessage(error) || 'desconhecido',
      )}`;
  }
}

async function checkPositive(
  label: string,
  secrets: DatabaseSecrets,
  expectedUser: string,
  expectedDatabase: string,
  expectCreate: boolean,
): Promise<void> {
  try {
    const { identity, privileges } = await withClient(
      secrets.databaseUrl,
      async (client) => ({
        identity: await readIdentity(client),
        privileges: await readPrivileges(client),
      }),
    );

    const identityOk =
      identity.current_user === expectedUser &&
      identity.current_database === expectedDatabase;
    const privilegeOk =
      privileges.can_use === true && privileges.can_create === expectCreate;

    record(
      identityOk && privilegeOk,
      label,
      `usuario=${identity.current_user} banco=${identity.current_database} USAGE=${privileges.can_use} CREATE=${privileges.can_create}`,
    );
  } catch (error) {
    record(
      false,
      label,
      describeConnectionFailure(classifyConnectionError(error), error),
    );
  }
}

async function checkShadow(
  label: string,
  shadowUrl: string,
  expectedUser: string,
  expectedDatabase: string,
): Promise<void> {
  try {
    const identity = await withClient(shadowUrl, readIdentity);
    const ok =
      identity.current_user === expectedUser &&
      identity.current_database === expectedDatabase;

    record(
      ok,
      label,
      `usuario=${identity.current_user} banco=${identity.current_database}`,
    );
  } catch (error) {
    record(
      false,
      label,
      describeConnectionFailure(classifyConnectionError(error), error),
    );
  }
}

async function checkDenied(
  label: string,
  url: string,
): Promise<void> {
  try {
    await withClient(url, async (client) => {
      await client.$queryRaw`SELECT 1`;
    });
    record(false, label, 'a conexão foi permitida, mas deveria ser bloqueada');
  } catch (error) {
    const classification = classifyConnectionError(error);

    if (classification.kind === 'connect-privilege-denied') {
      const sqlState = classification.sqlState
        ? `, SQLSTATE ${classification.sqlState}`
        : '';
      record(true, label, `bloqueado corretamente (CONNECT negado${sqlState})`);
      return;
    }

    if (classification.kind === 'authentication-failed') {
      record(false, label, 'falha de autenticação; não comprova isolamento');
      return;
    }

    if (classification.kind === 'network-error') {
      record(false, label, 'erro de rede; não comprova isolamento');
      return;
    }

    record(
      false,
      label,
      'erro diferente de negação de CONNECT; verificar manualmente',
    );
  }
}

async function main(): Promise<void> {
  const appDev = loadDatabaseProfile('app-dev', { purpose: 'any' });
  const appTest = loadDatabaseProfile('app-test', { purpose: 'any' });
  const migrateDev = loadDatabaseProfile('migrate-dev', { purpose: 'any' });
  const migrateTest = loadDatabaseProfile('migrate-test', { purpose: 'any' });

  const shadowDatabase = migrateDev.shadowDatabaseUrl
    ? new URL(migrateDev.shadowDatabaseUrl).pathname.replace(/^\/+/, '')
    : '';

  console.log('=== Conexões positivas ===');
  await checkPositive(
    'app-dev',
    appDev,
    'cardapio_dev_app',
    'cardapio_digital_dev',
    false,
  );
  await checkPositive(
    'app-test',
    appTest,
    'cardapio_test_app',
    'cardapio_digital_test',
    false,
  );
  await checkPositive(
    'migrate-dev',
    migrateDev,
    'cardapio_migrator',
    'cardapio_digital_dev',
    true,
  );
  await checkPositive(
    'migrate-test',
    migrateTest,
    'cardapio_migrator',
    'cardapio_digital_test',
    true,
  );

  if (migrateDev.shadowDatabaseUrl && shadowDatabase) {
    await checkShadow(
      'migrate-shadow',
      migrateDev.shadowDatabaseUrl,
      'cardapio_migrator',
      shadowDatabase,
    );
  } else {
    record(false, 'migrate-shadow', 'SHADOW_DATABASE_URL ausente no perfil migrate-dev');
  }

  console.log('=== Isolamento entre bancos ===');
  await checkDenied(
    'app-dev -> cardapio_digital_test',
    crossDatabaseUrl(appDev, 'cardapio_digital_test'),
  );
  await checkDenied(
    'app-dev -> cardapio_digital_shadow',
    crossDatabaseUrl(appDev, 'cardapio_digital_shadow'),
  );
  await checkDenied(
    'app-test -> cardapio_digital_dev',
    crossDatabaseUrl(appTest, 'cardapio_digital_dev'),
  );
  await checkDenied(
    'app-test -> cardapio_digital_shadow',
    crossDatabaseUrl(appTest, 'cardapio_digital_shadow'),
  );

  const failures = results.filter((result) => !result.ok);

  console.log(
    `=== Resultado: ${results.length - failures.length}/${results.length} verificações aprovadas ===`,
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

function isDirectExecution(): boolean {
  if (
    typeof require !== 'undefined' &&
    typeof module !== 'undefined' &&
    require.main === module
  ) {
    return true;
  }

  const entry = process.argv[1];

  return (
    typeof entry === 'string' &&
    /(^|[\\/])validate-databases\.(?:ts|js)$/.test(entry)
  );
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    const message =
      error instanceof SecretsConfigError || error instanceof Error
        ? error.message
        : 'Erro desconhecido.';
    console.error(`[validate-databases] ${redactSecrets(message)}`);
    process.exitCode = 1;
  });
}
