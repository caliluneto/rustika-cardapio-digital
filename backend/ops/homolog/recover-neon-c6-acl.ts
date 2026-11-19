/**
 * RÚSTIKA — C.6-FIX01 — RECUPERAÇÃO DO ESTADO PARCIAL DO NEON (SOMENTE ACL DO BANCO DE REPLAY)
 *
 * CONTEXTO COMPROVADO
 *   A C.6 criou as cinco roles e o banco `cardapio_digital_test` (owner `cardapio_migrator`), mas falhou em
 *   [6/8] porque PUBLIC ainda tinha CONNECT/TEMPORARY. Causa: `REVOKE`/`GRANT` foram executados pela role
 *   administrativa `neondb_owner`, que NÃO é dona do banco e NÃO herda os privilégios da migradora
 *   (membership temporária com SET TRUE, INHERIT FALSE). O PostgreSQL apenas emitiu WARNING e não alterou a ACL.
 *
 * ESCOPO DESTE SCRIPT
 *   - SOMENTE LEITURA no modo `--check` (padrão da verificação inicial).
 *   - No modo de aplicação, depois de confirmação digitada, executa APENAS, como o OWNER do banco:
 *       REVOKE CONNECT, TEMPORARY ON DATABASE cardapio_digital_test FROM PUBLIC;
 *       GRANT CONNECT ON DATABASE cardapio_digital_test TO cardapio_migrator, cardapio_test_app, cardapio_homolog_bootstrap;
 *     em uma transação, conferindo o resultado antes do COMMIT.
 *   - NÃO cria role, NÃO cria banco, NÃO renomeia, NÃO executa migrations, NÃO faz DROP/CASCADE/FORCE/RESET,
 *     NÃO altera senhas e NÃO grava credenciais.
 *
 * PRÉ-REQUISITOS DE ENTRADA (TTY, eco oculto):
 *   1. Connection String do `neondb_owner` (banco administrativo `neondb`, endpoint DIRETO do Neon).
 *   2. Senha atual de `cardapio_migrator` — usada para abrir a conexão de OWNER que aplica/verifica a ACL.
 *      Se a senha foi perdida, NÃO repita CREATE ROLE nem use este script para adivinhar: a redefinição exige
 *      uma operação separada e autorizada (`ALTER ROLE cardapio_migrator PASSWORD ...`).
 *
 * USO
 *   Verificação somente leitura:
 *     npx tsx ops/homolog/recover-neon-c6-acl.ts --check
 *   Aplicação (exige digitar C.6-RECOVER-ACL depois do pré-voo):
 *     npx tsx ops/homolog/recover-neon-c6-acl.ts --apply
 */
import { Client } from 'pg';
import * as tls from 'node:tls';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
const APPLY_TOKEN = 'C.6-RECOVER-ACL';
const REPORT_PATH = 'RELATORIO-RECUPERACAO-C.6-ACL.md';
const REPORT_FAILURE_PATH = 'RELATORIO-RECUPERACAO-C.6-ACL-FALHA.md';

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

const EXPECTED_PROJECT_ROLES = [
  ROLES.migrator,
  ROLES.app,
  ROLES.placeholder,
  ROLES.bootstrap,
  ROLES.marker,
] as const;
const FINAL_ROLES = [ROLES.finalMigrator, ROLES.finalApp, ROLES.finalPlaceholder] as const;
const EXPECTED_CONN_LIMITS: Record<string, number> = {
  [ROLES.migrator]: 5,
  [ROLES.app]: 20,
  [ROLES.bootstrap]: 2,
};
const EXPECTED_LOGIN: Record<string, boolean> = {
  [ROLES.migrator]: true,
  [ROLES.app]: true,
  [ROLES.placeholder]: false,
  [ROLES.bootstrap]: false,
  [ROLES.marker]: false,
};

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
  allowconn: boolean;
  connlimit: number;
  publicConnect: boolean;
  publicTemp: boolean;
  publicCreate: boolean;
}

interface MembershipRow {
  role: string;
  member: string;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
}

interface ReplayAclRow {
  publicConnect: boolean;
  publicTemp: boolean;
  publicCreate: boolean;
  migratorConnect: boolean;
  migratorCreate: boolean;
  migratorTemp: boolean;
  appConnect: boolean;
  appCreate: boolean;
  appTemp: boolean;
  bootstrapConnect: boolean;
  bootstrapCreate: boolean;
  bootstrapTemp: boolean;
  placeholderConnect: boolean;
  placeholderCreate: boolean;
  placeholderTemp: boolean;
  markerConnect: boolean;
  markerCreate: boolean;
  markerTemp: boolean;
}

interface Inventory {
  databases: DatabaseRow[];
  projectRoles: RoleRow[];
  memberships: MembershipRow[];
  replayDatabase: DatabaseRow | undefined;
  finalDatabaseExists: boolean;
  finalRolesPresent: string[];
  projectDatabases: string[];
  projectRoleNames: string[];
  unexpectedProjectDatabases: string[];
  unexpectedProjectRoles: string[];
}

interface OwnerFacts {
  facts: ServerFacts;
  ownsDatabase: boolean;
  publicSchemaCreate: boolean;
  publicSchemaUsage: boolean;
  userObjectCount: number;
  userFunctionCount: number;
  userTriggerCount: number;
  policyCount: number;
  eventTriggerCount: number;
  unexpectedSchemas: string[];
}

const secrets = { connectionString: '', migratorPassword: '' };

function clearSecrets(): void {
  secrets.connectionString = '';
  secrets.migratorPassword = '';
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
  if (hostname.includes('-pooler')) throw new Error('Use o endpoint direto do Neon (sem -pooler).');
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

function buildClient({
  hostname,
  port,
  database,
  user,
  password,
  sslServername,
}: {
  hostname: string;
  port: string | number;
  database: string;
  user: string;
  password: string;
  sslServername: string;
}): Client {
  return new Client({
    host: hostname,
    port: typeof port === 'number' ? port : parseInt(String(port), 10),
    database,
    user,
    password,
    ssl: {
      rejectUnauthorized: true,
      servername: sslServername,
    },
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

function assertServerIdentity(facts: ServerFacts, expectedDatabase: string, expectedUser: string): void {
  assert(facts.database === expectedDatabase, `Banco inesperado: ${facts.database}.`);
  assert(facts.user === expectedUser, `current_user inesperado: ${facts.user}.`);
  assert(facts.sessionUser === expectedUser, `session_user inesperado: ${facts.sessionUser}.`);
  assert(facts.version.startsWith(EXPECTED_VERSION_PREFIX), `PostgreSQL ${facts.version} não é 18.x.`);
  assert(facts.projectId === EXPECTED_PROJECT_ID, `Project ID inesperado: ${facts.projectId ?? '(ausente)'}.`);
  if (facts.endpointId !== null && facts.endpointId !== '') {
    const endpointMatches = facts.endpointId === EXPECTED_ENDPOINT_ID
      || facts.endpointId.startsWith(`${EXPECTED_ENDPOINT_ID}.`)
      || facts.endpointId.startsWith(`${EXPECTED_ENDPOINT_ID}-`);
    assert(endpointMatches, `Endpoint ID inesperado: ${facts.endpointId}.`);
  }
}

async function readInventory(client: Client): Promise<Inventory> {
  const dbResult = await client.query<DatabaseRow>(`
    SELECT datname,
           pg_get_userbyid(datdba) AS owner,
           datallowconn AS allowconn,
           datconnlimit AS connlimit,
           EXISTS (SELECT 1 FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
                    WHERE acl.grantee = 0 AND acl.privilege_type = 'CONNECT') AS "publicConnect",
           EXISTS (SELECT 1 FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
                    WHERE acl.grantee = 0 AND acl.privilege_type = 'TEMPORARY') AS "publicTemp",
           EXISTS (SELECT 1 FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
                    WHERE acl.grantee = 0 AND acl.privilege_type = 'CREATE') AS "publicCreate"
      FROM pg_database
     ORDER BY datname
  `);
  const roleResult = await client.query<RoleRow>(`
    SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit,
           rolreplication, rolbypassrls, rolconnlimit
      FROM pg_roles
     WHERE rolname LIKE 'cardapio\\_%' OR rolname = $1
     ORDER BY rolname
  `, [MARKER_ROLE]);
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

  const projectDatabases = dbResult.rows
    .map((row) => row.datname)
    .filter((name) => name.startsWith('cardapio_digital_'));
  const projectRoleNames = roleResult.rows.map((row) => row.rolname);
  const unexpectedProjectDatabases = projectDatabases.filter((name) => name !== REPLAY_DB);
  const unexpectedProjectRoles = projectRoleNames.filter(
    (name) => !(EXPECTED_PROJECT_ROLES as readonly string[]).includes(name),
  );

  return {
    databases: dbResult.rows,
    projectRoles: roleResult.rows,
    memberships: membershipResult.rows,
    replayDatabase: dbResult.rows.find((row) => row.datname === REPLAY_DB),
    finalDatabaseExists: dbResult.rows.some((row) => row.datname === FINAL_DB),
    finalRolesPresent: FINAL_ROLES.filter((role) => projectRoleNames.includes(role)),
    projectDatabases,
    projectRoleNames,
    unexpectedProjectDatabases,
    unexpectedProjectRoles,
  };
}

async function readReplayAcl(client: Client, database: string): Promise<ReplayAclRow> {
  const result = await client.query<ReplayAclRow>(`
    SELECT
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'CONNECT') AS "publicConnect",
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'TEMPORARY') AS "publicTemp",
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(datacl, acldefault('d', datdba))) acl
               WHERE acl.grantee = 0 AND acl.privilege_type = 'CREATE') AS "publicCreate",
      has_database_privilege($2, datname, 'CONNECT') AS "migratorConnect",
      has_database_privilege($2, datname, 'CREATE') AS "migratorCreate",
      has_database_privilege($2, datname, 'TEMPORARY') AS "migratorTemp",
      has_database_privilege($3, datname, 'CONNECT') AS "appConnect",
      has_database_privilege($3, datname, 'CREATE') AS "appCreate",
      has_database_privilege($3, datname, 'TEMPORARY') AS "appTemp",
      has_database_privilege($4, datname, 'CONNECT') AS "bootstrapConnect",
      has_database_privilege($4, datname, 'CREATE') AS "bootstrapCreate",
      has_database_privilege($4, datname, 'TEMPORARY') AS "bootstrapTemp",
      has_database_privilege($5, datname, 'CONNECT') AS "placeholderConnect",
      has_database_privilege($5, datname, 'CREATE') AS "placeholderCreate",
      has_database_privilege($5, datname, 'TEMPORARY') AS "placeholderTemp",
      has_database_privilege($6, datname, 'CONNECT') AS "markerConnect",
      has_database_privilege($6, datname, 'CREATE') AS "markerCreate",
      has_database_privilege($6, datname, 'TEMPORARY') AS "markerTemp"
      FROM pg_database
     WHERE datname = $1
  `, [database, ROLES.migrator, ROLES.app, ROLES.bootstrap, ROLES.placeholder, ROLES.marker]);
  const row = result.rows[0];
  assert(row !== undefined, `Não foi possível ler a ACL de ${database}.`);
  return row;
}

function assertRoleMinimal(role: RoleRow): void {
  assert(!role.rolsuper, `${role.rolname}: rolsuper inesperado.`);
  assert(!role.rolcreaterole, `${role.rolname}: rolcreaterole inesperado.`);
  assert(!role.rolcreatedb, `${role.rolname}: rolcreatedb inesperado.`);
  assert(!role.rolreplication, `${role.rolname}: rolreplication inesperado.`);
  assert(!role.rolbypassrls, `${role.rolname}: rolbypassrls inesperado.`);
  assert(!role.rolinherit, `${role.rolname}: rolinherit inesperado.`);
  assert(role.rolcanlogin === EXPECTED_LOGIN[role.rolname], `${role.rolname}: rolcanlogin inesperado.`);
  const expectedConnLimit = EXPECTED_CONN_LIMITS[role.rolname];
  if (expectedConnLimit !== undefined) {
    assert(role.rolconnlimit === expectedConnLimit, `${role.rolname}: connection limit inesperado.`);
  }
}

function assertKnownPartialAcl(acl: ReplayAclRow): void {
  assert(!acl.publicCreate, 'PUBLIC tem CREATE inesperado no banco de replay.');
  assert(acl.migratorConnect && acl.migratorCreate && acl.migratorTemp,
    'O owner migrator não tem CONNECT/CREATE/TEMPORARY no banco de replay.');
  assert(acl.appConnect, 'A app de replay não tem CONNECT (estado inesperado: o GRANT explícito ou o PUBLIC deveria cobrir).');
  assert(acl.bootstrapConnect, 'O bootstrap não tem CONNECT (estado inesperado).');
  assert(!acl.appCreate && !acl.bootstrapCreate && !acl.placeholderCreate && !acl.markerCreate,
    'Alguma role de runtime/bootstrap/placeholder/marca tem CREATE no banco de replay.');
  // Antes da correção, PUBLIC pode conceder CONNECT/TEMPORARY a qualquer role. O que NÃO pode existir é
  // privilégio explícito inesperado quando PUBLIC não o concede. As duas checagens abaixo são o "falha fechada".
  if (!acl.publicConnect) {
    assert(!acl.placeholderConnect && !acl.markerConnect,
      'Placeholder/marca têm CONNECT explícito inesperado (PUBLIC não concede CONNECT).');
  }
  if (!acl.publicTemp) {
    assert(!acl.appTemp && !acl.bootstrapTemp && !acl.placeholderTemp && !acl.markerTemp,
      'Alguma role tem TEMPORARY explícito inesperado (PUBLIC não concede TEMPORARY).');
  }
}

function aclIsFullyCorrect(acl: ReplayAclRow): boolean {
  return !acl.publicConnect && !acl.publicTemp && !acl.publicCreate
    && acl.migratorConnect && acl.migratorCreate && acl.migratorTemp
    && acl.appConnect && !acl.appTemp && !acl.appCreate
    && acl.bootstrapConnect && !acl.bootstrapTemp && !acl.bootstrapCreate
    && !acl.placeholderConnect && !acl.placeholderTemp && !acl.placeholderCreate
    && !acl.markerConnect && !acl.markerTemp && !acl.markerCreate;
}

function formatDatabase(database: DatabaseRow): string {
  return `${database.datname} owner=${database.owner} allowconn=${database.allowconn} connlimit=${database.connlimit} ` +
    `publicConnect=${database.publicConnect} publicTemp=${database.publicTemp} publicCreate=${database.publicCreate}`;
}

function formatRole(role: RoleRow): string {
  return `${role.rolname} login=${role.rolcanlogin} inherit=${role.rolinherit} super=${role.rolsuper} ` +
    `createdb=${role.rolcreatedb} createrole=${role.rolcreaterole} replication=${role.rolreplication} ` +
    `bypassrls=${role.rolbypassrls} connlimit=${role.rolconnlimit}`;
}

async function readOwnerFacts(parsedUrl: URL): Promise<OwnerFacts> {
  const owner = buildClient({
    hostname: parsedUrl.hostname,
    port: parsedUrl.port === '' ? '5432' : parsedUrl.port,
    database: REPLAY_DB,
    user: ROLES.migrator,
    password: secrets.migratorPassword,
    sslServername: parsedUrl.hostname,
  });
  await owner.connect();
  try {
    const facts = await readServerFacts(owner);
    assertServerIdentity(facts, REPLAY_DB, ROLES.migrator);
    const ownResult = await owner.query<{ ownsDatabase: boolean }>(`
      SELECT (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = current_user AS "ownsDatabase"
    `);
    const schemaResult = await owner.query<{ schemaCreate: boolean; schemaUsage: boolean }>(`
      SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate",
             has_schema_privilege(current_user, 'public', 'USAGE') AS "schemaUsage"
    `);
    const tableResult = await owner.query<{ userObjectCount: number }>(`
      SELECT count(*)::int AS "userObjectCount"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    `);
    const schemaRows = await owner.query<{ nspname: string }>(`
      SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
       ORDER BY nspname
    `);
    const functionResult = await owner.query<{ userFunctionCount: number }>(`
      SELECT count(*)::int AS "userFunctionCount"
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
    `);
    const triggerResult = await owner.query<{ userTriggerCount: number }>(`
      SELECT count(*)::int AS "userTriggerCount"
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal
    `);
    const policyResult = await owner.query<{ policyCount: number }>('SELECT count(*)::int AS "policyCount" FROM pg_policy');
    const eventTriggerResult = await owner.query<{ eventTriggerCount: number }>(
      'SELECT count(*)::int AS "eventTriggerCount" FROM pg_event_trigger',
    );
    const own = ownResult.rows[0]?.ownsDatabase;
    const schema = schemaResult.rows[0];
    const count = tableResult.rows[0]?.userObjectCount;
    const functions = functionResult.rows[0]?.userFunctionCount;
    const triggers = triggerResult.rows[0]?.userTriggerCount;
    const policies = policyResult.rows[0]?.policyCount;
    const eventTriggers = eventTriggerResult.rows[0]?.eventTriggerCount;
    assert(own === true, 'A role migrator não é owner do banco de replay.');
    assert(schema !== undefined, 'Não foi possível ler os privilégios do schema public.');
    assert(typeof count === 'number', 'Não foi possível contar objetos no schema public.');
    assert(typeof functions === 'number' && typeof triggers === 'number' && typeof policies === 'number' && typeof eventTriggers === 'number',
      'Não foi possível contar funções/triggers/políticas/event triggers.');
    return {
      facts,
      ownsDatabase: own,
      publicSchemaCreate: schema.schemaCreate,
      publicSchemaUsage: schema.schemaUsage,
      userObjectCount: count,
      userFunctionCount: functions,
      userTriggerCount: triggers,
      policyCount: policies,
      eventTriggerCount: eventTriggers,
      unexpectedSchemas: schemaRows.rows.map((row) => row.nspname).filter((name) => name !== 'public'),
    };
  } finally {
    await owner.end().catch(() => undefined);
  }
}

async function applyAcl(parsedUrl: URL): Promise<ReplayAclRow> {
  const owner = buildClient({
    hostname: parsedUrl.hostname,
    port: parsedUrl.port === '' ? '5432' : parsedUrl.port,
    database: REPLAY_DB,
    user: ROLES.migrator,
    password: secrets.migratorPassword,
    sslServername: parsedUrl.hostname,
  });
  const notices: string[] = [];
  owner.on('notice', (notice: { message?: string }) => { if (notice.message) notices.push(notice.message); });
  await owner.connect();
  try {
    const facts = await readServerFacts(owner);
    assertServerIdentity(facts, REPLAY_DB, ROLES.migrator);
    const ownResult = await owner.query<{ ownsDatabase: boolean }>(`
      SELECT (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = current_user AS "ownsDatabase"
    `);
    assert(ownResult.rows[0]?.ownsDatabase === true, 'ACL: a conexão de aplicação não é do owner do banco.');

    await owner.query('BEGIN');
    try {
      await owner.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${owner.escapeIdentifier(REPLAY_DB)} FROM PUBLIC;`);
      await owner.query(
        `GRANT CONNECT ON DATABASE ${owner.escapeIdentifier(REPLAY_DB)} TO ` +
        `${owner.escapeIdentifier(ROLES.migrator)}, ${owner.escapeIdentifier(ROLES.app)}, ${owner.escapeIdentifier(ROLES.bootstrap)};`,
      );
      const acl = await readReplayAcl(owner, REPLAY_DB);
      assert(aclIsFullyCorrect(acl), 'ACL: o estado esperado não foi confirmado dentro da transação; ROLLBACK aplicado.');
      assert(!notices.some((message) => /no privileges (were granted|could be revoked)/i.test(message)),
        'ACL: o PostgreSQL emitiu WARNING de privilégios não aplicados; ROLLBACK aplicado.');
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const after = await readReplayAcl(owner, REPLAY_DB);
    assert(aclIsFullyCorrect(after), 'ACL: o estado esperado não foi confirmado após o COMMIT.');
    return after;
  } finally {
    await owner.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const checkOnly = !apply;
  if (!checkOnly && !process.argv.includes('--apply')) {
    throw new Error('Modo inválido.');
  }

  console.log('--- RÚSTIKA: C.6-FIX01 — RECUPERAÇÃO DA ACL DO BANCO DE REPLAY ---');
  console.log(checkOnly
    ? 'Modo: SOMENTE LEITURA (--check). Nenhuma escrita será executada.'
    : 'Modo: APLICAÇÃO. A escrita só ocorre após o pré-voo e a confirmação digitada.');
  console.log('Sem CREATE ROLE, sem CREATE DATABASE, sem migrations, sem DROP/CASCADE/FORCE/RESET.');

  // Ler credenciais de arquivos temporarios passados pelo PowerShell
  let adminConnectionString = '';
  let migratorPassword = '';
  let url: URL;

  const adminCredIndex = process.argv.indexOf('--admin-creds');
  const migratorPwdIndex = process.argv.indexOf('--migrator-pw');

  if (adminCredIndex >= 0 && migratorPwdIndex >= 0) {
    // Modo: credenciais passaram por PowerShell via arquivos temporarios
    const adminCredPath = process.argv[adminCredIndex + 1];
    const migratorPwdPath = process.argv[migratorPwdIndex + 1];

    if (!fs.existsSync(adminCredPath)) {
      throw new Error('Arquivo de credenciais do administrador nao encontrado: ' + adminCredPath);
    }
    if (!fs.existsSync(migratorPwdPath)) {
      throw new Error('Arquivo de senha do migrador nao encontrado: ' + migratorPwdPath);
    }

    adminConnectionString = fs.readFileSync(adminCredPath, 'utf8').trim();
    migratorPassword = fs.readFileSync(migratorPwdPath, 'utf8').trim();

    // Excluir arquivos temporarios imediatamente apos leitura
    try {
      fs.unlinkSync(adminCredPath);
      fs.unlinkSync(migratorPwdPath);
      // Remover diretorio pai se vazio
      const parentDir = path.dirname(adminCredPath);
      try {
        const dirContents = fs.readdirSync(parentDir);
        if (dirContents.length === 0) {
          fs.rmdirSync(parentDir);
        }
      } catch {}
    } catch (e) {
      // Ignorar erros de cleanup
    }

    secrets.connectionString = adminConnectionString;
    url = parseAdminConnectionString(adminConnectionString);
    secrets.migratorPassword = migratorPassword;
    assert(secrets.migratorPassword.length > 0, 'Senha da migradora vazia.');
  } else {
    // Modo legado: ler via TTY (readHiddenLine)
    secrets.connectionString = (await readHiddenLine('1. Connection String do neondb_owner (entrada oculta): ')).trim();
    url = parseAdminConnectionString(secrets.connectionString);
    secrets.migratorPassword = await readHiddenLine(`2. Senha atual de ${ROLES.migrator} (entrada oculta): `);
    assert(secrets.migratorPassword.length > 0, 'Senha da migradora vazia.');
  }

  console.log('\n[1/5] Verificando TLS externo...');
  const tlsDescription = await verifyExternalTls(url.hostname, Number(url.port === '' ? '5432' : url.port));
  console.log(`TLS externo comprovado: ${tlsDescription}`);

  const admin = buildClient({
  hostname: url.hostname,
  port: url.port === '' ? '5432' : url.port,
  database: EXPECTED_ADMIN_DB,
  user: safeDecode(url.username),
  password: safeDecode(url.password),
  sslServername: url.hostname,
});
  let connected = false;
  const report: string[] = [
    '# Relatório de Recuperação C.6-FIX01 — ACL do banco de replay',
    '',
    `- Data (UTC): ${new Date().toISOString()}`,
    `- Modo: ${checkOnly ? 'SOMENTE LEITURA (--check)' : 'APLICAÇÃO (--apply)'}`,
    '- Escopo: ACL do banco de replay; nenhuma role/banco é criado, renomeado ou removido.',
    '',
  ];

  try {
    console.log('[2/5] Conectando ao banco administrativo e comprovando a identidade...');
    await admin.connect();
    connected = true;
    secrets.connectionString = '';
    url.password = '';

    const adminFacts = await readServerFacts(admin);
    assertServerIdentity(adminFacts, EXPECTED_ADMIN_DB, EXPECTED_ADMIN_ROLE);
    const adminAttributes = await admin.query<{ rolcreatedb: boolean; rolcreaterole: boolean; rolsuper: boolean }>(`
      SELECT rolcreatedb, rolcreaterole, rolsuper FROM pg_roles WHERE rolname = current_user
    `);
    const adminRow = adminAttributes.rows[0];
    assert(adminRow !== undefined, 'Role administrativa não encontrada no catálogo.');
    assert(adminRow.rolcreatedb || adminRow.rolsuper, 'A role administrativa não tem CREATEDB.');
    assert(adminRow.rolcreaterole || adminRow.rolsuper, 'A role administrativa não tem CREATEROLE.');

    console.log('[3/5] Lendo inventário, roles, memberships e a ACL atual...');
    const inventory = await readInventory(admin);
    assert(inventory.finalDatabaseExists === false, `Banco definitivo ${FINAL_DB} já existe; este procedimento só recupera o estado parcial da C.6.`);
    assert(inventory.finalRolesPresent.length === 0,
      `Roles definitivas já existem (${inventory.finalRolesPresent.join(', ')}); estado fora do esperado para a recuperação.`);
    assert(inventory.unexpectedProjectDatabases.length === 0,
      `Bancos inesperados do projeto: ${inventory.unexpectedProjectDatabases.join(', ')}.`);
    assert(inventory.unexpectedProjectRoles.length === 0,
      `Roles inesperadas do projeto: ${inventory.unexpectedProjectRoles.join(', ')}.`);
    assert(inventory.projectRoleNames.length === EXPECTED_PROJECT_ROLES.length,
      `Roles do projeto: esperadas ${EXPECTED_PROJECT_ROLES.length}, encontradas ${inventory.projectRoleNames.length}.`);
    for (const name of EXPECTED_PROJECT_ROLES) {
      const role = inventory.projectRoles.find((row) => row.rolname === name);
      assert(role !== undefined, `Role ${name} ausente.`);
      assertRoleMinimal(role);
    }
    const marker = inventory.projectRoles.find((row) => row.rolname === MARKER_ROLE);
    assert(marker !== undefined && marker.rolcanlogin === false, 'A marca deve existir e ser NOLOGIN.');

    const replay = inventory.replayDatabase;
    assert(replay !== undefined, `Banco de replay ${REPLAY_DB} ausente; a recuperação não cria banco.`);
    assert(replay.owner === ROLES.migrator, `Owner do replay é ${replay.owner}, esperado ${ROLES.migrator}.`);
    assert(replay.allowconn, 'O banco de replay não aceita conexões.');
    assert(replay.connlimit === 40, `Connection limit do replay é ${replay.connlimit}, esperado 40.`);

    const markerComment = await admin.query<{ comment: string | null }>(
      `SELECT shobj_description(oid, 'pg_authid') AS comment FROM pg_roles WHERE rolname = $1`,
      [MARKER_ROLE],
    );
    const comment = markerComment.rows[0]?.comment ?? null;
    assert(comment !== null && comment.startsWith(MARKER_PREFIX),
      `Marca do cluster ausente ou inválida (esperado prefixo ${MARKER_PREFIX}).`);

    const temporaryElevations = inventory.memberships.filter((row) => row.setOption || row.inheritOption);
    assert(temporaryElevations.length === 0,
      `Memberships com SET/INHERIT inesperadas: ${temporaryElevations.map((row) => `${row.role}->${row.member}`).join(', ')}.`);
    const projectRolesAsMembers = inventory.memberships.filter((row) => row.member !== EXPECTED_ADMIN_ROLE);
    assert(projectRolesAsMembers.length === 0,
      `Roles do projeto aparecem como membros: ${projectRolesAsMembers.map((row) => `${row.role}->${row.member}`).join(', ')}.`);
    const unexpectedAdminMemberships = inventory.memberships.filter((row) =>
      row.member === EXPECTED_ADMIN_ROLE && !(row.adminOption && !row.setOption && !row.inheritOption));
    assert(unexpectedAdminMemberships.length === 0,
      `Memberships administrativas inesperadas: ${unexpectedAdminMemberships.map((row) => `${row.role}->${row.member}`).join(', ')}.`);

    const neonSuperuserMembers = await admin.query<{ role: string }>(`
      SELECT member.rolname AS role
        FROM pg_auth_members am
        JOIN pg_roles granted ON granted.oid = am.roleid
        JOIN pg_roles member ON member.oid = am.member
       WHERE granted.rolname = 'neon_superuser'
         AND (member.rolname LIKE 'cardapio\\_%' OR member.rolname = $1)
    `, [MARKER_ROLE]);
    assert(neonSuperuserMembers.rowCount === 0, 'Alguma role do projeto é membro de neon_superuser.');

    const dbRoleSettings = await admin.query<{ count: number }>(`
      SELECT count(*)::int AS count
        FROM pg_db_role_setting
       WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = $1)
          OR setrole IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'cardapio\\_%')
    `, [REPLAY_DB]);
    assert((dbRoleSettings.rows[0]?.count ?? 0) === 0, 'Há configurações por banco ou por role; revise antes de alterar a ACL.');

    console.log('[4/5] Conectando como owner do replay para conferir objetos e ACL (somente leitura)...');
    const ownerFacts = await readOwnerFacts(url);
    assert(ownerFacts.ownsDatabase, 'A role migrator não é owner do banco de replay.');
    assert(ownerFacts.publicSchemaCreate, 'O owner não tem CREATE no schema public.');
    assert(ownerFacts.publicSchemaUsage, 'O owner não tem USAGE no schema public.');
    assert(ownerFacts.userObjectCount === 0, 'O banco de replay não está vazio (há tabelas/sequências/views no schema public).');
    assert(ownerFacts.userFunctionCount === 0, 'O banco de replay não está vazio (há funções no schema public).');
    assert(ownerFacts.userTriggerCount === 0, 'O banco de replay não está vazio (há triggers no schema public).');
    assert(ownerFacts.policyCount === 0, 'O banco de replay não está vazio (há políticas de RLS).');
    assert(ownerFacts.eventTriggerCount === 0, 'O banco de replay não está vazio (há event triggers).');
    assert(ownerFacts.unexpectedSchemas.length === 0,
      `Schemas inesperados no replay: ${ownerFacts.unexpectedSchemas.join(', ')}.`);

    const ownerClient = buildClient({
    hostname: url.hostname,
    port: REPLAY_DB === 'cardapio_digital_test' ? '5432' : url.port,
    database: REPLAY_DB,
    user: ROLES.migrator,
    password: secrets.migratorPassword,
    sslServername: url.hostname,
  });
    await ownerClient.connect();
    let acl: ReplayAclRow;
    try {
      acl = await readReplayAcl(ownerClient, REPLAY_DB);
    } finally {
      await ownerClient.end().catch(() => undefined);
    }
    assertKnownPartialAcl(acl);
    const alreadyCorrect = aclIsFullyCorrect(acl);

    report.push(
      '- Identidade validada:',
      `  - Projeto Neon: ${EXPECTED_PROJECT_ID}`,
      `  - Endpoint esperado: ${EXPECTED_ENDPOINT_ID}`,
      `  - Host: ${url.hostname}`,
      `  - Banco administrativo: ${adminFacts.database}`,
      `  - Role administrativa: ${adminFacts.user}`,
      `  - PostgreSQL: ${adminFacts.version}`,
      `  - neon.project_id: ${adminFacts.projectId}`,
      `  - neon.endpoint_id: ${adminFacts.endpointId ?? '(não exposto)'}`,
      `  - TLS externo: ${tlsDescription}`,
      `  - pg_stat_ssl.ssl: ${String(adminFacts.ssl)} (false/null é esperado no Neon)`,
      '- Banco de replay:',
      `  - ${formatDatabase(replay)}`,
      '- Roles do projeto:',
      ...inventory.projectRoles.map((role) => `  - ${formatRole(role)}`),
      '- Memberships:',
      `  - ${inventory.memberships.length === 0 ? 'nenhuma' : inventory.memberships.map((row) => `${row.role}->${row.member} admin=${row.adminOption} inherit=${row.inheritOption} set=${row.setOption}`).join(' | ')}`,
      '- Banco definitivo e roles definitivas:',
      '  - Ausentes.',
      '- Replay vazio:',
      `  - Tabelas/sequências/views no schema public: ${ownerFacts.userObjectCount}; funções: ${ownerFacts.userFunctionCount}; ` +
        `triggers: ${ownerFacts.userTriggerCount}; políticas: ${ownerFacts.policyCount}; event triggers: ${ownerFacts.eventTriggerCount}; ` +
        `schemas inesperados: ${ownerFacts.unexpectedSchemas.length}.`,
      '- ACL atual:',
      `  - PUBLIC: connect=${acl.publicConnect} temporary=${acl.publicTemp} create=${acl.publicCreate}`,
      `  - migrator: connect=${acl.migratorConnect} create=${acl.migratorCreate} temporary=${acl.migratorTemp}`,
      `  - cardapio_test_app: connect=${acl.appConnect} create=${acl.appCreate} temporary=${acl.appTemp}`,
      `  - cardapio_homolog_bootstrap: connect=${acl.bootstrapConnect} create=${acl.bootstrapCreate} temporary=${acl.bootstrapTemp}`,
      `  - cardapio_dev_app: connect=${acl.placeholderConnect} create=${acl.placeholderCreate} temporary=${acl.placeholderTemp}`,
      `  - rustika_homolog_marker: connect=${acl.markerConnect} create=${acl.markerCreate} temporary=${acl.markerTemp}`,
      '',
    );

    for (const row of report) console.log(row);

    if (alreadyCorrect) {
      report.push('Status: ACL JÁ ESTÁ NO ESTADO ESPERADO; nenhuma escrita executada.');
      fs.writeFileSync(REPORT_PATH, report.join('\n'), { mode: 0o600 });
      console.log('\n[5/5] ACL já correta. Nenhuma escrita executada.');
      console.log(`Relatório sanitizado: ${REPORT_PATH}`);
      return;
    }

    if (checkOnly) {
      report.push('Status: PRÉ-VOO SOMENTE LEITURA CONCLUÍDO; a correção ainda NÃO foi aplicada.');
      report.push('Ação necessária (com autorização explícita): `npx tsx ops/homolog/recover-neon-c6-acl.ts --apply`.');
      fs.writeFileSync(REPORT_PATH, report.join('\n'), { mode: 0o600 });
      console.log('\n[5/5] Pré-voo concluído. A correção NÃO foi aplicada (modo --check).');
      console.log(`Relatório sanitizado: ${REPORT_PATH}`);
      return;
    }

    const confirmation = (await readHiddenLine(`\nDigite "${APPLY_TOKEN}" para aplicar a ACL mínima (entrada oculta): `)).trim();
    if (confirmation !== APPLY_TOKEN) throw new Error('Confirmação incorreta. Nenhuma escrita foi executada.');

    console.log('[5/5] Revalidando a identidade e aplicando a ACL como owner do banco...');
    const recheck = await readServerFacts(admin);
    assertServerIdentity(recheck, EXPECTED_ADMIN_DB, EXPECTED_ADMIN_ROLE);
    const finalAcl = await applyAcl(url);

    const after = await readInventory(admin);
    assert(after.replayDatabase !== undefined, 'O banco de replay desapareceu durante a operação.');
    assert(after.replayDatabase.owner === ROLES.migrator, 'O owner do replay mudou durante a operação.');
    assert(!after.replayDatabase.publicConnect && !after.replayDatabase.publicTemp && !after.replayDatabase.publicCreate,
      'O inventário administrativo ainda mostra acesso de PUBLIC após a correção.');
    assert(finalAcl.publicConnect === false && finalAcl.publicTemp === false && finalAcl.publicCreate === false,
      'A ACL final de PUBLIC não confere.');
    assert(finalAcl.appConnect && finalAcl.bootstrapConnect, 'A ACL final não concede CONNECT à app/bootstrap.');
    assert(!finalAcl.placeholderConnect && !finalAcl.markerConnect, 'Placeholder/marca receberam CONNECT indevido.');
    assert(!finalAcl.appTemp && !finalAcl.bootstrapTemp && !finalAcl.placeholderTemp && !finalAcl.markerTemp,
      'Alguma role recebeu TEMPORARY indevido.');
    assert(after.projectRoleNames.length === EXPECTED_PROJECT_ROLES.length,
      'O conjunto de roles do projeto mudou durante a operação.');
    assert(after.memberships.filter((row) => row.setOption || row.inheritOption).length === 0,
      'Surgiu membership com SET/INHERIT durante a operação.');

    report.push(
      '- Correção aplicada (transação concluída):',
      '  - `REVOKE CONNECT, TEMPORARY ON DATABASE cardapio_digital_test FROM PUBLIC;`',
      '  - `GRANT CONNECT ON DATABASE cardapio_digital_test TO cardapio_migrator, cardapio_test_app, cardapio_homolog_bootstrap;`',
      '  - Executada em conexão autenticada como o OWNER `cardapio_migrator` (não pela role administrativa).',
      '- ACL final:',
      `  - PUBLIC: connect=${finalAcl.publicConnect} temporary=${finalAcl.publicTemp} create=${finalAcl.publicCreate}`,
      `  - cardapio_test_app: connect=${finalAcl.appConnect} temporary=${finalAcl.appTemp}`,
      `  - cardapio_homolog_bootstrap: connect=${finalAcl.bootstrapConnect} temporary=${finalAcl.bootstrapTemp}`,
      `  - cardapio_dev_app: connect=${finalAcl.placeholderConnect} temporary=${finalAcl.placeholderTemp}`,
      `  - rustika_homolog_marker: connect=${finalAcl.markerConnect} temporary=${finalAcl.markerTemp}`,
      '- Nenhum CREATE ROLE, CREATE DATABASE, ALTER ROLE, DROP, CASCADE, FORCE, RESET ou migration foi executado.',
      '',
      'Status: RECUPERAÇÃO CONCLUÍDA; banco de replay pronto para o próximo passo autorizado.',
    );
    fs.writeFileSync(REPORT_PATH, report.join('\n'), { mode: 0o600 });
    console.log('\n[5/5] SUCESSO: ACL do banco de replay corrigida e verificada.');
    console.log(`Relatório sanitizado: ${REPORT_PATH}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n!!! RECUPERAÇÃO C.6-FIX01 INTERROMPIDA: ${redact(message)} !!!`);
    console.error('Nenhum DROP/CASCADE/FORCE/RESET será executado.');

    report.push('', '## FALHA', `- Erro: ${redact(message)}`);
    if (connected) {
      try {
        const partial = await readInventory(admin);
        report.push(
          '- Estado observado (somente leitura):',
          `  - Bancos do projeto: ${partial.projectDatabases.join(', ') || 'nenhum'}`,
          `  - Roles do projeto: ${partial.projectRoleNames.join(', ') || 'nenhuma'}`,
          `  - Banco definitivo: ${partial.finalDatabaseExists ? 'EXISTE' : 'ausente'}`,
          `  - Replay: ${partial.replayDatabase ? formatDatabase(partial.replayDatabase) : 'ausente'}`,
        );
      } catch (inventoryError) {
        report.push(`- Estado parcial indisponível: ${redact(inventoryError instanceof Error ? inventoryError.message : String(inventoryError))}`);
      }
    }
    report.push('', 'Status: FALHA — nenhuma escrita além da transação com ROLLBACK (quando aplicável).');
    fs.writeFileSync(REPORT_FAILURE_PATH, report.join('\n'), { mode: 0o600 });
    process.exitCode = 1;
  } finally {
    if (connected) await admin.end().catch(() => undefined);
    url.password = '';
    clearSecrets();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Recuperação abortada antes de qualquer escrita: ${redact(message)}`);
  clearSecrets();
  process.exitCode = 1;
});
