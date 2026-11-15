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

// O valor é normalizado com trim: no Windows, `set NODE_ENV=test && cmd` deixa "test " (espaço no fim),
// o que desativava silenciosamente a guarda NODE_ENV=test => DB_PROFILE=app-test abaixo.
const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();

// Perfis de homologação aceitos em produção. 'app-homolog-neon' é opt-in e tem a MESMA identidade final
// (banco/role) de 'app-homolog' — só o provedor e a verificação de identidade do servidor mudam (ver neonServerIdentity.ts).
export const PRODUCTION_HOMOLOG_PROFILES: ReadonlySet<string> = new Set(['app-homolog', 'app-homolog-neon']);

export function assertRuntimeDatabaseProfile(profile: string, runtimeEnv: string): void {
  if (!profile) throw new Error('DB_PROFILE não pode ser vazio.');
  if (runtimeEnv === 'test' && profile !== 'app-test') {
    throw new Error('NODE_ENV=test exige exclusivamente DB_PROFILE=app-test.');
  }
  // A homologação roda em modo production e só com um dos perfis dela; production nunca usa Dev/Test.
  if (PRODUCTION_HOMOLOG_PROFILES.has(profile) && runtimeEnv !== 'production') {
    throw new Error(`DB_PROFILE=${profile} exige NODE_ENV=production.`);
  }
  if (runtimeEnv === 'production' && !PRODUCTION_HOMOLOG_PROFILES.has(profile)) {
    throw new Error('NODE_ENV=production exige exclusivamente DB_PROFILE=app-homolog ou app-homolog-neon.');
  }
}

export function resolveDatabaseProfile(runtimeEnv: string, configuredProfile?: string): string {
  if (runtimeEnv === 'production' && (configuredProfile === undefined || configuredProfile.trim() === '')) {
    throw new Error('NODE_ENV=production exige DB_PROFILE explícito (app-homolog).');
  }
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
  // Com CARDAPIO_SECRETS_SOURCE=env não há pasta de segredos; evitar falhar na importação por causa de um HOME atípico.
  secretsDir: process.env.CARDAPIO_SECRETS_SOURCE?.trim() === 'env' ? '' : resolveSecretsDir(),
};
