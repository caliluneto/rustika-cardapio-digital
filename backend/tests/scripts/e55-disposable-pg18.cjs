// Manual OFFLINE integration rehearsal: node tests/scripts/e55-disposable-pg18.cjs
// Creates and stops a fresh PostgreSQL 18 cluster bound only to 127.0.0.1; never reads private profiles.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Client } = require('pg');

const bin = 'C:\\Program Files\\PostgreSQL\\18\\bin';
const port = 55474;
const root = fs.mkdtempSync(path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'rustika-e55-offline-'));
const cluster = path.join(root, 'pgdata');
const source = path.resolve(__dirname, '../../prisma-homolog');
const names = fs.readdirSync(path.join(source, 'migrations')).filter((name) => /^20\d{12}_/.test(name)).sort();
const originalSql = fs.readFileSync(path.join(source, 'migrations', names[9], 'migration.sql'), 'utf8');
const checksum = (text) => createHash('sha256').update(text).digest('hex');
const expected = names.map((name) => ({ name, digest: checksum(fs.readFileSync(path.join(source, 'migrations', name, 'migration.sql'))) }));
const pass = (name) => console.log('PASS ' + name);
function run(command, args, env) {
  // pg_ctl start spawns postgres; inherited capture pipes can keep spawnSync open on Windows.
  const result = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env }, cwd: process.cwd(),
    stdio: path.basename(command).toLowerCase() === 'pg_ctl.exe' ? 'ignore' : 'pipe' });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}): ${(result.stderr || result.error?.message || '').slice(-650)}`);
  return result.stdout;
}
const url = (database, role) => `postgresql://${role}@127.0.0.1:${port}/${database}?schema=public`;
async function query(database, role, sql, params) {
  const client = new Client({ connectionString: url(database, role) });
  await client.connect();
  try { return await client.query(sql, params); } finally { await client.end(); }
}
async function fails(name, sql, database = 'cardapio_digital_homolog', role = 'cardapio_homolog_migrator', expectedGranted = false, reason = /Unexpected homologation|Historical migration|Unexpected prior category ACL|synthetic post-GRANT failure/) {
  let failure;
  try { await query(database, role, sql); } catch (error) { failure = error; }
  if (!failure || !reason.test(failure.message)) throw new Error(name + ': expected guard failure, got ' + (failure?.message || 'success'));
  const acl = await query('cardapio_digital_homolog', 'postgres', `SELECT has_column_privilege('cardapio_homolog_app', 'public.categories', 'name', 'INSERT') AS granted`);
  if (acl.rows[0].granted !== expectedGranted) throw new Error(name + ': failed transaction changed category ACL');
  pass(name + ' (no GRANT)');
}
async function main() {
  if (names.length !== 10 || !originalSql.includes("IS DISTINCT FROM '57355'")) throw new Error('Unexpected production migration inventory/guard');
  // Fail closed if the dedicated test port is already in use. Never touch another cluster.
  const ready = spawnSync(path.join(bin, 'pg_isready.exe'), ['-h', '127.0.0.1', '-p', String(port)], { encoding: 'utf8' });
  if (ready.status === 0) throw new Error('Dedicated test port already occupied; refusing to start');
  run(path.join(bin, 'initdb.exe'), ['-D', cluster, '-U', 'postgres', '-A', 'trust', '--no-instructions']);
  run(path.join(bin, 'pg_ctl.exe'), ['-D', cluster, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  try {
    await query('postgres', 'postgres', 'CREATE ROLE cardapio_migrator LOGIN; CREATE ROLE cardapio_dev_app LOGIN; CREATE ROLE cardapio_test_app LOGIN');
    await query('postgres', 'postgres', 'CREATE DATABASE cardapio_digital_dev OWNER cardapio_migrator');
    const nineDir = path.join(root, 'nine');
    fs.mkdirSync(path.join(nineDir, 'migrations'), { recursive: true });
    fs.copyFileSync(path.join(source, 'schema.prisma'), path.join(nineDir, 'schema.prisma'));
    fs.copyFileSync(path.join(source, 'migrations', 'migration_lock.toml'), path.join(nineDir, 'migrations', 'migration_lock.toml'));
    for (const { name } of expected.slice(0, 9)) fs.cpSync(path.join(source, 'migrations', name), path.join(nineDir, 'migrations', name), { recursive: true });
    run(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(nineDir, 'schema.prisma')], { DATABASE_URL: url('cardapio_digital_dev', 'cardapio_migrator') });
    const replay = (await query('cardapio_digital_dev', 'cardapio_migrator', 'SELECT migration_name, checksum, finished_at, logs FROM public._prisma_migrations ORDER BY started_at, migration_name')).rows;
    if (replay.length !== 9 || replay.some((r, i) => r.migration_name !== expected[i].name || r.checksum !== expected[i].digest || !r.finished_at || r.logs)) throw new Error('Historical replay did not yield exact 9/9');
    pass('Prisma 6.19.3 replay of nine byte-identical migrations, 9/9 checksums');

    // Local-only transition to the identity recorded in E5.3. The SQL bytes of historical migrations never change.
    await query('postgres', 'postgres', 'ALTER DATABASE cardapio_digital_dev RENAME TO cardapio_digital_homolog');
    await query('postgres', 'postgres', 'ALTER ROLE cardapio_migrator RENAME TO cardapio_homolog_migrator');
    await query('postgres', 'postgres', 'ALTER ROLE cardapio_dev_app RENAME TO cardapio_homolog_app');
    await query('postgres', 'postgres', 'ALTER ROLE cardapio_test_app RENAME TO cardapio_homolog_placeholder');
    await query('postgres', 'postgres', "CREATE ROLE rustika_homolog_marker NOLOGIN; COMMENT ON ROLE rustika_homolog_marker IS 'rustika-homolog-cluster:81c4dfc1-1f0d-4e34-b31c-865e769f553e'");
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.project_id TO 'aged-scene-47291697'");
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.branch_id TO 'br-frosty-fire-bd4xw2sc'");
    const oid = String((await query('cardapio_digital_homolog', 'postgres', 'SELECT oid FROM pg_database WHERE datname = current_database()')).rows[0].oid);
    if (oid === '57355') throw new Error('Test OID unexpectedly matches Neon');
    await fails('production SQL rejects disposable OID', originalSql);
    const derived = originalSql.replace("IS DISTINCT FROM '57355'", `IS DISTINCT FROM '${oid}'`);
    if (derived === originalSql || derived.replace(`IS DISTINCT FROM '${oid}'`, "IS DISTINCT FROM '57355'") !== originalSql) throw new Error('Test derivation changes more than the OID');
    const testDir = path.join(root, 'ten');
    fs.cpSync(nineDir, testDir, { recursive: true });
    fs.mkdirSync(path.join(testDir, 'migrations', names[9]));
    fs.writeFileSync(path.join(testDir, 'migrations', names[9], 'migration.sql'), derived);
    pass(`derived test SQL: OID-only substitution, test OID ${oid}`);

    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.branch_id TO 'br-incorrect'");
    await fails('wrong branch', derived);
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.branch_id TO 'br-frosty-fire-bd4xw2sc'");
    await query('postgres', 'postgres', 'ALTER DATABASE cardapio_digital_homolog RESET neon.branch_id');
    await fails('missing branch', derived);
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.branch_id TO 'br-frosty-fire-bd4xw2sc'");
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.project_id TO 'wrong-project'");
    await fails('wrong project', derived);
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.project_id TO 'aged-scene-47291697'");
    await query('postgres', 'postgres', "COMMENT ON ROLE rustika_homolog_marker IS 'rustika-homolog-cluster:wrong'");
    await fails('wrong marker', derived);
    await query('postgres', 'postgres', "COMMENT ON ROLE rustika_homolog_marker IS 'rustika-homolog-cluster:81c4dfc1-1f0d-4e34-b31c-865e769f553e'");
    await fails('wrong database', derived, 'postgres');
    await fails('wrong role', derived, 'cardapio_digital_homolog', 'cardapio_homolog_app');
    await query('cardapio_digital_homolog', 'postgres', "UPDATE public._prisma_migrations SET checksum = repeat('0', 64) WHERE migration_name = $1", [names[0]]);
    await fails('tampered historical checksum', derived);
    await query('cardapio_digital_homolog', 'postgres', 'UPDATE public._prisma_migrations SET checksum = $1 WHERE migration_name = $2', [expected[0].digest, names[0]]);
    await query('cardapio_digital_homolog', 'postgres', "INSERT INTO public._prisma_migrations(id, checksum, migration_name, started_at, applied_steps_count) VALUES ('00000000-0000-0000-0000-000000000011', $1, '20270101000000_unknown', now(), 0)", ['0'.repeat(64)]);
    await fails('unexpected historical migration', derived);
    await query('cardapio_digital_homolog', 'postgres', "DELETE FROM public._prisma_migrations WHERE migration_name='20270101000000_unknown'");
    await query('cardapio_digital_homolog', 'postgres', "INSERT INTO public._prisma_migrations(id, checksum, migration_name, started_at, applied_steps_count) VALUES ('00000000-0000-0000-0000-000000000010', $1, $2, now(), 0)", [checksum(derived), names[9]]);
    await query('cardapio_digital_homolog', 'postgres', 'UPDATE public._prisma_migrations SET logs = $1 WHERE migration_name = $2', ['prior failure', names[9]]);
    await fails('previously recorded failed tenth', derived);
    await query('cardapio_digital_homolog', 'postgres', 'DELETE FROM public._prisma_migrations WHERE migration_name = $1', [names[9]]);
    await query('cardapio_digital_homolog', 'postgres', 'GRANT INSERT (name) ON public.categories TO cardapio_homolog_app');
    await fails('unexpected pre-existing category grant', derived, 'cardapio_digital_homolog', 'cardapio_homolog_migrator', true);
    await query('cardapio_digital_homolog', 'postgres', 'REVOKE INSERT (name) ON public.categories FROM cardapio_homolog_app');
    const injected = derived.replace('  IF NOT has_column_privilege', "  RAISE EXCEPTION 'synthetic post-GRANT failure';\n  IF NOT has_column_privilege");
    if (injected === derived) throw new Error('Injection point missing');
    await fails('post-GRANT exception rolls back both GRANTs', injected);

    // The real Prisma CLI starts its own connection and records the in-flight tenth row before running SQL.
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.branch_id TO 'br-incorrect'");
    const denied = spawnSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(testDir, 'schema.prisma')], {
      encoding: 'utf8', env: { ...process.env, DATABASE_URL: url('cardapio_digital_homolog', 'cardapio_homolog_migrator') },
    });
    const failedRow = (await query('cardapio_digital_homolog', 'postgres', 'SELECT finished_at, logs FROM public._prisma_migrations WHERE migration_name=$1', [names[9]])).rows;
    // Prisma 6.19.3 may leave logs NULL after BEGIN fails because the transaction is aborted;
    // finished_at IS NULL is the decisive failure signal, even when no logs were persisted.
    if (denied.status === 0 || failedRow.length !== 1 || failedRow[0].finished_at) throw new Error(`Prisma failed deploy mismatch: exit=${denied.status} rows=${failedRow.length} finished=${!!failedRow[0]?.finished_at}`);
    const deniedAcl = (await query('cardapio_digital_homolog', 'postgres', `SELECT has_column_privilege('cardapio_homolog_app','public.categories','name','INSERT') AS granted`)).rows[0];
    if (deniedAcl.granted) throw new Error('Prisma failed deploy changed category ACL');
    pass(`Prisma rejects wrong branch before GRANT; incomplete tenth recorded (logsPresent=${!!failedRow[0].logs}; no automatic retry)`);
    // Test-fixture reset only, on this newly created disposable cluster; never migrate resolve.
    await query('cardapio_digital_homolog', 'postgres', 'DELETE FROM public._prisma_migrations WHERE migration_name=$1', [names[9]]);
    await query('postgres', 'postgres', "ALTER DATABASE cardapio_digital_homolog SET neon.branch_id TO 'br-frosty-fire-bd4xw2sc'");
    run(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(testDir, 'schema.prisma')], { DATABASE_URL: url('cardapio_digital_homolog', 'cardapio_homolog_migrator') });
    const ten = (await query('cardapio_digital_homolog', 'postgres', 'SELECT migration_name, checksum, finished_at, rolled_back_at, logs FROM public._prisma_migrations ORDER BY started_at, migration_name')).rows;
    if (ten.length !== 10 || ten.some((r, i) => r.migration_name !== expected[i].name || r.checksum !== (i === 9 ? checksum(derived) : expected[i].digest) || !r.finished_at || r.rolled_back_at || r.logs)) throw new Error('Expected exact 10/10 after Prisma deployment');
    pass('Prisma 6.19.3 deployed guarded tenth; exact 10/10 and ten checksums');
    const columns = (await query('cardapio_digital_homolog', 'postgres', `SELECT attname, has_column_privilege('cardapio_homolog_app', attrelid, attnum, 'INSERT') AS ins, has_column_privilege('cardapio_homolog_app', attrelid, attnum, 'UPDATE') AS upd FROM pg_attribute WHERE attrelid='public.categories'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attname`)).rows;
    const ins = columns.filter(r => r.ins).map(r => r.attname).sort();
    const upd = columns.filter(r => r.upd).map(r => r.attname).sort();
    if (JSON.stringify(ins) !== JSON.stringify(['id', 'public_key', 'name', 'description', 'display_order', 'is_active', 'updated_at'].sort()) || JSON.stringify(upd) !== JSON.stringify(['name', 'description', 'display_order', 'updated_at'].sort())) throw new Error('Unexpected category column grants');
    const privileged = (await query('cardapio_digital_homolog', 'postgres', `SELECT has_table_privilege('cardapio_homolog_app','public.categories','DELETE') AS del, has_table_privilege('cardapio_homolog_app','public.categories','UPDATE') AS full_update, has_table_privilege('cardapio_homolog_app','public.admins','INSERT') AS admins_insert`)).rows[0];
    if (Object.values(privileged).some(Boolean)) throw new Error('Excess table or admins permissions');
    pass('only intended category column grants; no DELETE, full-table UPDATE or admins writes');
    run(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(testDir, 'schema.prisma')], { DATABASE_URL: url('cardapio_digital_homolog', 'cardapio_homolog_migrator') });
    const after = (await query('cardapio_digital_homolog', 'postgres', 'SELECT count(*)::int AS count FROM public._prisma_migrations')).rows[0].count;
    if (after !== 10) throw new Error('Second deploy added migrations');
    pass('Prisma repeat deploy no-op, 10/10');
    console.log(`OFFLINE_E55_RESULT=PASS cluster=${root} productionChecksum=${checksum(originalSql)} derivedChecksum=${checksum(derived)}`);
  } finally {
    run(path.join(bin, 'pg_ctl.exe'), ['-D', cluster, '-m', 'fast', '-w', 'stop']);
  }
}
main().catch((error) => { console.error('OFFLINE_E55_RESULT=FAIL ' + error.message); process.exitCode = 1; });
