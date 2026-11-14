import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

export type ProfilePurpose = 'runtime' | 'migration' | 'bootstrap';
/** 3D.5.3-C.5: 'homolog-neon' é o ambiente de homologação hospedado no Neon Free (ver docs/neon-homolog.md); banco e role
 * definitivos são os MESMOS de 'homolog' (o objetivo da C.5 é que o estado final seja idêntico, provedor à parte). */
export type HomologEnvironment = 'homolog' | 'homolog-replay' | 'homolog-neon';
export type RequestedPurpose = ProfilePurpose | 'any';

export interface ProfileDefinition {
  purpose: ProfilePurpose;
  /** 3D.5.2: ausente nos perfis locais (dev/test). 'homolog' = banco definitivo; 'homolog-replay' = replay transitório das migrations históricas. */
  environment?: HomologEnvironment;
  database: string;
  user: string;
  requiresShadow: boolean;
  shadowDatabase?: string;
}

export interface DatabaseSecrets {
  profile: string;
  purpose: ProfilePurpose;
  databaseUrl: string;
  shadowDatabaseUrl?: string;
  database: string;
  user: string;
  secretsFilePath: string;
  environment?: HomologEnvironment;
  host?: string;
  clusterId?: string;
  /** 3D.5.3-C.5: só presente quando environment === 'homolog-neon'. */
  projectId?: string;
  describe: () => string;
}

export interface LoadDatabaseProfileOptions {
  purpose?: RequestedPurpose;
  secretsDir?: string;
  /** Ambiente lido para CARDAPIO_SECRETS_SOURCE e variáveis de segredo (padrão: process.env); injetável em testes. */
  env?: NodeJS.ProcessEnv;
}

/** 3D.5.3-B: variáveis (prefixadas, sem colisão com DATABASE_URL genérica) usadas só com CARDAPIO_SECRETS_SOURCE=env. */
export const ENV_SECRET_VARIABLES = {
  DATABASE_URL: 'RUSTIKA_HOMOLOG_DATABASE_URL',
  EXPECTED_DATABASE_HOST: 'RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST',
  EXPECTED_CLUSTER_ID: 'RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID',
  /** 3D.5.3-C.5: só lido/exigido para o perfil app-homolog-neon (environment homolog-neon). */
  EXPECTED_PROJECT_ID: 'RUSTIKA_HOMOLOG_EXPECTED_PROJECT_ID',
} as const;
export const ENV_SECRETS_ORIGIN = '(variáveis de ambiente)';

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsConfigError';
  }
}

const ALLOWED_KEYS = new Set(['DATABASE_URL', 'SHADOW_DATABASE_URL']);
const HOMOLOG_EXTRA_KEYS = new Set(['EXPECTED_DATABASE_HOST', 'EXPECTED_CLUSTER_ID', 'EXPECTED_PROJECT_ID']);
const CLUSTER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 3D.5.3-C.5: formato observado dos project id do Neon (ex.: aged-scene-47291697). Documentado, não garantido pelo provedor. */
const NEON_PROJECT_ID_PATTERN = /^[a-z]+-[a-z]+-[0-9]{6,10}$/;

/**
 * 3D.5.2-A: identidade do ambiente de homologação.
 * O banco DEFINITIVO chama-se `cardapio_digital_homolog`; os nomes de Dev/Test/Shadow nunca o identificam.
 * As migrations históricas (imutáveis) só executam em um banco chamado `cardapio_digital_test|dev` com as roles legadas;
 * por isso existe uma fase TRANSITÓRIA de replay (perfil `migrate-homolog-replay`, banco `cardapio_digital_test`, apenas no
 * cluster dedicado e validado por identidade de servidor), seguida de renomeação controlada do banco e das roles.
 * Ver backend/docs/homologation-environment.md.
 */
export const HOMOLOG_DEFINITIVE_DATABASE = 'cardapio_digital_homolog';
export const HOMOLOG_REPLAY_DATABASE = 'cardapio_digital_test';
export const HOMOLOG_ROLES = {
  runtime: 'cardapio_homolog_app',
  migrator: 'cardapio_homolog_migrator',
  bootstrap: 'cardapio_homolog_bootstrap',
  placeholder: 'cardapio_homolog_placeholder',
} as const;
export const REPLAY_ROLES = { migrator: 'cardapio_migrator', runtime: 'cardapio_test_app', placeholder: 'cardapio_dev_app' } as const;
export const FORBIDDEN_DEFINITIVE_DATABASES: readonly string[] = [
  'cardapio_digital_dev', 'cardapio_digital_test', 'cardapio_digital_shadow', 'postgres', 'template0', 'template1',
];
const HOMOLOG_PROFILE_IDENTITY: Record<string, { environment: HomologEnvironment; purpose: ProfilePurpose; database: string; user: string }> = {
  'app-homolog': { environment: 'homolog', purpose: 'runtime', database: HOMOLOG_DEFINITIVE_DATABASE, user: HOMOLOG_ROLES.runtime },
  'migrate-homolog': { environment: 'homolog', purpose: 'migration', database: HOMOLOG_DEFINITIVE_DATABASE, user: HOMOLOG_ROLES.migrator },
  'bootstrap-homolog': { environment: 'homolog', purpose: 'bootstrap', database: HOMOLOG_DEFINITIVE_DATABASE, user: HOMOLOG_ROLES.bootstrap },
  'migrate-homolog-replay': { environment: 'homolog-replay', purpose: 'migration', database: HOMOLOG_REPLAY_DATABASE, user: REPLAY_ROLES.migrator },
  // 3D.5.3-C.5: mesmo banco/role definitivos de 'app-homolog' — só o provedor (Neon) e a verificação de identidade mudam.
  'app-homolog-neon': { environment: 'homolog-neon', purpose: 'runtime', database: HOMOLOG_DEFINITIVE_DATABASE, user: HOMOLOG_ROLES.runtime },
};
const HOMOLOG_QUERY_KEYS = new Set(['sslmode', 'sslaccept', 'sslcert', 'schema', 'connect_timeout', 'connection_limit', 'pool_timeout', 'channel_binding']);
const HOMOLOG_TLS_MODES = new Set(['require', 'verify-ca', 'verify-full']);
const PLACEHOLDER_PATTERN = /(SUBSTITUA|SENHA_URLENCODED|SENHA_EXEMPLO)/i;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const POSTGRES_PORT = '5432';

let cachedBackendRoot: string | undefined;
let cachedProfiles: Record<string, ProfileDefinition> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getBackendRoot(): string {
  if (cachedBackendRoot) {
    return cachedBackendRoot;
  }

  const candidates = [process.cwd(), path.resolve(process.cwd(), 'backend')];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'config', 'database-profiles.json'))) {
      cachedBackendRoot = candidate;
      return candidate;
    }
  }

  throw new SecretsConfigError(
    'Não foi possível localizar a raiz do backend (config/database-profiles.json).',
  );
}

function profilesFilePath(): string {
  return path.join(getBackendRoot(), 'config', 'database-profiles.json');
}

function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveSecretsDir(override?: string): string {
  const localAppData =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const candidate =
    override ??
    process.env.CARDAPIO_SECRETS_DIR ??
    path.join(localAppData, 'CardapioDigital', 'secrets');
  const resolved = path.resolve(candidate);
  const normalized = resolved.replace(/\//g, '\\').toLowerCase();

  if (/(^|\\)onedrive(\\|$)/.test(normalized)) {
    throw new SecretsConfigError(
      'A pasta de segredos não pode estar dentro do OneDrive.',
    );
  }

  const workspaceRoot = path.dirname(getBackendRoot());

  if (isPathInside(resolved, workspaceRoot)) {
    throw new SecretsConfigError(
      'A pasta de segredos não pode estar dentro do workspace do projeto.',
    );
  }

  return resolved;
}

function asProfileDefinition(
  name: string,
  value: unknown,
): ProfileDefinition {
  if (!isRecord(value)) {
    throw new SecretsConfigError(`Definição inválida para o perfil ${name}.`);
  }

  const { purpose, database, user, requiresShadow, shadowDatabase } = value;

  if (purpose !== 'runtime' && purpose !== 'migration' && purpose !== 'bootstrap') {
    throw new SecretsConfigError(
      `Finalidade inválida no perfil ${name}. Use runtime, migration ou bootstrap.`,
    );
  }

  if (typeof database !== 'string' || database.trim().length === 0) {
    throw new SecretsConfigError(`Banco inválido no perfil ${name}.`);
  }

  if (typeof user !== 'string' || user.trim().length === 0) {
    throw new SecretsConfigError(`Usuário inválido no perfil ${name}.`);
  }

  if (requiresShadow !== true && requiresShadow !== false) {
    throw new SecretsConfigError(
      `requiresShadow inválido no perfil ${name}. Use true ou false.`,
    );
  }

  if (requiresShadow) {
    if (typeof shadowDatabase !== 'string' || shadowDatabase.trim().length === 0) {
      throw new SecretsConfigError(
        `shadowDatabase é obrigatório no perfil ${name}.`,
      );
    }

    return {
      purpose,
      database: database.trim(),
      user: user.trim(),
      requiresShadow,
      shadowDatabase: shadowDatabase.trim(),
    };
  }

  if (shadowDatabase !== undefined) {
    throw new SecretsConfigError(
      `shadowDatabase não deve ser definido no perfil ${name}.`,
    );
  }

  return {
    purpose,
    database: database.trim(),
    user: user.trim(),
    requiresShadow,
  };
}

function withEnvironment(name: string, raw: unknown, definition: ProfileDefinition): ProfileDefinition {
  const environment = isRecord(raw) ? raw.environment : undefined;

  if (environment === undefined) {
    if (definition.purpose === 'bootstrap') {
      throw new SecretsConfigError(`O perfil ${name} de bootstrap exige environment=homolog.`);
    }
    return definition;
  }

  const identity = HOMOLOG_PROFILE_IDENTITY[name];
  if ((environment !== 'homolog' && environment !== 'homolog-replay' && environment !== 'homolog-neon') || !identity) {
    throw new SecretsConfigError(`Ambiente ou perfil de homologação inválido: ${name}.`);
  }
  if (definition.requiresShadow) {
    throw new SecretsConfigError(`O perfil ${name} de homologação não usa banco de sombra.`);
  }
  if (environment !== identity.environment || definition.purpose !== identity.purpose ||
      definition.database !== identity.database || definition.user !== identity.user) {
    throw new SecretsConfigError(`Banco, usuário ou finalidade do perfil ${name} divergem da identidade de homologação.`);
  }
  if (environment === 'homolog' && FORBIDDEN_DEFINITIVE_DATABASES.includes(definition.database)) {
    throw new SecretsConfigError(`O perfil ${name} não pode identificar o banco definitivo com um nome de Dev/Test/Shadow.`);
  }
  return { ...definition, environment: identity.environment };
}

function readProfiles(): Record<string, ProfileDefinition> {
  if (cachedProfiles) {
    return cachedProfiles;
  }

  let raw: string;

  try {
    raw = fs.readFileSync(profilesFilePath(), 'utf8');
  } catch {
    throw new SecretsConfigError(
      'Não foi possível ler o mapa de perfis do banco de dados.',
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SecretsConfigError('O mapa de perfis do banco de dados é inválido.');
  }

  if (!isRecord(parsed)) {
    throw new SecretsConfigError('O mapa de perfis do banco de dados é inválido.');
  }

  const profiles: Record<string, ProfileDefinition> = {};

  for (const [name, value] of Object.entries(parsed)) {
    profiles[name] = withEnvironment(name, value, asProfileDefinition(name, value));
  }

  cachedProfiles = profiles;
  return profiles;
}

function decodeUrlPart(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new SecretsConfigError(`${label} contém codificação inválida.`);
  }
}

interface ParsedPostgresUrl {
  url: URL;
  database: string;
  user: string;
}

function parsePostgresUrl(
  raw: string,
  profileName: string,
  key: string,
  remote = false,
): ParsedPostgresUrl {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} não é uma URL válida.`,
    );
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} deve usar o esquema postgresql:// ou postgres://.`,
    );
  }

  if (!remote && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} deve usar 127.0.0.1 ou localhost.`,
    );
  }

  if (!remote && url.port !== POSTGRES_PORT) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} deve usar a porta ${POSTGRES_PORT}.`,
    );
  }

  const database = decodeUrlPart(
    url.pathname.replace(/^\/+/, ''),
    `${key} do perfil ${profileName}`,
  );

  if (database.length === 0 || database.includes('/')) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} não contém um banco de dados válido.`,
    );
  }

  const user = decodeUrlPart(url.username, `${key} do perfil ${profileName}`);
  const password = decodeUrlPart(url.password, `${key} do perfil ${profileName}`);

  if (user.length === 0) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} não contém um usuário.`,
    );
  }

  if (password.length === 0 || PLACEHOLDER_PATTERN.test(password)) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} ainda contém a senha placeholder.`,
    );
  }

  return { url, database, user };
}

function requireSecret(
  values: Record<string, string>,
  key: string,
  profileName: string,
): string {
  const value = values[key]?.trim();

  if (!value) {
    throw new SecretsConfigError(
      `Variável ${key} ausente no perfil ${profileName}.`,
    );
  }

  return value;
}

function assertMatchesProfile(
  parsed: ParsedPostgresUrl,
  profile: ProfileDefinition,
  profileName: string,
  key: string,
): void {
  if (parsed.database !== profile.database) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} deve apontar para o banco ${profile.database}.`,
    );
  }

  if (parsed.user !== profile.user) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} deve usar o usuário ${profile.user}.`,
    );
  }
}

/** Hosts que nunca podem ser o destino da homologação (locais, de metadados ou ambíguos). */
export function isForbiddenHomologHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::' || host === '::1' || host === '0.0.0.0') return true;
  if (/^(127|0)\./.test(host) || /^169\.254\./.test(host)) return true;
  if (host.startsWith('::ffff:') || host.startsWith('fe80:')) return true;
  if (!host.includes('.') && !host.includes(':')) return true; // nome de rótulo único (rede local/docker)
  return false;
}

function parseHomologUrl(raw: string, profileName: string, key: string, expectedHost: string, requireDirectEndpoint = false): ParsedPostgresUrl {
  const base = parsePostgresUrl(raw, profileName, key, true);
  const host = base.url.hostname.toLowerCase();
  const label = `${key} do perfil ${profileName}`;

  if (isForbiddenHomologHost(host)) {
    throw new SecretsConfigError(`${label} aponta para um host local ou não permitido na homologação.`);
  }
  if (host !== expectedHost.trim().toLowerCase()) {
    throw new SecretsConfigError(`${label} não corresponde a EXPECTED_DATABASE_HOST.`);
  }
  // 3D.5.3-C.5: só para o perfil Neon — migrations e identidade do servidor exigem o endpoint DIRETO (o pooler mascara pg_backend_pid/SET).
  if (requireDirectEndpoint && host.split('.')[0]?.includes('-pooler')) {
    throw new SecretsConfigError(`${label} usa um endpoint com pooler (-pooler): use o endpoint direto do Neon.`);
  }
  const port = base.url.port === '' ? 5432 : Number(base.url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SecretsConfigError(`${label} contém uma porta inválida.`);
  }
  const params = base.url.searchParams;
  for (const param of params.keys()) {
    if (!HOMOLOG_QUERY_KEYS.has(param)) {
      throw new SecretsConfigError(`${label} contém um parâmetro não permitido: ${param}.`);
    }
  }
  const mode = params.get('sslmode');
  if (mode === null || !HOMOLOG_TLS_MODES.has(mode)) {
    throw new SecretsConfigError(`${label} exige sslmode=require, verify-ca ou verify-full.`);
  }
  const accept = params.get('sslaccept');
  if (accept !== null && accept !== 'strict') {
    throw new SecretsConfigError(`${label} não pode relaxar a validação do certificado TLS.`);
  }
  const channelBinding = params.get('channel_binding');
  if (channelBinding !== null && channelBinding !== 'require' && channelBinding !== 'prefer') {
    throw new SecretsConfigError(`${label} não pode desativar channel_binding.`);
  }
  const schema = params.get('schema');
  if (schema !== null && schema !== 'public') {
    throw new SecretsConfigError(`${label} deve usar o schema public.`);
  }
  return base;
}

function assertSecretsFileMode(secretsFilePath: string, profileName: string): void {
  if (process.platform === 'win32') return; // ACLs do Windows não são representadas por mode bits
  const mode = fs.statSync(secretsFilePath).mode;
  if ((mode & 0o077) !== 0) {
    throw new SecretsConfigError(`O arquivo de segredo do perfil ${profileName} deve ser legível apenas pelo proprietário (chmod 600).`);
  }
}

export function loadDatabaseProfile(
  profileName: string,
  options: LoadDatabaseProfileOptions = {},
): DatabaseSecrets {
  const profiles = readProfiles();
  const profile = profiles[profileName];

  if (!profile) {
    throw new SecretsConfigError(`Perfil de banco desconhecido: ${profileName}.`);
  }

  const requestedPurpose = options.purpose ?? 'any';

  if (requestedPurpose === 'bootstrap' && profile.purpose !== 'bootstrap') {
    throw new SecretsConfigError(`O perfil ${profileName} não é de bootstrap.`);
  }
  if (profile.purpose === 'bootstrap' && requestedPurpose !== 'bootstrap' && requestedPurpose !== 'any') {
    throw new SecretsConfigError(`O perfil ${profileName} é de bootstrap e só pode ser usado pelo comando de provisionamento do primeiro administrador.`);
  }

  if (requestedPurpose !== 'any' && profile.purpose !== requestedPurpose) {
    throw new SecretsConfigError(
      requestedPurpose === 'runtime'
        ? `O perfil ${profileName} é de migração e não pode ser usado pelo backend em execução.`
        : `O perfil ${profileName} é de aplicação e não pode ser usado para migrações.`,
    );
  }

  const homolog = profile.environment !== undefined;

  // 3D.5.3-B: origem dos segredos. Padrão `file` (inalterado). `env` é um opt-in EXPLÍCITO, restrito ao perfil de aplicação
  // (runtime) da homologação, para provedores sem arquivos com modo 0600 garantido. Todas as demais validações (host remoto,
  // TLS, banco/usuário exatos, EXPECTED_DATABASE_HOST, UUID do cluster, ausência de SHADOW) continuam valendo.
  const runtimeEnv = options.env ?? process.env;
  const source = runtimeEnv.CARDAPIO_SECRETS_SOURCE?.trim() ?? '';
  if (source !== '' && source !== 'file' && source !== 'env') {
    throw new SecretsConfigError('CARDAPIO_SECRETS_SOURCE deve ser "file" ou "env".');
  }
  const fromEnv = source === 'env';
  if (fromEnv && !(homolog && profile.purpose === 'runtime')) {
    throw new SecretsConfigError(`CARDAPIO_SECRETS_SOURCE=env não é permitido para o perfil ${profileName}: só o perfil de aplicação da homologação aceita segredos por variável de ambiente.`);
  }

  if (!fromEnv && homolog && options.secretsDir === undefined && !process.env.CARDAPIO_SECRETS_DIR?.trim()) {
    throw new SecretsConfigError(
      `O perfil ${profileName} exige uma pasta de segredos própria: defina CARDAPIO_SECRETS_DIR (não reutilize a pasta de Dev/Test).`,
    );
  }

  const secretsDir = fromEnv ? '' : (options.secretsDir ?? resolveSecretsDir());
  const secretsFilePath = fromEnv ? ENV_SECRETS_ORIGIN : path.join(secretsDir, `${profileName}.env`);

  let values: Record<string, string>;

  if (fromEnv) {
    values = {};
    for (const [key, variable] of Object.entries(ENV_SECRET_VARIABLES)) {
      const value = runtimeEnv[variable];
      if (value !== undefined && value.trim() !== '') values[key] = value;
    }
  } else {
    if (!fs.existsSync(secretsFilePath)) {
      throw new SecretsConfigError(
        `Arquivo de segredo ausente para o perfil ${profileName}: ${secretsFilePath}.`,
      );
    }

    if (homolog) assertSecretsFileMode(secretsFilePath, profileName);

    try {
      values = dotenv.parse(fs.readFileSync(secretsFilePath, 'utf8'));
    } catch {
      throw new SecretsConfigError(
        `Não foi possível ler o arquivo de segredo do perfil ${profileName}.`,
      );
    }
  }

  for (const key of Object.keys(values)) {
    if (!ALLOWED_KEYS.has(key) && !(homolog && HOMOLOG_EXTRA_KEYS.has(key))) {
      throw new SecretsConfigError(
        `Chave não permitida no perfil ${profileName}: ${key}.`,
      );
    }
  }

  // ponytail: migrate-homolog-replay adopts Neon validation when EXPECTED_PROJECT_ID or *.neon.tech host is configured
  const isNeon =
    profile.environment === 'homolog-neon' ||
    (profileName === 'migrate-homolog-replay' &&
      Boolean(values.EXPECTED_PROJECT_ID !== undefined || values.EXPECTED_DATABASE_HOST?.toLowerCase().endsWith('.neon.tech')));
  const databaseUrl = requireSecret(values, 'DATABASE_URL', profileName);
  const parsed = homolog
    ? parseHomologUrl(databaseUrl, profileName, 'DATABASE_URL', requireSecret(values, 'EXPECTED_DATABASE_HOST', profileName), isNeon)
    : parsePostgresUrl(databaseUrl, profileName, 'DATABASE_URL');
  assertMatchesProfile(parsed, profile, profileName, 'DATABASE_URL');

  if ((profile.purpose === 'runtime' || homolog) && values.SHADOW_DATABASE_URL !== undefined) {
    throw new SecretsConfigError(
      `O perfil de aplicação ${profileName} não deve definir SHADOW_DATABASE_URL.`,
    );
  }

  let shadowDatabaseUrl: string | undefined;

  if (profile.requiresShadow) {
    shadowDatabaseUrl = requireSecret(
      values,
      'SHADOW_DATABASE_URL',
      profileName,
    );
    const shadowParsed = parsePostgresUrl(
      shadowDatabaseUrl,
      profileName,
      'SHADOW_DATABASE_URL',
    );

    if (
      shadowParsed.database === parsed.database ||
      shadowParsed.url.toString() === parsed.url.toString()
    ) {
      throw new SecretsConfigError(
        `O banco principal e o banco de sombra do perfil ${profileName} não podem ser iguais.`,
      );
    }

    if (shadowParsed.database !== profile.shadowDatabase) {
      throw new SecretsConfigError(
        `SHADOW_DATABASE_URL do perfil ${profileName} deve apontar para ${profile.shadowDatabase}.`,
      );
    }

    if (shadowParsed.user !== profile.user) {
      throw new SecretsConfigError(
        `SHADOW_DATABASE_URL do perfil ${profileName} deve usar o usuário ${profile.user}.`,
      );
    }
  }

  let clusterId: string | undefined;
  if (homolog) {
    clusterId = requireSecret(values, 'EXPECTED_CLUSTER_ID', profileName).toLowerCase();
    if (!CLUSTER_ID_PATTERN.test(clusterId)) {
      throw new SecretsConfigError(`EXPECTED_CLUSTER_ID do perfil ${profileName} deve ser um UUID.`);
    }
  }
  let projectId: string | undefined;
  if (isNeon) {
    projectId = requireSecret(values, 'EXPECTED_PROJECT_ID', profileName).toLowerCase();
    if (!NEON_PROJECT_ID_PATTERN.test(projectId)) {
      throw new SecretsConfigError(`EXPECTED_PROJECT_ID do perfil ${profileName} não tem o formato esperado de project id do Neon.`);
    }
  } else if (values.EXPECTED_PROJECT_ID !== undefined) {
    throw new SecretsConfigError(`Chave não permitida no perfil ${profileName}: EXPECTED_PROJECT_ID.`);
  }

  return {
    profile: profileName,
    purpose: profile.purpose,
    databaseUrl,
    shadowDatabaseUrl,
    database: parsed.database,
    user: parsed.user,
    secretsFilePath,
    ...(homolog ? { environment: profile.environment, host: parsed.url.hostname.toLowerCase(), clusterId } : {}),
    ...(isNeon ? { projectId } : {}),
    describe: () =>
      `perfil=${profileName} banco=${parsed.database} role=${parsed.user}`,
  };
}

export function redactSecrets(value: string): string {
  return value.replace(/\b(postgres(?:ql)?:\/\/)[^\s@]*@/gi, '$1***@');
}
