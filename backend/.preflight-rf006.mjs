import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const secretsDir = path.join(process.env.LOCALAPPDATA, 'CardapioDigital', 'secrets');
const file = path.join(secretsDir, 'migrate-dev.env');
const values = {};
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const client = new Client({ connectionString: values.DATABASE_URL, application_name: 'rustika-readonly-preflight' });
await client.connect();
try {
  await client.query('BEGIN TRANSACTION READ ONLY');
  await client.query("SET LOCAL statement_timeout = '8000'");

  const identity = await client.query(`
    SELECT current_database() AS database, current_user AS current_user, session_user AS session_user,
           inet_server_addr()::text AS server_addr, inet_server_port() AS server_port,
           COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
           current_setting('server_version_num')::int AS server_version_num,
           current_setting('server_version') AS server_version,
           version() AS full_version,
           pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database())) AS database_owner`);
  console.log('IDENTITY', JSON.stringify(identity.rows[0]));

  const roles = await client.query(`
    SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin
    FROM pg_roles WHERE rolname IN ('cardapio_migrator','cardapio_dev_app','cardapio_test_app')
    ORDER BY rolname`);
  console.log('ROLES', JSON.stringify(roles.rows));

  const grants = await client.query(`
    SELECT
      has_table_privilege('cardapio_dev_app','public.products','SELECT') AS products_select,
      has_table_privilege('cardapio_dev_app','public.products','INSERT') AS products_insert_table,
      has_table_privilege('cardapio_dev_app','public.products','UPDATE') AS products_update_table,
      has_table_privilege('cardapio_dev_app','public.products','DELETE') AS products_delete_table,
      has_table_privilege('cardapio_dev_app','public.products','TRUNCATE') AS products_truncate,
      has_any_column_privilege('cardapio_dev_app','public.products','INSERT') AS products_insert_any_column,
      has_any_column_privilege('cardapio_dev_app','public.products','UPDATE') AS products_update_any_column,
      has_column_privilege('cardapio_dev_app','public.products','availability_state','UPDATE') AS products_availability_update,
      has_column_privilege('cardapio_dev_app','public.products','updated_at','UPDATE') AS products_updated_at_update,
      has_column_privilege('cardapio_dev_app','public.products','name','UPDATE') AS products_name_update,
      has_column_privilege('cardapio_dev_app','public.products','name','INSERT') AS products_name_insert,
      has_table_privilege('cardapio_dev_app','public.categories','SELECT') AS categories_select,
      has_table_privilege('cardapio_dev_app','public.order_items','SELECT') AS order_items_select`);
  console.log('GRANTS_BEFORE', JSON.stringify(grants.rows[0]));

  const columnAcls = await client.query(`
    SELECT c.relname AS table_name, a.attname AS column_name, acl.privilege_type, acl.is_grantable,
           pg_get_userbyid(acl.grantee) AS grantee
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
    ORDER BY c.relname, a.attname, acl.privilege_type`);
  console.log('COLUMN_ACLS', JSON.stringify(columnAcls.rows));

  const tableAcls = await client.query(`
    SELECT c.relname AS table_name, acl.privilege_type,
           pg_get_userbyid(acl.grantee) AS grantee
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    ORDER BY c.relname, grantee, acl.privilege_type`);
  console.log('TABLE_ACLS', JSON.stringify(tableAcls.rows));

  const migrationTable = await client.query(`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists`);
  console.log('MIGRATIONS_TABLE', JSON.stringify(migrationTable.rows[0]));

  if (migrationTable.rows[0].exists) {
    const migrations = await client.query(`
      SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back,
             started_at
      FROM public._prisma_migrations ORDER BY started_at`);
    console.log('MIGRATIONS', JSON.stringify(migrations.rows));
  }

  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM public.admins) AS admins,
      (SELECT count(*) FROM public.orders) AS orders,
      (SELECT count(*) FROM public.order_items) AS order_items,
      (SELECT count(*) FROM public.products) AS products,
      (SELECT count(*) FROM public.categories) AS categories,
      (SELECT count(*) FROM public.comandas) AS comandas`);
  console.log('COUNTS', JSON.stringify(counts.rows[0]));

  const neonSettings = await client.query(`
    SELECT name, setting FROM pg_settings WHERE name ILIKE 'neon%' OR name ILIKE '%neon%' ORDER BY name`);
  console.log('NEON_SETTINGS', JSON.stringify(neonSettings.rows));

  const marker = await client.query(`
    SELECT rolname, shobj_description(oid, 'pg_authid') AS comment
    FROM pg_roles WHERE rolname LIKE 'rustika%' OR rolname LIKE '%marker%' ORDER BY rolname`);
  console.log('MARKERS', JSON.stringify(marker.rows));

  await client.query('ROLLBACK');
} finally {
  await client.end();
}
