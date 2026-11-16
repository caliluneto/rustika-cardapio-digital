/**
 * Gate and identity checks for the PostgreSQL integration suite.
 * Pure functions: they decide from collected facts, so they are unit-tested with mocks in
 * `npm test` (tests/integration-db-support.test.ts) without touching any database.
 */

export const INTEGRATION_FLAG = 'RUSTIKA_DB_INTEGRATION';
export const INTEGRATION_CONFIRM = 'RUSTIKA_DB_INTEGRATION_CONFIRM';
export const INTEGRATION_CONFIRM_VALUE = 'WRITE_CARDAPIO_DIGITAL_TEST';
export const TEST_DATABASE = 'cardapio_digital_test';
export const APP_ROLE = 'cardapio_test_app';
export const FIXTURES_ROLE = 'cardapio_test_fixtures';
export const MIN_SERVER_VERSION_NUM = 170000;
/** Advisory lock key: one integration run at a time per database. */
export const RUN_LOCK_KEY = 3_039_390_001;

/** Migrations that must be applied, with the SHA-256 of the files as committed. */
export const EXPECTED_MIGRATIONS: ReadonlyArray<{ name: string; checksum: string }> = [
  { name: '20261023000000_initial_schema', checksum: '1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983' },
  { name: '20261027000000_rf004_comandas_catalogo_pedidos', checksum: '05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122' },
  { name: '20261031000000_rf004_fix_permissions', checksum: '960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b' },
  { name: '20261102000000_update_products_source_identity_constraint', checksum: '885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f' },
  { name: '20261104000000_runtime_least_privilege', checksum: '24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e' },
  { name: '20261105000000_order_status_update_privilege', checksum: '3d6a7a6d0ce3f595501dc6343c19858beb2b9fecd1ebe1fd1fbecf5603031d84' },
  { name: '20261106000000_product_availability_update_privilege', checksum: '3665ed812c4033527d17c6de3a7c66a623d659d676c719fc1b6f6477f7e69308' },
  { name: '20261110000000_rf006_product_crud_privilege', checksum: 'b3feb0dfca618498219161ec91f11b4edff9700de5386e452edf67eadf41561e' },
  { name: '20261114000000_product_insert_identity_columns', checksum: '6a533537645a8b2f3c14af2c863697cbe9bfdec034319971b50020fe134318c9' },
];

export class IntegrationAbort extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Suíte de integração abortada antes de qualquer escrita:\n- ${reasons.join('\n- ')}`);
    this.name = 'IntegrationAbort';
  }
}

/** Environment gate. Must pass before any connection is opened. */
export function assertIntegrationGate(env: Record<string, string | undefined>): void {
  const reasons: string[] = [];
  if (env[INTEGRATION_FLAG] !== '1') reasons.push(`${INTEGRATION_FLAG}=1 ausente (a suíte nunca roda por acidente).`);
  if (env[INTEGRATION_CONFIRM] !== INTEGRATION_CONFIRM_VALUE) reasons.push(`${INTEGRATION_CONFIRM}=${INTEGRATION_CONFIRM_VALUE} ausente.`);
  if (env.NODE_ENV !== 'test') reasons.push('NODE_ENV deve ser test.');
  if (env.DB_PROFILE !== 'app-test') reasons.push('DB_PROFILE deve ser app-test.');
  if (env.CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION !== undefined) reasons.push('CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION não pode estar definida durante os testes.');
  if (reasons.length) throw new IntegrationAbort(reasons);
}

export interface ConnectionFacts {
  database: string;
  user: string;
  serverVersionNum: number;
  superuser: boolean;
  bypassRls: boolean;
  readOnly?: boolean;
  sessionUser: string;
  serverIdentity: string;
  createRole: boolean;
  createDb: boolean;
  replication: boolean;
}

export interface MigrationRow { name: string; checksum: string; finished: boolean; rolledBack: boolean }

export interface PreflightFacts {
  app: ConnectionFacts;
  fixtures: ConnectionFacts;
  migrator: ConnectionFacts;
  migrations: MigrationRow[];
  /** SHA-256 of the migration files on disk, by migration name. */
  diskChecksums: Record<string, string>;
  /** Rows that look like fixtures left by a previous run (by marker), per table. */
  leftovers: Record<string, number>;
  /** Rows that would collide with fixed fixture identities (e.g. source_code PA062240). */
  collisions: Record<string, number>;
  lockAcquired: boolean;
  permissionViolations: string[];
  /**
   * Databases (other than Test) where a real connection attempt with the fixtures credentials
   * SUCCEEDED. Must be empty: pg_hba has to refuse the role everywhere except Test.
   * `undefined` means the probe did not run, which also aborts.
   */
  fixturesReachableDatabases?: string[];
}

/** Returns every reason to abort; empty list means it is safe to start writing fixtures. */
export function evaluatePreflight(facts: PreflightFacts): string[] {
  const reasons: string[] = [];
  const conn = (label: string, c: ConnectionFacts, role: string) => {
    if (c.database !== TEST_DATABASE) reasons.push(`${label}: banco ${c.database}, esperado ${TEST_DATABASE}.`);
    if (c.user !== role) reasons.push(`${label}: role ${c.user}, esperada ${role}.`);
    if (c.sessionUser !== role) reasons.push(`${label}: session_user inesperado.`);
    if (c.superuser || c.bypassRls || c.createRole || c.createDb || c.replication) reasons.push(`${label}: role com superuser/bypassrls ou atributos administrativos não é aceita.`);
    if (!(c.serverVersionNum >= MIN_SERVER_VERSION_NUM)) reasons.push(`${label}: PostgreSQL ${c.serverVersionNum} < ${MIN_SERVER_VERSION_NUM}.`);
  };
  conn('aplicação', facts.app, APP_ROLE);
  conn('fixtures', facts.fixtures, FIXTURES_ROLE);
  conn('migrator', facts.migrator, 'cardapio_migrator');
  if (!facts.app.serverIdentity || facts.app.serverIdentity !== facts.fixtures.serverIdentity || facts.app.serverIdentity !== facts.migrator.serverIdentity) reasons.push('Conexões apontam para servidores diferentes.');
  if (facts.migrator.database !== TEST_DATABASE) reasons.push(`leitura de migrations: banco ${facts.migrator.database}.`);
  if (facts.migrator.readOnly !== true) reasons.push('leitura de migrations precisa ocorrer em transação somente leitura.');

  const byName = new Map(facts.migrations.map((row) => [row.name, row]));
  if (facts.migrations.length !== EXPECTED_MIGRATIONS.length) {
    reasons.push(`_prisma_migrations tem ${facts.migrations.length} linhas, esperadas ${EXPECTED_MIGRATIONS.length} (baseline incompleto?).`);
  }
  for (const expected of EXPECTED_MIGRATIONS) {
    const row = byName.get(expected.name);
    if (!row) { reasons.push(`migration ${expected.name} não aplicada.`); continue; }
    if (!row.finished || row.rolledBack) reasons.push(`migration ${expected.name} com falha ou revertida.`);
    if (row.checksum !== expected.checksum) reasons.push(`checksum gravado de ${expected.name} difere do esperado.`);
    if (facts.diskChecksums[expected.name] !== expected.checksum) reasons.push(`arquivo de ${expected.name} no disco difere do esperado.`);
  }
  for (const [table, count] of Object.entries(facts.leftovers)) {
    if (count > 0) reasons.push(`${count} linha(s) de fixtures antigas em ${table}: rode a limpeza de resíduos antes.`);
  }
  for (const [what, count] of Object.entries(facts.collisions)) {
    if (count > 0) reasons.push(`${count} linha(s) não-fixture colidem com ${what}.`);
  }
  if (!facts.lockAcquired) reasons.push('outra execução de integração está em andamento (advisory lock ocupado).');
  if (!Array.isArray(facts.permissionViolations)) reasons.push('Permissões não verificadas.');
  else reasons.push(...facts.permissionViolations.map((v) => `Permissões inadequadas: ${v}`));
  if (!Array.isArray(facts.fixturesReachableDatabases)) reasons.push('Isolamento de conexão da role de fixtures não verificado.');
  else reasons.push(...facts.fixturesReachableDatabases.map((db) => `Role de fixtures conseguiu conectar em ${db}: configure o pg_hba.conf (pg_hba-test-fixtures.conf.example).`));
  return reasons;
}
