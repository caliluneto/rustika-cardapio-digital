import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sqlDir = path.join(process.cwd(), 'docs', 'sql');
const read = (name: string) => fs.readFileSync(path.join(sqlDir, name), 'utf8');
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

const provision = read('provision-test-fixtures.sql');
const enable = read('enable-test-fixtures-login.sql');
const rollback = read('rollback-test-fixtures.sql');
const verify = read('verify-test-fixtures.sql');
const docs = fs.readFileSync(path.join(process.cwd(), 'docs', 'fixture-role.md'), 'utf8');
const hba = read('pg_hba-test-fixtures.conf.example');

describe('provisão da role de fixtures (estática; nada foi executado)', () => {
  it('só age em cardapio_digital_test, com identidade e cluster verificados', () => {
    for (const sql of [provision, enable, rollback]) {
      expect(sql).toContain("current_database() <> 'cardapio_digital_test'");
      expect(sql).toContain('current_user <> session_user');
      expect(sql).toContain('rolsuper');
      expect(sql).toContain("inet_server_addr() NOT IN ('127.0.0.1', '::1')");
    }
    expect(provision).toContain("migration_name = '20261104000000_runtime_least_privilege'");
    expect(provision).toContain("db_owner <> 'cardapio_migrator'");
  });

  it('cria a role com atributos mínimos e sem senha/credencial versionada', () => {
    for (const attribute of ['NOLOGIN', 'NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOINHERIT', 'NOBYPASSRLS', 'NOREPLICATION', 'CONNECTION LIMIT 2']) {
      expect(provision).toContain(attribute);
    }
    expect(provision).not.toMatch(/PASSWORD\s+'/i);
    expect(provision).not.toMatch(/postgres(?:ql)?:\/\/[^\s@]+:[^\s@]+@/i);
    expect(enable.split('\n').some((line) => line.trim().startsWith('\\password'))).toBe(false);
    expect(enable).toContain('pg_authid');
    expect(docs).toContain('\\password cardapio_test_fixtures');
    expect(enable).not.toMatch(/PASSWORD\s+'/i);
  });

  it('aplica exatamente a matriz aprovada, sem PUBLIC, TRUNCATE, CREATE ou sequência', () => {
    const grants = [...provision.matchAll(/^GRANT ([\s\S]*?);$/gm)].map((match) => match[1]!.trim());
    expect(grants).toEqual([
      'CONNECT ON DATABASE cardapio_digital_test TO cardapio_test_fixtures',
      'USAGE ON SCHEMA public TO cardapio_test_fixtures',
      'SELECT, INSERT, DELETE ON TABLE public.admins, public.categories\n  TO cardapio_test_fixtures',
      'SELECT, INSERT, UPDATE, DELETE ON TABLE public.products, public.comandas\n  TO cardapio_test_fixtures',
      'SELECT, INSERT, DELETE ON TABLE public.comanda_invitations, public.comanda_sessions\n  TO cardapio_test_fixtures',
      'SELECT, DELETE ON TABLE public.orders, public.order_items, public.order_status_history\n  TO cardapio_test_fixtures',
    ]);
    expect(provision).not.toMatch(/GRANT[^;]*(PUBLIC|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN|CREATE|ALL)/s);
    expect(provision).not.toMatch(/GRANT[^;]*orders_order_number_seq/s);
    expect(provision).not.toMatch(/GRANT[^;]*_prisma_migrations/s);
    expect(provision).not.toMatch(/GRANT[^;]*(cardapio_digital_dev|cardapio_digital_shadow)/s);
  });

  // 3D.3.11: Dev/Shadow já não concedem CONNECT a PUBLIC, mas postgres, template1 e bancos de
  // outros projetos concedem. O isolamento passou a ser pg_hba, exigido no passo de LOGIN.
  it('provisão NOLOGIN não aborta por CONNECT herdado, mas recusa concessão explícita fora de Test', () => {
    const body = stripComments(provision);
    expect(body).not.toMatch(/has_database_privilege\('cardapio_test_fixtures', 'cardapio_digital_(dev|shadow)', 'CONNECT'\)/);
    expect(body).toContain("d.datname <> 'cardapio_digital_test'");
    expect(body).toContain("a.grantee = 'cardapio_test_fixtures'::regrole");
    expect(body).toContain('banco_conectavel_via_public');
  });

  it('LOGIN só é habilitado com pg_hba recusando a role fora de Test (primeira regra vence)', () => {
    const body = stripComments(enable);
    expect(body).toContain('pg_hba_file_rules WHERE error IS NOT NULL');
    expect(body).toContain("(pg_stat_file(current_setting('hba_file'))).modification > pg_conf_load_time()");
    expect(body).toMatch(/u LIKE '\+%' OR u LIKE '\/%'/);
    expect(body).toContain("database <> ARRAY['cardapio_digital_test']");
    expect(body).toContain("auth_method <> 'scram-sha-256'");
    expect(body).toContain("NOT IN ('127.0.0.1', '::1')");
    for (const reject of ["type = 'local'", "address IN ('127.0.0.1', 'all')", "address IN ('::1', 'all')"]) expect(body).toContain(reject);
    expect(body).toContain("'all' = ANY(user_name)");
    expect(body).toContain('first_generic < last_reject');
    // O bloco de pg_hba roda antes de ALTER ROLE ... LOGIN.
    expect(body.indexOf('pg_hba_file_rules')).toBeLessThan(body.indexOf('ALTER ROLE cardapio_test_fixtures LOGIN'));
  });

  it('exemplo de pg_hba: permissão só para Test por SCRAM em loopback e recusa de "all"', () => {
    const lines = hba.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => line.trim().split(/\s+/));
    expect(lines).toEqual([
      ['host', 'cardapio_digital_test', 'cardapio_test_fixtures', '127.0.0.1/32', 'scram-sha-256'],
      ['host', 'cardapio_digital_test', 'cardapio_test_fixtures', '::1/128', 'scram-sha-256'],
      ['local', 'all', 'cardapio_test_fixtures', 'reject'],
      ['host', 'all', 'cardapio_test_fixtures', '127.0.0.1/32', 'reject'],
      ['host', 'all', 'cardapio_test_fixtures', '::1/128', 'reject'],
    ]);
    expect(hba).toContain('pg_reload_conf()');
    expect(hba).not.toMatch(/password\s*[=:]/i);
  });

  it('verificação e rollback cobrem qualquer banco, não só Dev/Shadow', () => {
    expect(verify).toContain('pg_hba_file_rules');
    expect(verify).toContain("connect:missing:cardapio_digital_test");
    expect(stripComments(verify)).not.toMatch(/'connect:' \|\| d\.datname/);
    expect(rollback).toContain("FOR db IN SELECT DISTINCT d.datname FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a");
    expect(rollback).toContain('pg_reload_conf()');
    expect(docs).toContain('pg_hba');
    expect(docs).toContain('SET ROLE');
    expect(docs).toContain('são aditivos');
  });

  it('verificação é somente leitura e cobre as violações relevantes', () => {
    const body = stripComments(verify);
    expect(body).not.toMatch(/(^|;)\s*(GRANT|REVOKE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/im);
    expect(body).toContain("'cardapio_test_fixtures'::regrole");
    expect(body).toContain('has_table_privilege');
    expect(body).toContain('has_sequence_privilege');
    expect(body).toContain('pg_default_acl');
    expect(body).toContain('pg_auth_members');
    expect(body).toContain('Violações da matriz');
  });

  it('rollback revoga antes de remover e não usa DROP OWNED BY', () => {
    expect(rollback).toContain('REVOKE ALL ON DATABASE cardapio_digital_test FROM cardapio_test_fixtures');
    expect(rollback).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cardapio_test_fixtures');
    expect(rollback).toContain('DROP ROLE cardapio_test_fixtures');
    expect(stripComments(rollback)).not.toContain('DROP OWNED BY');
    expect(rollback).toContain("deptype = 'o'");
  });
});
