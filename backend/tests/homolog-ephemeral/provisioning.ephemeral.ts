/**
 * PREPARADO — NÃO EXECUTADO. Ensaio integral da homologação em um PostgreSQL 18 TOTALMENTE DESCARTÁVEL, com TLS
 * (CA sintética) e host NÃO-loopback, exercitando os mesmos gates dos wrappers reais (`prisma-run`, identidade do servidor,
 * núcleo do bootstrap). Pensado para o workflow manual `homolog-ephemeral` (.github/workflows/homolog-ephemeral.yml).
 *
 * Fluxo: identidade do servidor → 01 roles+marca → 02 banco de replay → wrapper `migrate-homolog-replay` (oito migrations ORIGINAIS)
 * → histórico/ACL/ownership → 03 → 04 rename → equivalência (snapshots A×B, renomeações classificadas, matriz de privilégios,
 * `_prisma_migrations` idêntica) → wrapper final → recusas de identidade → bootstrap → login/ready → oitava migration sintética
 * (cópia temporária do backend; o repositório não é tocado) → drift → descarte total.
 *
 * Variáveis (todas sintéticas, definidas pelo workflow; nunca segredos reais):
 *   RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM=RUN_ON_EPHEMERAL_POSTGRES
 *   RUSTIKA_HOMOLOG_EPHEMERAL_HOST (IP/FQDN não-loopback)   RUSTIKA_HOMOLOG_EPHEMERAL_PORT
 *   RUSTIKA_HOMOLOG_EPHEMERAL_ADMIN_USER / _ADMIN_PASSWORD   RUSTIKA_HOMOLOG_EPHEMERAL_CA_FILE / _WRONG_CA_FILE
 *   RUSTIKA_HOMOLOG_EPHEMERAL_CLUSTER_NAME (deve coincidir com SHOW cluster_name do servidor, antes da primeira escrita)
 *   RUSTIKA_HOMOLOG_EPHEMERAL_REQUIRED=1 (no CI: configuração ausente FALHA em vez de pular)
 * Sem as variáveis, a suíte é pulada explicitamente (uso local); com REQUIRED=1 nunca é pulada em silêncio.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_DATABASES_SQL, PROJECT_ROLES_SQL, assertOnlyEphemeralAdminRole, assertOnlyPostgresDatabase } from './roleGuard';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import { evaluateServerIdentity, MARKER_PREFIX, readServerFacts } from '../../src/config/serverIdentity';
import { hashPassword, verifyPassword } from '../../src/security/password';
import { runBootstrap } from '../../scripts/bootstrap/adminBootstrap';
import type { BootstrapDeps } from '../../scripts/bootstrap/adminBootstrap';
import { checkPasswordPolicy } from '../../scripts/bootstrap/adminInput';
import { EXPECTED_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import { lintFutureMigration } from '../../scripts/bootstrap/futureMigrationPolicy';
import { verifyAppliedMigrations, verifyMigrationDirectory } from '../../scripts/bootstrap/migrationIntegrity';
import { createPrismaBootstrapDb } from '../../scripts/bootstrap/prismaBootstrapDb';
import { classifyRenames, diffSnapshots, fingerprint, readPhysicalIdentity, readSchemaSnapshot, snapshotCompletenessProblems } from '../../scripts/homolog/schemaSnapshot';
import type { PhysicalIdentity, SchemaSnapshot } from '../../scripts/homolog/schemaSnapshot';

const e = process.env;
const HOST = e.RUSTIKA_HOMOLOG_EPHEMERAL_HOST ?? '';
const PORT = e.RUSTIKA_HOMOLOG_EPHEMERAL_PORT ?? '5432';
const ADMIN_USER = e.RUSTIKA_HOMOLOG_EPHEMERAL_ADMIN_USER ?? '';
const ADMIN_PASSWORD_PG = e.RUSTIKA_HOMOLOG_EPHEMERAL_ADMIN_PASSWORD ?? '';
const CA_FILE = e.RUSTIKA_HOMOLOG_EPHEMERAL_CA_FILE ?? '';
const WRONG_CA_FILE = e.RUSTIKA_HOMOLOG_EPHEMERAL_WRONG_CA_FILE ?? '';
const CLUSTER_NAME = e.RUSTIKA_HOMOLOG_EPHEMERAL_CLUSTER_NAME ?? '';
const REQUIRED = e.RUSTIKA_HOMOLOG_EPHEMERAL_REQUIRED === '1';
const ENABLED = e.RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM === 'RUN_ON_EPHEMERAL_POSTGRES'
  && [HOST, ADMIN_USER, ADMIN_PASSWORD_PG, CA_FILE, CLUSTER_NAME].every((value) => value !== '');

const BACKEND = process.cwd();
const SQL = (file: string) => path.join(BACKEND, 'ops', 'homolog', 'sql', file);
const TSX = path.join(BACKEND, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const REPLAY_DB = 'cardapio_digital_test';
const FINAL_DB = 'cardapio_digital_homolog';
const LEGACY = { migrator: 'cardapio_migrator', app: 'cardapio_test_app', placeholder: 'cardapio_dev_app' } as const;
const FINAL = { migrator: 'cardapio_homolog_migrator', app: 'cardapio_homolog_app', bootstrap: 'cardapio_homolog_bootstrap', placeholder: 'cardapio_homolog_placeholder' } as const;
const ALL_ROLES = ['cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_migrator', 'cardapio_homolog_app', 'cardapio_homolog_placeholder', 'cardapio_homolog_bootstrap', 'rustika_homolog_marker'];
const IDENTITY = { name: 'Admin Efêmero', email: 'admin.efemero@exemplo.invalid' };
const ADMIN_PASSWORD = `Ef-${randomBytes(12).toString('hex')}-Zq9!`; // gerada em memória; nunca registrada
const REPLAY_CONFIRM = { CARDAPIO_MIGRATE_HOMOLOG_REPLAY_CONFIRMATION: 'REPLAY_HISTORICAL_MIGRATIONS_RUSTIKA_HOMOLOG' };
const FINAL_CONFIRM = { CARDAPIO_MIGRATE_HOMOLOG_CONFIRMATION: 'APPLY_RUSTIKA_HOMOLOG_MIGRATIONS' };

const redact = (text: string) => text.replace(/postgres(ql)?:\/\/[^\s@]*@/g, 'postgresql://***@');
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

function prismaUrl(user: string, password: string, database: string, ca = CA_FILE): string {
  const url = new URL(`postgresql://${HOST}:${PORT}/${database}`);
  url.username = user; url.password = password;
  url.search = `schema=public&sslmode=require&sslaccept=strict&sslcert=${encodeURIComponent(ca)}`;
  return url.toString();
}
function psqlUrl(user: string, password: string, database: string): string {
  const url = new URL(`postgresql://${HOST}:${PORT}/${database}`);
  url.username = user; url.password = password;
  url.search = `sslmode=verify-full&sslrootcert=${encodeURIComponent(CA_FILE)}`;
  return url.toString();
}
function psql(url: string, file: string): { status: number | null; output: string } {
  const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', url, '-f', SQL(file)], { encoding: 'utf8', timeout: 120_000 });
  return { status: result.status, output: redact(`${result.stdout}${result.stderr}`) };
}
function client(user: string, password: string, database: string, ca = CA_FILE): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: prismaUrl(user, password, database, ca) } } });
}
async function canLogin(user: string, password: string, database: string, ca = CA_FILE): Promise<boolean> {
  const probe = client(user, password, database, ca);
  try { await probe.$queryRawUnsafe('SELECT 1'); return true; } catch { return false; } finally { await probe.$disconnect(); }
}
async function withClient<T>(user: string, password: string, database: string, action: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const prisma = client(user, password, database);
  try { return await action(prisma); } finally { await prisma.$disconnect(); }
}

/** Escreve a pasta de segredos SINTÉTICA (fora do repositório, 0700/0600) usada pelos wrappers reais. */
function writeSecrets(dir: string, clusterId: string, passwords: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const profiles: Array<[string, string, string]> = [
    ['migrate-homolog-replay', LEGACY.migrator, REPLAY_DB], ['migrate-homolog', FINAL.migrator, FINAL_DB],
    ['app-homolog', FINAL.app, FINAL_DB], ['bootstrap-homolog', FINAL.bootstrap, FINAL_DB],
  ];
  for (const [profile, user, database] of profiles) {
    const password = profile === 'migrate-homolog-replay' ? passwords[LEGACY.migrator]! : passwords[user]!;
    const content = `DATABASE_URL="${prismaUrl(user, password, database)}"\nEXPECTED_DATABASE_HOST="${HOST}"\nEXPECTED_CLUSTER_ID="${clusterId}"\n`;
    fs.writeFileSync(path.join(dir, `${profile}.env`), content, { mode: 0o600 });
  }
}
function wrapper(secretsDir: string, profile: string, subcommand: 'status' | 'deploy', extra: Record<string, string> = {}, cwd = BACKEND): { status: number | null; output: string } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, CARDAPIO_SECRETS_DIR: secretsDir, ...extra };
  delete childEnv.DATABASE_URL; delete childEnv.SHADOW_DATABASE_URL;
  for (const key of Object.keys(childEnv)) if (key.startsWith('CARDAPIO_MIGRATE_') && !(key in extra)) delete childEnv[key];
  const result = spawnSync(process.execPath, [TSX, path.join(cwd, 'scripts', 'prisma-run.ts'), profile, 'migrate', subcommand], { cwd, env: childEnv, encoding: 'utf8', timeout: 240_000 });
  return { status: result.status, output: redact(`${result.stdout}\n${result.stderr}`) };
}

interface MigrationRow { migration_name: string; checksum: string; started_at: string; finished_at: string | null; rolled_back_at: string | null; applied_steps_count: number; logs: string | null }
async function migrationRows(prisma: PrismaClient): Promise<MigrationRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<MigrationRow & { started_at: Date; finished_at: Date | null; rolled_back_at: Date | null }>>(
    'SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count, logs FROM public._prisma_migrations ORDER BY migration_name');
  return rows.map((row) => ({ ...row, started_at: row.started_at.toISOString(), finished_at: row.finished_at?.toISOString() ?? null, rolled_back_at: row.rolled_back_at?.toISOString() ?? null }));
}
const asApplied = (rows: MigrationRow[]) => rows.map((row) => ({ name: row.migration_name, checksum: row.checksum, finished: row.finished_at !== null, rolledBack: row.rolled_back_at !== null }));

/** Matriz efetiva de privilégios (tabela e coluna) de uma role, via funções do catálogo — independente de nomes. */
async function privilegeMatrix(admin: PrismaClient, role: string): Promise<string[]> {
  const tables = await admin.$queryRawUnsafe<Array<{ item: string }>>(
    `SELECT c.relname || ':' || p.priv AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND has_table_privilege($1, c.oid, p.priv) AND (c.relkind <> 'S' OR p.priv IN ('SELECT', 'UPDATE'))`, role);
  const columns = await admin.$queryRawUnsafe<Array<{ item: string }>>(
    `SELECT c.relname || '.' || a.attname || ':' || p.priv AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND has_column_privilege($1, c.oid, a.attnum, p.priv)`, role);
  const schema = await admin.$queryRawUnsafe<Array<{ item: string }>>(
    `SELECT 'schema:' || p.priv AS item FROM (VALUES ('USAGE'), ('CREATE')) p(priv) WHERE has_schema_privilege($1, 'public', p.priv)`, role);
  const database = await admin.$queryRawUnsafe<Array<{ item: string }>>(
    `SELECT 'database:' || p.priv AS item FROM (VALUES ('CONNECT'), ('CREATE'), ('TEMPORARY')) p(priv) WHERE has_database_privilege($1, current_database(), p.priv)`, role);
  return [...tables, ...columns, ...schema, ...database].map((row) => row.item).sort();
}

describe('configuração do ensaio efêmero', () => {
  it('no CI (REQUIRED=1) a configuração completa é obrigatória: nada é pulado em silêncio', () => {
    if (REQUIRED) {
      expect(e.RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM, 'confirmação explícita').toBe('RUN_ON_EPHEMERAL_POSTGRES');
      for (const [name, value] of Object.entries({ HOST, ADMIN_USER, ADMIN_PASSWORD_PG, CA_FILE, WRONG_CA_FILE, CLUSTER_NAME })) expect(value, `variável ${name}`).not.toBe('');
    }
    expect(true).toBe(true);
  });
});

describe.skipIf(!ENABLED)('homologação cardapio_digital_homolog em PostgreSQL efêmero (replay + renomeação)', () => {
  const pw = Object.fromEntries(ALL_ROLES.map((role) => [role, `Ep-${randomBytes(18).toString('hex')}`])) as Record<string, string>;
  const temps: string[] = [];
  let admin: PrismaClient;
  let created = false;
  let clusterId = '';
  let secrets = '';
  let rowsBefore: MigrationRow[] = [];
  let identityBefore: PhysicalIdentity;
  let snapshotA: SchemaSnapshot;
  let snapshotB: SchemaSnapshot;
  const matrixBefore: Record<string, string[]> = {};

  beforeAll(async () => {
    expect(['127.0.0.1', 'localhost', '::1', '0.0.0.0'], 'o ensaio exige host não-loopback para exercitar os gates reais').not.toContain(HOST.toLowerCase());
    expect(fs.existsSync(CA_FILE), 'CA sintética').toBe(true);
    admin = client(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres');
    // Identidade do servidor ANTES da primeira escrita: cluster descartável nomeado, TLS real, PG ≥ 17, vazio.
    const head = await admin.$queryRawUnsafe<Array<{ cluster: string; ver: number; ssl: boolean }>>(
      "SELECT current_setting('cluster_name') AS cluster, current_setting('server_version_num')::int AS ver, COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl");
    expect(head[0]!.cluster, 'cluster_name do servidor descartável').toBe(CLUSTER_NAME);
    expect(head[0]!.ssl, 'TLS ativo na conexão do ensaio').toBe(true);
    expect(head[0]!.ver).toBeGreaterThanOrEqual(170000);
    const databases = await admin.$queryRawUnsafe<Array<{ datname: string }>>(PROJECT_DATABASES_SQL);
    expect(() => assertOnlyPostgresDatabase(databases.map((row) => row.datname)), 'servidor deve conter somente o banco postgres').not.toThrow();
    // A única role do projeto permitida é a administrativa temporária do workflow (igualdade exata); ela deve existir.
    const roles = await admin.$queryRawUnsafe<Array<{ rolname: string }>>(PROJECT_ROLES_SQL);
    expect(() => assertOnlyEphemeralAdminRole(roles.map((row) => row.rolname), ADMIN_USER), 'nenhuma role do projeto pré-existente além da administrativa').not.toThrow();
    expect(spawnSync('psql', ['--version']).status, 'psql disponível no PATH').toBe(0);
    secrets = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-secrets-')); temps.push(secrets);
  });

  afterAll(async () => {
    while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true });
    if (!admin) return;
    if (created) {
      await admin.$queryRawUnsafe("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'cardapio\\_%' AND pid <> pg_backend_pid()").catch(() => undefined);
      for (const database of [FINAL_DB, REPLAY_DB, 'cardapio_digital_dev']) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      for (const role of ALL_ROLES) await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
    }
    const leftoverDatabases = await admin.$queryRawUnsafe<Array<{ datname: string }>>(PROJECT_DATABASES_SQL);
    const leftoverRoles = await admin.$queryRawUnsafe<Array<{ rolname: string }>>(PROJECT_ROLES_SQL);
    await admin.$disconnect();
    // Resíduo zero para tudo que pertence à suíte; a role administrativa do workflow permanece (o cleanup externo cuida dela).
    const residue = (): void => {
      assertOnlyPostgresDatabase(leftoverDatabases.map((row) => row.datname));
      assertOnlyEphemeralAdminRole(leftoverRoles.map((row) => row.rolname), ADMIN_USER);
    };
    expect(residue, 'cleanup: nenhum banco/role do ensaio pode sobrar').not.toThrow();
    expect(temps.length).toBe(0);
  });

  it('0) TLS de verdade: CA errada é recusada e o servidor só aceita a CA sintética', async () => {
    expect(await canLogin(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres')).toBe(true);
    expect(fs.existsSync(WRONG_CA_FILE), 'CA incorreta fornecida pelo workflow').toBe(true);
    expect(await canLogin(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres', WRONG_CA_FILE), 'CA errada deve ser recusada').toBe(false);
  });

  it('1) roles legadas transitórias e marca do cluster; recusa repetir; o UUID impresso é o do catálogo', async () => {
    created = true;
    const run = psql(psqlUrl(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres'), '01-cluster-roles.sql');
    expect(run.status, run.output).toBe(0);
    const printed = /rustika-homolog-cluster:([0-9a-f-]{36})|MARCA DO CLUSTER[^\n]*?([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(run.output);
    clusterId = (printed?.[1] ?? printed?.[2] ?? '').toLowerCase();
    expect(clusterId, 'UUID impresso pelo script 01').toMatch(/^[0-9a-f-]{36}$/);
    const marker = await admin.$queryRawUnsafe<Array<{ c: string; login: boolean }>>("SELECT shobj_description(oid, 'pg_authid') AS c, rolcanlogin AS login FROM pg_roles WHERE rolname = 'rustika_homolog_marker'");
    expect(marker[0]!.c.toLowerCase()).toBe(`${MARKER_PREFIX}${clusterId}`);
    expect(marker[0]!.login, 'a marca é NOLOGIN').toBe(false);
    for (const role of ['cardapio_migrator', 'cardapio_test_app', 'cardapio_homolog_bootstrap']) await admin.$executeRawUnsafe(`ALTER ROLE ${role} PASSWORD '${pw[role]}'`);
    expect(psql(psqlUrl(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres'), '01-cluster-roles.sql').status, 'repetir 01 deve abortar').not.toBe(0);
    writeSecrets(secrets, clusterId, pw);
  });

  it('2) banco de replay vazio; recusa sobrescrever; bootstrap sem login fora da janela', async () => {
    const adminUrl = psqlUrl(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres');
    expect(psql(adminUrl, '02-create-replay-database.sql').status).toBe(0);
    expect(psql(adminUrl, '02-create-replay-database.sql').output).toMatch(/ABORT/);
    expect(await canLogin('cardapio_homolog_bootstrap', pw.cardapio_homolog_bootstrap!, REPLAY_DB)).toBe(false);
  });

  it('3) wrapper do replay: recusa sem confirmação e com marca de cluster errada; aplica as oito migrations ORIGINAIS com a confirmação certa', async () => {
    expect(verifyMigrationDirectory(path.join(BACKEND, 'prisma', 'migrations')), 'oito migrations íntegras no disco').toEqual([]);
    const noConfirm = wrapper(secrets, 'migrate-homolog-replay', 'deploy');
    expect(noConfirm.status).not.toBe(0);
    const wrongDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-secrets-wrong-')); temps.push(wrongDir);
    writeSecrets(wrongDir, '00000000-0000-4000-8000-000000000000', pw);
    const wrong = wrapper(wrongDir, 'migrate-homolog-replay', 'deploy', REPLAY_CONFIRM);
    expect(wrong.status).not.toBe(0);
    expect(wrong.output).toMatch(/Identidade do servidor/);
    await withClient(LEGACY.migrator, pw.cardapio_migrator!, REPLAY_DB, async (prisma) => {
      const tables = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public'");
      expect(Number(tables[0]!.n), 'as recusas não podem ter escrito nada').toBe(0);
    });
    const ok = wrapper(secrets, 'migrate-homolog-replay', 'deploy', REPLAY_CONFIRM);
    expect(ok.status, ok.output).toBe(0);
    const status = wrapper(secrets, 'migrate-homolog-replay', 'status');
    expect(status.status, status.output).toBe(0);
  });

  it('4) histórico registrado, ownership, ACL e snapshot A (antes do rename)', async () => {
    await withClient(LEGACY.migrator, pw.cardapio_migrator!, REPLAY_DB, async (prisma) => {
      rowsBefore = await migrationRows(prisma);
      expect(verifyAppliedMigrations(asApplied(rowsBefore)), 'conjunto exato, concluído, sem reversão, checksums esperados').toEqual([]);
      expect(rowsBefore.map((row) => row.migration_name)).toEqual(EXPECTED_MIGRATIONS.map((m) => m.name).sort());
      expect(rowsBefore.every((row) => row.applied_steps_count === 1 && row.logs === null), 'nenhuma migration falhada').toBe(true);
      snapshotA = await readSchemaSnapshot(prisma);
      identityBefore = await readPhysicalIdentity(prisma);
      const owners = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        "SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','S','i') AND pg_get_userbyid(c.relowner) <> 'cardapio_migrator'");
      expect(Number(owners[0]!.n), 'todo objeto pertence ao migrator legado').toBe(0);
    });
    for (const role of [LEGACY.app, LEGACY.migrator, LEGACY.placeholder, 'cardapio_homolog_bootstrap']) matrixBefore[role] = await privilegeMatrix(admin, role);
    expect(matrixBefore[LEGACY.placeholder], 'placeholder sem privilégios em tabelas').not.toEqual(expect.arrayContaining([expect.stringMatching(/:SELECT$/)]));
    const runtime = matrixBefore[LEGACY.app]!;
    expect(runtime.filter((item) => /:(TRUNCATE|REFERENCES|TRIGGER)$/.test(item)), 'runtime sem TRUNCATE/REFERENCES/TRIGGER').toEqual([]);
    expect(runtime.filter((item) => item.startsWith('_prisma_migrations')), 'runtime sem acesso ao histórico').toEqual([]);
    expect(runtime).not.toContain('schema:CREATE');
    expect(runtime.filter((item) => /^admins[.:]/.test(item) && !/:SELECT$/.test(item)), 'runtime só lê admins').toEqual([]);
    expect(psql(psqlUrl(LEGACY.migrator, pw.cardapio_migrator!, REPLAY_DB), '03-verify-replay.sql').status).toBe(0);
  });

  it('5) falhas detectadas: dados inesperados no banco transitório e histórico adulterado reprovam; o rename só ocorre depois de restaurar', async () => {
    const replayAdmin = client(ADMIN_USER, ADMIN_PASSWORD_PG, REPLAY_DB);
    try {
      await replayAdmin.$executeRawUnsafe("INSERT INTO admins (id, name, email, password_hash, updated_at) VALUES (gen_random_uuid(), 'x', 'x@y.zz', 'h', now())");
      expect(psql(psqlUrl(LEGACY.migrator, pw.cardapio_migrator!, REPLAY_DB), '03-verify-replay.sql').status, 'dados inesperados devem reprovar o 03').not.toBe(0);
      await replayAdmin.$executeRawUnsafe('DELETE FROM admins');
      await replayAdmin.$executeRawUnsafe("UPDATE _prisma_migrations SET checksum = repeat('0', 64) WHERE migration_name = $1", EXPECTED_MIGRATIONS[2]!.name);
      expect(verifyAppliedMigrations(asApplied(await migrationRows(replayAdmin))).join(' ')).toMatch(/checksum/i);
      await replayAdmin.$executeRawUnsafe('UPDATE _prisma_migrations SET checksum = $1 WHERE migration_name = $2', EXPECTED_MIGRATIONS[2]!.checksum, EXPECTED_MIGRATIONS[2]!.name);
      expect(await migrationRows(replayAdmin)).toEqual(rowsBefore); // restaurado exatamente
    } finally { await replayAdmin.$disconnect(); }
    expect(psql(psqlUrl(LEGACY.migrator, pw.cardapio_migrator!, REPLAY_DB), '03-verify-replay.sql').status).toBe(0);
  });

  it('6) rename: recusado com sessão ativa e pela role renomeável; concluído pelo administrador; ownership e config preservados', async () => {
    const blocker = client(LEGACY.migrator, pw.cardapio_migrator!, REPLAY_DB);
    try {
      await blocker.$queryRawUnsafe('SELECT 1');
      expect(psql(psqlUrl(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres'), '04-finalize-rename.sql').status, 'conexão ativa no banco de replay').not.toBe(0);
    } finally { await blocker.$disconnect(); }
    expect(psql(psqlUrl(LEGACY.migrator, pw.cardapio_migrator!, 'postgres'), '04-finalize-rename.sql').status, 'a role legada não pode executar o rename').not.toBe(0);
    expect((await admin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_database WHERE datname = '${REPLAY_DB}'`))[0]!.n, 'nada mudou nas recusas').toBe(1n);
    const done = psql(psqlUrl(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres'), '04-finalize-rename.sql');
    expect(done.status, done.output).toBe(0);
    const names = await admin.$queryRawUnsafe<Array<{ datname: string }>>("SELECT datname FROM pg_database WHERE datname LIKE 'cardapio\\_%'");
    expect(names.map((row) => row.datname)).toEqual([FINAL_DB]);
    for (const [role, password] of [[FINAL.migrator, pw.cardapio_migrator!], [FINAL.app, pw.cardapio_test_app!]] as const) await admin.$executeRawUnsafe(`ALTER ROLE ${role} PASSWORD '${password}'`);
    pw[FINAL.migrator] = pw.cardapio_migrator!; pw[FINAL.app] = pw.cardapio_test_app!;
    writeSecrets(secrets, clusterId, pw);
  });

  it('7) EQUIVALÊNCIA: renomeações legítimas × alterações inesperadas, schema, ACLs, matriz de privilégios e histórico', async () => {
    await withClient(FINAL.migrator, pw[FINAL.migrator]!, FINAL_DB, async (prisma) => {
      const report = classifyRenames(identityBefore, await readPhysicalIdentity(prisma));
      expect(report.unexpected, 'somente renomeações aprovadas').toEqual([]);
      expect(report.renamed).toHaveLength(4);
      snapshotB = await readSchemaSnapshot(prisma);
      const differences = diffSnapshots(snapshotA, snapshotB);
      expect(differences, JSON.stringify(differences, null, 1)).toEqual([]);
      expect(fingerprint(snapshotB)).toBe(fingerprint(snapshotA));
      // Seções obrigatórias não vazias (defaultAcls pode legitimamente ser vazia) e nenhuma role desconhecida em nenhuma seção.
      expect(snapshotCompletenessProblems(snapshotB), 'completude do snapshot').toEqual([]);
      expect(await migrationRows(prisma), '_prisma_migrations idêntica (checksums, datas e passos)').toEqual(rowsBefore);
    });
    const pairs: Array<[string, string]> = [[LEGACY.app, FINAL.app], [LEGACY.migrator, FINAL.migrator], [LEGACY.placeholder, FINAL.placeholder], ['cardapio_homolog_bootstrap', 'cardapio_homolog_bootstrap']];
    for (const [before, after] of pairs) {
      expect(await privilegeMatrix(admin, after), `matriz de privilégios de ${after}`).toEqual(matrixBefore[before]);
    }
    expect(psql(psqlUrl(FINAL.migrator, pw[FINAL.migrator]!, FINAL_DB), '09-verify-acl.sql').status).toBe(0);
  });

  it('8) wrapper final: status e deploy sem reaplicação; o perfil de replay deixa de funcionar', () => {
    const status = wrapper(secrets, 'migrate-homolog', 'status');
    expect(status.status, status.output).toBe(0);
    expect(status.output).toMatch(/up to date/i);
    expect(wrapper(secrets, 'migrate-homolog', 'deploy').status, 'deploy exige confirmação própria').not.toBe(0);
    const deploy = wrapper(secrets, 'migrate-homolog', 'deploy', FINAL_CONFIRM);
    expect(deploy.status, deploy.output).toBe(0);
    expect(deploy.output).toMatch(/No pending migrations/);
    expect(wrapper(secrets, 'migrate-homolog-replay', 'status').status, 'o banco transitório não existe mais').not.toBe(0);
  });

  it('9) identidade do servidor: marca alterada e presença de banco de desenvolvimento são recusadas pelo wrapper e restauradas', async () => {
    const original = `${MARKER_PREFIX}${clusterId}`;
    await admin.$executeRawUnsafe(`COMMENT ON ROLE rustika_homolog_marker IS '${MARKER_PREFIX}00000000-0000-4000-8000-000000000000'`);
    const wrongMarker = wrapper(secrets, 'migrate-homolog', 'status');
    await admin.$executeRawUnsafe(`COMMENT ON ROLE rustika_homolog_marker IS '${original}'`);
    expect(wrongMarker.status).not.toBe(0);
    expect(wrongMarker.output).toMatch(/Identidade do servidor/);
    await admin.$executeRawUnsafe('CREATE DATABASE cardapio_digital_dev');
    const devPresent = wrapper(secrets, 'migrate-homolog', 'status');
    await admin.$executeRawUnsafe('DROP DATABASE cardapio_digital_dev');
    expect(devPresent.status).not.toBe(0);
    expect(devPresent.output).toMatch(/cardapio_digital_dev/);
    await withClient(FINAL.migrator, pw[FINAL.migrator]!, FINAL_DB, async (prisma) => {
      const facts = await readServerFacts(prisma);
      expect(facts.sslActive).toBe(true);
      expect(evaluateServerIdentity(facts, { phase: 'final', expectedClusterId: clusterId, expectedUser: FINAL.migrator })).toEqual([]);
      expect(evaluateServerIdentity(facts, { phase: 'replay', expectedClusterId: clusterId, expectedUser: FINAL.migrator }).length).toBeGreaterThan(0);
    });
  });

  it('10) bootstrap: recusas (role, banco e cluster errados), um único administrador, hash correto, sem exposição de senha', async () => {
    const migrator = psqlUrl(FINAL.migrator, pw[FINAL.migrator]!, FINAL_DB);
    expect(psql(migrator, '05-post-migration-grants.sql').status).toBe(0);
    expect(await canLogin(FINAL.bootstrap, pw.cardapio_homolog_bootstrap!, FINAL_DB), 'sem login antes da janela').toBe(false);
    expect(psql(psqlUrl(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres'), '06-bootstrap-window-open.sql').status).toBe(0);
    const results: unknown[] = [];
    await withClient(FINAL.bootstrap, pw.cardapio_homolog_bootstrap!, FINAL_DB, async (prisma) => {
      const deps: BootstrapDeps = { db: createPrismaBootstrapDb(prisma), hash: hashPassword, readPassword: async () => ADMIN_PASSWORD, validatePassword: (password) => checkPasswordPolicy(password, IDENTITY) };
      const good = { database: FINAL_DB, user: FINAL.bootstrap, clusterId };
      expect((await runBootstrap(deps, IDENTITY, 'dry-run', good)).status, 'ausência inicial de administradores').toBe('dry-run-ok');
      for (const wrong of [{ ...good, user: FINAL.app }, { ...good, database: REPLAY_DB }, { ...good, clusterId: '00000000-0000-4000-8000-000000000000' }]) {
        const refused = await runBootstrap(deps, IDENTITY, 'execute', wrong);
        results.push(refused);
        expect(refused).toMatchObject({ status: 'refused', code: 'ENVIRONMENT_MISMATCH' });
      }
      expect(await prisma.admin.count(), 'as recusas não criaram administrador').toBe(0);
      const created = await runBootstrap(deps, IDENTITY, 'execute', good); results.push(created);
      expect(created.status).toBe('created');
      const second = await runBootstrap(deps, { ...IDENTITY, email: 'outro@exemplo.invalid' }, 'execute', good); results.push(second);
      expect(second).toMatchObject({ status: 'refused', code: 'ADMIN_ALREADY_EXISTS' });
      expect(await prisma.admin.count()).toBe(1);
      await expect(prisma.$executeRawUnsafe('DELETE FROM admins')).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe("UPDATE admins SET name = 'x'")).rejects.toThrow();
    });
    expect(JSON.stringify(results)).not.toContain(ADMIN_PASSWORD);
    const rows = await withClient(FINAL.migrator, pw[FINAL.migrator]!, FINAL_DB, (prisma) => prisma.$queryRawUnsafe<Array<{ password_hash: string }>>('SELECT password_hash FROM admins'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.password_hash).not.toContain(ADMIN_PASSWORD);
    expect(await verifyPassword(ADMIN_PASSWORD, rows[0]!.password_hash)).toBe(true);
    expect(await verifyPassword(`${ADMIN_PASSWORD}x`, rows[0]!.password_hash)).toBe(false);
    await withClient(FINAL.app, pw[FINAL.app]!, FINAL_DB, async (prisma) => {
      const deps: BootstrapDeps = { db: createPrismaBootstrapDb(prisma), hash: hashPassword, readPassword: async () => ADMIN_PASSWORD, validatePassword: (password) => checkPasswordPolicy(password, IDENTITY) };
      const inadequate = await runBootstrap(deps, IDENTITY, 'execute', { database: FINAL_DB, user: FINAL.app, clusterId }).then((result) => result.status, () => 'threw');
      expect(['refused', 'threw'], 'a role de runtime nunca pode fazer bootstrap').toContain(inadequate);
    });
    expect(psql(psqlUrl(ADMIN_USER, ADMIN_PASSWORD_PG, 'postgres'), '07-bootstrap-window-close.sql').status).toBe(0);
    expect(psql(migrator, '08-bootstrap-revoke.sql').status).toBe(0);
    expect(psql(migrator, '09-verify-acl.sql').status).toBe(0);
    expect(await canLogin(FINAL.bootstrap, pw.cardapio_homolog_bootstrap!, FINAL_DB)).toBe(false);
  });

  it('11) runtime: /api/ready, login HTTP, senha errada e escritas indevidas negadas', async () => {
    await withClient(FINAL.app, pw[FINAL.app]!, FINAL_DB, async (runtime) => {
      const app = createApp({ prisma: runtime });
      expect((await request(app).get('/api/ready')).status).toBe(200);
      const login = (password: string) => request(app).post('/api/admin/auth/login').set('Origin', env.corsOrigin)
        .set('X-Rustika-Request', '1').set('Content-Type', 'application/json').send({ email: IDENTITY.email, password });
      const ok = await login(ADMIN_PASSWORD);
      expect(ok.status).toBeLessThan(300);
      expect(String(ok.headers['set-cookie'])).toContain('rustika_admin');
      expect(JSON.stringify(ok.body)).not.toContain(ADMIN_PASSWORD);
      expect((await login(`${ADMIN_PASSWORD}x`)).status).toBe(401);
      await expect(runtime.$executeRawUnsafe("INSERT INTO admins (id, name, email, password_hash, updated_at) VALUES (gen_random_uuid(), 'x', 'x@y.zz', 'h', now())")).rejects.toThrow();
      await expect(runtime.$executeRawUnsafe('CREATE TABLE public.intruso (id int)')).rejects.toThrow();
      await expect(runtime.$executeRawUnsafe('CREATE ROLE intruso')).rejects.toThrow();
      await expect(runtime.$queryRawUnsafe('SELECT * FROM public._prisma_migrations')).rejects.toThrow();
    });
  });

  it('12) OITAVA migration sintética em CÓPIA temporária do backend: desconhecida é recusada, aprovada é aplicada uma vez, divergência é recusada, drift é detectado', async () => {
    // A cópia fica em <tmp>/rustika-m8-XXXX/backend: o "workspace" que o carregador de segredos enxerga é <tmp>/rustika-m8-XXXX,
    // de modo que a pasta de segredos (irmã em <tmp>) continua FORA do workspace, como exige resolveSecretsDir.
    const copyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-m8-')); temps.push(copyRoot);
    const copy = path.join(copyRoot, 'backend');
    fs.mkdirSync(copy);
    for (const entry of ['src', 'scripts', 'config', 'prisma']) fs.cpSync(path.join(BACKEND, entry), path.join(copy, entry), { recursive: true });
    for (const file of ['package.json', 'tsconfig.json']) if (fs.existsSync(path.join(BACKEND, file))) fs.copyFileSync(path.join(BACKEND, file), path.join(copy, file));
    fs.symlinkSync(path.join(BACKEND, 'node_modules'), path.join(copy, 'node_modules'), 'junction');
    const name = '20270101000000_ephemeral_probe';
    const template = fs.readFileSync(path.join(BACKEND, 'docs', 'templates', 'future-migration-environment-guard.sql'), 'utf8')
      .replace(/COMMIT;\s*$/, 'CREATE TABLE public.ephemeral_probe (id integer PRIMARY KEY);\nCOMMIT;\n');
    expect(lintFutureMigration(template), 'SQL neutro de ambiente').toEqual([]);
    const dir = path.join(copy, 'prisma', 'migrations', name);
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'migration.sql'), template);
    const checksum = sha256(fs.readFileSync(path.join(dir, 'migration.sql')));

    const unknown = wrapper(secrets, 'migrate-homolog', 'deploy', FINAL_CONFIRM, copy);
    expect(unknown.status, 'migration fora da lista revisada é recusada').not.toBe(0);
    expect(unknown.output).toMatch(/desconhecida/);
    await withClient(FINAL.migrator, pw[FINAL.migrator]!, FINAL_DB, async (prisma) => {
      expect((await migrationRows(prisma)).length, 'a recusa não aplicou nada').toBe(8);
    });

    // Atualização REVISADA da lista (simulada somente na cópia): o repositório real continua com oito migrations.
    const listFile = path.join(copy, 'scripts', 'bootstrap', 'expectedMigrations.ts');
    const list = fs.readFileSync(listFile, 'utf8');
    fs.writeFileSync(listFile, list.replace(/\n\];\s*$/, `\n  { name: '${name}', checksum: '${checksum}' },\n];\n`));
    const applied = wrapper(secrets, 'migrate-homolog', 'deploy', FINAL_CONFIRM, copy);
    expect(applied.status, applied.output).toBe(0);
    await withClient(FINAL.migrator, pw[FINAL.migrator]!, FINAL_DB, async (prisma) => {
      const rows = await migrationRows(prisma);
      expect(rows).toHaveLength(9);
      expect(rows.find((row) => row.migration_name === name)).toMatchObject({ checksum, applied_steps_count: 1, rolled_back_at: null });
      expect(rows.filter((row) => row.migration_name !== name), 'as oito originais permanecem idênticas').toEqual(rowsBefore);
      const again = wrapper(secrets, 'migrate-homolog', 'deploy', FINAL_CONFIRM, copy);
      expect(again.status, again.output).toBe(0);
      expect(again.output).toMatch(/No pending migrations/);
      expect(await migrationRows(prisma), 'nova execução não reaplica nada').toEqual(rows);
      const snapshotC = await readSchemaSnapshot(prisma);
      const drift = diffSnapshots(snapshotB, snapshotC).map((item) => item.section);
      expect(drift).toEqual(expect.arrayContaining(['migrations', 'tables', 'columns']));
      expect(drift, 'ACLs e roles não podem derivar').not.toEqual(expect.arrayContaining(['roles', 'memberships', 'settings', 'databaseAcls', 'schemaAcls']));
      const app = await prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT has_table_privilege('${FINAL.app}', 'public.ephemeral_probe', 'SELECT') AS ok`);
      expect(app[0]!.ok, 'a tabela nova nasce sem privilégios para o runtime (default privileges)').toBe(false);
    });

    fs.appendFileSync(path.join(dir, 'migration.sql'), '\n-- adulterada depois de aplicada\n');
    const diverged = wrapper(secrets, 'migrate-homolog', 'status', {}, copy);
    expect(diverged.status, 'checksum divergente no disco é recusado').not.toBe(0);
    expect(diverged.output).toMatch(/checksum divergente/);
    expect(verifyMigrationDirectory(path.join(BACKEND, 'prisma', 'migrations')), 'o repositório real continua com as oito originais').toEqual([]);
  });
});
