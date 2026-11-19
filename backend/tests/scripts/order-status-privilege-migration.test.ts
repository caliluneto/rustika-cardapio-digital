import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../integration-db/support/preflight';
import { PENDING_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import { PERMISSIONS_SQL } from '../integration-db/support/permissions';

const root = path.join(process.cwd(), 'prisma/migrations');
const name = '20261105000000_order_status_update_privilege';
const bytes = fs.readFileSync(path.join(root, name, 'migration.sql'));
const raw = bytes.toString('utf8');
const sql = raw.replace(/--[^\n]*/g, '');

describe('3D.4.1 order status update privilege (static; migration NOT applied, not an ACL proof)', () => {
  it('is pinned by checksum, last in order, and previous migrations are untouched', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(EXPECTED_MIGRATIONS.find((m) => m.name === name)?.checksum);
    const names = fs.readdirSync(root).filter((p) => fs.statSync(path.join(root, p)).isDirectory()).sort();
    expect(names.indexOf(name)).toBe(5); // a 7ª (3D.4.2) é a última
    for (const m of EXPECTED_MIGRATIONS) {
      expect(createHash('sha256').update(fs.readFileSync(path.join(root, m.name, 'migration.sql'))).digest('hex')).toBe(m.checksum);
    }
  });

  it('mantém o baseline exato de oito migrations e reconhece a migration de identidade apenas como pendente', () => {
    expect(EXPECTED_MIGRATIONS).toEqual([
      { name: '20261023000000_initial_schema', checksum: '1a9cd08b9d49fa9f70eabcceaa4a696f5aee07555f6a88562ec789340f0d3983' },
      { name: '20261027000000_rf004_comandas_catalogo_pedidos', checksum: '05f583e854a87b77612c2f7d10a0a178ef45ea099d3237808b5bf0bd7c698122' },
      { name: '20261031000000_rf004_fix_permissions', checksum: '960766a8fb1576e6094622f112e1a3a9cd7455f56907a3405a8fbb183959e10b' },
      { name: '20261102000000_update_products_source_identity_constraint', checksum: '885b8de5dcc0cf5e7618d574ba5c013ae8b60c9b983260706c5819422564454f' },
      { name: '20261104000000_runtime_least_privilege', checksum: '24471ed369980bc861d885dc68d9edd3747de73457be620d166eae8b1ec47d6e' },
      { name: '20261105000000_order_status_update_privilege', checksum: '3d6a7a6d0ce3f595501dc6343c19858beb2b9fecd1ebe1fd1fbecf5603031d84' },
      { name: '20261106000000_product_availability_update_privilege', checksum: '3665ed812c4033527d17c6de3a7c66a623d659d676c719fc1b6f6477f7e69308' },
      { name: '20261110000000_rf006_product_crud_privilege', checksum: 'b3feb0dfca618498219161ec91f11b4edff9700de5386e452edf67eadf41561e' },
    ]);
    const onDisk = fs.readdirSync(root).filter((p) => fs.statSync(path.join(root, p)).isDirectory()).sort();
    expect(PENDING_MIGRATIONS).toEqual([
      { name: '20261114000000_product_insert_identity_columns', checksum: '6a533537645a8b2f3c14af2c863697cbe9bfdec034319971b50020fe134318c9' },
      { name: '20261119000000_category_crud_privilege', checksum: '975044f0f5a033e3202f19b014d64c449714973d917737b4ea30ac11032020a7' },
    ]);
    expect(onDisk).toEqual([...EXPECTED_MIGRATIONS, ...PENDING_MIGRATIONS].map((m) => m.name));
  });

  it('is transactional, LF-only and sets a fixed search_path', () => {
    expect(sql.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    expect(bytes.includes(13)).toBe(false);
    expect(sql).toContain('SET LOCAL search_path = pg_catalog;');
  });

  it('fails closed for database, identity, version, roles and memberships', () => {
    expect(sql).toContain("RAISE EXCEPTION 'Unauthorized database'");
    expect(sql).toContain("current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'");
    expect(sql).toContain("current_setting('server_version_num')::int < 170000");
    expect(sql).toContain('pg_auth_members');
    expect(sql).toContain('rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls');
    expect(sql).toContain("current_database() = 'cardapio_digital_test' THEN\n    target_role := 'cardapio_test_app';");
    expect(sql).toContain("current_database() = 'cardapio_digital_dev' THEN\n    target_role := 'cardapio_dev_app';");
  });

  it('requires the least-privilege migration state first (no column ACL, no UPDATE/DELETE on orders yet)', () => {
    expect(sql).toContain('a.attacl IS NOT NULL');
    expect(sql).toContain("has_table_privilege(target_role, 'public.orders', 'UPDATE')");
    expect(sql).toContain("has_table_privilege(target_role, 'public.orders', 'DELETE')");
    expect(sql).toContain('apply 20261104000000_runtime_least_privilege first');
  });

  it('grants exactly one thing: column UPDATE (status, updated_at) on orders to the runtime role', () => {
    const executes = [...sql.matchAll(/EXECUTE format\('([^']+)'/g)].map((m) => m[1]);
    expect(executes).toEqual(['GRANT UPDATE (status, updated_at) ON TABLE public.orders TO %I']);
    expect(executes[0]).not.toMatch(/\bALL\b|DELETE|TRUNCATE|CREATE|REFERENCES|TRIGGER|INSERT|GRANT OPTION/i);
    expect(executes[0]).toMatch(/ TO %I$/); // grantee is only the runtime role, never PUBLIC/fixtures/other role
    expect(sql).not.toMatch(/GRANT UPDATE ON/);
    expect(sql).not.toMatch(/CREATE ROLE|ALTER ROLE|DROP |ALTER TABLE|CREATE TABLE|INSERT INTO|UPDATE public|DELETE FROM|TRUNCATE |ALTER DEFAULT/i);
  });

  it('verifies the postcondition in the same transaction (aborts and rolls back on any deviation)', () => {
    const post = sql.slice(sql.indexOf('EXECUTE format'));
    for (const fragment of [
      "has_column_privilege(target_role, 'public.orders', 'status', 'UPDATE')",
      "has_column_privilege(target_role, 'public.orders', 'updated_at', 'UPDATE')",
      "has_table_privilege(target_role, 'public.orders', 'TRUNCATE')",
      'UPDATE WITH GRANT OPTION',
      "a.attname NOT IN ('status', 'updated_at')",
      'has_any_column_privilege',
      "RAISE EXCEPTION 'Unexpected privileges after granting orders status update'",
    ]) expect(post).toContain(fragment);
  });

  it('uses only real column names from the Prisma schema', () => {
    const schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const model = /model Order \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? '';
    expect(model).toMatch(/status\s+OrderStatus[^\n]*/);
    expect(model).toMatch(/updatedAt\s+DateTime[^\n]*@map\("updated_at"\)/);
  });

  it('keeps the ACL gate strict: the permissions matrix only tolerates the reviewed column ACL', () => {
    expect(PERMISSIONS_SQL).toContain("('cardapio_test_app','orders','SELECT,INSERT')");
    expect(PERMISSIONS_SQL).toContain("a.attname IN ('status', 'updated_at') AND acl.privilege_type = 'UPDATE' AND NOT acl.is_grantable");
    expect(PERMISSIONS_SQL).toContain("has_column_privilege('cardapio_test_fixtures', a.attrelid, a.attnum, 'UPDATE')");
    expect(PERMISSIONS_SQL).toContain('acl.grantee IN (0, r.oid)');
    expect(PERMISSIONS_SQL).toContain("('cardapio_test_fixtures','orders','SELECT,DELETE')");
  });
});
