import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertE2eGate, assertLegacyCleanupGate, E2eAbort } from './integration-db/e2e/gate';
import { dropInjectedEnv, guardedLaunch, launchEnv } from './integration-db/e2e/launch-env';

const GOOD = { RUSTIKA_E2E_CONFIRM: 'RUN_E2E_ON_CARDAPIO_DIGITAL_TEST', NODE_ENV: 'test', DB_PROFILE: 'app-test' };

describe('launch-env (3D.3.23-D): unidades', () => {
  it('URL definida pelo operador no lançamento bloqueia o gate', () => {
    const env = { ...GOOD, DATABASE_URL: 'postgresql://operador@h/outro' };
    expect(() => guardedLaunch(assertE2eGate, env, { DATABASE_URL: env.DATABASE_URL })).toThrow(/DATABASE_URL/);
    expect(env.DATABASE_URL).toBeDefined(); // nada é removido quando o gate falha
  });

  it('SHADOW_DATABASE_URL do operador também bloqueia; URL de outro banco nunca é aceita', () => {
    const shadow = { ...GOOD, SHADOW_DATABASE_URL: 'postgresql://x@h/cardapio_digital_shadow' };
    expect(() => guardedLaunch(assertE2eGate, shadow, { SHADOW_DATABASE_URL: shadow.SHADOW_DATABASE_URL })).toThrow(/SHADOW_DATABASE_URL/);
    const external = { ...GOOD, DATABASE_URL: 'postgresql://x@db.externo.example/producao' };
    expect(() => guardedLaunch(assertLegacyCleanupGate, external, { DATABASE_URL: external.DATABASE_URL })).toThrow(E2eAbort);
  });

  it('variável injetada implicitamente (ausente no lançamento) não desabilita o gate e é descartada', () => {
    const env: Record<string, string | undefined> = { ...GOOD, DATABASE_URL: 'postgresql://injetada@h/legado' };
    expect(() => assertE2eGate(env)).toThrow(/DATABASE_URL/); // o gate em si continua inalterado e estrito
    expect(() => guardedLaunch(assertE2eGate, env, {})).not.toThrow();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(() => assertE2eGate(env)).not.toThrow(); // os gates internos seguintes passam sobre o ambiente limpo
  });

  it('remove apenas chaves vigiadas injetadas; o resto do ambiente fica intacto', () => {
    const env: Record<string, string | undefined> = { ...GOOD, DATABASE_URL: 'a', SHADOW_DATABASE_URL: 'b', PORT: '4100', OUTRA: 'x' };
    expect(dropInjectedEnv(env, { SHADOW_DATABASE_URL: 'b' })).toEqual(['DATABASE_URL']);
    expect(env).toMatchObject({ SHADOW_DATABASE_URL: 'b', PORT: '4100', OUTRA: 'x', RUSTIKA_E2E_CONFIRM: GOOD.RUSTIKA_E2E_CONFIRM });
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('ausência das confirmações obrigatórias continua bloqueando', () => {
    for (const missing of ['RUSTIKA_E2E_CONFIRM', 'NODE_ENV', 'DB_PROFILE'] as const) {
      const env: Record<string, string | undefined> = { ...GOOD }; delete env[missing];
      expect(() => guardedLaunch(assertE2eGate, env, {})).toThrow(E2eAbort);
    }
    expect(() => guardedLaunch(assertLegacyCleanupGate, { ...GOOD }, {})).toThrow(/RUSTIKA_E2E_LEGACY_CLEANUP/);
  });

  it('perfil continua restrito: app-dev/migrate e NODE_ENV com espaço são recusados', () => {
    for (const DB_PROFILE of ['app-dev', 'migrate-test', 'app-test ']) {
      expect(() => guardedLaunch(assertE2eGate, { ...GOOD, DB_PROFILE }, {})).toThrow(E2eAbort);
    }
    expect(() => guardedLaunch(assertE2eGate, { ...GOOD, NODE_ENV: 'test ' }, {})).toThrow(E2eAbort);
  });

  it('launchEnv devolve o lançamento nas chaves vigiadas e o valor atual nas demais', () => {
    expect(launchEnv({ DATABASE_URL: 'injetada', PORT: '1' }, {})).toMatchObject({ DATABASE_URL: undefined, PORT: '1' });
  });
});

/** Processo real, na mesma ordem de imports dos entry points: o Prisma pode (ou não) injetar o .env legado. */
describe('launch-env (3D.3.23-D): processo real', () => {
  const backend = path.resolve(__dirname, '..');
  const tsx = path.join(backend, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const probe = path.join(backend, 'tests', 'helpers', 'launch-probe.ts');
  const run = (extra: Record<string, string>) => {
    const env: Record<string, string | undefined> = { ...process.env, ...GOOD, ...extra };
    if (!('DATABASE_URL' in extra)) delete env.DATABASE_URL;
    if (!('SHADOW_DATABASE_URL' in extra)) delete env.SHADOW_DATABASE_URL;
    const out = spawnSync(process.execPath, [tsx, probe], { cwd: backend, env: env as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 60_000 });
    return JSON.parse(out.stdout.trim().split('\n').pop() as string);
  };

  it('sem URL do operador: o gate passa mesmo que o Prisma injete o .env, e nada fica no processo', () => {
    const result = run({});
    expect(result).toMatchObject({ ok: true, urlAfter: false });
  }, 70_000);

  it('com URL do operador: bloqueia, mesmo depois do import do Prisma', () => {
    const result = run({ DATABASE_URL: 'postgresql://operador@127.0.0.1:5432/outro_banco' });
    expect(result).toMatchObject({ ok: false, mentionsUrl: true });
  }, 70_000);
});
