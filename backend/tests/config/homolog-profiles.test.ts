import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORBIDDEN_DEFINITIVE_DATABASES, HOMOLOG_DEFINITIVE_DATABASE, HOMOLOG_REPLAY_DATABASE, HOMOLOG_ROLES, REPLAY_ROLES,
  isForbiddenHomologHost, loadDatabaseProfile,
} from '../../src/config/secrets';

const HOST = 'db-homolog.exemplo.invalid';
const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const PASSWORD = 'Fake-Homolog-Pass-0000-aaaa';
const DEF = HOMOLOG_DEFINITIVE_DATABASE;
const created: string[] = [];

function dirWith(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-homolog-'));
  created.push(directory);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content, { encoding: 'utf8', mode: 0o600 });
  return directory;
}
interface Opts { query?: string; host?: string; database?: string; expected?: string | null; cluster?: string | null; password?: string; extra?: string }
function file(user: string, database: string, opts: Opts = {}): string {
  const host = opts.host ?? HOST;
  const expected = opts.expected === undefined ? host : opts.expected;
  const cluster = opts.cluster === undefined ? CLUSTER : opts.cluster;
  const url = `postgresql://${user}:${opts.password ?? PASSWORD}@${host}:5432/${opts.database ?? database}?${opts.query ?? 'schema=public&sslmode=verify-full'}`;
  return `DATABASE_URL="${url}"\n${expected === null ? '' : `EXPECTED_DATABASE_HOST="${expected}"\n`}${cluster === null ? '' : `EXPECTED_CLUSTER_ID="${cluster}"\n`}${opts.extra ?? ''}`;
}
const app = (opts?: Opts) => file(HOMOLOG_ROLES.runtime, DEF, opts);

afterEach(() => { while (created.length) fs.rmSync(created.pop()!, { recursive: true, force: true }); delete process.env.CARDAPIO_SECRETS_DIR; });

describe('identidade de homologação', () => {
  it('o banco definitivo é exatamente cardapio_digital_homolog e as roles definitivas não usam nomes de Dev/Test', () => {
    expect(HOMOLOG_DEFINITIVE_DATABASE).toBe('cardapio_digital_homolog');
    expect(Object.values(HOMOLOG_ROLES).every((role) => role.startsWith('cardapio_homolog_'))).toBe(true);
    for (const forbidden of ['cardapio_digital_dev', 'cardapio_digital_test', 'cardapio_digital_shadow']) expect(FORBIDDEN_DEFINITIVE_DATABASES).toContain(forbidden);
    expect(FORBIDDEN_DEFINITIVE_DATABASES).not.toContain(HOMOLOG_DEFINITIVE_DATABASE);
  });

  it('o mapa versionado: três perfis definitivos em cardapio_digital_homolog + um replay transitório, nenhum perfil local marcado', () => {
    const profiles = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config', 'database-profiles.json'), 'utf8')) as Record<string, { environment?: string; database: string; user: string; purpose: string }>;
    const marked = Object.keys(profiles).filter((name) => profiles[name]!.environment !== undefined).sort();
    // app-homolog-neon somou-se à lista (mesmo banco/role de app-homolog; só muda o provedor e a verificação de identidade).
    expect(marked).toEqual(['app-homolog', 'app-homolog-neon', 'bootstrap-homolog', 'migrate-homolog', 'migrate-homolog-replay']);
    expect(profiles['app-homolog-neon']).toMatchObject({ environment: 'homolog-neon', purpose: 'runtime', database: DEF, user: HOMOLOG_ROLES.runtime });
    for (const name of ['app-homolog', 'bootstrap-homolog', 'migrate-homolog']) {
      expect(profiles[name]!.environment).toBe('homolog');
      expect(profiles[name]!.database).toBe(DEF);
    }
    expect(profiles['migrate-homolog-replay']).toMatchObject({ environment: 'homolog-replay', purpose: 'migration', database: HOMOLOG_REPLAY_DATABASE, user: REPLAY_ROLES.migrator });
    for (const name of ['app-dev', 'app-test', 'migrate-dev', 'migrate-test']) expect(profiles[name]!.environment).toBeUndefined();
  });
});

describe('perfis de homologação', () => {
  it('carrega os quatro perfis com identidade, host, cluster e finalidade corretos', () => {
    const dir = dirWith({
      'app-homolog.env': app(), 'migrate-homolog.env': file(HOMOLOG_ROLES.migrator, DEF), 'bootstrap-homolog.env': file(HOMOLOG_ROLES.bootstrap, DEF),
      'migrate-homolog-replay.env': file(REPLAY_ROLES.migrator, HOMOLOG_REPLAY_DATABASE),
    });
    const loaded = loadDatabaseProfile('app-homolog', { purpose: 'runtime', secretsDir: dir });
    expect(loaded).toMatchObject({ profile: 'app-homolog', environment: 'homolog', database: DEF, host: HOST, clusterId: CLUSTER });
    expect(loaded.describe()).not.toContain(PASSWORD);
    expect(loadDatabaseProfile('migrate-homolog', { purpose: 'migration', secretsDir: dir }).user).toBe(HOMOLOG_ROLES.migrator);
    expect(loadDatabaseProfile('bootstrap-homolog', { purpose: 'bootstrap', secretsDir: dir }).user).toBe(HOMOLOG_ROLES.bootstrap);
    expect(loadDatabaseProfile('migrate-homolog-replay', { purpose: 'migration', secretsDir: dir })).toMatchObject({ environment: 'homolog-replay', database: 'cardapio_digital_test', user: 'cardapio_migrator' });
  });

  it('recusa Dev, Test e Shadow como banco da homologação definitiva (e roles legadas nos perfis definitivos)', () => {
    for (const database of ['cardapio_digital_dev', 'cardapio_digital_test', 'cardapio_digital_shadow', 'postgres', 'outro_projeto']) {
      expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ database }) }) })).toThrow(/cardapio_digital_homolog/);
    }
    for (const user of ['cardapio_test_app', 'cardapio_dev_app', 'cardapio_migrator', 'postgres', 'cardapio_homolog_migrator', 'cardapio_homolog_bootstrap']) {
      expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': file(user, DEF) }) })).toThrow(/usuário cardapio_homolog_app/);
    }
    expect(() => loadDatabaseProfile('migrate-homolog', { secretsDir: dirWith({ 'migrate-homolog.env': file('cardapio_migrator', DEF) }) })).toThrow(/usuário cardapio_homolog_migrator/);
  });

  it('o replay só aceita o banco transitório e a role legada do migrator', () => {
    expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dirWith({ 'migrate-homolog-replay.env': file('cardapio_migrator', DEF) }) })).toThrow(/cardapio_digital_test/);
    expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dirWith({ 'migrate-homolog-replay.env': file('cardapio_homolog_migrator', 'cardapio_digital_test') }) })).toThrow(/cardapio_migrator/);
    expect(() => loadDatabaseProfile('migrate-homolog-replay', { secretsDir: dirWith({ 'migrate-homolog-replay.env': file('cardapio_migrator', 'cardapio_digital_dev') }) })).toThrow(/cardapio_digital_test/);
  });

  it.each([
    ['localhost', 'localhost'], ['127.0.0.1', '127.0.0.1'], ['::1', '[::1]'], ['rótulo único (rede local)', 'db'], ['0.0.0.0', '0.0.0.0'],
    ['metadados 169.254', '169.254.169.254'], ['subdomínio .localhost', 'x.localhost'],
  ])('recusa host não permitido: %s', (_label, host) => {
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ host }) }) })).toThrow(/host local ou não permitido/);
  });

  it('exige EXPECTED_DATABASE_HOST igual ao host e EXPECTED_CLUSTER_ID (UUID) — o hostname sozinho não basta', () => {
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ expected: null }) }) })).toThrow(/EXPECTED_DATABASE_HOST ausente/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ expected: 'outro.exemplo.invalid' }) }) })).toThrow(/não corresponde/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ cluster: null }) }) })).toThrow(/EXPECTED_CLUSTER_ID ausente/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ cluster: 'nao-e-uuid' }) }) })).toThrow(/deve ser um UUID/);
  });

  it.each([['sem sslmode', 'schema=public'], ['sslmode=disable', 'sslmode=disable'], ['sslmode=prefer', 'sslmode=prefer']])('exige TLS: %s', (_label, query) => {
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ query }) }) })).toThrow(/sslmode/);
  });

  it('não permite relaxar o certificado nem parâmetros desconhecidos', () => {
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ query: 'sslmode=require&sslaccept=accept_invalid_certs' }) }) })).toThrow(/certificado/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ query: 'sslmode=require&options=-c%20search_path%3Devil' }) }) })).toThrow(/não permitido/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ query: 'sslmode=require&schema=other' }) }) })).toThrow(/schema public/);
  });

  it('recusa credenciais ausentes ou placeholder e chaves não permitidas', () => {
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': 'EXPECTED_DATABASE_HOST="x.exemplo.invalid"\n' }) })).toThrow(/DATABASE_URL ausente/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ password: 'SENHA_URLENCODED_SUBSTITUA' }) }) })).toThrow(/placeholder/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ extra: 'OUTRA=1\n' }) }) })).toThrow(/Chave não permitida/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': app({ extra: 'SHADOW_DATABASE_URL="x"\n' }) }) })).toThrow(/SHADOW_DATABASE_URL/);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({}) })).toThrow(/Arquivo de segredo ausente/);
  });

  it('exige pasta de segredos própria (não reaproveita o padrão de Dev/Test)', () => {
    delete process.env.CARDAPIO_SECRETS_DIR;
    expect(() => loadDatabaseProfile('app-homolog', { purpose: 'runtime' })).toThrow(/CARDAPIO_SECRETS_DIR/);
    expect(() => loadDatabaseProfile('migrate-homolog-replay', { purpose: 'migration' })).toThrow(/CARDAPIO_SECRETS_DIR/);
  });

  it('respeita a finalidade: runtime não carrega migração/bootstrap e vice-versa', () => {
    const dir = dirWith({ 'migrate-homolog.env': file(HOMOLOG_ROLES.migrator, DEF), 'bootstrap-homolog.env': file(HOMOLOG_ROLES.bootstrap, DEF), 'app-homolog.env': app() });
    expect(() => loadDatabaseProfile('migrate-homolog', { purpose: 'runtime', secretsDir: dir })).toThrow(/migração/);
    expect(() => loadDatabaseProfile('bootstrap-homolog', { purpose: 'runtime', secretsDir: dir })).toThrow(/bootstrap/);
    expect(() => loadDatabaseProfile('bootstrap-homolog', { purpose: 'migration', secretsDir: dir })).toThrow(/bootstrap/);
    expect(() => loadDatabaseProfile('app-homolog', { purpose: 'bootstrap', secretsDir: dir })).toThrow(/não é de bootstrap/);
    expect(() => loadDatabaseProfile('app-homolog', { purpose: 'migration', secretsDir: dir })).toThrow(/aplicação/);
  });

  it.skipIf(process.platform === 'win32')('recusa arquivo de segredo legível por grupo/outros', () => {
    const dir = dirWith({ 'app-homolog.env': app() });
    fs.chmodSync(path.join(dir, 'app-homolog.env'), 0o644);
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dir })).toThrow(/apenas pelo proprietário/);
  });

  it('classifica hosts proibidos', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.1.2.3', '::1', '[::1]', '0.0.0.0', 'db', 'a.localhost', '169.254.1.1', '::ffff:127.0.0.1', 'fe80::1', '']) expect(isForbiddenHomologHost(host)).toBe(true);
    for (const host of ['db.exemplo.invalid', '203.0.113.10', '2001:db8::1']) expect(isForbiddenHomologHost(host)).toBe(false);
  });
});

describe('regressão: perfis locais continuam estritos', () => {
  const PASS = 'Fake-Local-Pass-1234567';
  it('app-dev exige loopback, não é marcado como homologação e não vira perfil de bootstrap', () => {
    const remote = dirWith({ 'app-dev.env': `DATABASE_URL="postgresql://cardapio_dev_app:${PASS}@${HOST}:5432/cardapio_digital_dev?sslmode=require"\n` });
    expect(() => loadDatabaseProfile('app-dev', { secretsDir: remote })).toThrow(/127\.0\.0\.1 ou localhost/);
    const ok = dirWith({ 'app-dev.env': `DATABASE_URL="postgresql://cardapio_dev_app:${PASS}@127.0.0.1:5432/cardapio_digital_dev?schema=public"\n` });
    const loaded = loadDatabaseProfile('app-dev', { secretsDir: ok });
    expect(loaded.environment).toBeUndefined();
    expect(loaded.clusterId).toBeUndefined();
    expect(() => loadDatabaseProfile('app-dev', { purpose: 'bootstrap', secretsDir: ok })).toThrow(/não é de bootstrap/);
  });

  it('o perfil local de Test não aceita o banco/role da homologação nem vice-versa', () => {
    const dir = dirWith({ 'app-test.env': `DATABASE_URL="postgresql://${HOMOLOG_ROLES.runtime}:${PASS}@127.0.0.1:5432/${DEF}?schema=public"\n` });
    expect(() => loadDatabaseProfile('app-test', { secretsDir: dir })).toThrow(/cardapio_digital_test/);
  });
});
