/**
 * RÚSTIKA — C.6 — PROVISIONAMENTO SUPERVISIONADO DO NEON (SOMENTE PROVISIONAMENTO)
 *
 * Escopo autorizado desta etapa:
 *   - validar TLS externo, hostname, endpoint, Project ID, banco administrativo e role administrativa;
 *   - inventariar bancos/roles/memberships antes de qualquer escrita;
 *   - recusar se qualquer banco `cardapio_digital_*` ou role do projeto já existir;
 *   - criar as roles legadas exigidas pelas sete migrations históricas, a role de bootstrap e a marca;
 *   - criar o banco de replay `cardapio_digital_test` com owner `cardapio_migrator`;
 *   - conceder apenas CONNECT ao migrator, à app de replay e ao bootstrap;
 *   - revogar a membership temporária usada para `CREATE DATABASE ... OWNER`;
 *   - verificar ownership, atributos, ACLs, login e ausência das identidades definitivas.
 *
 * FORA DO ESCOPO (bloqueado por este script):
 *   - `prisma migrate deploy` e qualquer escrita de schema;
 *   - renomeação para `cardapio_digital_homolog` / `cardapio_homolog_*`;
 *   - bootstrap de administrador, deploy, DROP, TRUNCATE, DELETE;
 *   - criação de arquivos `.env` ou persistência de credenciais.
 *
 * A Connection String e as senhas são lidas somente de TTY, com eco oculto. Nada é aceito por argumento,
 * variável de ambiente, pipe ou arquivo. O relatório gerado é sanitizado.
 */
import { Client } from 'pg';
import * as tls from 'node:tls';
import * as fs from 'node:fs';
import { readHiddenLine } from '../../scripts/bootstrap/hiddenPrompt';
import { inspectExternalTls } from '../../src/config/externalTlsCheck';

const EXPECTED_PROJECT_ID = 'aged-scene-47291697';
const EXPECTED_ENDPOINT_ID = 'ep-sweet-king-bd7i7ypb';
const EXPECTED_HOST_SUFFIX = 'aws.neon.tech';
const EXPECTED_ADMIN_DB = 'neondb';
const EXPECTED_ADMIN_ROLE = 'neondb_owner';
const EXPECTED_VERSION_PREFIX = '18.';

const REPLAY_DB = 'cardapio_digital_test';
const FINAL_DB = 'cardapio_digital_homolog';
const MARKER_ROLE = 'rustika_homolog_marker';
const MARKER_PREFIX = 'rustika-homolog-cluster:';
const MIN_PASSWORD_LENGTH = 24;

const ROLES = {
  migrator: 'cardapio_migrator',
  app: 'cardapio_test_app',
  placeholder: 'cardapio_dev_app',
  bootstrap: 'cardapio_homolog_bootstrap',
  finalMigrator: 'cardapio_homolog_migrator',
  finalApp: 'cardapio_homolog_app',
  finalPlaceholder: 'cardapio_homolog_placeholder',
  marker: MARKER_ROLE,
} as const;

const FINAL_ROLES = [ROLES.finalMigrator, ROLES.finalApp, ROLES.finalPlaceholder] as const;
const LEGACY_ROLES = [ROLES.migrator, ROLES.app, ROLES.placeholder] as const;
const PROJECT_ROLE_FILTER = `rolname LIKE 'cardapio\\_%' OR rolname = '${MARKER_ROLE}'`;

interface AdminSecrets {
  connectionString: string;
  migratorPassword: string;
  appPassword: string;
  bootstrapPassword: string;
}

interface ServerFacts {
  database: string;
  user: string;
  sessionUser: string;
  version: string;
  projectId: string | null;
  endpointId: string | null;
  ssl: boolean | null;
}

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  rolinherit: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  rolconnlimit: number;
}

interface DatabaseRow {
  datname: string;
  owner: string;
  datallowconn: boolean;
  datconnlimit: number;
  publicHasAccess: boolean;
}

interface MembershipRow {
  role: string;
  member: string;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
}

interface Inventory {
  databases: DatabaseRow[];
  projectRoles: RoleRow[];
  memberships: MembershipRow[];
  roleCount: number;
  projectDatabases: string[];
  projectRoleNames: string[];
  replayDatabase: DatabaseRow | undefined;
  finalDatabaseExists: boolean;
  finalRolesPresent: string[];
}

interface MarkerRow {
  comment: string | null;
  canLogin: boolean;
}

interface DatabasePrivilegeRow {
  canConnect: boolean;
  canCreate: boolean;
  canTemp: boolean;
}

interface RoleMembershipCheck {
  rows: number;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
}

interface ReplayAclRow {
  publicConnect: boolean;
  publicTemp: boolean;
  migratorConnect: boolean;
  appConnect: boolean;
  bootstrapConnect: boolean;
  placeholderConnect: boolean;
  markerConnect: boolean;
  appTemp: boolean;
  bootstrapTemp: boolean;
  placeholderTemp: boolean;
  markerTemp: boolean;
}

const secrets: AdminSecrets = {
  connectionString: '',
  migratorPassword: '',
  appPassword: '',
  bootstrapPassword: '',
};

function clearSecrets(): void {
  secrets.connectionString = '';
  secrets.migratorPassword = '';
  secrets.appPassword = '';
  secrets.bootstrapPassword = '';
  delete process.env.DATABASE_URL;
  delete process.env.SHADOW_DATABASE_URL;
  delete process.env.RUSTIKA_HOMOLOG_DATABASE_URL;
}

function redact(text: string): string {
  return text.replace(/postgres(ql)?:\/\/[^\s@]*@/gi, 'postgresql://***@');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error('Connection string com codificação inválida.');
  }
}

function parseAdminConnectionString(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('Connection string inválida.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('A Connection String deve usar postgres:// ou postgresql://.');
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname.endsWith(`.${EXPECTED_HOST_SUFFIX}`)) {
    throw new Error(`Hostname fora do sufixo esperado ${EXPECTED_HOST_SUFFIX}.`);
  }
  if (hostname.includes('-pooler')) {
    throw new Error('Use o endpoint direto do Neon (sem -pooler).');
  }
  if (!hostname.startsWith(`${EXPECTED_ENDPOINT_ID}.`)) {
    throw new Error(`Hostname não pertence ao endpoint ${EXPECTED_ENDPOINT_ID}.`);
  }

  const port = url.port === '' ? '5432' : url.port;
  if (port !== '5432') throw new Error('Porta diferente de 5432.');

  if (safeDecode(url.username) !== EXPECTED_ADMIN_ROLE) {
    throw new Error(`Role administrativa deve ser ${EXPECTED_ADMIN_ROLE}.`);
  }
  if (safeDecode(url.password) === '') throw new Error('Connection String sem senha.');

  const database = safeDecode(url.pathname.replace(/^\/+/, '').replace(/\/+$/, ''));
  if (database !== EXPECTED_ADMIN_DB) {
    throw new Error(`Banco administrativo deve ser ${EXPECTED_ADMIN_DB}.`);
  }

  const sslmode = url.searchParams.get('sslmode');
  if (sslmode !== null && !['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    throw new Error('sslmode inseguro: use require, verify-ca ou verify-full.');
  }

  return url;
}

async function verifyExternalTls(hostname: string, port: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname });
    socket.setTimeout(20_000, () => {
      socket.destroy();
      reject(new Error('Timeout na verificação TLS externa.'));
    });
    socket.once('secureConnect', () => {
      const result = inspectExternalTls(socket, hostname);
      socket.destroy();
      if (!result.proven) {
        reject(new Error(`TLS externo não comprovado: ${result.reasons.join('; ')}`));
        return;
      }
      resolve(`TLS ${result.protocol} (${result.cipher}; CA ${result.issuer})`);
    });
    socket.once('error', (error: Error) => {
      reject(new Error(`Falha na conexão TLS externa: ${redact(error.message)}`));
    });
  });
}

function buildClient(url: URL, database: string, user: string, password: string, applicationName: string): Client {
  const target = new URL('postgresql://localhost/');
  target.hostname = url.hostname;
  target.port = url.port;
  target.username = user;
  target.password = password;
  target.pathname = `/${database}`;
  target.searchParams.set('application_name', applicationName);
  const channelBinding = url.searchParams.get('channel_binding');
  if (channelBinding !== null) target.searchParams.set('channel_binding', channelBinding);

  return new Client({
    connectionString: target.toString(),
    ssl: { rejectUnauthorized: true, servername: url.hostname },
    connectionTimeoutMillis: 30_000,
    query_timeout: 60_000,
    statement_timeout: 60_000,
  });
}

async function readServerFacts(client: Client): Promise<ServerFacts> {
  const result = await client.query<ServerFacts>(`
    SELECT current_database() AS database,
           current_user AS "user",
           session_user AS "sessionUser",
           current_setting('server_version') AS version,
           current_setting('neon.project_id', true) AS "projectId",
           current_setting('neon.endpoint_id', true) AS "endpointId",
           (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl
  `);
  const row = result.rows[0];
  assert(row !== undefined, 'Não foi possível ler a identidade do servidor.');
  return row;
}

async function readInventory(client: Client): Promise<Inventory> {
  const dbResult = await client.query<DatabaseRow>(`
    SELECT datname,
           pg_get_userbyid(datdba) AS owner,
           datallowconn,
           datconnlimit,
           EXISTS (
             SELECT 1
               FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
              WHERE acl.grantee = 0
                AND acl.privilege_type IN ('CONNECT', 'TEMPORARY')
           ) AS "publicHasAccess"
      FROM pg_database
     ORDER BY datname
  `);

  const roleResult = await client.query<RoleRow>(`
    SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit,
           rolreplication, rolbypassrls, rolconnlimit
      FROM pg_roles
     WHERE ${PROJECT_ROLE_FILTER}
     ORDER BY rolname
  `);

  const membershipResult = await client.query<MembershipRow>(`
    SELECT granted.rolname AS role,
           member.rolname AS member,
           am.admin_option AS "adminOption",
           am.inherit_option AS "inheritOption",
           am.set_option AS "setOption"
      FROM pg_auth_members am
      JOIN pg_roles granted ON granted.oid = am.roleid
      JOIN pg_roles member ON member.oid = am.member
     WHERE granted.rolname LIKE 'cardapio\\_%'
        OR granted.rolname = $1
        OR member.rolname LIKE 'cardapio\\_%'
        OR member.rolname = $1
     ORDER BY 1, 2
  `, [MARKER_ROLE]);

  const countResult = await client.query<{ roleCount: number }>('SELECT count(*)::int AS "roleCount" FROM pg_roles');
  const roleCount = countResult.rows[0]?.roleCount;
  assert(typeof roleCount === 'number', 'Não foi possível contar as roles do cluster.');

  const projectDatabases = dbResult.rows
    .map((row) => row.datname)
    .filter((name) => name.startsWith('cardapio_digital_'));
  const projectRoleNames = roleResult.rows.map((row) => row.rolname);

  return {
    databases: dbResult.rows,
    projectRoles: roleResult.rows,
    memberships: membershipResult.rows,
    roleCount,
    projectDatabases,
    projectRoleNames,
    replayDatabase: dbResult.rows.find((row) => row.datname === REPLAY_DB),
    finalDatabaseExists: dbResult.rows.some((row) => row.datname === FINAL_DB),
    finalRolesPresent: FINAL_ROLES.filter((role) => projectRoleNames.includes(role)),
  };
}

function roleBy(rows: RoleRow[], name: string): RoleRow {
  const row = rows.find((item) => item.rolname === name);
  assert(row !== undefined, `Role ${name} não encontrada no catálogo.`);
  return row;
}

function assertMinimalAttributes(role: RoleRow, expectedLogin: boolean, expectedConnLimit: number | null): void {
  assert(!role.rolsuper, `${role.rolname}: rolsuper inesperado.`);
  assert(!role.rolcreaterole, `${role.rolname}: rolcreaterole inesperado.`);
  assert(!role.rolcreatedb, `${role.rolname}: rolcreatedb inesperado.`);
  assert(!role.rolreplication, `${role.rolname}: rolreplication inesperado.`);
  assert(!role.rolbypassrls, `${role.rolname}: rolbypassrls inesperado.`);
  assert(!role.rolinherit, `${role.rolname}: rolinherit inesperado.`);
  assert(role.rolcanlogin === expectedLogin, `${role.rolname}: rolcanlogin diferente do esperado.`);
  if (expectedConnLimit !== null) {
    assert(role.rolconnlimit === expectedConnLimit, `${role.rolname}: connection limit diferente do esperado.`);
  }
}

function buildRoleSql(client: Client, role: string, options: {
  login: boolean;
  password?: string;
  connLimit?: number;
}): string {
  const parts = [
    `CREATE ROLE ${client.escapeIdentifier(role)}`,
    options.login ? 'LOGIN' : 'NOLOGIN',
  ];
  if (options.password !== undefined) parts.push(`PASSWORD ${client.escapeLiteral(options.password)}`);
  parts.push('NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS', 'NOINHERIT');
  if (options.connLimit !== undefined) parts.push(`CONNECTION LIMIT ${options.connLimit}`);
  return `${parts.join(' ')};`;
}

async function databasePrivileges(client: Client, role: string, database: string): Promise<DatabasePrivilegeRow> {
  const result = await client.query<DatabasePrivilegeRow>(`
    SELECT has_database_privilege($1, $2, 'CONNECT') AS "canConnect",
           has_database_privilege($1, $2, 'CREATE') AS "canCreate",
           has_database_privilege($1, $2, 'TEMPORARY') AS "canTemp"
  `, [role, database]);
  const row = result.rows[0];
  assert(row !== undefined, `Não foi possível ler privilégios de ${role} em ${database}.`);
  return row;
}

async function membershipCheck(client: Client, role: string): Promise<RoleMembershipCheck> {
  const result = await client.query<RoleMembershipCheck>(`
    SELECT count(*)::int AS rows,
           COALESCE(bool_or(am.admin_option), false) AS "adminOption",
           COALESCE(bool_or(am.inherit_option), false) AS "inheritOption",
           COALESCE(bool_or(am.set_option), false) AS "setOption"
      FROM pg_auth_members am
      JOIN pg_roles granted ON granted.oid = am.roleid
      JOIN pg_roles member ON member.oid = am.member
     WHERE granted.rolname = $1
       AND member.rolname = current_user
  `, [role]);
  const row = result.rows[0];
  assert(row !== undefined, `Não foi possível verificar a membership de ${role}.`);
  return row;
}

async function verifyDatabaseAsRole(url: URL, role: string, password: string, database: string, applicationName: string): Promise<{
  facts: ServerFacts;
  privileges: DatabasePrivilegeRow;
  ownsDatabase: boolean;
  schemaCreate: boolean;
  schemaUsage: boolean;
  userTableCount: number;
}> {
  const client = buildClient(url, database, role, password, applicationName);
  await client.connect();
  try {
    const facts = await readServerFacts(client);
    const privileges = await databasePrivileges(client, role, database);
    const ownerResult = await client.query<{ ownsDatabase: boolean }>(`
      SELECT (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = current_user AS "ownsDatabase"
    `);
    const schemaResult = await client.query<{ schemaCreate: boolean; schemaUsage: boolean }>(`
      SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate",
             has_schema_privilege(current_user, 'public', 'USAGE') AS "schemaUsage"
    `);
    const tableResult = await client.query<{ userTableCount: number }>(`
      SELECT count(*)::int AS "userTableCount"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    `);
    const ownsDatabase = ownerResult.rows[0]?.ownsDatabase;
    const schema = schemaResult.rows[0];
    const userTableCount = tableResult.rows[0]?.userTableCount;
    assert(typeof ownsDatabase === 'boolean', 'Não foi possível verificar o ownership do banco.');
    assert(schema !== undefined, 'Não foi possível verificar privilégios do schema public.');
    assert(typeof userTableCount === 'number', 'Não foi possível contar objetos no schema public.');
    return { facts, privileges, ownsDatabase, schemaCreate: schema.schemaCreate, schemaUsage: schema.schemaUsage, userTableCount };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function readReplayAcl(client: Client, database: string): Promise<ReplayAclRow> {
  const result = await client.query<ReplayAclRow>(`
    SELECT
      EXISTS (
        SELECT 1
          FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'CONNECT'
      ) AS "publicConnect",
      EXISTS (
        SELECT 1
          FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
         WHERE acl.grantee = 0 AND acl.privilege_type = 'TEMPORARY'
      ) AS "publicTemp",
      has_database_privilege($2, datname, 'CONNECT') AS "migratorConnect",
      has_database_privilege($3, datname, 'CONNECT') AS "appConnect",
      has_database_privilege($4, datname, 'CONNECT') AS "bootstrapConnect",
      has_database_privilege($5, datname, 'CONNECT') AS "placeholderConnect",
      has_database_privilege($6, datname, 'CONNECT') AS "markerConnect",
      has_database_privilege($3, datname, 'TEMPORARY') AS "appTemp",
      has_database_privilege($4, datname, 'TEMPORARY') AS "bootstrapTemp",
      has_database_privilege($5, datname, 'TEMPORARY') AS "placeholderTemp",
      has_database_privilege($6, datname, 'TEMPORARY') AS "markerTemp"
      FROM pg_database
     WHERE datname = $1
  `, [
    database,
    ROLES.migrator,
    ROLES.app,
    ROLES.bootstrap,
    ROLES.placeholder,
    ROLES.marker,
  ]);
  const row = result.rows[0];
  assert(row !== undefined, `Não foi possível ler a ACL de ${database}.`);
  return row;
}

/**
 * A correção C.6-FIX01: `REVOKE`/`GRANT` em um banco cujo owner é `cardapio_migrator` NÃO podem ser
 * executados pela role administrativa `neondb_owner`. Ela tem apenas a membership temporária com SET TRUE e
 * INHERIT FALSE (sem SET ROLE, não herda os privilégios do owner); nesse caso o PostgreSQL emite WARNING
 * ("no privileges could be revoked/granted") e o comando NÃO altera a ACL — exatamente a falha observada na
 * C.6, em que PUBLIC manteve CONNECT/TEMPORARY. Por isso a ACL é aplicada em uma conexão própria, autenticada
 * como o owner do banco, e conferida imediatamente antes de a membership temporária ser revogada.
 */
async function applyReplayDatabaseAclAsOwner(url: URL, database: string, migratorPassword: string): Promise<void> {
  const owner = buildClient(url, database, ROLES.migrator, migratorPassword, 'rustika-c6-replay-acl-owner');
  await owner.connect();
  try {
    const facts = await readServerFacts(owner);
    assert(facts.database === database, `ACL: banco inesperado na conexão do owner: ${facts.database}.`);
    assert(facts.user === ROLES.migrator, `ACL: current_user inesperado: ${facts.user}.`);
    assert(facts.sessionUser === ROLES.migrator, `ACL: session_user inesperado: ${facts.sessionUser}.`);
    const ownerResult = await owner.query<{ ownsDatabase: boolean }>(`
      SELECT (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = current_user AS "ownsDatabase"
    `);
    assert(ownerResult.rows[0]?.ownsDatabase === true, 'ACL: a conexão de correção não é do owner do banco.');

    // Escopo mínimo pedido na recuperação da C.6: somente CONNECT/TEMPORARY de PUBLIC. Como a conexão é do
    // owner, os comandos são efetivos; não há SET ROLE nem elevação adicional nesta etapa.
    await owner.query(
      `REVOKE CONNECT, TEMPORARY ON DATABASE ${owner.escapeIdentifier(database)} FROM PUBLIC;`,
    );
    await owner.query(
      `GRANT CONNECT ON DATABASE ${owner.escapeIdentifier(database)} TO ` +
      `${owner.escapeIdentifier(ROLES.migrator)}, ${owner.escapeIdentifier(ROLES.app)}, ${owner.escapeIdentifier(ROLES.bootstrap)};`,
    );

    const acl = await readReplayAcl(owner, database);
    assert(!acl.publicConnect, 'PUBLIC ainda tem CONNECT no banco de replay após o REVOKE.');
    assert(!acl.publicTemp, 'PUBLIC ainda tem TEMPORARY no banco de replay após o REVOKE.');
    assert(acl.migratorConnect, 'O owner perdeu CONNECT no banco de replay.');
    assert(acl.appConnect, 'A app de replay não recebeu CONNECT.');
    assert(acl.bootstrapConnect, 'O bootstrap não recebeu CONNECT.');
    assert(!acl.placeholderConnect, 'O placeholder recebeu CONNECT indevido.');
    assert(!acl.markerConnect, 'A marca recebeu CONNECT indevido.');
    assert(!acl.appTemp, 'A app recebeu TEMPORARY indevido.');
    assert(!acl.bootstrapTemp, 'O bootstrap recebeu TEMPORARY indevido.');
    assert(!acl.placeholderTemp, 'O placeholder recebeu TEMPORARY indevido.');
    assert(!acl.markerTemp, 'A marca recebeu TEMPORARY indevido.');
  } finally {
    await owner.end().catch(() => undefined);
  }
}

function formatRole(role: RoleRow): string {
  return [
    role.rolname,
    `login=${role.rolcanlogin}`,
    `inherit=${role.rolinherit}`,
    `super=${role.rolsuper}`,
    `createdb=${role.rolcreatedb}`,
    `createrole=${role.rolcreaterole}`,
    `replication=${role.rolreplication}`,
    `bypassrls=${role.rolbypassrls}`,
    `connlimit=${role.rolconnlimit}`,
  ].join(' ');
}

function formatDatabase(database: DatabaseRow): string {
  return `${database.datname} owner=${database.owner} allowconn=${database.datallowconn} connlimit=${database.datconnlimit} publicAccess=${database.publicHasAccess}`;
}

async function readMarker(client: Client): Promise<MarkerRow> {
  const result = await client.query<MarkerRow>(`
    SELECT shobj_description(oid, 'pg_authid') AS comment,
           rolcanlogin AS "canLogin"
      FROM pg_roles
     WHERE rolname = $1
  `, [MARKER_ROLE]);
  const row = result.rows[0];
  assert(row !== undefined, `Role de marca ${MARKER_ROLE} não encontrada.`);
  return row;
}

async function main(): Promise<void> {
  console.log('--- RÚSTIKA: C.6 — PROVISIONAMENTO NEON (SOMENTE BANCO E ROLES) ---');
  console.log('Sem prisma migrate deploy, sem rename, sem bootstrap, sem DROP.');

  const confirmation = (await readHiddenLine('Digite "C.6-PROVISION" para prosseguir: ')).trim();
  if (confirmation !== 'C.6-PROVISION') {
    throw new Error('Confirmação incorreta. Nada foi executado.');
  }

  secrets.connectionString = (await readHiddenLine('1. Connection String do neondb_owner (entrada oculta): ')).trim();
  const url = parseAdminConnectionString(secrets.connectionString);

  secrets.migratorPassword = await readHiddenLine(`2. Senha de ${ROLES.migrator} (mín. ${MIN_PASSWORD_LENGTH}, oculta): `);
  secrets.appPassword = await readHiddenLine(`3. Senha de ${ROLES.app} (mín. ${MIN_PASSWORD_LENGTH}, oculta): `);
  secrets.bootstrapPassword = await readHiddenLine(`4. Senha de ${ROLES.bootstrap} (mín. ${MIN_PASSWORD_LENGTH}, oculta): `);

  for (const [role, password] of [
    [ROLES.migrator, secrets.migratorPassword],
    [ROLES.app, secrets.appPassword],
    [ROLES.bootstrap, secrets.bootstrapPassword],
  ] as const) {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Senha de ${role} muito curta (mín. ${MIN_PASSWORD_LENGTH}).`);
  }
  if (new Set([secrets.migratorPassword, secrets.appPassword, secrets.bootstrapPassword]).size !== 3) {
    throw new Error('As três senhas devem ser distintas.');
  }

  const report: string[] = [
    '# Relatório de Provisionamento C.6 — somente provisionamento',
    '',
    `- Data (UTC): ${new Date().toISOString()}`,
    '- Status: em execução (o status final está no fim do relatório).',
    '- Modo: somente banco e roles; `prisma migrate deploy` NÃO executado.',
    '',
  ];

  console.log('\n[1/8] Verificando TLS externo...');
  const tlsDescription = await verifyExternalTls(url.hostname, Number(url.port === '' ? '5432' : url.port));
  console.log(`TLS externo comprovado: ${tlsDescription}`);

  const admin = buildClient(url, EXPECTED_ADMIN_DB, safeDecode(url.username), safeDecode(url.password), 'rustika-c6-provision-admin');
  let connected = false;
  const createdRoleNames: string[] = [];
  let createdDatabase = false;
  let membershipGranted = false;
  let markerComment = '';

  try {
    console.log('[2/8] Conectando ao banco administrativo e lendo inventário...');
    await admin.connect();
    connected = true;
    // A Connection String já foi consumida pelo cliente administrativo; não é mais necessária em texto.
    secrets.connectionString = '';
    url.password = '';

    const beforeFacts = await readServerFacts(admin);
    assert(beforeFacts.database === EXPECTED_ADMIN_DB, `Banco administrativo inesperado: ${beforeFacts.database}.`);
    assert(beforeFacts.user === EXPECTED_ADMIN_ROLE, `Role administrativa inesperada: ${beforeFacts.user}.`);
    assert(beforeFacts.sessionUser === EXPECTED_ADMIN_ROLE, `session_user inesperado: ${beforeFacts.sessionUser}.`);
    assert(beforeFacts.version.startsWith(EXPECTED_VERSION_PREFIX), `PostgreSQL ${beforeFacts.version} não é 18.x.`);
    assert(beforeFacts.projectId === EXPECTED_PROJECT_ID, `Project ID inesperado: ${beforeFacts.projectId ?? '(ausente)'}.`);
    if (beforeFacts.endpointId !== null && beforeFacts.endpointId !== '') {
      const endpointMatches = beforeFacts.endpointId === EXPECTED_ENDPOINT_ID
        || beforeFacts.endpointId.startsWith(`${EXPECTED_ENDPOINT_ID}.`)
        || beforeFacts.endpointId.startsWith(`${EXPECTED_ENDPOINT_ID}-`);
      assert(endpointMatches, `Endpoint ID inesperado: ${beforeFacts.endpointId}.`);
    }

    const adminAttributes = await admin.query<{
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolsuper: boolean;
    }>(`
      SELECT rolcreatedb, rolcreaterole, rolsuper
        FROM pg_roles
       WHERE rolname = current_user
    `);
    const adminRow = adminAttributes.rows[0];
    assert(adminRow !== undefined, 'Role administrativa não encontrada no catálogo.');
    assert(adminRow.rolcreatedb || adminRow.rolsuper, 'A role administrativa não tem CREATEDB.');
    assert(adminRow.rolcreaterole || adminRow.rolsuper, 'A role administrativa não tem CREATEROLE.');

    const before = await readInventory(admin);
    assert(before.projectDatabases.length === 0,
      `Ambiente não está limpo: bancos do projeto já existem (${before.projectDatabases.join(', ')}).`);
    assert(before.projectRoleNames.length === 0,
      `Ambiente não está limpo: roles do projeto já existem (${before.projectRoleNames.join(', ')}).`);
    assert(!before.finalDatabaseExists, `Banco definitivo ${FINAL_DB} já existe.`);
    assert(before.finalRolesPresent.length === 0,
      `Roles definitivas já existem (${before.finalRolesPresent.join(', ')}).`);

    report.push(
      '- Identidade validada:',
      `  - Projeto Neon: ${EXPECTED_PROJECT_ID}`,
      `  - Endpoint esperado: ${EXPECTED_ENDPOINT_ID}`,
      `  - Host: ${url.hostname}`,
      `  - Banco administrativo: ${beforeFacts.database}`,
      `  - Role administrativa: ${beforeFacts.user}`,
      `  - PostgreSQL: ${beforeFacts.version}`,
      `  - neon.project_id: ${beforeFacts.projectId}`,
      `  - neon.endpoint_id: ${beforeFacts.endpointId ?? '(não exposto)'}`,
      `  - TLS externo: ${tlsDescription}`,
      `  - pg_stat_ssl.ssl: ${String(beforeFacts.ssl)} (false/null é esperado no Neon; o TLS termina no proxy)`,
      '- Inventário inicial:',
      `  - Bancos: ${before.databases.map(formatDatabase).join(' | ')}`,
      `  - Roles do projeto: ${before.projectRoleNames.length === 0 ? 'nenhuma' : before.projectRoleNames.join(', ')}`,
      `  - Total de roles no cluster: ${before.roleCount}`,
      `  - Banco definitivo ${FINAL_DB}: ausente`,
      `  - Roles definitivas: ausentes`,
      '',
    );

    console.log('[3/8] Criando roles legadas, bootstrap e marca...');
    await admin.query(buildRoleSql(admin, ROLES.migrator, {
      login: true,
      password: secrets.migratorPassword,
      connLimit: 5,
    }));
    createdRoleNames.push(ROLES.migrator);
    await admin.query(buildRoleSql(admin, ROLES.app, {
      login: true,
      password: secrets.appPassword,
      connLimit: 20,
    }));
    createdRoleNames.push(ROLES.app);
    await admin.query(buildRoleSql(admin, ROLES.placeholder, { login: false }));
    createdRoleNames.push(ROLES.placeholder);
    await admin.query(buildRoleSql(admin, ROLES.bootstrap, {
      login: false,
      password: secrets.bootstrapPassword,
      connLimit: 2,
    }));
    createdRoleNames.push(ROLES.bootstrap);
    await admin.query(buildRoleSql(admin, ROLES.marker, { login: false }));
    createdRoleNames.push(ROLES.marker);

    const markerResult = await admin.query<{ marker: string }>(
      `SELECT '${MARKER_PREFIX}' || gen_random_uuid()::text AS marker`,
    );
    markerComment = markerResult.rows[0]?.marker ?? '';
    assert(markerComment.startsWith(MARKER_PREFIX), 'Não foi possível gerar a marca do cluster.');
    await admin.query(`COMMENT ON ROLE ${admin.escapeIdentifier(ROLES.marker)} IS ${admin.escapeLiteral(markerComment)};`);

    report.push(
      '- Roles criadas com privilégio mínimo:',
      `  - ${ROLES.migrator}: LOGIN, senha própria, NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS/NOINHERIT, connection limit 5.`,
      `  - ${ROLES.app}: LOGIN, senha própria, mesmos atributos, connection limit 20.`,
      `  - ${ROLES.placeholder}: NOLOGIN, mesmos atributos, sem senha.`,
      `  - ${ROLES.bootstrap}: NOLOGIN, senha própria, mesmos atributos, connection limit 2.`,
      `  - ${ROLES.marker}: NOLOGIN, mesmos atributos, sem senha.`,
      `  - Marca do cluster: ${markerComment} (não é credencial; copie para EXPECTED_CLUSTER_ID).`,
      '',
    );

    console.log('[4/8] Concedendo SET temporário e criando o banco de replay...');
    await admin.query(`GRANT ${admin.escapeIdentifier(ROLES.migrator)} TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;`);
    membershipGranted = true;
    await admin.query(
      `CREATE DATABASE ${admin.escapeIdentifier(REPLAY_DB)} OWNER ${admin.escapeIdentifier(ROLES.migrator)} ` +
      `ENCODING 'UTF8' TEMPLATE template0 CONNECTION LIMIT 40;`,
    );
    createdDatabase = true;
    // C.6-FIX01: a ACL é aplicada pelo OWNER do banco, em conexão própria. A role administrativa não é owner
    // e não herda privilégios (membership com INHERIT FALSE), então um REVOKE/GRANT aqui seria um no-op com
    // WARNING — foi exatamente a causa da falha original em [6/8].
    await applyReplayDatabaseAclAsOwner(url, REPLAY_DB, secrets.migratorPassword);

    console.log('[5/8] Revogando a membership temporária...');
    await admin.query(`REVOKE ${admin.escapeIdentifier(ROLES.migrator)} FROM CURRENT_USER;`);
    membershipGranted = false;
    const membership = await membershipCheck(admin, ROLES.migrator);
    assert(!membership.setOption, 'A membership temporária ainda tem SET.');
    assert(!membership.inheritOption, 'A membership temporária ainda tem INHERIT.');
    // PostgreSQL 16+ concede automaticamente a role criada ao criador com ADMIN OPTION,
    // SET FALSE e INHERIT FALSE, registrada pelo superusuário de bootstrap. Essa linha
    // não pode ser removida por um usuário CREATEROLE e NÃO permite SET ROLE nem herança.
    assert(
      membership.rows === 0 || (membership.rows === 1 && membership.adminOption && !membership.setOption && !membership.inheritOption),
      'Membership inesperada após a revogação da elevação temporária.',
    );

    console.log('[6/8] Verificando ownership, atributos e ACLs...');
    const after = await readInventory(admin);
    assert(after.projectDatabases.includes(REPLAY_DB), `Banco de replay ${REPLAY_DB} não foi encontrado.`);
    assert(!after.finalDatabaseExists, `Banco definitivo ${FINAL_DB} não deveria existir nesta etapa.`);
    assert(after.finalRolesPresent.length === 0,
      `Roles definitivas não deveriam existir nesta etapa (${after.finalRolesPresent.join(', ')}).`);

    const replay = after.replayDatabase;
    assert(replay !== undefined, 'Banco de replay não encontrado no inventário.');
    assert(replay.owner === ROLES.migrator, `Owner do replay é ${replay.owner}, esperado ${ROLES.migrator}.`);
    assert(replay.datallowconn, 'O banco de replay não aceita conexões.');
    assert(replay.datconnlimit === 40, `Connection limit do replay é ${replay.datconnlimit}, esperado 40.`);
    assert(!replay.publicHasAccess, 'PUBLIC ainda tem CONNECT/TEMPORARY no banco de replay.');

    for (const [role, expectedLogin, expectedConnLimit] of [
      [ROLES.migrator, true, 5],
      [ROLES.app, true, 20],
      [ROLES.placeholder, false, null],
      [ROLES.bootstrap, false, 2],
      [ROLES.marker, false, null],
    ] as const) {
      assertMinimalAttributes(roleBy(after.projectRoles, role), expectedLogin, expectedConnLimit);
    }

    const expectedPrivileges = [
      [ROLES.migrator, true, true, true],
      [ROLES.app, true, false, false],
      [ROLES.placeholder, false, false, false],
      [ROLES.bootstrap, true, false, false],
      [ROLES.marker, false, false, false],
    ] as const;
    for (const [role, canConnect, canCreate, canTemp] of expectedPrivileges) {
      const privileges = await databasePrivileges(admin, role, REPLAY_DB);
      assert(privileges.canConnect === canConnect, `${role}: CONNECT no replay diferente do esperado.`);
      assert(privileges.canCreate === canCreate, `${role}: CREATE no replay diferente do esperado.`);
      assert(privileges.canTemp === canTemp, `${role}: TEMPORARY no replay diferente do esperado.`);
    }

    const marker = await readMarker(admin);
    assert(marker.comment === markerComment, 'O comentário da marca não confere com o UUID gerado.');
    assert(!marker.canLogin, `A role de marca ${ROLES.marker} não pode ter login.`);

    const neonSuperuserMembers = await admin.query<{ role: string }>(`
      SELECT member.rolname AS role
        FROM pg_auth_members am
        JOIN pg_roles granted ON granted.oid = am.roleid
        JOIN pg_roles member ON member.oid = am.member
       WHERE granted.rolname = 'neon_superuser'
         AND (member.rolname LIKE 'cardapio\\_%' OR member.rolname = $1)
    `, [MARKER_ROLE]);
    assert(neonSuperuserMembers.rowCount === 0, 'Alguma role do projeto é membro de neon_superuser.');

    const temporaryElevations = after.memberships.filter((row) => row.setOption || row.inheritOption);
    assert(temporaryElevations.length === 0,
      `Memberships com SET/INHERIT inesperadas: ${temporaryElevations.map((row) => `${row.role}->${row.member}`).join(', ')}.`);
    const projectRolesAsMembers = after.memberships.filter((row) => row.member !== EXPECTED_ADMIN_ROLE);
    assert(projectRolesAsMembers.length === 0,
      `Roles do projeto aparecem como membros: ${projectRolesAsMembers.map((row) => `${row.role}->${row.member}`).join(', ')}.`);
    const unexpectedAdminMemberships = after.memberships.filter((row) =>
      row.member === EXPECTED_ADMIN_ROLE && !(row.adminOption && !row.setOption && !row.inheritOption),
    );
    assert(unexpectedAdminMemberships.length === 0,
      `Memberships administrativas inesperadas: ${unexpectedAdminMemberships.map((row) => `${row.role}->${row.member}`).join(', ')}.`);
    const automaticAdminGrants = after.memberships.filter((row) => row.member === EXPECTED_ADMIN_ROLE);

    console.log('[7/8] Verificando login e isolamento das roles de replay...');
    const migratorCheck = await verifyDatabaseAsRole(
      url, ROLES.migrator, secrets.migratorPassword, REPLAY_DB, 'rustika-c6-verify-migrator',
    );
    assert(migratorCheck.facts.database === REPLAY_DB, 'Migrator não está conectado ao banco de replay.');
    assert(migratorCheck.facts.user === ROLES.migrator, 'current_user do migrator inesperado.');
    assert(migratorCheck.facts.sessionUser === ROLES.migrator, 'session_user do migrator inesperado.');
    assert(migratorCheck.facts.version.startsWith(EXPECTED_VERSION_PREFIX), 'Versão do PostgreSQL no replay não é 18.x.');
    assert(migratorCheck.facts.projectId === EXPECTED_PROJECT_ID, 'Project ID no replay inesperado.');
    assert(migratorCheck.ownsDatabase, 'O migrator não é o owner do banco de replay.');
    assert(migratorCheck.privileges.canConnect, 'O migrator não tem CONNECT no replay.');
    assert(migratorCheck.privileges.canCreate, 'O migrator não tem CREATE no replay.');
    assert(migratorCheck.schemaCreate, 'O migrator não tem CREATE no schema public.');
    assert(migratorCheck.userTableCount === 0, 'O banco de replay não está vazio (há objetos no schema public).');

    const appCheck = await verifyDatabaseAsRole(
      url, ROLES.app, secrets.appPassword, REPLAY_DB, 'rustika-c6-verify-app',
    );
    assert(appCheck.facts.database === REPLAY_DB, 'App não está conectada ao banco de replay.');
    assert(appCheck.facts.user === ROLES.app, 'current_user da app inesperado.');
    assert(appCheck.facts.sessionUser === ROLES.app, 'session_user da app inesperado.');
    assert(appCheck.privileges.canConnect, 'A app não tem CONNECT no replay.');
    assert(!appCheck.privileges.canCreate, 'A app tem CREATE indevido no replay.');
    assert(!appCheck.privileges.canTemp, 'A app tem TEMPORARY indevido no replay.');
    assert(!appCheck.schemaCreate, 'A app tem CREATE indevido no schema public.');
    assert(appCheck.userTableCount === 0, 'O banco de replay não está vazio para a app.');

    report.push(
      '- Banco de replay criado:',
      `  - ${REPLAY_DB}: owner=${replay.owner}, allowconn=${replay.datallowconn}, connlimit=${replay.datconnlimit}, publicAccess=${replay.publicHasAccess}.`,
      '  - ACL: CONNECT para migrator, app de replay e bootstrap; nenhum CONNECT para placeholder/marca/PUBLIC.',
      '  - O banco está vazio: nenhuma tabela, sequência, view ou migration foi criada.',
      '',
      '- Verificação de privilégios no replay:',
      `  - ${ROLES.migrator}: CONNECT/CREATE no banco, CREATE no schema public, owner do banco, login confirmado.`,
      `  - ${ROLES.app}: CONNECT, sem CREATE/TEMPORARY no banco, sem CREATE no schema public, login confirmado.`,
      `  - ${ROLES.placeholder}: sem CONNECT, NOLOGIN.`,
      `  - ${ROLES.bootstrap}: CONNECT, sem CREATE/TEMPORARY, NOLOGIN.`,
      `  - ${ROLES.marker}: sem CONNECT, NOLOGIN, comentário ${markerComment}.`,
      '',
      '- Membership temporária:',
      '  - `GRANT cardapio_migrator TO neondb_owner WITH SET TRUE, INHERIT FALSE` executado apenas para `CREATE DATABASE ... OWNER`.',
      '  - `REVOKE cardapio_migrator FROM neondb_owner` executado.',
      `  - pg_auth_members: ${membership.rows} linha(s) para neondb_owner -> cardapio_migrator; admin/inherit/set = ${membership.adminOption}/${membership.inheritOption}/${membership.setOption}.`,
      '  - A linha automática de ADMIN OPTION do PostgreSQL 16+ (quando existir) não concede SET ROLE nem herança; a elevação temporária com SET/INHERIT foi revogada.',
      `  - Linhas automáticas de ADMIN OPTION observadas para as roles criadas: ${automaticAdminGrants.length}.`,
      '  - O `03-verify-replay.sql` e o `neon/02-revoke-set-true-migrator.sql` toleram essa linha ADMIN-only e continuam recusando qualquer SET/INHERIT.',
      '',
      '- Inventário final:',
      `  - Bancos: ${after.databases.map(formatDatabase).join(' | ')}`,
      `  - Roles do projeto: ${after.projectRoleNames.join(', ')}`,
      `  - Banco definitivo ${FINAL_DB}: ausente`,
      '  - Roles definitivas cardapio_homolog_migrator/app/placeholder: ausentes',
      '  - Nenhum DROP, TRUNCATE, DELETE ou comando de migration foi executado.',
      '',
      '- Próximo passo (NÃO EXECUTADO nesta etapa):',
      '  - Aplicar as sete migrations históricas no banco de replay com o wrapper `npm run homolog:replay:deploy` e a confirmação própria.',
      '  - Depois: `03-verify-replay.sql`, reexecutar `neon/01-grant-set-true-migrator.sql` (a membership temporária desta C.6 foi revogada), `neon/01b-elevate-inherit-for-rename.sql`, `04-finalize-rename.sql`, `neon/02-revoke-set-true-migrator.sql` e `05`..`09`.',
      '',
      '- Limitações:',
      '  - O trecho proxy→compute do Neon não é observável pelo cliente; `pg_stat_ssl` pode ser false/null mesmo com TLS externo comprovado.',
      '  - Este relatório não inclui credenciais, Connection String, senhas ou arquivos .env.',
      '  - As três senhas não foram gravadas; preserve-as em cofre local para a etapa de migrations.',
      '',
      'Status final: PROVISIONAMENTO CONCLUÍDO (SEM MIGRATIONS).',
    );

    fs.writeFileSync('RELATORIO-PROVISIONAMENTO-C.6.md', report.join('\n'), { mode: 0o600 });
    console.log('\n[8/8] SUCESSO: provisionamento concluído sem migrations.');
    console.log('Relatório sanitizado: RELATORIO-PROVISIONAMENTO-C.6.md');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n!!! C.6 INTERROMPIDA: ${redact(message)} !!!`);
    console.error('Nenhum DROP automático será executado.');

    report.push(
      '',
      '## FALHA',
      `- Erro: ${redact(message)}`,
      `- Roles criadas antes da falha: ${createdRoleNames.length === 0 ? 'nenhuma' : createdRoleNames.join(', ')}`,
      `- Banco de replay criado antes da falha: ${createdDatabase ? 'sim' : 'não'}`,
      `- Marca gerada antes da falha: ${markerComment === '' ? '(nenhuma)' : markerComment}`,
    );

    if (connected && membershipGranted) {
      try {
        await admin.query(`REVOKE ${admin.escapeIdentifier(ROLES.migrator)} FROM CURRENT_USER;`);
        membershipGranted = false;
        report.push('- Limpeza de emergência: REVOKE da membership temporária executado após a falha.');
      } catch (revokeError) {
        report.push(`- Limpeza de emergência: falha ao revogar a membership temporária: ${redact(revokeError instanceof Error ? revokeError.message : String(revokeError))}`);
      }
    }

    if (connected) {
      try {
        const partial = await readInventory(admin);
        report.push(
          '- Inventário parcial (nenhum DROP executado):',
          `  - Bancos: ${partial.databases.map(formatDatabase).join(' | ')}`,
          `  - Roles do projeto: ${partial.projectRoleNames.length === 0 ? 'nenhuma' : partial.projectRoleNames.join(', ')}`,
          `  - Memberships envolvendo o projeto: ${partial.memberships.length === 0 ? 'nenhuma' : partial.memberships.map((row) => `${row.role}->${row.member}`).join(', ')}`,
          `  - Banco definitivo ${FINAL_DB}: ${partial.finalDatabaseExists ? 'EXISTE' : 'ausente'}`,
        );
      } catch (inventoryError) {
        report.push(`- Inventário parcial indisponível: ${redact(inventoryError instanceof Error ? inventoryError.message : String(inventoryError))}`);
      }
    } else {
      report.push('- Sem conexão administrativa; nenhum inventário remoto foi lido.');
    }

    report.push('', 'Status final: FALHA — interrompido sem DROP automático.');
    fs.writeFileSync('RELATORIO-PROVISIONAMENTO-C.6-FALHA.md', report.join('\n'), { mode: 0o600 });
    process.exitCode = 1;
  } finally {
    if (connected) await admin.end().catch(() => undefined);
    url.password = '';
    clearSecrets();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`C.6 abortada antes de qualquer escrita: ${redact(message)}`);
  clearSecrets();
  process.exitCode = 1;
});
