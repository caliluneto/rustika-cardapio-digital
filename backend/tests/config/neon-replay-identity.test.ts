import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDatabaseProfile } from '../../src/config/secrets';
import { evaluateNeonServerIdentity, type NeonServerFacts } from '../../src/config/neonServerIdentity';
import { MARKER_PREFIX } from '../../src/config/serverIdentity';

const PROJECT = 'aged-scene-47291697';
const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const HOST = 'ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech';
const PASSWORD = 'Fake-Neon-Replay-Pass-0000-aaaa';
const REPLAY_DB = 'cardapio_digital_test';
const REPLAY_USER = 'cardapio_migrator';

const provenTls = {
  proven: true,
  reasons: [],
  authorized: true,
  nameMatches: true,
  wrongNameRejected: true,
  protocol: 'TLSv1.3',
  cipher: 'x',
  issuer: 'y',
  validTo: null,
};

const replayFacts = (patch: Partial<NeonServerFacts> = {}): NeonServerFacts => ({
  database: REPLAY_DB,
  currentUser: REPLAY_USER,
  serverVersionNum: 180006,
  databases: ['postgres', 'neondb', REPLAY_DB],
  roles: ['neondb_owner', REPLAY_USER, 'cardapio_test_app', 'cardapio_dev_app', 'rustika_homolog_marker'],
  markerComment: `${MARKER_PREFIX}${CLUSTER}`,
  projectId: PROJECT,
  pgStatSslActive: false,
  external: provenTls,
  ...patch,
});

const REPLAY_EXPECTED = {
  phase: 'replay' as const,
  expectedProjectId: PROJECT,
  expectedClusterId: CLUSTER,
  expectedUser: REPLAY_USER,
  expectedDatabase: REPLAY_DB,
};

const created: string[] = [];

function dirWith(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-neon-replay-'));
  created.push(directory);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), content, { encoding: 'utf8', mode: 0o600 });
  }
  return directory;
}

interface ReplayEnvOpts {
  host?: string;
  database?: string;
  user?: string;
  query?: string;
  projectId?: string | null;
  cluster?: string | null;
}

function replayEnv(opts: ReplayEnvOpts = {}): string {
  const host = opts.host ?? HOST;
  const user = opts.user ?? REPLAY_USER;
  const database = opts.database ?? REPLAY_DB;
  const query = opts.query ?? 'sslmode=require&sslaccept=strict';
  const url = `postgresql://${user}:${PASSWORD}@${host}/${database}?${query}`;
  const project = opts.projectId === undefined ? PROJECT : opts.projectId;
  const cluster = opts.cluster === undefined ? CLUSTER : opts.cluster;
  return `DATABASE_URL="${url}"\nEXPECTED_DATABASE_HOST="${host}"\n${cluster === null ? '' : `EXPECTED_CLUSTER_ID="${cluster}"\n`}${project === null ? '' : `EXPECTED_PROJECT_ID="${project}"\n`}`;
}
describe('RÚSTIKA — desbloquear replay Prisma no Neon', () => {
  describe('perfil migrate-homolog-replay no Neon (loadDatabaseProfile)', () => {
    it('carrega migrate-homolog-replay com project id e endpoint direto Neon', () => {
      const dir = dirWith({ 'migrate-homolog-replay.env': replayEnv() });
      const loaded = loadDatabaseProfile('migrate-homolog-replay', { purpose: 'migration', secretsDir: dir });
      expect(loaded).toMatchObject({
        profile: 'migrate-homolog-replay',
        environment: 'homolog-replay',
        database: REPLAY_DB,
        user: REPLAY_USER,
        clusterId: CLUSTER,
        projectId: PROJECT,
      });
    });

    it('recusa endpoint com pooler (-pooler)', () => {
      const poolerHost = 'ep-sweet-king-bd7i7ypb-pooler.c-8.us-east-2.aws.neon.tech';
      const dir = dirWith({ 'migrate-homolog-replay.env': replayEnv({ host: poolerHost }) });
      expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dir })).toThrow(/pooler/);
    });

    it('recusa host local ou de loopback', () => {
      for (const host of ['localhost', '127.0.0.1', '[::1]', '0.0.0.0']) {
        const dir = dirWith({ 'migrate-homolog-replay.env': replayEnv({ host }) });
        expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dir })).toThrow(/host local ou não permitido/);
      }
    });

    it('exige EXPECTED_PROJECT_ID quando aponta para host Neon', () => {
      const dir = dirWith({ 'migrate-homolog-replay.env': replayEnv({ projectId: null }) });
      expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dir })).toThrow(/EXPECTED_PROJECT_ID ausente/);
    });

    it('valida formato de EXPECTED_PROJECT_ID', () => {
      for (const bad of ['projeto_invalido', '12345', 'aged_scene_47291697', 'A-B-1']) {
        const dir = dirWith({ 'migrate-homolog-replay.env': replayEnv({ projectId: bad }) });
        expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dir })).toThrow(/formato esperado de project id/);
      }
    });

    it('recusa banco diferente de cardapio_digital_test (ex: neondb ou definitivo)', () => {
      expect(() =>
        loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dirWith({ 'migrate-homolog-replay.env': replayEnv({ database: 'neondb' }) }) }),
      ).toThrow(/cardapio_digital_test/);
      expect(() =>
        loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dirWith({ 'migrate-homolog-replay.env': replayEnv({ database: 'cardapio_digital_homolog' }) }) }),
      ).toThrow(/cardapio_digital_test/);
    });

    it('recusa role diferente de cardapio_migrator (ex: neondb_owner ou cardapio_homolog_migrator)', () => {
      expect(() =>
        loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dirWith({ 'migrate-homolog-replay.env': replayEnv({ user: 'neondb_owner' }) }) }),
      ).toThrow(/usuário cardapio_migrator/);
      expect(() =>
        loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dirWith({ 'migrate-homolog-replay.env': replayEnv({ user: 'cardapio_homolog_migrator' }) }) }),
      ).toThrow(/usuário cardapio_migrator/);
    });

    it('preserva migrate-homolog-replay em PostgreSQL dedicado (sem EXPECTED_PROJECT_ID)', () => {
      const dedicatedHost = 'db-homolog.exemplo.invalid';
      const dedicatedUrl = `postgresql://${REPLAY_USER}:${PASSWORD}@${dedicatedHost}:5432/${REPLAY_DB}?sslmode=verify-full&schema=public`;
      const dedicatedContent = `DATABASE_URL="${dedicatedUrl}"\nEXPECTED_DATABASE_HOST="${dedicatedHost}"\nEXPECTED_CLUSTER_ID="${CLUSTER}"\n`;
      const dir = dirWith({ 'migrate-homolog-replay.env': dedicatedContent });
      const loaded = loadDatabaseProfile('migrate-homolog-replay', { purpose: 'migration', secretsDir: dir });
      expect(loaded).toMatchObject({
        profile: 'migrate-homolog-replay',
        environment: 'homolog-replay',
        database: REPLAY_DB,
        user: REPLAY_USER,
        clusterId: CLUSTER,
      });
      expect(loaded.projectId).toBeUndefined();
    });

    it('aceita URL oficial do Neon com channel_binding=require e sem porta/schema/sslaccept', () => {
      const dir = dirWith({
        'migrate-homolog-replay.env': replayEnv({ query: 'sslmode=require&channel_binding=require' }),
      });
      const loaded = loadDatabaseProfile('migrate-homolog-replay', { purpose: 'migration', secretsDir: dir });
      expect(loaded).toMatchObject({
        profile: 'migrate-homolog-replay',
        database: REPLAY_DB,
        user: REPLAY_USER,
        projectId: PROJECT,
      });
    });

    it('aceita esquema postgres:// além de postgresql://', () => {
      const url = `postgres://${REPLAY_USER}:${PASSWORD}@${HOST}/${REPLAY_DB}?sslmode=require&channel_binding=require`;
      const content = `DATABASE_URL="${url}"\nEXPECTED_DATABASE_HOST="${HOST}"\nEXPECTED_CLUSTER_ID="${CLUSTER}"\nEXPECTED_PROJECT_ID="${PROJECT}"\n`;
      const dir = dirWith({ 'migrate-homolog-replay.env': content });
      const loaded = loadDatabaseProfile('migrate-homolog-replay', { purpose: 'migration', secretsDir: dir });
      expect(loaded.user).toBe(REPLAY_USER);
    });

    it('recusa channel_binding=disable', () => {
      const dir = dirWith({
        'migrate-homolog-replay.env': replayEnv({ query: 'sslmode=require&channel_binding=disable' }),
      });
      expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dir })).toThrow(/channel_binding/);
    });

    it('outros perfis de homologação continuam recusando EXPECTED_PROJECT_ID', () => {
      const url = `postgresql://cardapio_homolog_migrator:${PASSWORD}@db-homolog.exemplo.invalid:5432/cardapio_digital_homolog?sslmode=require`;
      const content = `DATABASE_URL="${url}"\nEXPECTED_DATABASE_HOST="db-homolog.exemplo.invalid"\nEXPECTED_CLUSTER_ID="${CLUSTER}"\nEXPECTED_PROJECT_ID="${PROJECT}"\n`;
      expect(() => loadDatabaseProfile('migrate-homolog', { secretsDir: dirWith({ 'migrate-homolog.env': content }) })).toThrow(/Chave não permitida.*EXPECTED_PROJECT_ID/s);
    });
  });

  describe('avaliação de identidade Neon no replay (evaluateNeonServerIdentity)', () => {
    it('aprova fatos do Neon com TLS externo comprovado e pg_stat_ssl=false', () => {
      expect(evaluateNeonServerIdentity(replayFacts(), REPLAY_EXPECTED)).toEqual([]);
      expect(evaluateNeonServerIdentity(replayFacts({ pgStatSslActive: null }), REPLAY_EXPECTED)).toEqual([]);
    });

    it('recusa quando TLS externo não é comprovado (falha de certificado/TLS)', () => {
      const facts = replayFacts({
        external: { ...provenTls, proven: false, authorized: false, reasons: ['certificado autoassinado ou CA inválida'] },
      });
      const problems = evaluateNeonServerIdentity(facts, REPLAY_EXPECTED);
      expect(problems.join(' ')).toMatch(/TLS externo não comprovado/);
    });

    it('recusa hostname divergente do certificado', () => {
      const facts = replayFacts({
        external: { ...provenTls, proven: false, nameMatches: false, reasons: ['nome do servidor não confere'] },
      });
      const problems = evaluateNeonServerIdentity(facts, REPLAY_EXPECTED);
      expect(problems.join(' ')).toMatch(/TLS externo não comprovado/);
    });

    it('recusa projeto incorreto ou ausente', () => {
      expect(evaluateNeonServerIdentity(replayFacts({ projectId: 'outro-projeto-11111111' }), REPLAY_EXPECTED).join(' ')).toMatch(/neon\.project_id difere/);
      expect(evaluateNeonServerIdentity(replayFacts({ projectId: null }), REPLAY_EXPECTED).join(' ')).toMatch(/não expõe neon\.project_id/);
      expect(evaluateNeonServerIdentity(replayFacts(), { ...REPLAY_EXPECTED, expectedProjectId: '' }).join(' ')).toMatch(/EXPECTED_PROJECT_ID não configurado/);
    });

    it('recusa banco conectado incorreto (ex: neondb ou postgres)', () => {
      expect(evaluateNeonServerIdentity(replayFacts({ database: 'neondb' }), REPLAY_EXPECTED).join(' ')).toMatch(/banco conectado diferente de cardapio_digital_test/);
      expect(evaluateNeonServerIdentity(replayFacts({ database: 'postgres' }), REPLAY_EXPECTED).join(' ')).toMatch(/banco conectado diferente de cardapio_digital_test/);
    });

    it('recusa se o banco definitivo cardapio_digital_homolog já existir no cluster durante o replay', () => {
      const facts = replayFacts({ databases: [...replayFacts().databases, 'cardapio_digital_homolog'] });
      expect(evaluateNeonServerIdentity(facts, REPLAY_EXPECTED).join(' ')).toMatch(/o banco definitivo cardapio_digital_homolog já existe/);
    });

    it('recusa se bancos de desenvolvimento (dev/shadow) estiverem presentes no cluster', () => {
      expect(evaluateNeonServerIdentity(replayFacts({ databases: [...replayFacts().databases, 'cardapio_digital_dev'] }), REPLAY_EXPECTED).join(' ')).toMatch(/cardapio_digital_dev.*réplica de desenvolvimento/);
      expect(evaluateNeonServerIdentity(replayFacts({ databases: [...replayFacts().databases, 'cardapio_digital_shadow'] }), REPLAY_EXPECTED).join(' ')).toMatch(/cardapio_digital_shadow.*réplica de desenvolvimento/);
    });

    it('recusa role incorreta (ex: neondb_owner ou cardapio_test_app)', () => {
      expect(evaluateNeonServerIdentity(replayFacts({ currentUser: 'neondb_owner' }), REPLAY_EXPECTED).join(' ')).toMatch(/role conectada difere/);
      expect(evaluateNeonServerIdentity(replayFacts({ currentUser: 'cardapio_test_app' }), REPLAY_EXPECTED).join(' ')).toMatch(/role conectada difere/);
    });

    it('recusa marca de cluster ausente ou divergente', () => {
      expect(evaluateNeonServerIdentity(replayFacts({ markerComment: null }), REPLAY_EXPECTED).join(' ')).toMatch(/marca de homologação/);
      expect(evaluateNeonServerIdentity(replayFacts({ markerComment: `${MARKER_PREFIX}00000000-0000-4000-8000-000000000000` }), REPLAY_EXPECTED).join(' ')).toMatch(/marca de homologação/);
    });

    it('recusa PostgreSQL anterior ao 17', () => {
      expect(evaluateNeonServerIdentity(replayFacts({ serverVersionNum: 160005 }), REPLAY_EXPECTED).join(' ')).toMatch(/anterior ao 17/);
    });
  });

  describe('comportamento histórico das migrations condicionais', () => {
    it('migration 3 (20261031000000) direciona permissões para cardapio_test_app em cardapio_digital_test', () => {
      const mig3 = fs.readFileSync(
        path.join(process.cwd(), 'prisma', 'migrations', '20261031000000_rf004_fix_permissions', 'migration.sql'),
        'utf8',
      );
      expect(mig3).toContain("ELSIF current_db = 'cardapio_digital_test' THEN");
      expect(mig3).toContain("target_role := 'cardapio_test_app';");
      expect(mig3).toContain('GRANT USAGE ON SCHEMA public TO');
      expect(mig3).toContain('GRANT SELECT, INSERT ON TABLE "orders"');
    });

    it('migration 5 (20261104000000) valida owner migrator, roles legadas e aplica least-privilege', () => {
      const mig5 = fs.readFileSync(
        path.join(process.cwd(), 'prisma', 'migrations', '20261104000000_runtime_least_privilege', 'migration.sql'),
        'utf8',
      );
      expect(mig5).toContain("IF current_database() = 'cardapio_digital_test' THEN");
      expect(mig5).toContain("target_role := 'cardapio_test_app';");
      expect(mig5).toContain("other_role := 'cardapio_dev_app';");
      expect(mig5).toContain("current_user <> 'cardapio_migrator'");
      expect(mig5).toContain('GRANT CONNECT ON DATABASE');
    });
  });
});

afterEach(() => {
  while (created.length) {
    fs.rmSync(created.pop()!, { recursive: true, force: true });
  }
});
