import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { DatabaseSecrets } from '../../src/config/secrets';
import { createPrismaRuntime } from '../../src/lib/prisma';

const testDatabase: DatabaseSecrets = {
  profile: 'app-test',
  purpose: 'runtime',
  databaseUrl: 'postgresql://fake:fake@127.0.0.1:5432/cardapio_digital_test',
  database: 'cardapio_digital_test',
  user: 'cardapio_test_app',
  secretsFilePath: 'fake',
  describe: () => 'perfil=app-test banco=cardapio_digital_test role=cardapio_test_app',
};

function doubles(database = testDatabase) {
  const loadProfile = vi.fn(() => database);
  const createClient = vi.fn(() => ({ $disconnect: vi.fn() }) as unknown as PrismaClient);
  return { loadProfile, createClient };
}

describe('createPrismaRuntime em NODE_ENV=test', () => {
  it('rejeita app-dev antes de carregar perfil ou construir cliente', () => {
    const dependencies = doubles();

    expect(() => createPrismaRuntime('app-dev', dependencies)).toThrow(/app-test/);
    expect(dependencies.loadProfile).not.toHaveBeenCalled();
    expect(dependencies.createClient).not.toHaveBeenCalled();
  });

  it('rejeita identidade de banco ou role diferente mesmo com perfil app-test', () => {
    for (const database of [
      { ...testDatabase, database: 'cardapio_digital_dev' },
      { ...testDatabase, user: 'cardapio_dev_app' },
      { ...testDatabase, profile: 'app-dev' },
      { ...testDatabase, purpose: 'migration' as const },
    ]) {
      const dependencies = doubles(database);
      expect(() => createPrismaRuntime('app-test', dependencies)).toThrow(/incompatível/);
      expect(dependencies.createClient).not.toHaveBeenCalled();
    }
  });

  it('constrói clientes separados, passando apenas a URL do perfil validado', () => {
    const dependencies = doubles();
    const first = createPrismaRuntime('app-test', dependencies);
    const second = createPrismaRuntime('app-test', dependencies);

    expect(dependencies.loadProfile).toHaveBeenCalledWith('app-test', {
      purpose: 'runtime',
      secretsDir: expect.any(String),
    });
    expect(dependencies.createClient).toHaveBeenCalledTimes(2);
    expect(dependencies.createClient).toHaveBeenCalledWith(testDatabase.databaseUrl);
    expect(first.prisma).not.toBe(second.prisma);
    expect(first.databaseInfo).toContain('perfil=app-test');
  });
});
