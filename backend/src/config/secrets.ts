import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

export type ProfilePurpose = 'runtime' | 'migration';
export type RequestedPurpose = ProfilePurpose | 'any';

export interface ProfileDefinition {
  purpose: ProfilePurpose;
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
  describe: () => string;
}

export interface LoadDatabaseProfileOptions {
  purpose?: RequestedPurpose;
  secretsDir?: string;
}

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsConfigError';
  }
}

const ALLOWED_KEYS = new Set(['DATABASE_URL', 'SHADOW_DATABASE_URL']);
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

  if (purpose !== 'runtime' && purpose !== 'migration') {
    throw new SecretsConfigError(
      `Finalidade inválida no perfil ${name}. Use runtime ou migration.`,
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
    profiles[name] = asProfileDefinition(name, value);
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
): ParsedPostgresUrl {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} não é uma URL válida.`,
    );
  }

  if (url.protocol !== 'postgresql:') {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} deve usar o esquema postgresql://.`,
    );
  }

  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new SecretsConfigError(
      `${key} do perfil ${profileName} deve usar 127.0.0.1 ou localhost.`,
    );
  }

  if (url.port !== POSTGRES_PORT) {
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

  if (requestedPurpose !== 'any' && profile.purpose !== requestedPurpose) {
    throw new SecretsConfigError(
      requestedPurpose === 'runtime'
        ? `O perfil ${profileName} é de migração e não pode ser usado pelo backend em execução.`
        : `O perfil ${profileName} é de aplicação e não pode ser usado para migrações.`,
    );
  }

  const secretsDir = options.secretsDir ?? resolveSecretsDir();
  const secretsFilePath = path.join(secretsDir, `${profileName}.env`);

  if (!fs.existsSync(secretsFilePath)) {
    throw new SecretsConfigError(
      `Arquivo de segredo ausente para o perfil ${profileName}: ${secretsFilePath}.`,
    );
  }

  let values: Record<string, string>;

  try {
    values = dotenv.parse(fs.readFileSync(secretsFilePath, 'utf8'));
  } catch {
    throw new SecretsConfigError(
      `Não foi possível ler o arquivo de segredo do perfil ${profileName}.`,
    );
  }

  for (const key of Object.keys(values)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new SecretsConfigError(
        `Chave não permitida no perfil ${profileName}: ${key}.`,
      );
    }
  }

  const databaseUrl = requireSecret(values, 'DATABASE_URL', profileName);
  const parsed = parsePostgresUrl(databaseUrl, profileName, 'DATABASE_URL');
  assertMatchesProfile(parsed, profile, profileName, 'DATABASE_URL');

  if (profile.purpose === 'runtime' && values.SHADOW_DATABASE_URL !== undefined) {
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

  return {
    profile: profileName,
    purpose: profile.purpose,
    databaseUrl,
    shadowDatabaseUrl,
    database: parsed.database,
    user: parsed.user,
    secretsFilePath,
    describe: () =>
      `perfil=${profileName} banco=${parsed.database} role=${parsed.user}`,
  };
}

export function redactSecrets(value: string): string {
  return value.replace(/\b(postgres(?:ql)?:\/\/)[^\s@]*@/gi, '$1***@');
}
