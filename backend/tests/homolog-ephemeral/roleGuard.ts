/**
 * Classificação das roles do projeto no PostgreSQL efêmero.
 *
 * O workflow cria, na inicializacao do container, UMA role administrativa temporaria (`rustika_eph_admin`, superusuario).
 * Ela casa com o padrao `rustika\_%`, mas e a identidade legitima do ensaio e DEVE existir enquanto o servidor estiver no ar.
 * A excecao e por igualdade exata de nome (nunca por prefixo) e so vale para essa identidade. Qualquer outra role `rustika_*`
 * ou `cardapio_*` (preexistente ou residual das etapas da suite) continua sendo rejeitada.
 */
export const EXPECTED_EPHEMERAL_ADMIN_ROLE = 'rustika_eph_admin';

/** Consulta unica de deteccao: todas as roles do projeto (inclui a administrativa; a classificacao e feita por `classifyProjectRoles`). */
export const PROJECT_ROLES_SQL =
  "SELECT rolname FROM pg_roles WHERE rolname LIKE 'cardapio\\_%' OR rolname LIKE 'rustika\\_%' ORDER BY rolname";

/** Banco(s) que podem existir no cluster efemero: somente `postgres`. */
export const PROJECT_DATABASES_SQL = 'SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname';

export interface RoleClassification {
  adminPresent: boolean;
  unexpected: string[];
}

/** Valida que a identidade configurada para o ensaio e exatamente a role administrativa temporaria permitida. */
export function assertExpectedAdminIdentity(configuredAdminUser: string): void {
  if (configuredAdminUser !== EXPECTED_EPHEMERAL_ADMIN_ROLE) {
    throw new Error(`Identidade administrativa inesperada: '${configuredAdminUser}' (esperado '${EXPECTED_EPHEMERAL_ADMIN_ROLE}').`);
  }
}

export function classifyProjectRoles(roleNames: readonly string[], configuredAdminUser: string): RoleClassification {
  assertExpectedAdminIdentity(configuredAdminUser);
  return {
    adminPresent: roleNames.filter((name) => name === configuredAdminUser).length === 1,
    unexpected: roleNames.filter((name) => name !== configuredAdminUser),
  };
}

/** Lanca se a role administrativa nao existir ou se houver QUALQUER outra role do projeto. Retorna normalmente caso contrario. */
export function assertOnlyEphemeralAdminRole(roleNames: readonly string[], configuredAdminUser: string): void {
  const { adminPresent, unexpected } = classifyProjectRoles(roleNames, configuredAdminUser);
  if (!adminPresent) throw new Error(`A role administrativa '${configuredAdminUser}' deve existir enquanto o PostgreSQL efemero estiver ativo.`);
  if (unexpected.length > 0) throw new Error(`Roles do projeto inesperadas: ${unexpected.join(', ')}`);
}

/** Lanca se existir qualquer banco alem de `postgres` (templates ja excluidos pela consulta). */
export function assertOnlyPostgresDatabase(databaseNames: readonly string[]): void {
  const extra = databaseNames.filter((name) => name !== 'postgres');
  if (extra.length > 0 || !databaseNames.includes('postgres')) throw new Error(`Bancos inesperados: ${extra.join(', ') || '(postgres ausente)'}`);
}
