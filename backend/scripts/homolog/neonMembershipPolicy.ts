export interface NeonMembershipRow {
  grantedRole: string;
  memberRole: string;
  grantorRole: string;
  grantorIsSuperuser: boolean;
  admin: boolean;
  set: boolean;
  inherit: boolean;
}

export interface PreRenameRecoveryFacts {
  database: string;
  currentUser: string;
  sessionUser: string;
  expectedAdminUser: string;
  projectIdentityValid: boolean;
  markerIdentityValid: boolean;
  replayDatabaseExists: boolean;
  finalDatabaseExists: boolean;
  legacyMigratorExists: boolean;
  finalMigratorExists: boolean;
  replayDatabaseOwner: string | null;
  memberships: readonly NeonMembershipRow[];
}

export function evaluatePreRenameMembershipRecovery(facts: PreRenameRecoveryFacts): string[] {
  const problems: string[] = [];
  if (facts.database !== 'postgres') problems.push('executor deve estar conectado ao banco postgres.');
  if (facts.currentUser !== facts.expectedAdminUser || facts.sessionUser !== facts.expectedAdminUser) {
    problems.push('executor administrativo inesperado.');
  }
  if (!facts.projectIdentityValid || !facts.markerIdentityValid) problems.push('identidade Neon/projeto/cluster divergente.');
  if (!facts.replayDatabaseExists || facts.finalDatabaseExists) problems.push('estado de bancos não é pré-rename.');
  if (!facts.legacyMigratorExists || facts.finalMigratorExists) problems.push('estado de roles não é pré-rename.');
  if (facts.replayDatabaseOwner !== 'cardapio_migrator') problems.push('owner do banco transitório é incorreto.');

  const relevant = facts.memberships.filter(({ grantedRole }) => grantedRole === 'cardapio_migrator');
  const temporary = relevant.filter(({ memberRole, grantorRole, set, inherit }) =>
    memberRole === facts.expectedAdminUser && grantorRole === facts.expectedAdminUser && (set || inherit));
  const allowedAdminOnly = relevant.filter(({ memberRole, grantorIsSuperuser, admin, set, inherit }) =>
    memberRole === facts.expectedAdminUser && grantorIsSuperuser && admin && !set && !inherit);
  const unexpected = relevant.filter((row) => !temporary.includes(row) && !allowedAdminOnly.includes(row));
  if (unexpected.length > 0) problems.push('membership inesperada, inclusive de runtime, detectada.');
  if (temporary.length !== 1) {
    problems.push(temporary.length === 0
      ? 'membership temporária ausente; reexecução/estado ADMIN-only é bloqueado.'
      : 'mais de uma membership temporária foi encontrada.');
  }
  return problems;
}

export function evaluateRecoveredMemberships(
  rows: readonly NeonMembershipRow[],
  expectedAdminUser: string,
): string[] {
  const relevant = rows.filter(({ grantedRole }) => grantedRole === 'cardapio_migrator');
  const problems: string[] = [];
  if (relevant.some(({ set, inherit }) => set || inherit)) problems.push('SET ou INHERIT residual.');
  if (relevant.some(({ memberRole, grantorIsSuperuser, admin, set, inherit }) =>
    memberRole !== expectedAdminUser || !grantorIsSuperuser || !admin || set || inherit)) {
    problems.push('restou membership diferente da linha ADMIN-only automática.');
  }
  return problems;
}
