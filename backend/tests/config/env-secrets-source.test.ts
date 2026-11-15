import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env.ts com segredos por ambiente', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('CARDAPIO_SECRETS_SOURCE=env não resolve (nem falha por) a pasta de segredos', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DB_PROFILE', 'app-homolog');
    vi.stubEnv('CARDAPIO_SECRETS_SOURCE', 'env');
    // Pasta inválida (dentro do workspace) falharia na importação se fosse resolvida.
    vi.stubEnv('CARDAPIO_SECRETS_DIR', process.cwd());
    vi.resetModules();
    const { env } = await import('../../src/config/env');
    expect(env.secretsDir).toBe('');
    expect(env.nodeEnv).toBe('production');
  });

  it('sem a opção (padrão arquivo) a validação da pasta continua valendo', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DB_PROFILE', 'app-homolog');
    vi.stubEnv('CARDAPIO_SECRETS_SOURCE', '');
    vi.stubEnv('CARDAPIO_SECRETS_DIR', process.cwd());
    vi.resetModules();
    await expect(import('../../src/config/env')).rejects.toThrow(/pasta de segredos não pode estar/);
  });

  it('valor diferente de "env" (ex.: ENV) não desliga a validação', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DB_PROFILE', 'app-homolog');
    vi.stubEnv('CARDAPIO_SECRETS_SOURCE', 'ENV');
    vi.stubEnv('CARDAPIO_SECRETS_DIR', process.cwd());
    vi.resetModules();
    await expect(import('../../src/config/env')).rejects.toThrow(/pasta de segredos não pode estar/);
  });
});
