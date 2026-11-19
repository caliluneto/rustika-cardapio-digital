import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const profile = process.argv[2] ?? 'migrate-dev';
const secretsDir = path.join(process.env.LOCALAPPDATA, 'CardapioDigital', 'secrets');
const file = path.join(secretsDir, `${profile}.env`);
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
           version() AS full_version,
           pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database())) AS database_owner`);
  console.log('IDENTITY', JSON.stringify(identity.rows[0]));
  const migrations = await client.query(`
    SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
    FROM public._prisma_migrations ORDER BY started_at`);
  console.log('MIGRATIONS', JSON.stringify(migrations.rows));
  const tables = await client.query(`
    SELECT c.relname AS table_name, acl.privilege_type, pg_get_userbyid(acl.grantee) AS grantee
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      AND pg_get_userbyid(acl.grantee) IN ('cardapio_dev_app','cardapio_test_app')
    ORDER BY c.relname, grantee, acl.privilege_type`);
  console.log('RUNTIME_TABLE_ACLS', JSON.stringify(tables.rows));
  const columnAcls = await client.query(`
    SELECT c.relname AS table_name, a.attname AS column_name, acl.privilege_type, pg_get_userbyid(acl.grantee) AS grantee
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE n.nspname = 'public' AND a.attacl IS NOT NULL ORDER BY c.relname, a.attname, acl.privilege_type`);
  console.log('COLUMN_ACLS', JSON.stringify(columnAcls.rows));
  const counts = await client.query(`
    SELECT (SELECT count(*) FROM public.admins) AS admins, (SELECT count(*) FROM public.orders) AS orders,
           (SELECT count(*) FROM public.order_items) AS order_items, (SELECT count(*) FROM public.products) AS products,
           (SELECT count(*) FROM public.categories) AS categories`);
  console.log('COUNTS', JSON.stringify(counts.rows[0]));
  await client.query('ROLLBACK');
} finally {
  await client.end();
}
