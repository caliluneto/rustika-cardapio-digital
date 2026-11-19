import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const f = path.join(process.env.LOCALAPPDATA, 'CardapioDigital', 'secrets', 'migrate-dev.env');
const values = {};
for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const client = new Client({ connectionString: values.DATABASE_URL, application_name: 'rustika-prebackup-check' });
await client.connect();
try {
  const activity = await client.query(`
    SELECT pid, usename, application_name, state, wait_event_type, wait_event, left(query, 120) AS query
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
    ORDER BY pid`);
  console.log('ACTIVITY', JSON.stringify(activity.rows));
  const locks = await client.query(`
    SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`);
  console.log('WAITING_LOCKS', JSON.stringify(locks.rows));
} finally {
  await client.end();
}
