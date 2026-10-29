import { describe, expect, it } from 'vitest';
import {
  authorizePrismaInvocation,
  checkDeployConfirmation,
  DEPLOY_CONFIRMATION_ENV,
  DEPLOY_CONFIRMATION_VALUE,
  parsePrismaInvocation,
  type ParsedPrismaInvocation,
} from '../../scripts/prisma-run-policy';

const migrationTestDatabase = {
  profile: 'migrate-test',
  purpose: 'migration' as const,
  database: 'cardapio_digital_test',
};

const migrationDevDatabase = {
  profile: 'migrate-test',
  purpose: 'migration' as const,
  database: 'cardapio_digital_dev',
};

const runtimeTestDatabase = {
  profile: 'app-test',
  purpose: 'runtime' as const,
  database: 'cardapio_digital_test',
};

const confirmedEnv = {
  [DEPLOY_CONFIRMATION_ENV]: DEPLOY_CONFIRMATION_VALUE,
};

function migrateInvocation(subcommand: 'status' | 'deploy'): ParsedPrismaInvocation {
  const parsed = parsePrismaInvocation(['migrate-test', 'migrate', subcommand]);

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  return parsed.value;
}

describe('parsePrismaInvocation', () => {
  it('preserva validate e generate com seus argumentos', () => {
    const validate = parsePrismaInvocation(['migrate-dev', 'validate']);
    const generate = parsePrismaInvocation([
      'app-dev',
      'generate',
      '--schema',
      'prisma/schema.prisma',
    ]);

    expect(validate).toEqual({
      ok: true,
      value: {
        profileName: 'migrate-dev',
        purpose: 'any',
        prismaArgs: ['validate'],
      },
    });
    expect(generate).toEqual({
      ok: true,
      value: {
        profileName: 'app-dev',
        purpose: 'any',
        prismaArgs: ['generate', '--schema', 'prisma/schema.prisma'],
      },
    });
  });

  it('permite migrate status com migrate-test', () => {
    expect(parsePrismaInvocation(['migrate-test', 'migrate', 'status'])).toEqual({
      ok: true,
      value: {
        profileName: 'migrate-test',
        purpose: 'migration',
        prismaArgs: ['migrate', 'status'],
        migrationSubcommand: 'status',
      },
    });
  });

  it('permite migrate deploy com migrate-test', () => {
    expect(parsePrismaInvocation(['migrate-test', 'migrate', 'deploy'])).toEqual({
      ok: true,
      value: {
        profileName: 'migrate-test',
        purpose: 'migration',
        prismaArgs: ['migrate', 'deploy'],
        migrationSubcommand: 'deploy',
      },
    });
  });

  it.each([
    ['dev'],
    ['reset'],
    ['resolve'],
    ['unknown'],
  ])('bloqueia migrate %s', (subcommand) => {
    expect(
      parsePrismaInvocation(['migrate-test', 'migrate', subcommand]),
    ).toMatchObject({ ok: false });
  });

  it.each([
    ['db', 'push'],
    ['seed'],
    ['dev'],
    ['reset'],
    ['resolve'],
  ])('bloqueia o comando %s', (...command) => {
    expect(parsePrismaInvocation(['migrate-test', ...command])).toMatchObject({
      ok: false,
    });
  });

  it('rejeita migrate sem subcomando', () => {
    expect(parsePrismaInvocation(['migrate-test', 'migrate'])).toMatchObject({
      ok: false,
    });
  });

  it.each([
    ['migrate-dev', 'migrate', 'deploy'],
    ['app-test', 'migrate', 'status'],
    ['migrate-test', 'migrate', 'deploy', '--force'],
    ['migrate-test', 'migrate', 'status', 'extra'],
  ])('rejeita combinação não autorizada: %s', (...argv) => {
    expect(parsePrismaInvocation(argv)).toMatchObject({ ok: false });
  });
});

describe('checkDeployConfirmation', () => {
  it('exige confirmação antes de carregar credenciais para deploy', () => {
    expect(
      checkDeployConfirmation(migrateInvocation('deploy'), {}),
    ).toMatchObject({ ok: false });
  });

  it('aceita confirmação explícita para deploy', () => {
    expect(
      checkDeployConfirmation(migrateInvocation('deploy'), confirmedEnv),
    ).toEqual({ ok: true });
  });

  it('não exige confirmação para status', () => {
    expect(
      checkDeployConfirmation(migrateInvocation('status'), {}),
    ).toEqual({ ok: true });
  });
});

describe('authorizePrismaInvocation', () => {
  it('autoriza comandos existentes sem confirmação', () => {
    const parsed = parsePrismaInvocation(['app-dev', 'validate']);

    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      return;
    }

    expect(
      authorizePrismaInvocation(parsed.value, runtimeTestDatabase, {}),
    ).toEqual({ ok: true });
  });

  it('autoriza migrate status no banco de teste sem confirmação', () => {
    expect(
      authorizePrismaInvocation(migrateInvocation('status'), migrationTestDatabase, {}),
    ).toEqual({ ok: true });
  });

  it('recusa migrate deploy sem confirmação explícita', () => {
    expect(
      authorizePrismaInvocation(migrateInvocation('deploy'), migrationTestDatabase, {}),
    ).toMatchObject({ ok: false });
  });

  it('recusa migrate deploy com confirmação incorreta', () => {
    expect(
      authorizePrismaInvocation(migrateInvocation('deploy'), migrationTestDatabase, {
        [DEPLOY_CONFIRMATION_ENV]: 'VALOR_INCORRETO',
      }),
    ).toMatchObject({ ok: false });
  });

  it('autoriza migrate deploy com confirmação explícita', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('deploy'),
        migrationTestDatabase,
        confirmedEnv,
      ),
    ).toEqual({ ok: true });
  });

  it('recusa perfil com finalidade incorreta', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('status'),
        runtimeTestDatabase,
        {},
      ),
    ).toMatchObject({ ok: false });
  });

  it('recusa perfil com nome incorreto', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('status'),
        {
          profile: 'migrate-dev',
          purpose: 'migration',
          database: 'cardapio_digital_test',
        },
        {},
      ),
    ).toMatchObject({ ok: false });
  });

  it('recusa banco incorreto', () => {
    expect(
      authorizePrismaInvocation(
        migrateInvocation('deploy'),
        migrationDevDatabase,
        confirmedEnv,
      ),
    ).toMatchObject({ ok: false });
  });
});
