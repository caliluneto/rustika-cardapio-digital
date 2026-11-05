import { describe, expect, it, vi } from 'vitest';
import { assertRuntimeDatabaseProfile, resolveDatabaseProfile } from '../../src/config/env';

/** 3D.3.21-A: `set NODE_ENV=test && cmd` no cmd.exe grava "test " (espaço no fim). Sem normalizar,
 * a guarda NODE_ENV=test => DB_PROFILE=app-test deixava passar app-dev. */
describe('NODE_ENV com espaço no fim (lançamento via cmd.exe)', () => {
  async function loadEnv(nodeEnv: string, profile: string) {
    const previous = { NODE_ENV: process.env.NODE_ENV, DB_PROFILE: process.env.DB_PROFILE };
    vi.resetModules();
    process.env.NODE_ENV = nodeEnv; process.env.DB_PROFILE = profile;
    try { return await import('../../src/config/env'); } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      vi.resetModules();
    }
  }

  it("recusa DB_PROFILE='app-dev ' quando NODE_ENV='test '", async () => {
    await expect(loadEnv('test ', 'app-dev ')).rejects.toThrow(/app-test/);
  });

  it("normaliza NODE_ENV='test ' e aceita apenas app-test", async () => {
    const { env } = await loadEnv('test ', 'app-test ');
    expect(env.nodeEnv).toBe('test');
    expect(env.databaseProfile).toBe('app-test');
  });
});

describe('perfil de banco do backend', () => {
  it('bloqueia app-dev e perfil de migração em ambiente de testes', () => {
    for (const profile of ['app-dev', 'migrate-test', 'migrate-dev']) {
      expect(() => resolveDatabaseProfile('test', profile)).toThrow(/app-test/);
      expect(() => assertRuntimeDatabaseProfile(profile, 'test')).toThrow(/app-test/);
    }
  });

  it('mantém app-test como único perfil de testes e app-dev em desenvolvimento', () => {
    expect(resolveDatabaseProfile('test')).toBe('app-test');
    expect(resolveDatabaseProfile('test', ' app-test ')).toBe('app-test');
    expect(resolveDatabaseProfile('development')).toBe('app-dev');
  });

  it('não usa fallback quando DB_PROFILE está definido mas vazio', () => {
    expect(() => resolveDatabaseProfile('test', '  ')).toThrow();
    expect(() => resolveDatabaseProfile('development', '')).toThrow();
  });
});
