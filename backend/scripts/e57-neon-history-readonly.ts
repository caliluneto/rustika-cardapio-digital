/** E5.7: verificação de identidade + histórico 10/10 + privilégios da migration 10, somente leitura.
 *
 * Reutiliza os controles da E5.3 adaptados ao estado definitivo 10/10. Não grava nada no Neon.
 * Exige --authorize-read-only e confirmação específica de ambiente; nenhuma conexão aberta sem elas.
 */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile } from '../src/config/secrets';
import { assertNeonProxyTlsAck, evaluateNeonServerIdentity, readNeonServerFacts } from '../src/config/neonServerIdentity';
import { E4_ALT_TARGET, runSerializableReadOnlyTransaction } from './bootstrap/exceptionalMigratorBootstrap';
import { strictTargetUrlProblem } from './bootstrap/exceptionalMigratorCli';
import { evaluateE53Identity, type E53IdentityRow, type E53MigrationRow } from './homolog/e53ReadOnlyVerification';
import { HOMOLOG_CATEGORY_MIGRATION, HOMOLOG_EXPECTED_MIGRATIONS, verifyHomologAppliedPrefix, verifyHomologMigrationChain } from './homolog/homologMigrationChain';

export const E57_CONFIRMATION_ENV = 'RUSTIKA_E57_READ_ONLY_CONFIRMATION';
export const E57_CONFIRMATION_VALUE = 'VERIFY_ONLY_E57_NEON_HISTORY_10_10';

interface GrantRow { attname: string; granted: boolean }

async function main(): Promise<number> {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--authorize-read-only' ||
      process.env[E57_CONFIRMATION_ENV] !== E57_CONFIRMATION_VALUE) {
    console.error('[e57] Exige --authorize-read-only e confirmação específica E5.7; nenhuma conexão aberta.');
    return 2;
  }
  // Os bytes da cadeia inteira são conferidos antes de ler o perfil privado ou abrir socket.
  const chain = verifyHomologMigrationChain(path.resolve(__dirname, '..'));
  if (chain.problems.length) {
    console.error('[e57] Cadeia prisma-homolog inválida; nenhuma conexão aberta.');
    return 2;
  }
  if (process.env.RUSTIKA_HOMOLOG_EXPECTED_PROJECT_ID !== E4_ALT_TARGET.projectId) {
    console.error('[e57] Projeto esperado não coincide com o alvo fixo; nenhuma conexão aberta.');
    return 2;
  }
  let database: ReturnType<typeof loadDatabaseProfile>;
  try { database = loadDatabaseProfile('migrate-homolog', { purpose: 'migration' }); }
  catch { console.error('[e57] Perfil privado migrate-homolog indisponível ou inválido.'); return 2; }
  if (database.profile !== 'migrate-homolog' || database.purpose !== 'migration' ||
      database.environment !== 'homolog' || database.database !== E4_ALT_TARGET.database ||
      database.user !== E4_ALT_TARGET.migratorRole || !database.clusterId ||
      strictTargetUrlProblem(database) !== null || database.shadowDatabaseUrl) {
    console.error('[e57] Endpoint, role, TLS da URL ou perfil privado incompatível; nenhuma conexão aberta.');
    return 2;
  }
  try { assertNeonProxyTlsAck(process.env.RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK); }
  catch { console.error('[e57] Reconhecimento humano do TLS no proxy ausente; nenhuma conexão aberta.'); return 2; }

  let tls: Awaited<ReturnType<typeof readNeonServerFacts>>;
  try {
    tls = await readNeonServerFacts(database.databaseUrl, database.host ?? '');
    const problems = evaluateNeonServerIdentity(tls, {
      phase: 'final', expectedProjectId: E4_ALT_TARGET.projectId,
      expectedClusterId: database.clusterId, expectedUser: E4_ALT_TARGET.migratorRole,
      expectedDatabase: E4_ALT_TARGET.database,
    });
    if (problems.length) throw new Error('Identidade/TLS externo divergente.');
  } catch {
    console.error('[e57] TLS externo ou identidade do endpoint divergente/indisponível; nenhuma consulta de histórico iniciada.');
    return 2;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  try {
    const result = await runSerializableReadOnlyTransaction(prisma, async (tx) => {
      const head = (await tx.$queryRaw<E53IdentityRow[]>`
        SELECT current_database()::text AS "database",
               (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
               current_user::text AS "currentUser", session_user::text AS "sessionUser",
               (SELECT pg_get_userbyid(datdba)::text FROM pg_database WHERE datname = current_database()) AS "databaseOwner",
               (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
                  FROM pg_roles WHERE rolname = current_user) AS "elevatedRole",
               current_setting('server_version_num')::int AS "serverVersionNum",
               current_setting('neon.project_id', true) AS "projectId",
               current_setting('neon.branch_id', true) AS "branchId",
               (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = 'rustika_homolog_marker') AS "markerComment"`)[0];
      if (!head) throw new Error('Identidade ausente.');
      const identity = evaluateE53Identity(head, database.clusterId!);
      if (identity.problems.length) throw new Error(`Identidade divergente: ${identity.problems.join(' ')}`);
      const migrations = await tx.$queryRaw<E53MigrationRow[]>`
        SELECT migration_name AS name, checksum,
               finished_at IS NOT NULL AS finished,
               rolled_back_at IS NOT NULL AS "rolledBack",
               (logs IS NOT NULL AND btrim(logs) <> '') AS "logsPresent"
          FROM public._prisma_migrations ORDER BY started_at, migration_name`;
      const grants = await tx.$queryRaw<GrantRow[]>`
        SELECT attname,
          (has_column_privilege('cardapio_homolog_app', 'public.categories'::regclass, attnum, 'INSERT') OR
           has_column_privilege('cardapio_homolog_app', 'public.categories'::regclass, attnum, 'UPDATE')) AS granted
          FROM pg_attribute
         WHERE attrelid = 'public.categories'::regclass AND attnum > 0 AND NOT attisdropped
         ORDER BY attname`;
      const adminCount = await tx.admin.count();
      return { head, identity, migrations, grants, adminCount };
    });
    const historyProblems = verifyHomologAppliedPrefix(result.migrations);
    if (result.migrations.length !== 10) historyProblems.push(`Histórico remoto contém ${result.migrations.length} linhas; esperadas exatamente 10.`);
    for (const row of result.migrations) {
      if (row.logsPresent) historyProblems.push(`Logs de falha não vazios na migration ${row.name}.`);
    }
    if (!result.identity.branchReported) historyProblems.push('Branch ID não foi exposto pelo PostgreSQL; consultar API Neon em autorização independente.');

    // Privilégios previstos na migration 10: INSERT em 7 colunas, UPDATE em 4 colunas, nenhum DELETE,
    // nenhuma privilégio de tabela inteira, nada em admins.
    const expectedInsert = new Set(['id', 'public_key', 'name', 'description', 'display_order', 'is_active', 'updated_at']);
    const expectedUpdate = new Set(['name', 'description', 'display_order', 'updated_at']);
    const grantProblems: string[] = [];
    const grantedInsert = new Set(result.grants.filter((g) => g.granted && expectedInsert.has(g.attname)).map((g) => g.attname));
    const grantedUpdate = new Set(result.grants.filter((g) => g.granted && expectedUpdate.has(g.attname)).map((g) => g.attname));
    for (const col of expectedInsert) if (!grantedInsert.has(col)) grantProblems.push(`Falta INSERT em categories.${col}`);
    for (const col of expectedUpdate) if (!grantedUpdate.has(col)) grantProblems.push(`Falta UPDATE em categories.${col}`);
    const allGranted = new Set(result.grants.filter((g) => g.granted).map((g) => g.attname));
    const allowed = new Set([...expectedInsert, ...expectedUpdate]);
    for (const col of allGranted) if (!allowed.has(col)) grantProblems.push(`Privilégio inesperado em categories.${col}`);
    const tableInsert = (await prisma.$queryRaw<{ v: boolean }[]>`SELECT has_table_privilege('cardapio_homolog_app', 'public.categories', 'INSERT') AS v`)[0]?.v;
    const tableUpdate = (await prisma.$queryRaw<{ v: boolean }[]>`SELECT has_table_privilege('cardapio_homolog_app', 'public.categories', 'UPDATE') AS v`)[0]?.v;
    const tableDelete = (await prisma.$queryRaw<{ v: boolean }[]>`SELECT has_table_privilege('cardapio_homolog_app', 'public.categories', 'DELETE') AS v`)[0]?.v;
    const adminsInsert = (await prisma.$queryRaw<{ v: boolean }[]>`SELECT has_table_privilege('cardapio_homolog_app', 'public.admins', 'INSERT') AS v`)[0]?.v;
    const adminsUpdate = (await prisma.$queryRaw<{ v: boolean }[]>`SELECT has_table_privilege('cardapio_homolog_app', 'public.admins', 'UPDATE') AS v`)[0]?.v;
    const adminsDelete = (await prisma.$queryRaw<{ v: boolean }[]>`SELECT has_table_privilege('cardapio_homolog_app', 'public.admins', 'DELETE') AS v`)[0]?.v;
    if (tableInsert || tableUpdate || tableDelete) grantProblems.push('Privilégio de tabela inteira em categories não permitido.');
    if (adminsInsert || adminsUpdate || adminsDelete) grantProblems.push('Privilégios em admins não permitidos.');

    const problems = [...historyProblems, ...grantProblems];
    console.log(JSON.stringify({
      status: problems.length ? 'NO-GO' : 'READ_ONLY_VERIFIED',
      target: {
        projectId: result.head.projectId, branchIdReported: result.head.branchId,
        branchProof: result.identity.branchReported ? 'neon.branch_id (servidor; não API independente)' : 'não comprovado',
        database: result.head.database, databaseOid: result.head.databaseOid,
        currentUser: result.head.currentUser, sessionUser: result.head.sessionUser,
        databaseOwner: result.head.databaseOwner, elevatedRole: result.head.elevatedRole,
        serverVersionNum: result.head.serverVersionNum,
        markerMatches: true, directEndpoint: database.host, externalTlsProven: tls.external.proven,
        externalTlsProtocol: tls.external.protocol,
      },
      migrations: result.migrations, expectedTen: HOMOLOG_EXPECTED_MIGRATIONS.map((m) => ({ ...m, finished: true, rolledBack: false })),
      pending: HOMOLOG_CATEGORY_MIGRATION, grants: result.grants, adminCount: result.adminCount, problems,
    }, null, 2));
    return problems.length ? 2 : 0;
  } catch {
    console.error('[e57] Identidade da transação ou leitura READ ONLY falhou; nenhuma escrita realizada. NÃO REPITA sem nova autorização.');
    return 2;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().then((code) => { process.exitCode = code; });
