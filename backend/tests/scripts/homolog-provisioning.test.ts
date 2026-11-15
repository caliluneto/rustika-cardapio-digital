import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOMOLOG_PROFILES, HOMOLOG_SQL_FILES, runHomologPreflight } from '../../scripts/homolog/preflight';

const sqlDir = path.join(process.cwd(), 'ops', 'homolog', 'sql');
const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');
const read = (file: string) => fs.readFileSync(path.join(sqlDir, file), 'utf8');
const stripComments = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const withoutStrings = (sql: string) => sql.replace(/'[^']*'/g, "''");

describe('scripts SQL de provisionamento da homologação (validação estática, nada é executado)', () => {
  it('existem exatamente os nove scripts previstos (mais o subdiretório neon/, específico do provedor)', () => {
    const entries = fs.readdirSync(sqlDir, { withFileTypes: true });
    expect(entries.filter((e) => e.isFile()).map((e) => e.name).sort()).toEqual([...HOMOLOG_SQL_FILES].sort());
    expect(HOMOLOG_SQL_FILES).toHaveLength(9);
    expect(entries.filter((e) => e.isDirectory()).map((e) => e.name)).toEqual(['neon']);
    expect(fs.readdirSync(path.join(sqlDir, 'neon')).sort()).toEqual([
      '01-grant-set-true-migrator.sql', '01b-elevate-inherit-for-rename.sql', '02-revoke-set-true-migrator.sql',
      '03-verify-ownership.sql', 'README.md',
    ]);
  });

  it('todos abortam no primeiro erro e são marcados como não executados', () => {
    for (const file of HOMOLOG_SQL_FILES) {
      const sql = read(file);
      expect(sql, file).toMatch(/\\set ON_ERROR_STOP on/);
      expect(sql.split('\n')[0], file).toMatch(/NAO EXECUTADO/);
    }
  });

  it('nenhum script contém senha, DROP, TRUNCATE, DELETE, ALTER SYSTEM ou superusuário', () => {
    for (const file of HOMOLOG_SQL_FILES) {
      const code = stripComments(read(file));
      expect(code, file).not.toMatch(/PASSWORD\s*'/i);
      expect(withoutStrings(code), file).not.toMatch(/(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+SYSTEM)/i);
      expect(code, file).not.toMatch(/(?<!NO)SUPERUSER|(?<!NO)CREATEROLE|(?<!NO)CREATEDB|(?<!NO)BYPASSRLS|(?<!NO)REPLICATION/);
    }
  });

  it('só o script 02 cria banco e só o 01 cria roles; ambos recusam sobrescrever', () => {
    for (const file of HOMOLOG_SQL_FILES) {
      const code = stripComments(read(file));
      expect(/CREATE DATABASE/.test(code), file).toBe(file === '02-create-replay-database.sql');
      expect(/CREATE ROLE/.test(code), file).toBe(file === '01-cluster-roles.sql');
    }
    expect(read('02-create-replay-database.sql')).toMatch(/\if :refuse[\s\S]*\quit[\s\S]*\endif[\s\S]*CREATE DATABASE/);
    expect(read('01-cluster-roles.sql')).toMatch(/IF EXISTS \(SELECT 1 FROM pg_database[\s\S]*RAISE EXCEPTION 'ABORT/);
    expect(read('01-cluster-roles.sql')).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles[\s\S]*RAISE EXCEPTION 'ABORT/);
  });

  it('o banco transitório usa o nome que as migrations exigem e NUNCA é o banco definitivo; o rename é o único ponto de troca de nome', () => {
    expect(stripComments(read('02-create-replay-database.sql'))).toMatch(/CREATE DATABASE cardapio_digital_test OWNER cardapio_migrator/);
    for (const file of HOMOLOG_SQL_FILES) {
      const code = stripComments(read(file));
      expect(/ALTER DATABASE[^;]*RENAME TO cardapio_digital_homolog/.test(code), file).toBe(file === '04-finalize-rename.sql');
      expect(/CREATE DATABASE cardapio_digital_(dev|shadow|homolog)/.test(code), file).toBe(false);
    }
    const rename = stripComments(read('04-finalize-rename.sql'));
    expect(rename).toMatch(/ALTER ROLE cardapio_test_app RENAME TO cardapio_homolog_app/);
    expect(rename).toMatch(/ALTER ROLE cardapio_migrator RENAME TO cardapio_homolog_migrator/);
    expect(rename).toMatch(/ALTER ROLE cardapio_dev_app RENAME TO cardapio_homolog_placeholder/);
    expect(rename).toMatch(/pg_stat_activity/); // recusa renomear com conexões ativas
    expect(rename).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });

  it('o bootstrap nasce sem login e sem UPDATE/DELETE; a marca do cluster é criada no script 01', () => {
    const roles = stripComments(read('01-cluster-roles.sql'));
    expect(roles).toMatch(/CREATE ROLE cardapio_homolog_bootstrap NOLOGIN/);
    expect(roles).toMatch(/CREATE ROLE cardapio_dev_app NOLOGIN/);
    expect(roles).toMatch(/CREATE ROLE rustika_homolog_marker NOLOGIN/);
    expect(roles).toMatch(/rustika-homolog-cluster:/);
    expect(stripComments(read('05-post-migration-grants.sql'))).toMatch(/GRANT SELECT, INSERT ON TABLE public\.admins TO cardapio_homolog_bootstrap/);
    expect(stripComments(read('05-post-migration-grants.sql'))).not.toMatch(/GRANT[^;]*(UPDATE|DELETE|TRUNCATE)/);
    expect(read('06-bootstrap-window-open.sql')).toMatch(/ALTER ROLE cardapio_homolog_bootstrap LOGIN/);
    expect(read('07-bootstrap-window-close.sql')).toMatch(/ALTER ROLE cardapio_homolog_bootstrap NOLOGIN/);
    expect(read('08-bootstrap-revoke.sql')).toMatch(/REVOKE ALL ON TABLE public\.admins FROM cardapio_homolog_bootstrap/);
  });

  it('os scripts 03 e 09 são somente leitura; o 09 exige a identidade final', () => {
    for (const file of ['03-verify-replay.sql', '09-verify-acl.sql']) {
      const code = stripComments(read(file));
      expect(code, file).toMatch(/BEGIN READ ONLY/);
      expect(code, file).toMatch(/ROLLBACK;/);
      expect(withoutStrings(code), file).not.toMatch(/(GRANT|REVOKE|INSERT|UPDATE|CREATE|ALTER|DELETE)/);
    }
    const final = stripComments(read('09-verify-acl.sql'));
    expect(final).toMatch(/current_database\(\) <> 'cardapio_digital_homolog'/);
    expect(final).toMatch(/cardapio_digital_test', 'cardapio_digital_dev', 'cardapio_digital_shadow'/);
  });

  it('nenhum script aplica a identidade de Dev/Test/Shadow como banco definitivo', () => {
    for (const file of ['05-post-migration-grants.sql', '08-bootstrap-revoke.sql', '09-verify-acl.sql']) {
      const code = stripComments(read(file));
      expect(code, file).toMatch(/cardapio_digital_homolog/);
      expect(code, file).not.toMatch(/current_database\(\) (=|<>) 'cardapio_digital_(dev|test|shadow)'/);
    }
  });
});

describe('proteção da renomeação', () => {
  it('o 04 exige o banco postgres, recusa role conectada, sessões, transações preparadas e slots', () => {
    const code = stripComments(read('04-finalize-rename.sql'));
    expect(code).toMatch(/current_database\(\) <> 'postgres'/);
    expect(code).toMatch(/current_user IN \('cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app'\)/);
    expect(code).toMatch(/session_user IN \('cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app'\)/);
    expect(code).toMatch(/pg_stat_activity WHERE datname = 'cardapio_digital_test' AND pid <> pg_backend_pid\(\)/);
    expect(code).toMatch(/pg_prepared_xacts WHERE database = 'cardapio_digital_test'/);
    expect(code).toMatch(/pg_replication_slots WHERE database = 'cardapio_digital_test'/);
    expect(code.indexOf('current_database()')).toBeLessThan(code.indexOf('ALTER DATABASE'));
    expect(code.indexOf('pg_replication_slots')).toBeLessThan(code.indexOf('ALTER DATABASE'));
  });

  it('o 03 verifica ownership, ACL, memberships, configurações por role/banco e a ausência de SQL armazenado', () => {
    const code = stripComments(read('03-verify-replay.sql'));
    for (const needle of ['datdba', 'relowner', 'nspowner', 'typowner', 'pg_auth_members', 'pg_db_role_setting', 'pg_policy', 'pg_event_trigger', 'pg_proc', 'has_table_privilege', 'has_column_privilege']) {
      expect(code, needle).toContain(needle);
    }
  });

  it('Neon: o 03 tolera somente a linha ADMIN-only automática do criador (PostgreSQL >= 16) e continua recusando SET/INHERIT', () => {
    const code = stripComments(read('03-verify-replay.sql'));
    expect(code).toContain('grantor_role.rolsuper');
    expect(code).toContain('m.admin_option');
    expect(code).toContain('NOT m.set_option');
    expect(code).toContain('NOT m.inherit_option');
    expect(code).toContain("member_role.rolname NOT LIKE 'cardapio\\_%'");
  });

  it('o script de CI mantém as pastas TLS atravessáveis pelo uid 999 do container (senão o PostgreSQL não lê a chave)', () => {
    const start = fs.readFileSync(path.join(process.cwd(), 'ops', 'homolog', 'ci', 'start-ephemeral-postgres.sh'), 'utf8');
    expect(start).toMatch(/chmod 755 "\$\{WORK\}" "\$\{WORK\}\/tls"/);
    expect(start).toMatch(/sudo chown "\$\{PG_UID\}:\$\{PG_UID\}" "\$\{WORK\}\/tls\/server\.key"/);
    expect(start).toMatch(/chmod 600 "\$\{WORK\}\/tls\/server\.key"/);
    // Nenhum chmod do material TLS pode vir DEPOIS do chown (o runner deixa de ser dono e o chmod falha).
    const lines = start.split('\n');
    const chownAt = lines.findIndex((line) => /^\s*sudo chown /.test(line));
    expect(chownAt).toBeGreaterThan(-1);
    const chmodOfTlsFiles = (line: string) => /^\s*chmod\s+\d+\s+.*tls\/(server\.key|server\.crt)/.test(line);
    lines.forEach((line, index) => { if (chmodOfTlsFiles(line)) expect(index, `chmod após chown: ${line}`).toBeLessThan(chownAt); });
    expect(start).toMatch(/stat -c '%u:%a' "\$\{WORK\}\/tls\/server\.key"/);
    expect(start).not.toMatch(/chmod\s+(777|666|755|644)\s+[^\n]*server\.key/);
  });

  it('a cópia temporária da 8ª migration fica em <tmp>/<dir>/backend (a pasta de segredos precisa ficar fora do workspace)', () => {
    const suite = fs.readFileSync(path.join(process.cwd(), 'tests', 'homolog-ephemeral', 'provisioning.ephemeral.ts'), 'utf8');
    expect(suite).toMatch(/const copy = path\.join\(copyRoot, 'backend'\)/);
  });
});

describe('suíte efêmera preparada', () => {
  const file = fs.readFileSync(path.join(process.cwd(), 'tests', 'homolog-ephemeral', 'provisioning.ephemeral.ts'), 'utf8');
  it('só roda com URL e confirmação explícitas, aborta em servidor não vazio e não entra nas suítes padrão', () => {
    expect(file).toMatch(/RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM === 'RUN_ON_EPHEMERAL_POSTGRES'/);
    expect(file).toMatch(/describe\.skipIf\(!ENABLED\)/);
    expect(file).toContain("LIKE 'cardapio\\\\_%'");
    const config = fs.readFileSync(path.join(process.cwd(), 'vitest.homolog-ephemeral.config.mts'), 'utf8');
    expect(config).toMatch(/\*\*\/\*\.ephemeral\.ts/);
    expect('provisioning.ephemeral.ts').not.toMatch(/\.test\.ts$/);
    expect(fs.readFileSync(path.join(process.cwd(), 'vitest.unit.config.mts'), 'utf8')).not.toMatch(/ephemeral/);
  });
});

describe('pré-voo offline da homologação', () => {
  const temps: string[] = [];
  afterEach(() => { while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true }); });
  const DATABASES: Record<string, string> = { 'app-homolog': 'cardapio_digital_homolog', 'migrate-homolog': 'cardapio_digital_homolog', 'bootstrap-homolog': 'cardapio_digital_homolog', 'migrate-homolog-replay': 'cardapio_digital_test' };
  const secrets = (users: Record<string, string>, host = 'db-homolog.exemplo.invalid', cluster = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10', password = (user: string) => `Senha-Unica-${user}-1234567890-ZZ`) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-pre-')); temps.push(dir);
    for (const profile of HOMOLOG_PROFILES) {
      const user = users[profile]!;
      fs.writeFileSync(path.join(dir, `${profile}.env`), `DATABASE_URL="postgresql://${user}:${password(user)}@${host}:5432/${DATABASES[profile]}?sslmode=verify-full"\nEXPECTED_DATABASE_HOST="${host}"\nEXPECTED_CLUSTER_ID="${cluster}"\n`, { mode: 0o600 });
    }
    return dir;
  };
  const USERS = { 'app-homolog': 'cardapio_homolog_app', 'migrate-homolog': 'cardapio_homolog_migrator', 'bootstrap-homolog': 'cardapio_homolog_bootstrap', 'migrate-homolog-replay': 'cardapio_migrator' };

  it('aprova uma configuração íntegra sem abrir conexão', () => {
    const findings = runHomologPreflight({ secretsDir: secrets(USERS), migrationsDir, sqlDir });
    expect(findings.filter((f) => f.level === 'FAIL')).toEqual([]);
    expect(findings.map((f) => f.code)).toEqual(expect.arrayContaining(['SAME_TARGET', 'DISTINCT_PASSWORDS', 'PASSWORD_LENGTH', 'MIGRATIONS', 'SQL_FILES']));
    expect(JSON.stringify(findings)).not.toContain('Senha-Unica');
  });

  it('reprova senha repetida entre roles, senha curta e arquivos ausentes', () => {
    const same = runHomologPreflight({ secretsDir: secrets(USERS, undefined, undefined, () => 'Mesma-Senha-Longa-1234567890-ZZ'), migrationsDir, sqlDir });
    expect(same.find((f) => f.code === 'DISTINCT_PASSWORDS')?.level).toBe('FAIL');
    const short = runHomologPreflight({ secretsDir: secrets(USERS, undefined, undefined, (u) => `${u.slice(-3)}Abc1!xyz`), migrationsDir, sqlDir });
    expect(short.find((f) => f.code === 'PASSWORD_LENGTH')?.level).toBe('FAIL');
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-pre-')); temps.push(empty);
    const none = runHomologPreflight({ secretsDir: empty, migrationsDir: empty, sqlDir: empty });
    expect(none.filter((f) => f.level === 'FAIL').length).toBeGreaterThanOrEqual(5);
  });
});
