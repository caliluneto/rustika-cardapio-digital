/**
 * Gate and target guards for the browser E2E fixtures.
 * Pure functions, unit-tested with mocks. The E2E has its OWN confirmation on top of the
 * integration-db one, so confirming one suite never enables the other by accident.
 */

export const E2E_CONFIRM = 'RUSTIKA_E2E_CONFIRM';
export const E2E_CONFIRM_VALUE = 'RUN_E2E_ON_CARDAPIO_DIGITAL_TEST';
export const E2E_LEGACY_CONFIRM = 'RUSTIKA_E2E_LEGACY_CLEANUP';
export const E2E_LEGACY_CONFIRM_VALUE = 'ERASE_LEGACY_E2E_FIXTURES';
export const E2E_TARGET_DATABASE = 'cardapio_digital_test';

/** Names that must never be a write target, whatever the confirmation says. */
const FORBIDDEN_DATABASE = /(^|_)(dev|shadow|prod|production|restore|precheck|lab|plataforma|template|postgres)(_|$)/i;

export class E2eAbort extends Error {
  constructor(public readonly reasons: string[]) {
    super(`E2E abortado antes de qualquer escrita:\n- ${reasons.join('\n- ')}`);
    this.name = 'E2eAbort';
  }
}

/** Exact allow-list: only cardapio_digital_test. Everything else (Dev, Shadow, Restore, other projects). */
export function assertTestDatabaseName(name: string): void {
  if (name !== E2E_TARGET_DATABASE) {
    throw new E2eAbort([`Banco recusado: ${JSON.stringify(name)}. Somente ${E2E_TARGET_DATABASE}.`]);
  }
}

/** Human-readable classification of a refused name (used in messages and tests). */
export const isForbiddenDatabase = (name: string): boolean => name !== E2E_TARGET_DATABASE || FORBIDDEN_DATABASE.test(name);

export function assertE2eGate(env: Record<string, string | undefined>): void {
  const reasons: string[] = [];
  if (env[E2E_CONFIRM] !== E2E_CONFIRM_VALUE) reasons.push(`${E2E_CONFIRM}=${E2E_CONFIRM_VALUE} ausente.`);
  if (env.NODE_ENV !== 'test') reasons.push(`NODE_ENV deve ser exatamente "test" (recebido ${JSON.stringify(env.NODE_ENV)}).`);
  if (env.DB_PROFILE !== 'app-test') reasons.push(`DB_PROFILE deve ser exatamente "app-test" (recebido ${JSON.stringify(env.DB_PROFILE)}).`);
  if (env.CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION !== undefined) reasons.push('CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION não pode estar definida.');
  for (const key of ['DATABASE_URL', 'SHADOW_DATABASE_URL']) {
    if (env[key] !== undefined) reasons.push(`${key} não pode estar definida: os acessos usam somente os perfis da pasta de segredos.`);
  }
  if (reasons.length) throw new E2eAbort(reasons);
}

export function assertLegacyCleanupGate(env: Record<string, string | undefined>): void {
  assertE2eGate(env);
  if (env[E2E_LEGACY_CONFIRM] !== E2E_LEGACY_CONFIRM_VALUE) {
    throw new E2eAbort([`${E2E_LEGACY_CONFIRM}=${E2E_LEGACY_CONFIRM_VALUE} ausente.`]);
  }
}
