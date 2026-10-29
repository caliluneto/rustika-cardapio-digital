import { describe, expect, it } from 'vitest';
import { assertRuntimeDatabaseProfile, resolveDatabaseProfile } from '../../src/config/env';

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
