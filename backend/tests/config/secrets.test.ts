import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadDatabaseProfile,
  redactSecrets,
  resolveSecretsDir,
} from '../../src/config/secrets';

const FAKE_PASSWORD = 'fake_password_123';
const createdDirectories: string[] = [];

function createSecretsDir(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardapio-secrets-'));
  createdDirectories.push(directory);

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), content, 'utf8');
  }

  return directory;
}

function fakeUrl(
  user: string,
  database: string,
  password = FAKE_PASSWORD,
): string {
  return `postgresql://${user}:${password}@127.0.0.1:5432/${database}?schema=public&sslmode=disable`;
}

function appDevContent(url = fakeUrl('cardapio_dev_app', 'cardapio_digital_dev')): string {
  return `DATABASE_URL="${url}"\n`;
}

function migrateDevContent(
  databaseUrl = fakeUrl('cardapio_migrator', 'cardapio_digital_dev'),
  shadowDatabaseUrl = fakeUrl('cardapio_migrator', 'cardapio_digital_shadow'),
): string {
  return `DATABASE_URL="${databaseUrl}"\nSHADOW_DATABASE_URL="${shadowDatabaseUrl}"\n`;
}

afterEach(() => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();

    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe('loadDatabaseProfile', () => {
  it('carrega o perfil app-dev sem banco de sombra', () => {
    const secretsDir = createSecretsDir({
      'app-dev.env': appDevContent(),
    });

    const config = loadDatabaseProfile('app-dev', {
      purpose: 'runtime',
      secretsDir,
    });

    expect(config.database).toBe('cardapio_digital_dev');
    expect(config.user).toBe('cardapio_dev_app');
    expect(config.shadowDatabaseUrl).toBeUndefined();
    expect(config.describe()).not.toContain(FAKE_PASSWORD);
  });

  it('carrega o perfil migrate-dev com banco de sombra', () => {
    const secretsDir = createSecretsDir({
      'migrate-dev.env': migrateDevContent(),
    });

    const config = loadDatabaseProfile('migrate-dev', {
      purpose: 'migration',
      secretsDir,
    });

    expect(config.database).toBe('cardapio_digital_dev');
    expect(config.shadowDatabaseUrl).toContain('/cardapio_digital_shadow');
    expect(config.describe()).not.toContain(FAKE_PASSWORD);
  });

  it('rejeita perfil de migração no backend em execução', () => {
    const secretsDir = createSecretsDir({
      'migrate-dev.env': migrateDevContent(),
    });

    expect(() =>
      loadDatabaseProfile('migrate-dev', {
        purpose: 'runtime',
        secretsDir,
      }),
    ).toThrow(/migração/);
  });

  it('rejeita usuário migrator em perfil de aplicação', () => {
    const secretsDir = createSecretsDir({
      'app-dev.env': appDevContent(
        fakeUrl('cardapio_migrator', 'cardapio_digital_dev'),
      ),
    });

    expect(() =>
      loadDatabaseProfile('app-dev', {
        purpose: 'runtime',
        secretsDir,
      }),
    ).toThrow(/cardapio_dev_app/);
  });

  it('rejeita banco diferente do esperado no perfil', () => {
    const secretsDir = createSecretsDir({
      'app-dev.env': appDevContent(
        fakeUrl('cardapio_dev_app', 'cardapio_digital_test'),
      ),
    });

    expect(() =>
      loadDatabaseProfile('app-dev', {
        purpose: 'runtime',
        secretsDir,
      }),
    ).toThrow(/cardapio_digital_dev/);
  });

  it('rejeita banco principal e shadow iguais', () => {
    const secretsDir = createSecretsDir({
      'migrate-dev.env': migrateDevContent(
        fakeUrl('cardapio_migrator', 'cardapio_digital_dev'),
        fakeUrl('cardapio_migrator', 'cardapio_digital_dev'),
      ),
    });

    expect(() =>
      loadDatabaseProfile('migrate-dev', {
        purpose: 'migration',
        secretsDir,
      }),
    ).toThrow(/não podem ser iguais/);
  });

  it('rejeita ausência de SHADOW_DATABASE_URL em perfil de migração', () => {
    const secretsDir = createSecretsDir({
      'migrate-dev.env': `DATABASE_URL="${fakeUrl(
        'cardapio_migrator',
        'cardapio_digital_dev',
      )}"\n`,
    });

    expect(() =>
      loadDatabaseProfile('migrate-dev', {
        purpose: 'migration',
        secretsDir,
      }),
    ).toThrow(/SHADOW_DATABASE_URL/);
  });

  it('rejeita shadow que não seja cardapio_digital_shadow', () => {
    const secretsDir = createSecretsDir({
      'migrate-dev.env': migrateDevContent(
        fakeUrl('cardapio_migrator', 'cardapio_digital_dev'),
        fakeUrl('cardapio_migrator', 'cardapio_digital_test'),
      ),
    });

    expect(() =>
      loadDatabaseProfile('migrate-dev', {
        purpose: 'migration',
        secretsDir,
      }),
    ).toThrow(/cardapio_digital_shadow/);
  });

  it('rejeita arquivo de segredo ausente', () => {
    const secretsDir = createSecretsDir({});

    expect(() =>
      loadDatabaseProfile('app-dev', {
        purpose: 'runtime',
        secretsDir,
      }),
    ).toThrow(/ausente/);
  });

  it('rejeita senha placeholder', () => {
    const secretsDir = createSecretsDir({
      'app-dev.env': appDevContent(
        fakeUrl(
          'cardapio_dev_app',
          'cardapio_digital_dev',
          'SUBSTITUA_PELA_SENHA_URLENCODED',
        ),
      ),
    });

    expect(() =>
      loadDatabaseProfile('app-dev', {
        purpose: 'runtime',
        secretsDir,
      }),
    ).toThrow(/placeholder/);
  });

  it('rejeita chave não permitida no arquivo de segredo', () => {
    const secretsDir = createSecretsDir({
      'app-dev.env': `${appDevContent()}EXTRA_KEY="valor"\n`,
    });

    expect(() =>
      loadDatabaseProfile('app-dev', {
        purpose: 'runtime',
        secretsDir,
      }),
    ).toThrow(/EXTRA_KEY/);
  });

  it('rejeita SHADOW_DATABASE_URL em perfil de aplicação', () => {
    const secretsDir = createSecretsDir({
      'app-dev.env': `${appDevContent()}SHADOW_DATABASE_URL="${fakeUrl(
        'cardapio_dev_app',
        'cardapio_digital_shadow',
      )}"\n`,
    });

    expect(() =>
      loadDatabaseProfile('app-dev', {
        purpose: 'runtime',
        secretsDir,
      }),
    ).toThrow(/não deve definir SHADOW_DATABASE_URL/);
  });
});

describe('resolveSecretsDir', () => {
  it('rejeita pasta dentro do OneDrive', () => {
    const oneDrivePath = path.join(
      os.homedir(),
      'OneDrive',
      'CardapioDigital',
      'secrets',
    );

    expect(() => resolveSecretsDir(oneDrivePath)).toThrow(/OneDrive/);
  });

  it('rejeita pasta dentro do workspace', () => {
    expect(() => resolveSecretsDir(path.join(process.cwd(), 'secrets'))).toThrow(
      /workspace|OneDrive/,
    );
  });

  it('aceita pasta temporária fora do workspace', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cardapio-secrets-'));
    createdDirectories.push(directory);

    expect(resolveSecretsDir(directory)).toBe(path.resolve(directory));
  });
});

describe('redactSecrets', () => {
  it('remove credenciais de URLs PostgreSQL', () => {
    const redacted = redactSecrets(
      'falha em postgresql://usuario:senha@127.0.0.1:5432/banco',
    );

    expect(redacted).not.toContain('senha');
    expect(redacted).toContain('postgresql://***@127.0.0.1:5432/banco');
  });
});
