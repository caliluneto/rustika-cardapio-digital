import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../integration-db/support/preflight';
import { PENDING_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';

const root = path.join(process.cwd(), 'prisma/migrations');
const name = '20261104000000_runtime_least_privilege';
const rf006Name = '20261110000000_rf006_product_crud_privilege';
const bytes = fs.readFileSync(path.join(root, name, 'migration.sql'));
const sql = bytes.toString('utf8').replace(/--[^\n]*/g, '');

describe('Least privilege (static, not an ACL proof)', () => {
  it('preserves every previous migration and lock bytes', () => {
    for (const m of EXPECTED_MIGRATIONS.filter((m) => m.name !== name)) {
      expect(createHash('sha256').update(fs.readFileSync(path.join(root, m.name, 'migration.sql'))).digest('hex')).toBe(m.checksum);
    }
    expect(createHash('sha256').update(fs.readFileSync(path.join(root, 'migration_lock.toml'))).digest('hex'))
      .toBe('99836963713b4f5b269ad49af0ed3d7b0b2e336115c2f92dc9ac683d139d0900');
  });
  it('is the fifth migration, followed only by the reviewed privilege, RF006 and pending identity migrations', () => {
    const names = fs.readdirSync(root).filter((p) => fs.statSync(path.join(root, p)).isDirectory()).sort();
    expect(names).toEqual([...EXPECTED_MIGRATIONS, ...PENDING_MIGRATIONS].map((m) => m.name));
    expect(names.indexOf(name)).toBe(4);
    expect(names.slice(5)).toEqual([
      '20261105000000_order_status_update_privilege',
      '20261106000000_product_availability_update_privilege',
      rf006Name,
      ...PENDING_MIGRATIONS.map((m) => m.name),
    ]);
  });
  it('uses a transaction and LF with Git byte-preservation', () => {
    expect(sql.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(bytes.includes(13)).toBe(false);
    expect(fs.readFileSync('../.gitattributes', 'utf8')).toContain('backend/prisma/migrations/** -text');
  });
  it.each([
    ['cardapio_digital_test', 'cardapio_test_app', 'cardapio_dev_app'],
    ['cardapio_digital_dev', 'cardapio_dev_app', 'cardapio_test_app'],
  ])('selects only the matching runtime for %s', (database, target, other) => {
    expect(sql).toContain(`current_database() = '${database}' THEN\n    target_role := '${target}';\n    other_role := '${other}';`);
  });
  it('fails closed for shadow, arbitrary databases, roles and memberships', () => {
    expect(sql).toContain("RAISE EXCEPTION 'Unauthorized database'");
    expect(sql).toContain("current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'");
    expect(sql).toContain('pg_auth_members');
    expect(sql).toContain('rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls');
    expect(sql).toContain('a.attacl IS NOT NULL');
  });
  it('requires all tables, migration metadata and sequence', () => {
    for (const table of ['admins','categories','products','comandas','comanda_invitations','comanda_sessions','orders','order_items','order_status_history','_prisma_migrations','orders_order_number_seq']) expect(sql).toContain(`'${table}'`);
    expect(sql).toContain('to_regclass');
  });
  it('resets table, sequence, schema and database ACLs including PUBLIC and opposite runtime', () => {
    for (const object of ['ALL TABLES IN SCHEMA public', 'ALL SEQUENCES IN SCHEMA public', 'TABLE public._prisma_migrations', 'SCHEMA public', 'DATABASE %I']) {
      expect(sql).toContain(`REVOKE ALL ON ${object} FROM PUBLIC, %I, %I`);
    }
  });
  it.each(['TABLES', 'SEQUENCES'])('removes global AND schema defaults on %s', (object) => {
    for (const scope of ['', ' IN SCHEMA public']) expect(sql).toContain(`ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator${scope} REVOKE ALL ON ${object} FROM PUBLIC, %I, %I`);
  });
  it('grants exactly the reviewed matrix, never to PUBLIC, other role or fixtures', () => {
    const grants = [...sql.matchAll(/'GRANT ([^']+)'/g)].map((m) => m[1]);
    expect(grants).toEqual([
      'CONNECT ON DATABASE %I TO %I', 'USAGE ON SCHEMA public TO %I',
      'SELECT ON TABLE public.admins, public.categories, public.products TO %I',
      'SELECT, INSERT ON TABLE public.orders, public.order_items, public.order_status_history, public.comanda_sessions TO %I',
      'SELECT, INSERT, UPDATE ON TABLE public.comandas, public.comanda_invitations TO %I',
      'USAGE ON SEQUENCE public.orders_order_number_seq TO %I',
    ]);
    for (const line of sql.split('\n').filter((l) => l.includes("'GRANT "))) expect(line).toMatch(/, target_role\);$/);
    expect(sql).not.toMatch(/GRANT[^']*(ALL|DELETE|TRUNCATE|CREATE|WITH GRANT OPTION)/);
    expect(sql).not.toMatch(/CREATE ROLE|DROP |INSERT INTO|UPDATE public|DELETE FROM/);
  });
});
