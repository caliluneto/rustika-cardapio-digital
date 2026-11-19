import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOMOLOG_DEFINITIVE_DATABASE, HOMOLOG_ROLES, loadDatabaseProfile } from '../../src/config/secrets';

const HOST = 'ep-cool-darkness-123456.us-east-2.aws.neon.tech';
const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const PROJECT = 'aged-scene-47291697';
const PASSWORD = 'Fake-Neon-Homolog-Pass-0000-aaaa';
const DEF = HOMOLOG_DEFINITIVE_DATABASE;
const created: string[] = [];

function dirWith(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-neon-homolog-'));
  created.push(directory);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content, { encoding: 'utf8', mode: 0o600 });
  return directory;
}

interface Opts { host?: string; database?: string; user?: string; query?: string; projectId?: string | null; cluster?: string | null }
function env(opts: Opts = {}): string {
  const host = opts.host ?? HOST;
  const user = opts.user ?? HOMOLOG_ROLES.runtime;
  const database = opts.database ?? DEF;
  const query = opts.query ?? 'sslmode=require&sslaccept=strict&channel_binding=require';
  const url = `postgresql://${user}:${PASSWORD}@${host}/${database}?${query}`;
  const project = opts.projectId === undefined ? PROJECT : opts.projectId;
  const cluster = opts.cluster === undefined ? CLUSTER : opts.cluster;
  return `DATABASE_URL="${url}"\nEXPECTED_DATABASE_HOST="${host}"\n${cluster === null ? '' : `EXPECTED_CLUSTER_ID="${cluster}"\n`}${project === null ? '' : `EXPECTED_PROJECT_ID="${project}"\n`}`;
}

afterEach(() => { while (created.length) fs.rmSync(created.pop()!, { recursive: true, force: true }); });

describe('3D.5.3-C.5 (Parte B/C) — perfil app-homolog-neon em loadDatabaseProfile', () => {
  it('carrega com a mesma identidade final de app-homolog, mais o project id', () => {
    const dir = dirWith({ 'app-homolog-neon.env': env() });
    const loaded = loadDatabaseProfile('app-homolog-neon', { purpose: 'runtime', secretsDir: dir });
    expect(loaded).toMatchObject({ profile: 'app-homolog-neon', environment: 'homolog-neon', database: DEF, user: HOMOLOG_ROLES.runtime, clusterId: CLUSTER, projectId: PROJECT });
  });

  it('exige EXPECTED_PROJECT_ID (ausente, formato incorreto, ou presente em outro perfil homolog)', () => {
    expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dirWith({ 'app-homolog-neon.env': env({ projectId: null }) }) })).toThrow(/EXPECTED_PROJECT_ID ausente/);
    for (const bad of ['nao-e-um-project-id', 'ABCDE-12345', 'aged_scene_47291697']) {
      expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dirWith({ 'app-homolog-neon.env': env({ projectId: bad }) }) })).toThrow(/formato esperado de project id/);
    }
  });

  it('recusa EXPECTED_PROJECT_ID em perfis que não são app-homolog-neon', () => {
    const url = `postgresql://${HOMOLOG_ROLES.runtime}:${PASSWORD}@db-homolog.exemplo.invalid:5432/${DEF}?sslmode=require`;
    const content = `DATABASE_URL="${url}"\nEXPECTED_DATABASE_HOST="db-homolog.exemplo.invalid"\nEXPECTED_CLUSTER_ID="${CLUSTER}"\nEXPECTED_PROJECT_ID="${PROJECT}"\n`;
    expect(() => loadDatabaseProfile('app-homolog', { secretsDir: dirWith({ 'app-homolog.env': content }) })).toThrow(/Chave não permitida.*EXPECTED_PROJECT_ID/s);
  });

  it('recusa o endpoint com pooler (-pooler): exige o endpoint direto do Neon', () => {
    const dir = dirWith({ 'app-homolog-neon.env': env({ host: 'ep-cool-darkness-123456-pooler.us-east-2.aws.neon.tech' }) });
    expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dir })).toThrow(/pooler/);
  });

  it('banco ou role diferentes do definitivo continuam recusados, como em app-homolog', () => {
    expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dirWith({ 'app-homolog-neon.env': env({ database: 'neondb' }) }) })).toThrow(/cardapio_digital_homolog/);
    expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dirWith({ 'app-homolog-neon.env': env({ user: 'neondb_owner' }) }) })).toThrow(/usuário cardapio_homolog_app/);
  });

  it('continua exigindo TLS estrito e EXPECTED_CLUSTER_ID, como em app-homolog', () => {
    expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dirWith({ 'app-homolog-neon.env': env({ query: 'schema=public' }) }) })).toThrow(/sslmode/);
    for (const query of [
      'sslmode=verify-full&sslaccept=strict&channel_binding=require',
      'sslmode=prefer&sslaccept=strict&channel_binding=require',
      'sslmode=require&channel_binding=require',
      'sslmode=require&sslaccept=accept_invalid_certs&channel_binding=require',
      'sslmode=require&sslaccept=strict&channel_binding=prefer',
      'sslmode=require&sslaccept=strict&channel_binding=require&sslmode=disable',
      'sslmode=require&sslaccept=strict&channel_binding=require&sslaccept=accept_invalid_certs',
    ]) {
      expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dirWith({ 'app-homolog-neon.env': env({ query }) }) })).toThrow();
    }
    expect(() => loadDatabaseProfile('app-homolog-neon', { secretsDir: dirWith({ 'app-homolog-neon.env': env({ cluster: null }) }) })).toThrow(/EXPECTED_CLUSTER_ID ausente/);
  });
});
