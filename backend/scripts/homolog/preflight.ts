import fs from 'node:fs';
import path from 'node:path';
import { loadDatabaseProfile } from '../../src/config/secrets';
import type { DatabaseSecrets } from '../../src/config/secrets';
import { verifyMigrationDirectory } from '../bootstrap/migrationIntegrity';

export const HOMOLOG_PROFILES = ['app-homolog', 'migrate-homolog', 'bootstrap-homolog', 'migrate-homolog-replay'] as const;
export const HOMOLOG_SQL_FILES = [
  '01-cluster-roles.sql', '02-create-replay-database.sql', '03-verify-replay.sql', '04-finalize-rename.sql', '05-post-migration-grants.sql',
  '06-bootstrap-window-open.sql', '07-bootstrap-window-close.sql', '08-bootstrap-revoke.sql', '09-verify-acl.sql',
] as const;
export const MIN_HOMOLOG_PASSWORD_LENGTH = 24;

export interface PreflightFinding { level: 'FAIL' | 'OK'; code: string; message: string }

export interface PreflightInputs {
  secretsDir: string;
  migrationsDir: string;
  sqlDir: string;
  loadProfile?: typeof loadDatabaseProfile;
}

function passwordOf(database: DatabaseSecrets): string {
  return decodeURIComponent(new URL(database.databaseUrl).password);
}

/**
 * Verificação OFFLINE (nenhuma conexão): perfis, segredos, integridade das migrations e presença dos scripts SQL.
 * Nunca imprime senha: apenas perfis, comprimentos de classe e códigos.
 */
export function runHomologPreflight(input: PreflightInputs): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const add = (level: PreflightFinding['level'], code: string, message: string): void => { findings.push({ level, code, message }); };
  const load = input.loadProfile ?? loadDatabaseProfile;
  const loaded: DatabaseSecrets[] = [];

  for (const profile of HOMOLOG_PROFILES) {
    try {
      loaded.push(load(profile, { secretsDir: input.secretsDir }));
      add('OK', `PROFILE_${profile}`, `perfil ${profile} válido (TLS, host remoto, identidade de homologação).`);
    } catch (error) {
      add('FAIL', `PROFILE_${profile}`, error instanceof Error ? error.message : 'perfil inválido.');
    }
  }

  if (loaded.length === HOMOLOG_PROFILES.length) {
    // O replay e o banco definitivo são o MESMO cluster: mesmo host e mesmo EXPECTED_CLUSTER_ID; os bancos diferem (transitório × definitivo).
    if (new Set(loaded.map((item) => `${item.host}|${item.clusterId}`)).size !== 1) add('FAIL', 'SAME_TARGET', 'Os quatro perfis devem apontar para o mesmo host e o mesmo EXPECTED_CLUSTER_ID.');
    else add('OK', 'SAME_TARGET', 'Os quatro perfis apontam para o mesmo cluster (host e marca).');
    const byProfile = new Map(loaded.map((item) => [item.profile, passwordOf(item)]));
    const app = byProfile.get('app-homolog')!; const migrator = byProfile.get('migrate-homolog')!;
    const bootstrap = byProfile.get('bootstrap-homolog')!; const replay = byProfile.get('migrate-homolog-replay')!;
    // O replay usa a role que depois é renomeada para o migrator definitivo: a senha pode coincidir com a dele, nunca com as demais.
    if (new Set([app, migrator, bootstrap]).size !== 3 || replay === app || replay === bootstrap) add('FAIL', 'DISTINCT_PASSWORDS', 'Cada role deve ter uma senha distinta (o replay pode repetir a do migrator definitivo).');
    else add('OK', 'DISTINCT_PASSWORDS', 'Senhas distintas por role.');
    if ([app, migrator, bootstrap, replay].some((password) => password.length < MIN_HOMOLOG_PASSWORD_LENGTH)) add('FAIL', 'PASSWORD_LENGTH', `Cada senha deve ter ao menos ${MIN_HOMOLOG_PASSWORD_LENGTH} caracteres.`);
    else add('OK', 'PASSWORD_LENGTH', `Todas as senhas têm ao menos ${MIN_HOMOLOG_PASSWORD_LENGTH} caracteres.`);
  }

  const migrationProblems = verifyMigrationDirectory(input.migrationsDir);
  if (migrationProblems.length > 0) add('FAIL', 'MIGRATIONS', migrationProblems.join(' '));
  else add('OK', 'MIGRATIONS', 'As sete migrations históricas existem e os checksums coincidem.');

  const missing = HOMOLOG_SQL_FILES.filter((file) => !fs.existsSync(path.join(input.sqlDir, file)));
  if (missing.length > 0) add('FAIL', 'SQL_FILES', `Scripts SQL ausentes: ${missing.join(', ')}.`);
  else add('OK', 'SQL_FILES', 'Scripts de provisionamento presentes.');
  return findings;
}
