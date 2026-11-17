import { evaluateNeonReplayHistory, type ReplayMigrationRow } from './neonReplayPreflight';

export interface RenameGateFacts {
  identityProblems: readonly string[];
  migrations: readonly ReplayMigrationRow[];
  replayDatabaseExists: boolean;
  finalDatabaseExists: boolean;
  finalRolesPresent: readonly string[];
  databaseOwner: string | null;
  objectOwnershipValid: boolean;
  aclValid: boolean;
  membershipsValid: boolean;
  activeConnections: number;
  allowConnections: boolean;
}

export type RenameGatePhase = 'pre-freeze' | 'post-freeze-verifier' | 'ready-to-rename';

/**
 * Gate puro usado antes e depois do congelamento operacional do banco transitório.
 * O segundo passe exige datallowconn=false e zero sessões; sem isso o SQL 04 também aborta.
 */
export function evaluateRenameGate(facts: RenameGateFacts, phase: RenameGatePhase): string[] {
  const problems = [...facts.identityProblems];
  const history = evaluateNeonReplayHistory(facts.migrations, 'status');
  if (!history.ok) problems.push(...history.problems);
  else if (history.appliedCount !== 9) problems.push(`rename exige 9/9 íntegro; encontrado ${history.appliedCount}/9.`);
  if (!facts.replayDatabaseExists) problems.push('banco transitório ausente.');
  if (facts.finalDatabaseExists) problems.push('destino final já existe.');
  if (facts.finalRolesPresent.length > 0) {
    problems.push(`roles finais já existem: ${facts.finalRolesPresent.join(', ')}.`);
  }
  if (facts.databaseOwner !== 'cardapio_migrator') problems.push('owner do banco transitório é incorreto.');
  if (!facts.objectOwnershipValid) problems.push('ownership de objetos diverge do gate 03.');
  if (!facts.aclValid) problems.push('ACL diverge do gate 03.');
  if (!facts.membershipsValid) problems.push('memberships divergem do gate 03.');
  if (phase === 'pre-freeze') {
    if (!facts.allowConnections) problems.push('banco já está congelado; classifique o estado antes de continuar.');
    if (facts.activeConnections !== 1) {
      problems.push('pré-freeze exige somente a sessão verificadora no banco transitório.');
    }
  } else if (phase === 'post-freeze-verifier') {
    if (facts.allowConnections) problems.push('banco transitório ainda aceita novas conexões.');
    if (facts.activeConnections !== 1) {
      problems.push('pós-freeze exige somente a sessão verificadora preexistente.');
    }
  } else {
    if (facts.allowConnections) problems.push('banco transitório ainda aceita novas conexões.');
    if (facts.activeConnections !== 0) problems.push('há conexões inesperadas no banco transitório.');
  }
  return problems;
}

export interface RenameInterlockDriver {
  acquireOperationalLock(): Promise<void>;
  inspectPreFreeze(): Promise<RenameGateFacts>;
  freezeReplayDatabase(): Promise<void>;
  inspectReplayAfterFreeze(): Promise<RenameGateFacts>;
  closeReplayVerifier(): Promise<void>;
  inspectReadyToRename(): Promise<RenameGateFacts>;
  executeRename(): Promise<void>;
}

export type RenameInterlockResult =
  | { status: 'simulated'; phase: 'pre-freeze' }
  | { status: 'renamed' }
  | { status: 'blocked'; phase: RenameGatePhase; problems: string[] };

/**
 * Ordem obrigatória. O freeze é uma alteração administrativa separada e deliberada,
 * portanto não é descrito como atômico com o rename. Falha após o freeze mantém o banco
 * bloqueado para investigação; nunca tenta “compensar” automaticamente.
 */
export async function runRenameInterlock(
  driver: RenameInterlockDriver,
  execute: boolean,
): Promise<RenameInterlockResult> {
  await driver.acquireOperationalLock();
  const pre = evaluateRenameGate(await driver.inspectPreFreeze(), 'pre-freeze');
  if (pre.length > 0) return { status: 'blocked', phase: 'pre-freeze', problems: pre };
  if (!execute) return { status: 'simulated', phase: 'pre-freeze' };

  await driver.freezeReplayDatabase();
  const frozenReplay = evaluateRenameGate(await driver.inspectReplayAfterFreeze(), 'post-freeze-verifier');
  if (frozenReplay.length > 0) {
    return { status: 'blocked', phase: 'ready-to-rename', problems: frozenReplay };
  }
  await driver.closeReplayVerifier();
  const ready = evaluateRenameGate(await driver.inspectReadyToRename(), 'ready-to-rename');
  if (ready.length > 0) return { status: 'blocked', phase: 'ready-to-rename', problems: ready };
  await driver.executeRename();
  return { status: 'renamed' };
}
