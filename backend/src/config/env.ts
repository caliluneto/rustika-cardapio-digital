import dotenv from 'dotenv';
import { resolveSecretsDir } from './secrets';

dotenv.config();

function readPort(value: string | undefined, fallback: number): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }

  return port;
}

// 3D.3.21-A: trimmed. A Windows `set NODE_ENV=test && cmd` leaves "test " (trailing space), which
// silently disabled the NODE_ENV=test => DB_PROFILE=app-test guard below.
const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();

export function assertRuntimeDatabaseProfile(profile: string, runtimeEnv: string): void {
  if (!profile) throw new Error('DB_PROFILE não pode ser vazio.');
  if (runtimeEnv === 'test' && profile !== 'app-test') {
    throw new Error('NODE_ENV=test exige exclusivamente DB_PROFILE=app-test.');
  }
}

export function resolveDatabaseProfile(runtimeEnv: string, configuredProfile?: string): string {
  const profile = configuredProfile === undefined
    ? (runtimeEnv === 'test' ? 'app-test' : 'app-dev') : configuredProfile.trim();
  assertRuntimeDatabaseProfile(profile, runtimeEnv);
  return profile;
}

export const env = {
  nodeEnv,
  port: readPort(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  databaseProfile: resolveDatabaseProfile(nodeEnv, process.env.DB_PROFILE),
  secretsDir: resolveSecretsDir(),
};
