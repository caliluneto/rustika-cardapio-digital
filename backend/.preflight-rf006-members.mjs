import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const f = path.join(process.env.LOCALAPPDATA, 'CardapioDigital', 'secrets', 'migrate-dev.env');
const values = {};
for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const client = new Client({ connectionString: values.DATABASE_URL });
await client.connect();
try {
  const memberships = await client.query(`
    SELECT member.rolname AS member, role.rolname AS role
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    JOIN pg_roles role ON role.oid = m.roleid
    WHERE member.rolname IN ('cardapio_dev_app','cardapio_test_app','cardapio_migrator')
    ORDER BY 1,2`);
  console.log('MEMBERSHIPS', JSON.stringify(memberships.rows));
  const size = await client.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);
  console.log('SIZE', JSON.stringify(size.rows));
  const settings = await client.query(`
    SELECT name FROM pg_settings WHERE name ILIKE '%neon%' OR name ILIKE '%pool%' ORDER BY name`);
  console.log('SETTINGS', JSON.stringify(settings.rows));
} finally {
  await client.end();
}
