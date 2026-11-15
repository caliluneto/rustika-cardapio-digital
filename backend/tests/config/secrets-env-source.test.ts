import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENV_SECRET_VARIABLES, HOMOLOG_ROLES, SecretsConfigError, loadDatabaseProfile } from '../../src/config/secrets';

const HOST = 'ep-teste.regiao.exemplo.invalid';
const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const PASSWORD = 'Fake-Homolog-Pass-0000-aaaa';
const created: string[] = [];
afterEach(() => { while (created.length) fs.rmSync(created.pop()!, { recursive: true, force: true }); });

const url = (user: string, database = 'cardapio_digital_homolog', query = 'schema=public&sslmode=require&sslaccept=strict') =>
  `postgresql://${user}:${PASSWORD}@${HOST}:5432/${database}?${query}`;
const envFor = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  CARDAPIO_SECRETS_SOURCE: 'env',
  [ENV_SECRET_VARIABLES.DATABASE_URL]: url(HOMOLOG_ROLES.runtime),
  [ENV_SECRET_VARIABLES.EXPECTED_DATABASE_HOST]: HOST,
  [ENV_SECRET_VARIABLES.EXPECTED_CLUSTER_ID]: CLUSTER,
  ...overrides,
});
const load = (profile: string, env: NodeJS.ProcessEnv, purpose: 'runtime' | 'migration' | 'bootstrap' = 'runtime') =>
  loadDatabaseProfile(profile, { purpose, env, secretsDir: undefined });

describe('segredos do perfil app-homolog por variável de ambiente (opt-in)', () => {
  it('carrega o perfil de aplicação com as mesmas validações e sem arquivo nem pasta de segredos', () => {
    const secrets = load('app-homolog', envFor());
    expect(secrets).toMatchObject({ profile: 'app-homolog', purpose: 'runtime', database: 'cardapio_digital_homolog', user: HOMOLOG_ROLES.runtime, host: HOST, clusterId: CLUSTER });
    expect(secrets.secretsFilePath).toBe('(variáveis de ambiente)');
    expect(secrets.describe()).not.toContain(PASSWORD);
  });

  it('o padrão continua sendo arquivo: sem CARDAPIO_SECRETS_SOURCE as variáveis são ignoradas e a pasta própria é exigida', () => {
    const env = envFor({ CARDAPIO_SECRETS_SOURCE: undefined });
    const saved = process.env.CARDAPIO_SECRETS_DIR; delete process.env.CARDAPIO_SECRETS_DIR;
    try {
      expect(() => load('app-homolog', env)).toThrow(/pasta de segredos própria/);
      expect(() => load('app-homolog', envFor({ CARDAPIO_SECRETS_SOURCE: 'file' }))).toThrow(/pasta de segredos própria/);
    } finally { if (saved !== undefined) process.env.CARDAPIO_SECRETS_DIR = saved; }
  });

  it('valor inválido de CARDAPIO_SECRETS_SOURCE falha', () => {
    for (const bad of ['ENV', 'environment', 'true', '1']) expect(() => load('app-homolog', envFor({ CARDAPIO_SECRETS_SOURCE: bad }))).toThrow(/"file" ou "env"/);
  });

  it('nunca vale para migração, bootstrap, replay nem perfis locais', () => {
    for (const [profile, purpose] of [['migrate-homolog', 'migration'], ['bootstrap-homolog', 'bootstrap'], ['migrate-homolog-replay', 'migration'],
      ['app-dev', 'runtime'], ['app-test', 'runtime'], ['migrate-dev', 'migration'], ['migrate-test', 'migration']] as const) {
      expect(() => load(profile, envFor(), purpose), profile).toThrow(SecretsConfigError);
      expect(() => load(profile, envFor(), purpose), profile).toThrow(/não é permitido|bootstrap|migração/);
    }
  });

  it('as validações de identidade continuam valendo (usuário, banco, host, TLS, UUID, host local)', () => {
    const cases: Array<[string, Record<string, string | undefined>, RegExp]> = [
      ['usuário errado', { [ENV_SECRET_VARIABLES.DATABASE_URL]: url('cardapio_homolog_migrator') }, /usuário/],
      ['banco errado', { [ENV_SECRET_VARIABLES.DATABASE_URL]: url(HOMOLOG_ROLES.runtime, 'cardapio_digital_test') }, /banco/],
      ['sem TLS', { [ENV_SECRET_VARIABLES.DATABASE_URL]: url(HOMOLOG_ROLES.runtime, 'cardapio_digital_homolog', 'schema=public') }, /sslmode/],
      ['TLS relaxado', { [ENV_SECRET_VARIABLES.DATABASE_URL]: url(HOMOLOG_ROLES.runtime, 'cardapio_digital_homolog', 'sslmode=require&sslaccept=accept_invalid_certs') }, /TLS|certificado/],
      ['parâmetro extra', { [ENV_SECRET_VARIABLES.DATABASE_URL]: url(HOMOLOG_ROLES.runtime, 'cardapio_digital_homolog', 'sslmode=require&pgbouncer=true') }, /parâmetro/],
      ['host diferente do esperado', { [ENV_SECRET_VARIABLES.EXPECTED_DATABASE_HOST]: 'outro.exemplo.invalid' }, /EXPECTED_DATABASE_HOST/],
      ['host local', { [ENV_SECRET_VARIABLES.DATABASE_URL]: url(HOMOLOG_ROLES.runtime).replace(HOST, 'localhost'), [ENV_SECRET_VARIABLES.EXPECTED_DATABASE_HOST]: 'localhost' }, /host local/],
      ['UUID inválido', { [ENV_SECRET_VARIABLES.EXPECTED_CLUSTER_ID]: 'nao-e-uuid' }, /UUID/],
      ['URL ausente', { [ENV_SECRET_VARIABLES.DATABASE_URL]: undefined }, /DATABASE_URL ausente/],
      ['host esperado ausente', { [ENV_SECRET_VARIABLES.EXPECTED_DATABASE_HOST]: undefined }, /EXPECTED_DATABASE_HOST ausente/],
      ['cluster ausente', { [ENV_SECRET_VARIABLES.EXPECTED_CLUSTER_ID]: undefined }, /EXPECTED_CLUSTER_ID ausente/],
      ['valor em branco', { [ENV_SECRET_VARIABLES.DATABASE_URL]: '   ' }, /DATABASE_URL ausente/],
    ];
    for (const [name, overrides, pattern] of cases) expect(() => load('app-homolog', envFor(overrides)), name).toThrow(pattern);
  });

  it('variáveis genéricas (DATABASE_URL, SHADOW_DATABASE_URL) não são lidas: só as prefixadas', () => {
    const env = envFor({ DATABASE_URL: url('qualquer'), SHADOW_DATABASE_URL: url('qualquer') });
    expect(load('app-homolog', env).user).toBe(HOMOLOG_ROLES.runtime);
    expect(() => load('app-homolog', envFor({ [ENV_SECRET_VARIABLES.DATABASE_URL]: undefined, DATABASE_URL: url(HOMOLOG_ROLES.runtime) }))).toThrow(/ausente/);
  });

  it('o modo de arquivo continua sendo exigido no caminho padrão (o gate de permissão não foi enfraquecido)', () => {
    if (process.platform === 'win32') return; // ACLs do Windows não têm mode bits
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-envsrc-')); created.push(dir);
    fs.writeFileSync(path.join(dir, 'app-homolog.env'), `DATABASE_URL="${url(HOMOLOG_ROLES.runtime)}"\nEXPECTED_DATABASE_HOST="${HOST}"\nEXPECTED_CLUSTER_ID="${CLUSTER}"\n`, { mode: 0o644 });
    fs.chmodSync(path.join(dir, 'app-homolog.env'), 0o644);
    expect(() => loadDatabaseProfile('app-homolog', { purpose: 'runtime', secretsDir: dir, env: {} })).toThrow(/chmod 600/);
  });

  it('o código-fonte não registra valores de segredo ao usar variáveis de ambiente', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'config', 'secrets.ts'), 'utf8');
    expect(source).not.toMatch(/console\./);
  });
});
