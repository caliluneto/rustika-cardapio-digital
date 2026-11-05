import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  getBackendRoot,
  loadDatabaseProfile,
  redactSecrets,
  SecretsConfigError,
} from '../src/config/secrets';
import {
  authorizePrismaInvocation,
  checkDeployConfirmation,
  parsePrismaInvocation,
} from './prisma-run-policy';

function fail(message: string): number {
  console.error(`[prisma-run] ${redactSecrets(message)}`);
  return 1;
}

function main(): number {
  const parsed = parsePrismaInvocation(process.argv.slice(2));

  if (!parsed.ok) {
    return fail(parsed.error);
  }

  const confirmation = checkDeployConfirmation(parsed.value);

  if (!confirmation.ok) {
    return fail(confirmation.error);
  }

  const backendRoot = getBackendRoot();
  const prismaCli = path.join(
    backendRoot,
    'node_modules',
    'prisma',
    'build',
    'index.js',
  );

  if (!fs.existsSync(prismaCli)) {
    return fail(
      'Prisma CLI local não encontrado. Execute npm install no diretório backend.',
    );
  }

  let database;

  try {
    database = loadDatabaseProfile(parsed.value.profileName, {
      purpose: parsed.value.purpose,
    });
  } catch (error) {
    const message =
      error instanceof SecretsConfigError || error instanceof Error
        ? error.message
        : 'Erro desconhecido ao carregar o perfil de banco.';

    return fail(message);
  }

  const authorization = authorizePrismaInvocation(parsed.value, database);

  if (!authorization.ok) {
    return fail(authorization.error);
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: database.databaseUrl,
  };

  if (database.shadowDatabaseUrl) {
    childEnv.SHADOW_DATABASE_URL = database.shadowDatabaseUrl;
  } else {
    delete childEnv.SHADOW_DATABASE_URL;
  }

  const result = spawnSync(
    process.execPath,
    [prismaCli, ...parsed.value.prismaArgs],
    {
      cwd: backendRoot,
      env: childEnv,
      encoding: 'utf8',
    },
  );

  if (result.error) {
    return fail(`Falha ao executar o Prisma: ${result.error.message}`);
  }

  if (result.stdout) {
    process.stdout.write(redactSecrets(result.stdout));
  }

  if (result.stderr) {
    process.stderr.write(redactSecrets(result.stderr));
  }

  return result.status ?? 1;
}

process.exit(main());
