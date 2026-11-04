import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { getBackendRoot, loadDatabaseProfile, redactSecrets, resolveSecretsDir } from '../../../src/config/secrets';
import { createPrismaRuntime } from '../../../src/lib/prisma';
import { countCollisions, countLeftovers } from './fixtures';
import {
  APP_ROLE, assertIntegrationGate, EXPECTED_MIGRATIONS, evaluatePreflight, FIXTURES_ROLE, IntegrationAbort, RUN_LOCK_KEY, TEST_DATABASE,
} from './preflight';
import type { ConnectionFacts, PreflightFacts } from './preflight';
import { FIXTURES_REACHABLE_SQL, PERMISSIONS_SQL } from './permissions';

/**
 * Connections for the integration suite:
 * - app: the real runtime client from `createPrismaRuntime('app-test')` (role cardapio_test_app).
 * - fixtures: role cardapio_test_fixtures, read from `fixtures-test.env` in the secrets directory
 *   (outside the repository). The role and the file do not exist yet: see
 *   docs/integration-db.md. Until they exist the suite aborts here, before any write.
 * - migrator: only to read _prisma_migrations, inside a READ ONLY transaction.
 */

const FIXTURES_FILE = 'fixtures-test.env';

export function loadFixturesUrl(secretsDir = resolveSecretsDir()): string {
  const file = path.join(secretsDir, FIXTURES_FILE);
  if (!fs.existsSync(file)) throw new IntegrationAbort([`Segredo de fixtures ausente (${FIXTURES_FILE} na pasta de segredos). Role ${FIXTURES_ROLE} ainda não provisionada.`]);
  const values = dotenv.parse(fs.readFileSync(file, 'utf8'));
  const keys = Object.keys(values);
  if (keys.length !== 1 || keys[0] !== 'DATABASE_URL') throw new IntegrationAbort([`${FIXTURES_FILE} deve conter somente DATABASE_URL.`]);
  let url: URL;
  try { url = new URL(values.DATABASE_URL!); } catch { throw new IntegrationAbort([`${FIXTURES_FILE}: URL inválida.`]); }
  const reasons: string[] = [];
  if (!/^postgres(ql)?:$/.test(url.protocol)) reasons.push('protocolo diferente de postgresql.');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) reasons.push('host deve ser local (127.0.0.1/localhost).');
  if (decodeURIComponent(url.pathname.slice(1)) !== TEST_DATABASE) reasons.push(`banco deve ser ${TEST_DATABASE}.`);
  if (decodeURIComponent(url.username) !== FIXTURES_ROLE) reasons.push(`usuário deve ser ${FIXTURES_ROLE}.`);
  if ([...url.searchParams.keys()].some((key) => !['schema', 'connection_limit'].includes(key)) ||
      (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) reasons.push('parâmetros da URL não autorizados.');
  if (reasons.length) throw new IntegrationAbort(reasons.map((r) => `${FIXTURES_FILE}: ${r}`));
  // Session advisory locks must stay on the same physical connection for the entire run.
  url.searchParams.set('connection_limit', '1');
  return url.toString();
}

interface FactsRow { database: string; user: string; session_user: string; server_identity: string; version: number; superuser: boolean; bypassrls: boolean; createrole: boolean; createdb: boolean; replication: boolean; readonly: string }
const FACTS_SQL = `SELECT current_database() AS database, current_user AS "user",
  session_user, inet_server_addr()::text || ':' || inet_server_port()::text AS server_identity,
  current_setting('server_version_num')::int AS version, r.rolsuper AS superuser, r.rolbypassrls AS bypassrls,
  r.rolcreaterole AS createrole, r.rolcreatedb AS createdb, r.rolreplication AS replication,
  current_setting('transaction_read_only') AS readonly
  FROM pg_roles r WHERE r.rolname = current_user`;

async function facts(client: PrismaClient, readOnly = false): Promise<ConnectionFacts> {
  const read = async (db: Pick<PrismaClient, '$queryRawUnsafe'>) => (await db.$queryRawUnsafe<FactsRow[]>(FACTS_SQL))[0]!;
  const row = readOnly
    ? await client.$transaction(async (tx) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return read(tx); })
    : await read(client);
  return { database: row.database, user: row.user, sessionUser: row.session_user, serverIdentity: row.server_identity, serverVersionNum: row.version, superuser: row.superuser, bypassRls: row.bypassrls, createRole: row.createrole, createDb: row.createdb, replication: row.replication, readOnly: row.readonly === 'on' };
}

export function diskChecksums(): Record<string, string> {
  const dir = path.join(getBackendRoot(), 'prisma', 'migrations');
  return Object.fromEntries(EXPECTED_MIGRATIONS.map(({ name }) => {
    const file = path.join(dir, name, 'migration.sql');
    return [name, fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'ausente'];
  }));
}

export interface IntegrationDatabases { app: PrismaClient; fixtures: PrismaClient; close(): Promise<void> }

export interface DatabaseDependencies {
  app(): PrismaClient;
  fixtures(): PrismaClient;
  migrator(): PrismaClient;
  checksums(): Record<string, string>;
  /** Tries to open (and immediately close) a fixtures-role connection to `database`. True = connected. */
  probeFixturesConnection(database: string): Promise<boolean>;
}

/** Same credentials, other database. No statement is sent: only authentication is attempted. */
export function fixturesUrlFor(database: string, base = loadFixturesUrl()): string {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(database)) throw new IntegrationAbort([`Nome de banco inesperado na sondagem: ${database}`]);
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.searchParams.set('connect_timeout', '5');
  return url.toString();
}

async function probeFixturesConnection(database: string): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url: fixturesUrlFor(database) } } });
  try {
    await client.$connect();
    return true;
  } catch {
    return false; // refused by pg_hba (or any other failure): the role cannot reach this database
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

const dependencies: DatabaseDependencies = {
  app: () => createPrismaRuntime('app-test').prisma,
  fixtures: () => new PrismaClient({ datasources: { db: { url: loadFixturesUrl() } } }),
  migrator: () => new PrismaClient({ datasources: { db: { url: loadDatabaseProfile('migrate-test', { purpose: 'migration' }).databaseUrl } } }),
  checksums: diskChecksums,
  probeFixturesConnection,
};

/** Probes every database the fixtures role could reach by privilege; returns those that connected. */
export async function reachableDatabases(candidates: string[], probe: DatabaseDependencies['probeFixturesConnection']): Promise<string[]> {
  const reached: string[] = [];
  for (const database of candidates) if (await probe(database)) reached.push(database);
  return reached;
}

/**
 * Opens the connections, gathers every fact and aborts on any deviation. The only statements
 * issued before the decision are SELECTs and pg_try_advisory_lock (no data is written).
 * The advisory lock is held by the fixtures connection until `close()`.
 */
export async function openIntegrationDatabases(env: Record<string, string | undefined> = process.env, deps = dependencies, allowLeftovers = false): Promise<IntegrationDatabases> {
  assertIntegrationGate(env);
  const clients: PrismaClient[] = [];
  const close = async () => { await Promise.allSettled(clients.map((c) => c.$disconnect())); };
  try {
    const app = deps.app(); clients.push(app);
    const fixtures = deps.fixtures(); clients.push(fixtures);
    const migrator = deps.migrator(); clients.push(migrator);
    // Acquire before checking residues/collisions, avoiding a check-then-lock race.
    const lockAcquired = (await fixtures.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT pg_try_advisory_lock(${RUN_LOCK_KEY}) AS ok`))[0]!.ok;
    if (!lockAcquired) throw new IntegrationAbort(['advisory lock ocupado.']);
    const collected: PreflightFacts = {
      app: await facts(app),
      fixtures: await facts(fixtures),
      migrator: await facts(migrator, true),
      migrations: await migrator.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return tx.$queryRawUnsafe<{ name: string; checksum: string; finished: boolean; rolledBack: boolean }[]>(
          `SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack" FROM _prisma_migrations ORDER BY started_at`);
      }),
      diskChecksums: deps.checksums(),
      leftovers: allowLeftovers ? {} : await countLeftovers(fixtures),
      collisions: await countCollisions(fixtures),
      lockAcquired,
      permissionViolations: await migrator.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return (await tx.$queryRawUnsafe<{ violation: string }[]>(PERMISSIONS_SQL)).map((r) => r.violation);
      }),
    };
    // 3D.3.11: CONNECT inherited from PUBLIC is neutralized by pg_hba; prove it by trying.
    const candidates = await migrator.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return (await tx.$queryRawUnsafe<{ datname: string }[]>(FIXTURES_REACHABLE_SQL)).map((r) => r.datname);
    });
    collected.fixturesReachableDatabases = await reachableDatabases(candidates, deps.probeFixturesConnection);
    await migrator.$disconnect();
    const reasons = evaluatePreflight(collected);
    if (reasons.length) throw new IntegrationAbort(reasons);
    if (collected.app.user !== APP_ROLE) throw new IntegrationAbort(['role da aplicação inesperada.']);
    return { app, fixtures, close };
  } catch (error) {
    await close();
    if (error instanceof IntegrationAbort) throw error;
    throw new IntegrationAbort([redactSecrets(error instanceof Error ? error.message : String(error))]);
  }
}
