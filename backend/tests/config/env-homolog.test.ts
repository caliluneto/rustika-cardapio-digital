import { describe, expect, it, vi } from 'vitest';
import { assertRuntimeDatabaseProfile, resolveDatabaseProfile } from '../../src/config/env';
import { assertHomologRuntimeConfig } from '../../src/config/homologRuntime';
import { createPrismaRuntime } from '../../src/lib/prisma';

describe('gates de ambiente (3D.5.2)', () => {
  it('app-homolog só roda com NODE_ENV=production e production só com app-homolog', () => {
    expect(() => assertRuntimeDatabaseProfile('app-homolog', 'production')).not.toThrow();
    for (const runtime of ['development', '']) expect(() => assertRuntimeDatabaseProfile('app-homolog', runtime)).toThrow(/NODE_ENV=production/);
    expect(() => assertRuntimeDatabaseProfile('app-homolog', 'test')).toThrow(/app-test/);
    for (const profile of ['app-dev', 'app-test', 'migrate-test', 'migrate-homolog', 'bootstrap-homolog']) {
      expect(() => assertRuntimeDatabaseProfile(profile, 'production')).toThrow(/app-homolog/);
    }
  });

  it('production exige DB_PROFILE explícito; Dev e Test mantêm o comportamento anterior', () => {
    expect(() => resolveDatabaseProfile('production', undefined)).toThrow(/explícito/);
    expect(() => resolveDatabaseProfile('production', '  ')).toThrow(/explícito/);
    expect(resolveDatabaseProfile('production', ' app-homolog ')).toBe('app-homolog');
    expect(resolveDatabaseProfile('development', undefined)).toBe('app-dev');
    expect(resolveDatabaseProfile('test', undefined)).toBe('app-test');
    expect(() => resolveDatabaseProfile('test', 'app-homolog')).toThrow(/app-test/);
  });

  it('configuração de runtime de homologação exige origem https pública e exata', () => {
    const good = { nodeEnv: 'production', corsOrigin: 'https://homolog.exemplo.invalid', databaseProfile: 'app-homolog' };
    expect(() => assertHomologRuntimeConfig(good)).not.toThrow();
    for (const corsOrigin of ['http://homolog.exemplo.invalid', 'https://localhost', 'https://127.0.0.1', 'https://x.exemplo.invalid/app', 'https://x.exemplo.invalid/', 'https://u:p@x.exemplo.invalid', 'não é url', 'http://localhost:5173']) {
      expect(() => assertHomologRuntimeConfig({ ...good, corsOrigin })).toThrow(/CORS_ORIGIN/);
    }
    expect(() => assertHomologRuntimeConfig({ ...good, nodeEnv: 'development' })).toThrow(/NODE_ENV=production/);
    expect(() => assertHomologRuntimeConfig({ ...good, databaseProfile: 'app-dev' })).toThrow(/app-homolog/);
  });

  it('o runtime recusa perfil de homologação sem ambiente homolog e vice-versa (role/finalidade trocadas)', () => {
    const base = { purpose: 'runtime' as const, databaseUrl: 'x', database: 'cardapio_digital_test', user: 'cardapio_test_app', secretsFilePath: 'x', describe: () => 'd' };
    const createClient = vi.fn(() => ({}) as never);
    // env.nodeEnv é 'test' no vitest: o gate NODE_ENV=test já recusa antes de carregar segredos.
    expect(() => createPrismaRuntime('app-homolog', { loadProfile: vi.fn(() => ({ ...base, profile: 'app-homolog', environment: 'homolog' as const })), createClient })).toThrow(/app-test/);
    expect(createClient).not.toHaveBeenCalled();
    expect(() => createPrismaRuntime('app-test', { loadProfile: vi.fn(() => ({ ...base, profile: 'app-test', environment: 'homolog' as const })), createClient })).toThrow(/incompatível/);
    expect(() => createPrismaRuntime('app-test', { loadProfile: vi.fn(() => ({ ...base, profile: 'migrate-test', purpose: 'migration' as const })), createClient })).toThrow(/incompatível/);
  });
});
