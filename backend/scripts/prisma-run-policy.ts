import type { DatabaseSecrets, RequestedPurpose } from '../src/config/secrets';

export const MIGRATE_TEST_PROFILE = 'migrate-test';
export const MIGRATE_TEST_DATABASE = 'cardapio_digital_test';
export const DEPLOY_CONFIRMATION_ENV = 'CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION';
export const DEPLOY_CONFIRMATION_VALUE = 'APPLY_CARDAPIO_DIGITAL_TEST';

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

  if (profileName !== MIGRATE_TEST_PROFILE) {
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
  database: Pick<DatabaseSecrets, 'profile' | 'purpose' | 'database'>,
  env: NodeJS.ProcessEnv = process.env,
): AuthorizationResult {
  if (!invocation.migrationSubcommand) {
    return { ok: true };
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
