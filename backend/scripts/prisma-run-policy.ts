import type { DatabaseSecrets, RequestedPurpose } from '../src/config/secrets';

export const MIGRATE_TEST_PROFILE = 'migrate-test';
export const MIGRATE_TEST_DATABASE = 'cardapio_digital_test';
export const DEPLOY_CONFIRMATION_ENV = 'CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION';
export const DEPLOY_CONFIRMATION_VALUE = 'APPLY_CARDAPIO_DIGITAL_TEST';
// 3D.5.2: homologação remota. Perfil, banco e confirmação PRÓPRIOS; a confirmação do Test local não vale aqui.
// 3D.5.2-A: banco definitivo `cardapio_digital_homolog`; o replay das migrations históricas usa perfil, banco transitório e confirmação próprios.
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

  if (profileName !== MIGRATE_TEST_PROFILE && !isHomologMigrationProfile(profileName)) {
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
  database: Pick<DatabaseSecrets, 'profile' | 'purpose' | 'database' | 'environment'>,
  env: NodeJS.ProcessEnv = process.env,
): AuthorizationResult {
  if (!invocation.migrationSubcommand) {
    return { ok: true };
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
