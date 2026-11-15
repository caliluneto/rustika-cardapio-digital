// ENSAIO SUPERVISIONADO de compatibilidade Neon Free
// Modo "read"  : somente leitura.
// Modo "write" : cria/renomeia/exclui SOMENTE objetos zz_probe_* e exige NEON_PROBE_ALLOW_WRITE=yes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyServerSideSsl, decideProbeConnection, evaluateIdentity, inspectExternalTls } from './neon-probe-checks.mjs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import tls from 'node:tls';

const mode = process.argv[2] ?? 'read';
const outFile = process.argv[3];
const rawUrl = process.env.NEON_PROBE_URL ?? '';
const confirmEndpoint = (process.env.NEON_PROBE_CONFIRM_ENDPOINT ?? '').trim();
const allowWrite = process.env.NEON_PROBE_ALLOW_WRITE === 'yes';
const allowGrant = process.env.NEON_PROBE_ALLOW_GRANT === 'yes';
const skipPrisma = process.env.NEON_PROBE_SKIP_PRISMA === 'yes';
const EXPECT = { database: 'neondb', user: 'neondb_owner', versionPrefix: '18.', projectId: 'aged-scene-47291697' };
// Nomes UNICOS por execucao (runId aleatorio). Assim a limpeza so alcanca objetos desta execucao, mesmo contra outro processo concorrente
// que crie zz_probe_* no meio do ensaio; a pre-checagem por prefixo (zz_probe_%) continua recusando qualquer resto de execucoes anteriores.
const runId = crypto.randomBytes(4).toString('hex');
const P = `zz_probe_${runId}_`;
const N = { roleA: `${P}role_a`, roleB: `${P}role_b`, reader: `${P}reader`, db: `${P}db`, dbRenamed: `${P}db_renamed` };
for (const name of Object.values(N)) if (!/^zz_probe_[0-9a-f]{8}_[a-z_]+$/.test(name)) throw new Error('nome de teste invalido');
const assertOwned = (name) => { if (!name.startsWith(P) || !Object.values(N).includes(name)) throw new Error('recusado: objeto nao pertence a esta execucao'); };
const qi = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`; // identificadores sempre entre aspas

const results = [];
const secretsToMask = [];
const mask = (text) => secretsToMask.reduce((acc, s) => (s && s.length >= 4 ? acc.split(s).join('***') : acc), String(text));
const record = (id, status, detail) => { results.push({ id, status, detail: mask(detail ?? '') }); console.log(`[${status}] ${id}${detail ? ' - ' + mask(detail) : ''}`); };
const fail = (message) => { console.error(`ABORT: ${message}`); process.exit(2); };

if (!['read', 'write'].includes(mode)) fail('modo deve ser read ou write');
if (outFile) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const target = path.resolve(outFile);
  if (target.toLowerCase().startsWith(repoRoot.toLowerCase() + path.sep)) fail('o arquivo de saida deve ficar FORA do repositorio (ex.: $env:TEMP)');
}
if (!rawUrl) fail('NEON_PROBE_URL nao definido (PENDENTE: o proprietario deve defini-lo no proprio terminal)');
let url;
let baseUser;
let basePassword;
try { url = new URL(rawUrl); baseUser = decodeURIComponent(url.username); basePassword = decodeURIComponent(url.password); } catch { fail('NEON_PROBE_URL invalida'); }
if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') fail('a URL deve usar o esquema postgresql://');
secretsToMask.push(url.hostname, basePassword, rawUrl, url.password);
const host = url.hostname;
if (!/^[a-z0-9.-]+\.neon\.tech$/.test(host)) fail('o host nao e um endpoint Neon (*.neon.tech)');
if (host.split('.')[0].includes('-pooler')) fail('endpoint pooled (-pooler) recusado: use o endpoint DIRETO');
if (!/^ep-[a-z0-9-]+$/.test(confirmEndpoint) || host.split('.')[0] !== confirmEndpoint) fail('NEON_PROBE_CONFIRM_ENDPOINT ausente ou diferente do endpoint da URL (confirme no console Neon)');
if (!host.includes('.us-east-2.aws.')) fail('regiao diferente de AWS us-east-2');
if (mode === 'write' && !allowWrite) fail('modo write exige NEON_PROBE_ALLOW_WRITE=yes');
const baseDb = decodeURIComponent(url.pathname.replace(/^\//, '')) || EXPECT.database;

const buildConfig = (database, user, password) => ({
  host, port: Number(url.port || 5432), database, user, password, connectionTimeoutMillis: 30000, statement_timeout: mode === 'write' ? 120000 : 30000,
  ssl: { rejectUnauthorized: true, servername: host, minVersion: 'TLSv1.2' },
});
async function open(database = baseDb, user = baseUser, password = basePassword, readOnly = false) {
  for (let attempt = 1; ; attempt += 1) {
    const client = new pg.Client(buildConfig(database, user, password));
    try {
      await client.connect();
      if (readOnly) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'); // defesa em profundidade
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      // Reintenta uma vez apenas por cold start/rede (scale-to-zero); nunca por falha de TLS ou autenticacao.
      if (attempt >= 2 || !/timeout|terminated|ECONNRESET|ETIMEDOUT/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
const rows = async (client, sql, params) => (await client.query(sql, params)).rows;
const one = async (id, fn) => { try { const detail = await fn(); record(id, 'COMPROVADO', detail); return true; } catch (error) { record(id, 'INCOMPATIVEL', `${error.code ?? ''} ${error.message}`.trim()); return false; } };
// O PostgreSQL >= 16 guarda uma linha de pg_auth_members POR CONCEDENTE (grantor) para o mesmo par
// (role, membro). Um "[0]" sem agregacao leria uma linha arbitraria quando ha mais de uma. Esta funcao agrega SEMPRE.
const aggMembership = async (client, roleName, memberName) => {
  const r = (await rows(client,
    'SELECT bool_or(set_option) s, bool_or(inherit_option) i, bool_or(admin_option) a, count(*)::int n, ' +
    "(SELECT array_agg(pg_get_userbyid(grantor)) FROM pg_auth_members WHERE roleid=$1::regrole AND member=(SELECT oid FROM pg_roles WHERE rolname=$2)) grantors " +
    'FROM pg_auth_members WHERE roleid=$1::regrole AND member=(SELECT oid FROM pg_roles WHERE rolname=$2)',
    [roleName, memberName]))[0];
  return { anySet: r.s === true, anyInherit: r.i === true, anyAdmin: r.a === true, rowCount: r.n, grantors: r.grantors ?? [] };
};

const inventory = async (client) => ({
  databases: (await rows(client, "SELECT datname FROM pg_database WHERE datname NOT LIKE 'zz\\_probe\\_%' ORDER BY 1")).map((r) => r.datname),
  roles: (await rows(client, "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'zz\\_probe\\_%' ORDER BY 1")).map((r) => r.rolname),
  members: (await rows(client, "SELECT pg_get_userbyid(roleid) r, pg_get_userbyid(member) m FROM pg_auth_members WHERE pg_get_userbyid(roleid) NOT LIKE 'zz\\_probe\\_%' AND pg_get_userbyid(member) NOT LIKE 'zz\\_probe\\_%' ORDER BY 1,2")).map((r) => `${r.r}>${r.m}`),
});
const leftovers = async (client) => ({
  databases: (await rows(client, "SELECT datname FROM pg_database WHERE datname LIKE 'zz\\_probe\\_%'")).map((r) => r.datname),
  roles: (await rows(client, "SELECT rolname FROM pg_roles WHERE rolname LIKE 'zz\\_probe\\_%'")).map((r) => r.rolname),
});

// "attempted": nomes que ESTA execucao tentou criar (marcados antes do CREATE, pois a resposta pode se perder). So existem se a pre-checagem
// provou que nenhum zz_probe_* existia; por isso um DROP IF EXISTS desses nomes nunca atinge objeto preexistente.
const attempted = { roles: new Set(), dbs: new Set() };
let precheckPassed = false;
let admin;
let before;
// Marca um nome como "tentado" antes do CREATE (resposta pode se perder). Se o servidor disser que o objeto JA EXISTIA (42710/42P04), ele nao e nosso:
// sai do conjunto e nunca sera removido.
const guardedCreate = async (set, name, fn) => {
  assertOwned(name);
  set.add(name);
  try { return await fn(); } catch (error) { if (error.code === '42710' || error.code === '42P04') set.delete(name); throw error; }
};
// Limpeza idempotente, reutilizavel por finally e por sinais; usa conexao nova se a original morreu; 3 tentativas por objeto.
let cleanupPromise;
let cleanupFailed = false;
const cleanup = () => (cleanupPromise ??= (async () => {
  if (!precheckPassed || (attempted.dbs.size === 0 && attempted.roles.size === 0)) return;
  let client = admin;
  try { await client.query('SELECT 1'); } catch { client = undefined; }
  if (!client) { try { client = await open(); } catch (error) { cleanupFailed = true; record('LIMPEZA_CONEXAO', 'INCOMPATIVEL', `${error.code ?? ''} ${error.message} - BLOQUEIO CRITICO`); return; } }
  const attempt = async (id, work) => {
    for (let n = 1; n <= 3; n += 1) {
      try { await work(); record(id, 'COMPROVADO'); return true; }
      catch (error) { if (n === 3) { cleanupFailed = true; record(id, 'INCOMPATIVEL', `${error.code ?? ''} ${error.message} - BLOQUEIO CRITICO`); } else await new Promise((resolve) => setTimeout(resolve, 3000)); }
    }
    return false;
  };
  for (const db of [...attempted.dbs]) {
    assertOwned(db);
    if (await attempt(`LIMPEZA_DB_${db}`, async () => { await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [db]); await client.query(`DROP DATABASE IF EXISTS ${qi(db)}`); })) attempted.dbs.delete(db);
  }
  for (const role of [N.reader, N.roleB, N.roleA]) {
    if (!attempted.roles.has(role)) continue;
    assertOwned(role);
    if (await attempt(`LIMPEZA_ROLE_${role}`, async () => { await client.query(`DROP ROLE IF EXISTS ${qi(role)}`); })) attempted.roles.delete(role);
  }
  if (client !== admin) await client.end().catch(() => {});
})());
let interrupted = false;
const onSignal = (signal) => {
  if (interrupted) return;
  interrupted = true;
  console.error(`\nINTERROMPIDO (${signal}). Executando a limpeza dos objetos desta execucao: roles=[${[...attempted.roles]}] bancos=[${[...attempted.dbs]}] ...`);
  cleanup().finally(() => { console.error(cleanupFailed ? 'LIMPEZA INCOMPLETA: rode o modo read e remova manualmente apenas os zz_probe_* listados.' : 'Limpeza concluida. Rode o modo read para comprovar a ausencia de zz_probe_*.'); process.exit(cleanupFailed ? 4 : 130); });
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => onSignal(signal));

try {
  admin = await open(baseDb, baseUser, basePassword, mode === 'read');
  // (1) TLS EXTERNO: comprovado pelo CLIENTE (cadeia/CA, nome do servidor, rejeicao de nome falso, protocolo). Nao depende do PostgreSQL.
  const external = inspectExternalTls(admin.connection.stream, host);
  record('TLS_EXTERNO', external.proven ? 'COMPROVADO' : 'INCOMPATIVEL',
    `authorized=${external.authorized} nomeConfere=${external.nameMatches} nomeErradoRejeitado=${external.wrongNameRejected} protocolo=${external.protocol} cifra=${external.cipher} emissor=${external.issuer} validoAte=${external.validTo}${external.proven ? '' : ' motivos=' + external.reasons.join('|')}`);
  if (!external.proven) fail('TLS externo nao comprovado; nada mais sera executado');
  // (2) ESTADO SSL DA SESSAO NO POSTGRESQL (pg_stat_ssl): camada diferente; atras de um proxy que termina o TLS pode ser false.
  const head = (await rows(admin, "SELECT current_database() db, current_user usr, session_user su, current_setting('server_version') sv, current_setting('server_version_num')::int svn, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) ssl, (SELECT version FROM pg_stat_ssl WHERE pid = pg_backend_pid()) tlsv, current_setting('ssl', true) ssl_guc, (inet_client_addr() IS NULL) client_addr_null, COALESCE(inet_client_addr() <<= ANY (ARRAY['10.0.0.0/8'::inet, '172.16.0.0/12'::inet, '192.168.0.0/16'::inet, '100.64.0.0/10'::inet]), false) client_private, current_setting('neon.project_id', true) pid"))[0];
  const identityProblems = evaluateIdentity(head, EXPECT);
  record('IDENTIDADE', identityProblems.length === 0 ? 'COMPROVADO' : 'INCOMPATIVEL', `banco=${head.db} usuario=${head.usr} sessionUser=${head.su} versao=${head.sv} (num ${head.svn})${identityProblems.length ? ' problemas=' + identityProblems.join('|') : ''}`);
  const sslClass = classifyServerSideSsl({ ssl: head.ssl, version: head.tlsv }, external.proven);
  record('PG_STAT_SSL_SESSAO_INTERNA', sslClass.status, `${sslClass.detail}; GUC ssl=${head.ssl_guc}; enderecoDoCliente(visto pelo PostgreSQL) privado=${head.client_private} nulo=${head.client_addr_null}`);
  const projectMismatch = Boolean(head.pid) && head.pid !== EXPECT.projectId;
  const decision = decideProbeConnection({ external, identityProblems, sslClass, projectMismatch });
  if (!decision.proceed) fail(`diagnostico recusou prosseguir: ${decision.blockers.join(' / ')}; nada mais sera executado`);
  if (mode === 'write' && !head.pid) fail('modo write exige que o servidor exponha neon.project_id e que ele confira com o projeto descartavel; nada foi alterado');
  if (head.pid) {
    record('PROJETO_NEON_ID', 'COMPROVADO', 'neon.project_id confere com o esperado');
  } else {
    record('PROJETO_NEON_ID', 'NAO TESTADO', 'o servidor nao expoe neon.project_id; o projeto foi confirmado apenas pelo endpoint informado pelo proprietario');
  }
  const attrs = (await rows(admin, 'SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user'))[0];
  record('PRIVILEGIOS_DECLARADOS', 'COMPROVADO', JSON.stringify(attrs) + ' (declarados; nao garantem as operacoes)');
  const pre = await leftovers(admin);
  const hasLeftovers = pre.databases.length > 0 || pre.roles.length > 0;
  if (hasLeftovers && mode === 'write') fail(`ja existem objetos zz_probe_*: ${JSON.stringify(pre)} - nada foi alterado`);
  if (hasLeftovers) record('REMANESCENTES_zz_probe_ANTES', 'INCOMPATIVEL', JSON.stringify(pre));
  precheckPassed = !hasLeftovers;
  before = await inventory(admin);
  record('INVENTARIO_ANTES', 'COMPROVADO', `bancos=${before.databases.join(',')} roles=${before.roles.length} memberships=${before.members.length}`);

  // ---- Prisma (driver do RUSTIKA) em PROCESSO FILHO com ambiente minimo: o Prisma carrega backend/.env sozinho; assim isso nao entra neste processo ----
  if (!skipPrisma) {
    const pu = new URL(rawUrl); pu.searchParams.set('sslmode', 'require'); pu.searchParams.set('sslaccept', 'strict'); pu.searchParams.set('connect_timeout', '30');
    secretsToMask.push(pu.toString());
    const code = "const {PrismaClient}=require('@prisma/client');(async()=>{const p=new PrismaClient({log:[],errorFormat:'minimal',datasources:{db:{url:process.env.PROBE_PRISMA_URL}}});try{const r=await p.$queryRawUnsafe('SELECT current_database() AS db, (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl');console.log(JSON.stringify(r[0]))}finally{await p.$disconnect()}})().catch(e=>{console.log(JSON.stringify({error:String(e.code||'')+' '+String(e.message).split('\\n').slice(-2).join(' ')}));process.exit(1)})";
    const child = spawnSync(process.execPath, ['-e', code], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), encoding: 'utf8', timeout: 90000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), PROBE_PRISMA_URL: pu.toString() } });
    let parsed;
    try { parsed = JSON.parse((child.stdout ?? '').trim().split('\n').pop()); } catch { parsed = { error: 'saida do processo filho ilegivel' }; }
    if (parsed.error) record('PRISMA_TLS_STRICT', 'INCOMPATIVEL', parsed.error);
    else record('PRISMA_TLS_STRICT', parsed.db === EXPECT.database ? 'COMPROVADO' : 'INCOMPATIVEL', `conexao com sslmode=require&sslaccept=strict (certificado validado pelo motor do Prisma) banco=${parsed.db}; pg_stat_ssl.ssl visto pelo PostgreSQL=${parsed.ssl} (camada interna, ver PG_STAT_SSL_SESSAO_INTERNA)`);
  } else record('PRISMA_TLS_STRICT', 'NAO TESTADO', 'NEON_PROBE_SKIP_PRISMA=yes');

  // ---- G e H: leitura ----
  await one('G_CONEXAO_BANCO_POSTGRES', async () => { const c = await open('postgres', baseUser, basePassword, true); try { const r = await rows(c, 'SELECT current_database() db'); return `conectou a ${r[0].db}`; } finally { await c.end(); } });
  const catalogs = {
    pg_database: 'SELECT count(*) FROM pg_database', pg_roles: 'SELECT count(*) FROM pg_roles', pg_auth_members: 'SELECT count(*), bool_or(inherit_option) FROM pg_auth_members',
    pg_class_ns: 'SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace', pg_proc: 'SELECT count(*) FROM pg_proc', pg_trigger: 'SELECT count(*) FROM pg_trigger',
    pg_policy: 'SELECT count(*) FROM pg_policy', pg_event_trigger: 'SELECT count(*) FROM pg_event_trigger', pg_db_role_setting: 'SELECT count(*) FROM pg_db_role_setting',
    pg_default_acl: 'SELECT count(*) FROM pg_default_acl', pg_stat_activity: 'SELECT count(*) FROM pg_stat_activity', pg_prepared_xacts: 'SELECT count(*) FROM pg_prepared_xacts',
    pg_replication_slots: 'SELECT count(*) FROM pg_replication_slots', pg_stat_ssl: 'SELECT count(*) FROM pg_stat_ssl', shobj_description: "SELECT count(*) FROM pg_roles WHERE shobj_description(oid,'pg_authid') IS NOT NULL",
    has_privilege: "SELECT has_database_privilege(current_user, current_database(), 'CONNECT') c", marker_role: "SELECT count(*) FROM pg_roles WHERE rolname='rustika_homolog_marker'",
  };
  for (const [name, sql] of Object.entries(catalogs)) await one(`H_${name}`, async () => JSON.stringify((await rows(admin, sql))[0]));
  await one('H_roles_preexistentes', async () => (await rows(admin, "SELECT rolname||'(super='||rolsuper||',createrole='||rolcreaterole||',createdb='||rolcreatedb||',login='||rolcanlogin||')' x FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' ORDER BY 1")).map((r) => r.x).join('; '));
  await one('H_dono_dos_bancos', async () => (await rows(admin, "SELECT datname||':'||pg_get_userbyid(datdba) x FROM pg_database WHERE NOT datistemplate ORDER BY 1")).map((r) => r.x).join('; '));

  if (mode === 'read') record('ESCRITA', 'PENDENTE DE AUTORIZACAO', 'modo read: nenhum teste de escrita executado');
  else if (precheckPassed) {
    // ---- A..F: escrita reversivel, um teste por vez (SOMENTE modo write, apos aprovacao especifica) ----
    const readerPassword = crypto.randomBytes(24).toString('base64url'); secretsToMask.push(readerPassword);
    const stepA = await one('A_CREATE_ROLE_NOLOGIN', async () => {
      await guardedCreate(attempted.roles, N.roleA, () => admin.query(`CREATE ROLE ${qi(N.roleA)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`));
      const r = (await rows(admin, 'SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname=$1', [N.roleA]))[0];
      const m = await rows(admin, 'SELECT pg_get_userbyid(member) m, admin_option a, inherit_option i, set_option s FROM pg_auth_members WHERE roleid = $1::regrole', [N.roleA]);
      return `atributos=${JSON.stringify(r)} membershipsDoCriador=${JSON.stringify(m)}`;
    });
    await one('A2_CREATE_ROLE_LOGIN_CONNLIMIT_NOINHERIT', async () => {
      await guardedCreate(attempted.roles, N.reader, () => admin.query(`CREATE ROLE ${qi(N.reader)} LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2`));
      return `connlimit=${(await rows(admin, 'SELECT rolconnlimit FROM pg_roles WHERE rolname=$1', [N.reader]))[0].rolconnlimit}`;
    });
    if (stepA) {
      let roleName = N.roleA;
      const renamed = await one('B_ALTER_ROLE_RENAME', async () => { await guardedCreate(attempted.roles, N.roleB, () => admin.query(`ALTER ROLE ${qi(N.roleA)} RENAME TO ${qi(N.roleB)}`)); roleName = N.roleB; return `renomeada para ${N.roleB}`; });
      if (!renamed) roleName = N.roleA;
      const marker = `zz-probe-marker:${crypto.randomUUID()}`;
      const commented = await one('C_COMMENT_ON_ROLE', async () => { await admin.query(`COMMENT ON ROLE ${qi(roleName)} IS '${marker}'`); const r = await rows(admin, "SELECT shobj_description(oid,'pg_authid') c FROM pg_roles WHERE rolname=$1", [roleName]); return `leitura pelo admin confere=${r[0].c === marker}`; });
      if (commented) await one('D_LER_COMENTARIO_COMO_ROLE_SEM_PRIVILEGIOS', async () => {
        const c = await open(baseDb, N.reader, readerPassword, true);
        try { const r = await rows(c, "SELECT shobj_description(oid,'pg_authid') c FROM pg_roles WHERE rolname=$1", [roleName]); const s = await rows(c, 'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()'); return `comentarioVisivel=${r[0]?.c === marker} pg_stat_ssl.ssl=${s[0]?.ssl}`; } finally { await c.end(); }
      });
      const ownerOf = async (db) => (await rows(admin, 'SELECT pg_get_userbyid(datdba) o FROM pg_database WHERE datname=$1', [db]))[0]?.o;
      const createDb = async () => { await guardedCreate(attempted.dbs, N.db, () => admin.query(`CREATE DATABASE ${qi(N.db)} OWNER ${qi(roleName)} ENCODING 'UTF8' TEMPLATE template0 CONNECTION LIMIT 40`)); return `dono=${await ownerOf(N.db)}`; };
      let haveDb = await one('E_CREATE_DATABASE_OWNER_ROLE_DESCARTAVEL', createDb);
      let grantUsed = false;
      if (!haveDb) {
        const diag = await aggMembership(admin, roleName, baseUser);
        record('E_DIAGNOSTICO_MEMBERSHIP', 'COMPROVADO', JSON.stringify(diag));
        // Minimo privilegio, fundamentado (nao suposicao) na documentacao oficial do PostgreSQL
        // (Role Membership, 16 e 18, texto identico): "To create an object owned by another role ... you must have
        // the ability to SET ROLE to that role" - a ligacao documentada e com SET, nao com INHERIT, para esta
        // operacao especifica. INHERIT TRUE (uso automatico e continuo dos privilegios da role concedida) so e
        // concedido mais abaixo, na janela estrita em volta do RENAME (F0), que exige a checagem de "privilegios
        // do dono" (has_privs_of_role), essa sim dependente de INHERIT - ver E_DIAGNOSTICO/F0.
        if (!allowGrant) record('E2_GRANT_SET_TRUE_INHERIT_FALSE_NA_ROLE_DESCARTAVEL', 'PENDENTE DE AUTORIZACAO', 'exige NEON_PROBE_ALLOW_GRANT=yes');
        else if (await one('E2_GRANT_SET_TRUE_INHERIT_FALSE_NA_ROLE_DESCARTAVEL', async () => { await admin.query(`GRANT ${qi(roleName)} TO ${qi(baseUser)} WITH SET TRUE, INHERIT FALSE`); return 'grant aplicado (somente na role zz_probe_*)'; })) {
          grantUsed = true;
          const okE2B = await one('E2B_VERIFICAR_SET_TRUE_INHERIT_FALSE_SEM_ADMIN', async () => {
            const m = await aggMembership(admin, roleName, baseUser);
            if (!m.anySet || m.anyInherit) throw Object.assign(new Error(`membership inesperada (agregada sobre ${m.rowCount} linha(s), concedentes=${typeof m.grantors === 'string' ? m.grantors : (Array.isArray(m.grantors) ? m.grantors.join(',') : JSON.stringify(m.grantors))}): ${JSON.stringify(m)}`), { code: 'ASSERT' });
            return `set_option=true (em ao menos 1 de ${m.rowCount} linha(s)) inherit_option=false admin_option=${m.anyAdmin} (admin pode vir do cloud_admin)`;
          });
          if (okE2B) haveDb = await one('E3_CREATE_DATABASE_APOS_GRANT', createDb);
        }
      }
      if (haveDb) {
        await one('E4_REVOKE_GRANT_CONNECT_NO_BANCO_DESCARTAVEL', async () => { await admin.query(`REVOKE ALL ON DATABASE ${qi(N.db)} FROM PUBLIC`); await admin.query(`GRANT CONNECT ON DATABASE ${qi(N.db)} TO ${qi(N.reader)}`); return 'REVOKE/GRANT ok'; });

        // F0 - ELEVACAO TEMPORARIA E CONTROLADA, so para a janela do RENAME:
        // ALTER DATABASE RENAME exige "privilegios do dono" (has_privs_of_role), que SO acompanha memberships com
        // INHERIT - SET nao basta. CREATEDB para a propria operacao vem do ATRIBUTO PROPRIO do admin (nao herdado).
        // NUNCA eleva a role de runtime; a elevacao e so sobre a role de teste ja concedida em E2.
        let elevated = false;
        if (grantUsed) {
          elevated = await one('F0_ELEVAR_INHERIT_TRUE_PARA_RENAME', async () => {
            await admin.query(`GRANT ${qi(roleName)} TO ${qi(baseUser)} WITH SET TRUE, INHERIT TRUE`);
            const m = await aggMembership(admin, roleName, baseUser);
            if (!m.anySet || !m.anyInherit) throw Object.assign(new Error(`elevacao nao confirmada: ${JSON.stringify(m)}`), { code: 'ASSERT' });
            return `set_option=true inherit_option=true confirmados (agregado sobre ${m.rowCount} linha(s))`;
          });
        } else record('F0_ELEVAR_INHERIT_TRUE_PARA_RENAME', 'NAO TESTADO', 'o GRANT da E2 nao foi necessario (E passou sem ele) - nada para elevar');

        const canRename = !grantUsed || elevated;
        const renamedOk = canRename ? await one('F_ALTER_DATABASE_RENAME', async () => {
          await guardedCreate(attempted.dbs, N.dbRenamed, () => admin.query(`ALTER DATABASE ${qi(N.db)} RENAME TO ${qi(N.dbRenamed)}`));
          return `renomeado (dono preservado=${await ownerOf(N.dbRenamed)})`;
        }) : (record('F_ALTER_DATABASE_RENAME', 'NAO TESTADO', 'depende de F0 (elevacao)'), false);

        // G - LIMPEZA EM ORDEM SEGURA: DROP DATABASE enquanto o INHERIT ainda esta ativo (precisa dele), SO DEPOIS
        // revogar a membership por completo. Revogar ANTES do DROP DATABASE quebraria a propria limpeza (a mesma
        // causa raiz do 42501) - por isso NAO existe aqui um revoke isolado antes do DROP. Tudo fora de attempted
        // (que o "finally" tambem tentaria) e removido daqui para nao ser tentado em duplicidade.
        if (renamedOk) {
          const dropped = await one('G1_DROP_DATABASE_COM_INHERIT_AINDA_ATIVO', async () => {
            await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [N.dbRenamed]);
            await admin.query(`DROP DATABASE ${qi(N.dbRenamed)}`);
            attempted.dbs.delete(N.db); attempted.dbs.delete(N.dbRenamed);
            return `${N.dbRenamed} removido`;
          });
          if (!dropped) record('G2_REVOGAR_MEMBERSHIP_TEMPORARIA', 'NAO TESTADO', 'DROP DATABASE falhou; a limpeza generica do finally tentara de novo com o INHERIT ainda ativo');
          else if (grantUsed) await one('G2_REVOGAR_MEMBERSHIP_TEMPORARIA', async () => {
            await admin.query(`REVOKE ${qi(roleName)} FROM ${qi(baseUser)}`);
            const m = await aggMembership(admin, roleName, baseUser);
            if (m.rowCount !== 0) throw Object.assign(new Error(`membership ainda presente apos REVOKE (${m.rowCount} linha(s))`), { code: 'ASSERT' });
            return 'membership (SET e INHERIT) removida por completo';
          });
          else record('G2_REVOGAR_MEMBERSHIP_TEMPORARIA', 'NAO TESTADO', 'o GRANT nao foi necessario (E passou sem ele) - nada a revogar');
        } else {
          record('G1_DROP_DATABASE_COM_INHERIT_AINDA_ATIVO', 'NAO TESTADO', 'depende de F (rename)');
          record('G2_REVOGAR_MEMBERSHIP_TEMPORARIA', 'NAO TESTADO', 'depende de F (rename)');
        }
      } else { record('F0_ELEVAR_INHERIT_TRUE_PARA_RENAME', 'NAO TESTADO', 'banco descartavel nao foi criado'); record('F_ALTER_DATABASE_RENAME', 'NAO TESTADO', 'banco descartavel nao foi criado'); }
    } else record('B_C_D_E_F', 'NAO TESTADO', 'depende do passo A');
  }
} catch (error) {
  record('ERRO_GERAL', 'INCOMPATIVEL', `${error.code ?? ''} ${error.message}`);
} finally {
  // ---- Limpeza: somente nomes que ESTA execucao tentou criar, e somente se a pre-checagem provou que nao existiam ----
  if (admin) await cleanup();
  if (admin) {
    let verifier = admin;
    try { await verifier.query('SELECT 1'); } catch { verifier = await open().catch(() => undefined); }
    if (verifier) {
      try {
        const left = await leftovers(verifier);
        const after = await inventory(verifier);
        const same = before ? JSON.stringify(before) === JSON.stringify(after) : false;
        const clean = left.databases.length === 0 && left.roles.length === 0;
        if (!clean || !same) cleanupFailed = true;
        record('REMANESCENTES_zz_probe', clean ? 'COMPROVADO' : 'INCOMPATIVEL', JSON.stringify(left));
        record('INVENTARIO_DEPOIS_IGUAL_ANTES', same ? 'COMPROVADO' : 'INCOMPATIVEL', same ? 'bancos, roles e memberships preexistentes identicos' : 'DIFERENCA - investigar');
      } catch (error) { cleanupFailed = true; record('VERIFICACAO_FINAL', 'INCOMPATIVEL', `${error.code ?? ''} ${error.message}`); }
      if (verifier !== admin) await verifier.end().catch(() => {});
    } else { cleanupFailed = true; record('VERIFICACAO_FINAL', 'INCOMPATIVEL', 'sem conexao para verificar remanescentes - BLOQUEIO CRITICO'); }
    await admin.end().catch(() => {});
  }
  if (cleanupFailed) process.exitCode = 3;
  const interpretacao = 'TLS_EXTERNO = validado pelo cliente (CA, nome, protocolo). PG_STAT_SSL_SESSAO_INTERNA = sessao entre o proxy do provedor e o PostgreSQL; ssl=false com TLS externo comprovado indica terminacao de TLS no proxy e nao invalida o TLS externo, mas o trecho interno nao e verificavel pelo cliente.';
  if (outFile) fs.writeFileSync(path.resolve(outFile), JSON.stringify({ when: new Date().toISOString(), mode, interpretacao, results }, null, 2), 'utf8');
  console.log('\nFim. A saida acima nao contem segredos' + (outFile ? `; copia em ${path.resolve(outFile)}` : '') + '.');
}
