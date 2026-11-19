import { E4_ALT_TARGET } from '../bootstrap/exceptionalMigratorBootstrap';
import { verifyAppliedMigrationPrefix } from '../bootstrap/migrationIntegrity';
import { HOMOLOG_EXPECTED_MIGRATIONS } from './homologMigrationChain';

export interface E53IdentityRow {
  database: string;
  databaseOid: string;
  currentUser: string;
  sessionUser: string;
  databaseOwner: string;
  elevatedRole: boolean | null;
  serverVersionNum: number;
  projectId: string | null;
  branchId: string | null;
  markerComment: string | null;
}

export interface E53MigrationRow {
  name: string;
  checksum: string;
  finished: boolean;
  rolledBack: boolean;
  logsPresent: boolean;
}

/** O GUC da branch é evidência declarada pelo servidor Neon, não verificação independente da API do provedor. */
export function evaluateE53Identity(row: E53IdentityRow, clusterId: string): { problems: string[]; branchReported: boolean } {
  const problems: string[] = [];
  if (row.database !== E4_ALT_TARGET.database) problems.push('Banco conectado diverge do alvo fixo.');
  if (row.databaseOid !== E4_ALT_TARGET.databaseOid) problems.push('OID do banco diverge do alvo fixo.');
  if (row.currentUser !== E4_ALT_TARGET.migratorRole || row.sessionUser !== E4_ALT_TARGET.migratorRole) {
    problems.push('current_user ou session_user não é a role migradora esperada.');
  }
  if (row.databaseOwner !== E4_ALT_TARGET.migratorRole) problems.push('Owner do banco diverge da role migradora.');
  if (row.elevatedRole !== false) problems.push('Role migradora possui atributos elevados ou não pôde ser conferida.');
  if (row.serverVersionNum < 180000) problems.push('A variante 10 exige PostgreSQL 18 ou superior.');
  if (row.projectId !== E4_ALT_TARGET.projectId) problems.push('neon.project_id diverge do projeto fixo.');
  if (!clusterId || row.markerComment?.trim().toLowerCase() !== `rustika-homolog-cluster:${clusterId.toLowerCase()}`) {
    problems.push('Marca do cluster ausente ou divergente do perfil privado.');
  }
  if (row.branchId !== null && row.branchId !== E4_ALT_TARGET.branchId) {
    problems.push('neon.branch_id diverge da branch esperada.');
  }
  return { problems, branchReported: row.branchId === E4_ALT_TARGET.branchId };
}

/** Requer exatamente nove linhas concluídas, únicas e na ordem; nunca considera uma décima parcialmente aplicada. */
export function evaluateE53History(rows: readonly E53MigrationRow[]): string[] {
  const expectedNine = HOMOLOG_EXPECTED_MIGRATIONS.slice(0, 9);
  const problems = verifyAppliedMigrationPrefix(rows, expectedNine);
  if (rows.length !== 9) problems.push(`Histórico remoto contém ${rows.length} linhas; esperadas exatamente 9.`);
  for (const row of rows) {
    if (row.logsPresent) problems.push(`Logs de falha não vazios na migration ${row.name}.`);
  }
  return problems;
}
