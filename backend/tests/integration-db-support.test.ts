import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { fixturesUrlFor, openIntegrationDatabases, reachableDatabases } from './integration-db/support/databases';
import { buildCleanupPlan, createRunIdentity } from './integration-db/support/fixtures';
import {
  APP_ROLE, assertIntegrationGate, EXPECTED_MIGRATIONS, evaluatePreflight, FIXTURES_ROLE, IntegrationAbort,
  INTEGRATION_CONFIRM, INTEGRATION_CONFIRM_VALUE, INTEGRATION_FLAG, TEST_DATABASE,
} from './integration-db/support/preflight';
import type { PreflightFacts } from './integration-db/support/preflight';

const GATE = { [INTEGRATION_FLAG]: '1', [INTEGRATION_CONFIRM]: INTEGRATION_CONFIRM_VALUE, NODE_ENV: 'test', DB_PROFILE: 'app-test' };
const conn = (user: string) => ({ database: TEST_DATABASE, user, sessionUser: user, serverIdentity: '127.0.0.1:5432', serverVersionNum: 180006, superuser: false, bypassRls: false, createRole: false, createDb: false, replication: false });

function healthy(): PreflightFacts {
  return {
    app: conn(APP_ROLE), fixtures: conn(FIXTURES_ROLE), migrator: { ...conn('cardapio_migrator'), readOnly: true },
    migrations: EXPECTED_MIGRATIONS.map((m) => ({ name: m.name, checksum: m.checksum, finished: true, rolledBack: false })),
    diskChecksums: Object.fromEntries(EXPECTED_MIGRATIONS.map((m) => [m.name, m.checksum])),
    leftovers: { admins: 0, categories: 0 }, collisions: { 'source_code PA062240': 0 }, lockAcquired: true,
    permissionViolations: [], fixturesReachableDatabases: [],
  };
}

describe('trava de ambiente da suíte de integração', () => {
  it('passa só com as duas variáveis explícitas e o perfil de teste', () => {
    expect(() => assertIntegrationGate(GATE)).not.toThrow();
  });

  it.each([
    ['sem flag', { ...GATE, [INTEGRATION_FLAG]: undefined }],
    ['flag diferente de 1', { ...GATE, [INTEGRATION_FLAG]: 'true' }],
    ['sem confirmação', { ...GATE, [INTEGRATION_CONFIRM]: undefined }],
    ['confirmação errada', { ...GATE, [INTEGRATION_CONFIRM]: 'yes' }],
    ['NODE_ENV development', { ...GATE, NODE_ENV: 'development' }],
    ['perfil app-dev', { ...GATE, DB_PROFILE: 'app-dev' }],
    ['confirmação de deploy presente', { ...GATE, CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION: 'APPLY_CARDAPIO_DIGITAL_TEST' }],
  ])('recusa: %s', (_label, env) => {
    expect(() => assertIntegrationGate(env)).toThrow(IntegrationAbort);
  });

  it('o ambiente atual do npm test não habilita a suíte', () => {
    expect(() => assertIntegrationGate(process.env)).toThrow(IntegrationAbort);
  });
});

describe('preflight de identidade do banco (decide antes de qualquer escrita)', () => {
  it('estado esperado após as migrations: nenhuma razão para abortar', () => {
    expect(evaluatePreflight(healthy())).toEqual([]);
  });

  it('estado registrado do Test (1 aplicada, baseline incompleto) aborta', () => {
    const facts = healthy(); facts.migrations = facts.migrations.slice(0, 1);
    const reasons = evaluatePreflight(facts);
    expect(reasons.some((r) => /baseline incompleto/.test(r))).toBe(true);
    expect(reasons.filter((r) => /não aplicada/.test(r))).toHaveLength(8);
  });

  it('nove migrations exatas passam; baseline incompleto, migration extra ou trocada abortam', () => {
    expect(EXPECTED_MIGRATIONS).toHaveLength(9);
    expect(evaluatePreflight(healthy())).toEqual([]);
    const pending = healthy(); pending.migrations = pending.migrations.slice(0, 7);
    expect(evaluatePreflight(pending).join(' ')).toMatch(/7 linhas, esperadas 9|20261110000000_rf006_product_crud_privilege não aplicada/);
    const extra = healthy(); extra.migrations.push({ name: '20261107000000_desconhecida', checksum: 'f'.repeat(64), finished: true, rolledBack: false });
    expect(evaluatePreflight(extra).join(' ')).toMatch(/10 linhas, esperadas 9/);
    const swapped = healthy(); swapped.migrations[7] = { ...swapped.migrations[7]!, name: '20261110000000_outra' };
    expect(evaluatePreflight(swapped).join(' ')).toMatch(/rf006_product_crud_privilege não aplicada/);
    const seventhDisk = healthy(); seventhDisk.diskChecksums[EXPECTED_MIGRATIONS[7]!.name] = 'x';
    expect(evaluatePreflight(seventhDisk).join(' ')).toMatch(/arquivo de 20261110000000_rf006_product_crud_privilege no disco/);
    const seventhRow = healthy(); seventhRow.migrations[7]!.checksum = '0'.repeat(64);
    expect(evaluatePreflight(seventhRow).join(' ')).toMatch(/checksum gravado de 20261110000000/);
  });

  it.each<[string, (f: PreflightFacts) => void, RegExp]>([
    ['banco Dev na aplicação', (f) => { f.app.database = 'cardapio_digital_dev'; }, /banco cardapio_digital_dev/],
    ['banco errado nas fixtures', (f) => { f.fixtures.database = 'postgres'; }, /fixtures: banco postgres/],
    ['role de aplicação errada', (f) => { f.app.user = 'cardapio_dev_app'; }, /role cardapio_dev_app/],
    ['fixtures com o migrator', (f) => { f.fixtures.user = 'cardapio_migrator'; }, /fixtures: role cardapio_migrator/],
    ['superuser', (f) => { f.fixtures.superuser = true; }, /superuser/],
    ['PostgreSQL 16', (f) => { f.app.serverVersionNum = 160004; }, /160004/],
    ['leitura de migrations fora de READ ONLY', (f) => { f.migrator.readOnly = false; }, /somente leitura/],
    ['migration com falha', (f) => { f.migrations[2]!.finished = false; }, /falha/],
    ['checksum gravado divergente', (f) => { f.migrations[0]!.checksum = '0'.repeat(64); }, /checksum gravado/],
    ['arquivo divergente no disco', (f) => { f.diskChecksums[EXPECTED_MIGRATIONS[3]!.name] = 'x'; }, /no disco/],
    ['resíduos de execução anterior', (f) => { f.leftovers.admins = 2; }, /resíduos/],
    ['PA062240 real colidindo', (f) => { f.collisions['source_code PA062240'] = 1; }, /colidem/],
    ['execução concorrente', (f) => { f.lockAcquired = false; }, /advisory lock/],
    ['ACL excessiva', (f) => { f.permissionViolations = ['admins:INSERT']; }, /Permissões inadequadas/],
    ['ACL ausente', (f) => { f.permissionViolations = ['orders:INSERT ausente']; }, /Permissões inadequadas/],
    ['migrator incorreto', (f) => { f.migrator.user = APP_ROLE; }, /migrator: role/],
    ['SET ROLE disfarçado', (f) => { f.app.sessionUser = 'postgres'; }, /session_user/],
    ['CREATEROLE', (f) => { f.fixtures.createRole = true; }, /administrativos/],
    ['cluster diferente', (f) => { f.fixtures.serverIdentity = '127.0.0.1:5433'; }, /servidores diferentes/],
  ])('aborta com %s', (_label, mutate, pattern) => {
    const facts = healthy(); mutate(facts);
    expect(evaluatePreflight(facts).join('\n')).toMatch(pattern);
  });

  it('os checksums esperados são os dos arquivos atuais no disco', () => {
    const dir = path.join(process.cwd(), 'prisma', 'migrations');
    for (const migration of EXPECTED_MIGRATIONS) {
      const bytes = fs.readFileSync(path.join(dir, migration.name, 'migration.sql'));
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash).toBe(migration.checksum);
    }
  });
});

describe('identidade das fixtures e limpeza isolada', () => {
  it('é determinística por execução e respeita as constraints do schema', () => {
    const id = createRunIdentity('0a1b2c3d');
    expect(createRunIdentity('0a1b2c3d')).toEqual(id);
    expect(id.adminEmail).toBe('fixture-3d39-0a1b2c3d@rustika.test');
    expect(id.categoryKey).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/); // categories_public_key_format
    for (const code of Object.values(id.codes)) expect(code).toMatch(/^[A-Za-z0-9]+$/);
    expect(id.codes.alphanumeric).toBe('PA062240');
    const numbers = [id.comandas.open, id.comandas.other, id.comandas.closed, ...id.comandas.spare];
    for (const number of numbers) expect(number).toMatch(/^9[0-9]{5}$/); // comandas_number_format, faixa reservada
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('execuções diferentes não compartilham faixa de comandas nem códigos numéricos', () => {
    const a = createRunIdentity('00000001'); const b = createRunIdentity('00000002');
    expect(a.comandas.open).not.toBe(b.comandas.open);
    expect(a.codes.numeric).not.toBe(b.codes.numeric);
  });

  it('runId inválido é recusado', () => {
    expect(() => createRunIdentity('xyz')).toThrow();
  });

  it('o plano de limpeza apaga filhos antes dos pais e todo passo é restrito a ids da execução', () => {
    const plan = buildCleanupPlan({ comandaIds: ['c1'], adminIds: ['a1'], productIds: ['p1'], categoryIds: ['k1'] });
    expect(plan.map((step) => step.table)).toEqual([
      'order_status_history', 'order_items', 'orders', 'comanda_sessions', 'comanda_invitations', 'comandas', 'products', 'categories', 'admins',
    ]);
    for (const step of plan) {
      const text = JSON.stringify(step.where);
      expect(text).toMatch(/"in":\["(c1|a1|p1|k1)"\]/);
    }
  });

  it('lista vazia de ids produz filtros vazios (deleteMany com in: [] não apaga nada)', () => {
    const plan = buildCleanupPlan({ comandaIds: [], adminIds: [], productIds: [], categoryIds: [] });
    for (const step of plan) expect(JSON.stringify(step.where)).toContain('"in":[]');
  });
});

describe('abertura das conexões antes de qualquer escrita', () => {
  it('banco inacessível vira IntegrationAbort, fecha os clientes e não emite escrita', async () => {
    const disconnected: string[] = [];
    const writes: string[] = [];
    const facts = {
      database: TEST_DATABASE, user: APP_ROLE, session_user: APP_ROLE,
      server_identity: '127.0.0.1:5432', version: 180006, superuser: false,
      bypassrls: false, createrole: false, createdb: false, replication: false, readonly: 'off',
    };
    const client = (name: string, unreachable = false) => ({
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return [{ ok: true }];
        if (unreachable) {
          throw new Error('Can not reach database server at postgresql://cardapio_test_app:super-secret@127.0.0.1:5432/cardapio_digital_test');
        }
        return [facts];
      },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        $executeRawUnsafe: async (sql: string) => {
          if (sql !== 'SET TRANSACTION READ ONLY') writes.push(sql);
        },
        $queryRawUnsafe: async () => [],
      }),
      $disconnect: async () => { disconnected.push(name); },
    } as unknown as PrismaClient);
    const deps = {
      app: () => client('app', true),
      fixtures: () => client('fixtures'),
      migrator: () => client('migrator'),
      checksums: () => ({}),
      probeFixturesConnection: async () => false,
    };

    let caught: unknown;
    try {
      await openIntegrationDatabases(GATE, deps);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ name: 'IntegrationAbort' });
    expect((caught as Error).message).toMatch(/postgresql:\/\/\*\*\*@/);
    expect((caught as Error).message).not.toContain('super-secret');
    expect(disconnected).toEqual(expect.arrayContaining(['app', 'fixtures', 'migrator']));
    expect(writes).toEqual([]);
  });
});

describe('isolamento de conexão da role de fixtures', () => {
  it('sondagem não executada aborta', () => {
    const facts = healthy(); delete facts.fixturesReachableDatabases;
    expect(evaluatePreflight(facts).join('\n')).toMatch(/Isolamento de conexão .* não verificado/);
  });

  it.each(['postgres', 'cardapio_digital_dev', 'plataforma_sites_ia'])('conexão bem-sucedida em %s aborta', (database) => {
    const facts = healthy(); facts.fixturesReachableDatabases = [database];
    expect(evaluatePreflight(facts).join('\n')).toContain(`conseguiu conectar em ${database}`);
  });

  it('reachableDatabases devolve só os bancos em que a conexão foi aceita, testando todos', async () => {
    const tried: string[] = [];
    const reached = await reachableDatabases(['postgres', 'template1', 'plataforma_sites_ia'], async (db) => { tried.push(db); return db === 'template1'; });
    expect(tried).toEqual(['postgres', 'template1', 'plataforma_sites_ia']);
    expect(reached).toEqual(['template1']);
  });

  it('a URL de sondagem troca só o banco e recusa nomes suspeitos', () => {
    const base = 'postgresql://cardapio_test_fixtures:x@127.0.0.1:5432/cardapio_digital_test?schema=public&connection_limit=1';
    const url = new URL(fixturesUrlFor('postgres', base));
    expect(url.pathname).toBe('/postgres');
    expect(url.username).toBe('cardapio_test_fixtures');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.searchParams.get('connect_timeout')).toBe('5');
    for (const bad of ['a/b', 'x?y', '', 'db name', 'd'.repeat(64)]) expect(() => fixturesUrlFor(bad, base)).toThrow(IntegrationAbort);
  });

  /** Full open with fake clients: everything healthy except what each case changes. */
  function fakeCluster(options: { reachable: string[]; accepts: string[] }) {
    const writes: string[] = []; const probes: string[] = [];
    const factsFor = (user: string) => ({ database: TEST_DATABASE, user, session_user: user, server_identity: '127.0.0.1:5432', version: 180006,
      superuser: false, bypassrls: false, createrole: false, createdb: false, replication: false, readonly: user === 'cardapio_migrator' ? 'on' : 'off' });
    const rows = (user: string, sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ ok: true }];
      if (sql.includes('matrix(')) return []; // PERMISSIONS_SQL: no violations
      if (sql.includes('current_database()')) return [factsFor(user)];
      if (sql.includes('_prisma_migrations')) return EXPECTED_MIGRATIONS.map((m) => ({ name: m.name, checksum: m.checksum, finished: true, rolledBack: false }));
      if (sql.includes('datallowconn')) return options.reachable.map((datname) => ({ datname }));
      throw new Error(`consulta inesperada no mock: ${sql.slice(0, 60)}`);
    };
    const client = (user: string) => {
      const query = async (sql: string) => rows(user, sql);
      const count = async () => 0;
      return {
        $queryRawUnsafe: query,
        $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
          $executeRawUnsafe: async (sql: string) => { if (sql !== 'SET TRANSACTION READ ONLY') writes.push(sql); },
          $queryRawUnsafe: query,
        }),
        admin: { count }, category: { count }, product: { count }, comanda: { count },
        $disconnect: async () => undefined,
      } as unknown as PrismaClient;
    };
    const deps = {
      app: () => client(APP_ROLE), fixtures: () => client(FIXTURES_ROLE), migrator: () => client('cardapio_migrator'),
      checksums: () => Object.fromEntries(EXPECTED_MIGRATIONS.map((m) => [m.name, m.checksum])),
      probeFixturesConnection: async (db: string) => { probes.push(db); return options.accepts.includes(db); },
    };
    return { deps, writes, probes };
  }

  it('pg_hba recusando todos os bancos alcançáveis: preflight passa e sonda cada um', async () => {
    const cluster = fakeCluster({ reachable: ['plataforma_sites_ia', 'postgres', 'template1'], accepts: [] });
    const connections = await openIntegrationDatabases(GATE, cluster.deps);
    await connections.close();
    expect(cluster.probes).toEqual(['plataforma_sites_ia', 'postgres', 'template1']);
    expect(cluster.writes).toEqual([]);
  });

  it('um banco de outro projeto aceitando a role: aborta antes de qualquer escrita', async () => {
    const cluster = fakeCluster({ reachable: ['plataforma_sites_ia', 'postgres'], accepts: ['plataforma_sites_ia'] });
    await expect(openIntegrationDatabases(GATE, cluster.deps)).rejects.toThrow(/conseguiu conectar em plataforma_sites_ia/);
    expect(cluster.writes).toEqual([]);
  });
});

describe('isolamento da suíte com escrita', () => {
  it('arquivos de integração usam sufixo fora do padrão do npm test', () => {
    const dir = path.join(process.cwd(), 'tests', 'integration-db');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.ts'));
    const suites = files.filter((name) => name.endsWith('.integration.ts'));
    expect(suites.length).toBeGreaterThanOrEqual(4);
    expect(files.some((name) => /\.(test|spec)\.ts$/.test(name))).toBe(false);
  });

  it('npm test não usa config que inclua a suíte; o script dedicado usa', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:integration:db']).toBe('vitest run --config vitest.integration.config.mts');
    expect(fs.existsSync(path.join(process.cwd(), 'vitest.config.ts'))).toBe(false);
  });
});
