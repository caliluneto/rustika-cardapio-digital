import { PrismaClient } from '@prisma/client';
import { assertRuntimeDatabaseProfile, env } from '../config/env';
import { loadDatabaseProfile } from '../config/secrets';

interface PrismaRuntimeDependencies {
  loadProfile: typeof loadDatabaseProfile;
  createClient: (databaseUrl: string) => PrismaClient;
}

const defaultDependencies: PrismaRuntimeDependencies = {
  loadProfile: loadDatabaseProfile,
  createClient: (databaseUrl) => new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  }),
};

export function createPrismaRuntime(
  profile = env.databaseProfile,
  dependencies: PrismaRuntimeDependencies = defaultDependencies,
): { prisma: PrismaClient; databaseInfo: string } {
  assertRuntimeDatabaseProfile(profile, env.nodeEnv);

  const database = dependencies.loadProfile(profile, {
    purpose: 'runtime',
    secretsDir: env.secretsDir,
  });

  if (
    database.profile !== profile || database.purpose !== 'runtime' ||
    (env.nodeEnv === 'test' &&
      (database.database !== 'cardapio_digital_test' || database.user !== 'cardapio_test_app'))
  ) {
    throw new Error('Perfil de banco incompatível com o backend em execução.');
  }

  return {
    prisma: dependencies.createClient(database.databaseUrl),
    databaseInfo: database.describe(),
  };
}
