import { Prisma, type PrismaClient } from '@prisma/client';
import type { AdminIdentity } from './adminInput';
import type { AppliedMigration } from './migrationIntegrity';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from './expectedMigrations';
import { HOMOLOG_EXPECTED_MIGRATIONS } from '../homolog/homologMigrationChain';
import {
  DEFAULT_ROLE_ALIASES,
  fingerprint,
  readSchemaSnapshot,
  type SchemaSnapshot,
} from '../homolog/schemaSnapshot';

export const E4_ALT_NEON_PROVIDER_ROLE_ALIASES: Readonly<Record<string, string>> = {
  cloud_admin: 'neon_provider_cloud_admin',
  neon_superuser: 'neon_provider_superuser',
  neondb_owner: 'neon_project_owner',
};

export const E4_ALT_ROLE_ALIASES: Readonly<Record<string, string>> = {
  ...DEFAULT_ROLE_ALIASES,
  ...E4_ALT_NEON_PROVIDER_ROLE_ALIASES,
};

export const EXCEPTIONAL_MIGRATOR_PROFILE = 'migrate-homolog';
export const EXCEPTIONAL_CONFIRMATION_ENV = 'CARDAPIO_E4_ALT_CONFIRMATION';
export const EXCEPTIONAL_CONFIRMATION_VALUE =
  'CREATE_FIRST_ADMIN_VIA_MIGRATOR_AGED_SCENE_47291697_BR_FROSTY_FIRE_BD4XW2SC';

export const E4_ALT_TARGET = {
  projectId: 'aged-scene-47291697',
  branchId: 'br-frosty-fire-bd4xw2sc',
  database: 'cardapio_digital_homolog',
  databaseOid: '57355',
  migratorRole: 'cardapio_homolog_migrator',
  runtimeRole: 'cardapio_homolog_app',
  bootstrapRole: 'cardapio_homolog_bootstrap',
  bootstrapRoleOid: '57350',
} as const;

export const E4_ALT_EXPECTED_MIGRATIONS: ReadonlyArray<{ name: string; checksum: string }> = [
  ...EXPECTED_MIGRATIONS,
  // E4-ALT é evidência 9/9 imutável. A 10ª migration local nunca entra neste candidato remoto.
  ...PENDING_MIGRATIONS.filter((migration) => migration.name === '20261114000000_product_insert_identity_columns'),
];

export interface ExternalTlsEvidence {
  proven: boolean;
  reasons: string[];
}

export interface ExceptionalExpectedIdentity {
  schemaFingerprint: string;
  clusterId: string;
  /** Ausente somente para a evidência histórica E4-ALT (9/9). O executor atual exige E5.1 (10/10). */
  migrationSet?: 'e5-1';
}

export const BOOTSTRAP_ACL_SCOPES = [
  'database', 'schemas', 'tables', 'columns', 'sequences', 'routines', 'types', 'defaultAcls',
] as const;
export type BootstrapAclScope = (typeof BOOTSTRAP_ACL_SCOPES)[number];

/**
 * Matriz fail-closed da role bootstrap. Grants diretos, ownership e privilégios efetivos são fatos distintos:
 * ACL NULL significa apenas "sem ACL explícita neste objeto", não "sem privilégio efetivo". Por isso os privilégios
 * efetivos (incluindo PUBLIC e memberships) são medidos separadamente.
 */
export interface BootstrapAclMatrix {
  explicitGrants: Record<BootstrapAclScope, number>;
  ownedObjects: Record<'databases' | 'schemas' | 'relations' | 'routines' | 'types', number>;
  effectiveUnsafe: {
    databaseCreate: boolean;
    schemaCreate: boolean;
    tablePrivilegeObjects: number;
    columnPrivilegeColumns: number;
    sequencePrivilegeObjects: number;
    dangerousRoutineObjects: number;
  };
  /** Privilégios efetivos não mutadores/default de PUBLIC + CONNECT explícito não-grantable em current_database() (enquanto NOLOGIN); entram na evidência, sem mascarar grants perigosos. */
  effectiveInformational: {
    databaseConnect: boolean;
    databaseTemporary: boolean;
    explicitDatabaseConnectCurrentDb: number;
    schemaUsage: boolean;
    routineExecuteObjects: number;
    typeUsageObjects: number;
  };
}

export interface ExceptionalBootstrapFacts {
  database: string;
  databaseOid: string;
  currentUser: string;
  sessionUser: string;
  projectId: string | null;
  branchId: string | null;
  markerComment: string | null;
  serverVersionNum: number;
  elevatedRole: boolean;
  databaseOwner: string;
  adminsOwner: string;
  canInsertAdmins: boolean;
  adminCount: number;
  bootstrapRoleOid: string | null;
  bootstrapCanLogin: boolean | null;
  bootstrapElevatedRole: boolean | null;
  bootstrapAcl: BootstrapAclMatrix;
  bootstrapExplicitAclCount: number;
  projectMembershipCount: number;
  neonCreatorAdminOnlyMemberships: number;
  migrations: AppliedMigration[];
  schemaFingerprint: string;
  externalTls: ExternalTlsEvidence;
}

export type ExceptionalRefusal =
  | 'ENVIRONMENT_MISMATCH'
  | 'UNSAFE_ROLE'
  | 'SCHEMA_INCOMPATIBLE'
  | 'ADMIN_ALREADY_EXISTS'
  | 'CONCURRENT_BOOTSTRAP';

export class ExceptionalBootstrapRefused extends Error {
  constructor(public readonly code: ExceptionalRefusal, message: string) {
    super(message);
    this.name = 'ExceptionalBootstrapRefused';
  }
}

export class CommitOutcomeUnknown extends Error {
  constructor() {
    super('O resultado do COMMIT não pôde ser confirmado. Não repita a operação antes da reconciliação somente leitura.');
    this.name = 'CommitOutcomeUnknown';
  }
}

export interface ExceptionalMigratorDb {
  readFacts(): Promise<ExceptionalBootstrapFacts>;
  insertFirstAdmin(
    input: { name: string; email: string; passwordHash: string },
    expected: ExceptionalExpectedIdentity,
  ): Promise<{ id: string }>;
}

function migrationProblems(rows: readonly AppliedMigration[], migrationSet?: 'e5-1'): string[] {
  const problems: string[] = [];
  const expected = migrationSet === 'e5-1' ? HOMOLOG_EXPECTED_MIGRATIONS : E4_ALT_EXPECTED_MIGRATIONS;
  const byName = new Map(rows.map((row) => [row.name, row]));
  if (rows.length !== expected.length) problems.push(`_prisma_migrations tem ${rows.length} linhas, esperadas ${expected.length}.`);
  const expectedNames = new Set(expected.map((migration) => migration.name));
  for (const row of rows) if (!expectedNames.has(row.name)) problems.push(`migration desconhecida aplicada: ${row.name}.`);
  for (const migration of expected) {
    const row = byName.get(migration.name);
    if (!row) { problems.push(`migration não aplicada: ${migration.name}.`); continue; }
    if (!row.finished || row.rolledBack) problems.push(`migration com falha ou revertida: ${migration.name}.`);
    if (row.checksum !== migration.checksum) problems.push(`checksum gravado diverge: ${migration.name}.`);
  }
  return problems;
}

export function evaluateExceptionalFacts(
  facts: ExceptionalBootstrapFacts,
  expected: ExceptionalExpectedIdentity,
): { code: ExceptionalRefusal; message: string } | null {
  if (!facts.externalTls.proven) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'TLS externo estrito não foi comprovado.' };
  }
  if (
    facts.database !== E4_ALT_TARGET.database ||
    facts.databaseOid !== E4_ALT_TARGET.databaseOid ||
    facts.currentUser !== E4_ALT_TARGET.migratorRole ||
    facts.sessionUser !== E4_ALT_TARGET.migratorRole ||
    facts.projectId !== E4_ALT_TARGET.projectId ||
    facts.branchId !== E4_ALT_TARGET.branchId
  ) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'Banco, OID, role, projeto ou branch divergem do alvo E4-ALT.' };
  }
  if (
    expected.clusterId.trim() === '' ||
    facts.markerComment?.trim().toLowerCase() !== `rustika-homolog-cluster:${expected.clusterId.trim().toLowerCase()}`
  ) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'A marca do cluster diverge do perfil migrate-homolog.' };
  }
  if (facts.serverVersionNum < 180000) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'O alvo E4-ALT exige PostgreSQL 18 ou superior.' };
  }
  if (
    facts.elevatedRole ||
    facts.databaseOwner !== E4_ALT_TARGET.migratorRole ||
    facts.adminsOwner !== E4_ALT_TARGET.migratorRole ||
    !facts.canInsertAdmins ||
    facts.projectMembershipCount !== 0 ||
    facts.neonCreatorAdminOnlyMemberships < 0 ||
    facts.neonCreatorAdminOnlyMemberships > 4
  ) {
    return { code: 'UNSAFE_ROLE', message: 'A role migradora não corresponde ao proprietário mínimo esperado.' };
  }
  if (
    facts.bootstrapRoleOid !== E4_ALT_TARGET.bootstrapRoleOid ||
    facts.bootstrapCanLogin !== false ||
    facts.bootstrapElevatedRole !== false ||
    facts.bootstrapExplicitAclCount !== 0 ||
    facts.bootstrapAcl.effectiveInformational.explicitDatabaseConnectCurrentDb < 0 ||
    facts.bootstrapAcl.effectiveInformational.explicitDatabaseConnectCurrentDb > 1 ||
    Object.values(facts.bootstrapAcl.ownedObjects).some((count) => count !== 0) ||
    facts.bootstrapAcl.effectiveUnsafe.databaseCreate ||
    facts.bootstrapAcl.effectiveUnsafe.schemaCreate ||
    facts.bootstrapAcl.effectiveUnsafe.tablePrivilegeObjects !== 0 ||
    facts.bootstrapAcl.effectiveUnsafe.columnPrivilegeColumns !== 0 ||
    facts.bootstrapAcl.effectiveUnsafe.sequencePrivilegeObjects !== 0 ||
    facts.bootstrapAcl.effectiveUnsafe.dangerousRoutineObjects !== 0
  ) {
    return { code: 'UNSAFE_ROLE', message: 'A role bootstrap não preserva OID, NOLOGIN, atributos, ownership e privilégios mínimos.' };
  }
  const migrations = migrationProblems(facts.migrations, expected.migrationSet);
  if (migrations.length > 0) {
    return { code: 'SCHEMA_INCOMPATIBLE', message: `Migrations incompatíveis: ${migrations[0]}` };
  }
  if (facts.schemaFingerprint !== expected.schemaFingerprint) {
    return { code: 'SCHEMA_INCOMPATIBLE', message: 'O fingerprint do schema diverge do baseline explicitamente aprovado.' };
  }
  if (facts.adminCount !== 0) {
    return { code: 'ADMIN_ALREADY_EXISTS', message: 'Já existe administrador; o executor excepcional só cria o primeiro.' };
  }
  return null;
}

interface HeadRow {
  database: string;
  databaseOid: string;
  currentUser: string;
  sessionUser: string;
  projectId: string | null;
  branchId: string | null;
  markerComment: string | null;
  serverVersionNum: number;
  elevatedRole: boolean | null;
  databaseOwner: string;
  adminsOwner: string;
  canInsertAdmins: boolean;
}

interface BootstrapRoleRow { oid: string; canLogin: boolean; elevated: boolean }
interface MembershipSummaryRow { unsafeCount: bigint | number | string; neonCreatorAdminOnlyCount: bigint | number | string }
interface MigrationRow { migration_name: string; checksum: string; finished: boolean; rolled_back: boolean }

interface BootstrapAclRow {
  database: bigint | number | string;
  explicitDatabaseConnectCurrentDb: bigint | number | string;
  schemas: bigint | number | string;
  tables: bigint | number | string;
  columns: bigint | number | string;
  sequences: bigint | number | string;
  routines: bigint | number | string;
  types: bigint | number | string;
  defaultAcls: bigint | number | string;
  ownedDatabases: bigint | number | string;
  ownedSchemas: bigint | number | string;
  ownedRelations: bigint | number | string;
  ownedRoutines: bigint | number | string;
  ownedTypes: bigint | number | string;
  databaseCreate: boolean;
  schemaCreate: boolean;
  tablePrivilegeObjects: bigint | number | string;
  columnPrivilegeColumns: bigint | number | string;
  sequencePrivilegeObjects: bigint | number | string;
  dangerousRoutineObjects: bigint | number | string;
  databaseConnect: boolean;
  databaseTemporary: boolean;
  schemaUsage: boolean;
  routineExecuteObjects: bigint | number | string;
  typeUsageObjects: bigint | number | string;
}

export interface ReadOnlyTransactionClient {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  admin: Pick<Prisma.TransactionClient['admin'], 'count'>;
}

type DbReader = ReadOnlyTransactionClient;

interface TransactionModeRow { readOnly: boolean; isolation: string }

/**
 * A primeira instrução da callback torna a transação PostgreSQL READ ONLY. O callback recebe uma visão tipada sem
 * métodos Prisma de escrita; o servidor continua sendo a barreira real e rejeita qualquer DML/DDL que escape da tipagem.
 */
export async function runSerializableReadOnlyTransaction<T>(
  prisma: PrismaClient,
  read: (tx: ReadOnlyTransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const mode = (await tx.$queryRaw<TransactionModeRow[]>`
      SELECT current_setting('transaction_read_only')::boolean AS "readOnly",
             current_setting('transaction_isolation')::text AS isolation`)[0];
    if (mode?.readOnly !== true || mode.isolation.toLowerCase() !== 'serializable') {
      throw new Error('A transação de diagnóstico não foi comprovada como SERIALIZABLE READ ONLY pelo PostgreSQL.');
    }
    const readOnlyClient: ReadOnlyTransactionClient = Object.freeze({
      $queryRaw: tx.$queryRaw.bind(tx) as Prisma.TransactionClient['$queryRaw'],
      admin: Object.freeze({ count: tx.admin.count.bind(tx.admin) }),
    });
    return read(readOnlyClient);
  // O snapshot de catálogo realiza dezenas de SELECTs; o padrão de 5 s da transação interativa
  // Prisma pode encerrá-la durante a coleta. Limite explícito e finito, sem retry nem escrita.
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
}

export interface ExceptionalFactsCollection {
  facts: ExceptionalBootstrapFacts;
  snapshot: SchemaSnapshot;
}

export async function collectExceptionalFacts(
  client: DbReader,
  externalTls: ExternalTlsEvidence,
  onStage?: (stage: string) => void,
): Promise<ExceptionalFactsCollection> {
  onStage?.('head');
  const head = (await client.$queryRaw<HeadRow[]>`
    SELECT current_database()::text AS "database",
           (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
           current_user::text AS "currentUser", session_user::text AS "sessionUser",
           current_setting('neon.project_id', true) AS "projectId",
           current_setting('neon.branch_id', true) AS "branchId",
           (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = 'rustika_homolog_marker') AS "markerComment",
           current_setting('server_version_num')::int AS "serverVersionNum",
           (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
              FROM pg_roles WHERE rolname = current_user) AS "elevatedRole",
           (SELECT pg_get_userbyid(datdba)::text FROM pg_database WHERE datname = current_database()) AS "databaseOwner",
           (SELECT pg_get_userbyid(c.relowner)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'admins' AND c.relkind IN ('r', 'p')) AS "adminsOwner",
           has_table_privilege(current_user, 'public.admins', 'INSERT') AS "canInsertAdmins"`)[0];
  if (!head) throw new Error('Fatos do alvo E4-ALT indisponíveis.');

  onStage?.('bootstrap-role');
  const bootstrap = (await client.$queryRaw<BootstrapRoleRow[]>`
    SELECT oid::text AS oid, rolcanlogin AS "canLogin",
           (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls) AS elevated
      FROM pg_roles
     WHERE rolname = ${E4_ALT_TARGET.bootstrapRole}`)[0];
  onStage?.('migrations');
  const migrations = await client.$queryRaw<MigrationRow[]>`
    SELECT migration_name, checksum, (finished_at IS NOT NULL) AS finished,
           (rolled_back_at IS NOT NULL) AS rolled_back
       FROM public._prisma_migrations ORDER BY migration_name`;
  onStage?.('acl');
  const acl = (await client.$queryRaw<BootstrapAclRow[]>`
    WITH target AS (SELECT (SELECT oid FROM pg_roles WHERE rolname = ${E4_ALT_TARGET.bootstrapRole}) AS oid)
    SELECT
      (SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) x, target t
        WHERE d.datacl IS NOT NULL AND x.grantee = t.oid
          AND NOT (d.datname = current_database() AND x.privilege_type = 'CONNECT' AND NOT x.is_grantable)) AS database,
      (SELECT count(*) FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) x, target t
        WHERE d.datacl IS NOT NULL AND x.grantee = t.oid
          AND d.datname = current_database() AND x.privilege_type = 'CONNECT' AND NOT x.is_grantable) AS "explicitDatabaseConnectCurrentDb",
      (SELECT count(*) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x, target t
        WHERE n.nspacl IS NOT NULL AND x.grantee = t.oid) AS schemas,
      (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x, target t
        WHERE c.relacl IS NOT NULL AND c.relkind <> 'S' AND x.grantee = t.oid) AS tables,
      (SELECT count(*) FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x, target t
        WHERE a.attacl IS NOT NULL AND x.grantee = t.oid) AS columns,
      (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x, target t
        WHERE c.relacl IS NOT NULL AND c.relkind = 'S' AND x.grantee = t.oid) AS sequences,
      (SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) x, target t
        WHERE p.proacl IS NOT NULL AND x.grantee = t.oid) AS routines,
      (SELECT count(*) FROM pg_type y CROSS JOIN LATERAL aclexplode(y.typacl) x, target t
        WHERE y.typacl IS NOT NULL AND x.grantee = t.oid) AS types,
      (SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) x, target t
        WHERE x.grantee = t.oid) AS "defaultAcls",
      (SELECT count(*) FROM pg_database d, target t WHERE d.datdba = t.oid) AS "ownedDatabases",
      (SELECT count(*) FROM pg_namespace n, target t WHERE n.nspowner = t.oid) AS "ownedSchemas",
      (SELECT count(*) FROM pg_class c, target t WHERE c.relowner = t.oid) AS "ownedRelations",
      (SELECT count(*) FROM pg_proc p, target t WHERE p.proowner = t.oid) AS "ownedRoutines",
      (SELECT count(*) FROM pg_type y, target t WHERE y.typowner = t.oid) AS "ownedTypes",
      has_database_privilege(t.oid, current_database(), 'CREATE') AS "databaseCreate",
      has_schema_privilege(t.oid, 'public', 'CREATE') AS "schemaCreate",
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND
          (has_table_privilege(t.oid, c.oid, 'SELECT') OR has_table_privilege(t.oid, c.oid, 'INSERT') OR
           has_table_privilege(t.oid, c.oid, 'UPDATE') OR has_table_privilege(t.oid, c.oid, 'DELETE') OR
           has_table_privilege(t.oid, c.oid, 'TRUNCATE') OR has_table_privilege(t.oid, c.oid, 'REFERENCES') OR
           has_table_privilege(t.oid, c.oid, 'TRIGGER'))) AS "tablePrivilegeObjects",
      (SELECT count(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped AND
          (has_column_privilege(t.oid, a.attrelid, a.attnum, 'SELECT') OR has_column_privilege(t.oid, a.attrelid, a.attnum, 'INSERT') OR
           has_column_privilege(t.oid, a.attrelid, a.attnum, 'UPDATE') OR has_column_privilege(t.oid, a.attrelid, a.attnum, 'REFERENCES'))) AS "columnPrivilegeColumns",
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S' AND
          (has_sequence_privilege(t.oid, c.oid, 'USAGE') OR has_sequence_privilege(t.oid, c.oid, 'SELECT') OR
           has_sequence_privilege(t.oid, c.oid, 'UPDATE'))) AS "sequencePrivilegeObjects",
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') AND has_function_privilege(t.oid, p.oid, 'EXECUTE')
          AND (p.prosecdef OR p.provolatile = 'v' OR p.prokind = 'p')) AS "dangerousRoutineObjects",
      has_database_privilege(t.oid, current_database(), 'CONNECT') AS "databaseConnect",
      has_database_privilege(t.oid, current_database(), 'TEMPORARY') AS "databaseTemporary",
      has_schema_privilege(t.oid, 'public', 'USAGE') AS "schemaUsage",
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') AND has_function_privilege(t.oid, p.oid, 'EXECUTE')) AS "routineExecuteObjects",
      (SELECT count(*) FROM pg_type y JOIN pg_namespace n ON n.oid = y.typnamespace
        WHERE n.nspname = 'public' AND has_type_privilege(t.oid, y.oid, 'USAGE')) AS "typeUsageObjects"
    FROM target t`)[0];
  if (!acl) throw new Error('Matriz ACL da role bootstrap indisponível.');
  onStage?.('memberships');
  const memberships = (await client.$queryRaw<MembershipSummaryRow[]>`
    SELECT
      (SELECT count(*) FROM pg_auth_members m
        WHERE m.member IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'cardapio\\_%')
           OR (m.roleid IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'cardapio\\_%')
               AND (m.set_option OR m.inherit_option OR NOT m.admin_option
                    OR pg_get_userbyid(m.member) <> 'neondb_owner'))) AS "unsafeCount",
      (SELECT count(*) FROM pg_auth_members m
        WHERE m.roleid IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'cardapio\\_%')
          AND pg_get_userbyid(m.member) = 'neondb_owner'
           AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option) AS "neonCreatorAdminOnlyCount"`)[0];
  onStage?.('schema-snapshot');
  const snapshot = await readSchemaSnapshot(client as unknown as PrismaClient, E4_ALT_ROLE_ALIASES);
  const number = (value: bigint | number | string): number => Number(value);
  const bootstrapAcl: BootstrapAclMatrix = {
    explicitGrants: {
      database: number(acl.database), schemas: number(acl.schemas), tables: number(acl.tables), columns: number(acl.columns),
      sequences: number(acl.sequences), routines: number(acl.routines), types: number(acl.types), defaultAcls: number(acl.defaultAcls),
    },
    ownedObjects: {
      databases: number(acl.ownedDatabases), schemas: number(acl.ownedSchemas), relations: number(acl.ownedRelations),
      routines: number(acl.ownedRoutines), types: number(acl.ownedTypes),
    },
    effectiveUnsafe: {
      databaseCreate: acl.databaseCreate, schemaCreate: acl.schemaCreate,
      tablePrivilegeObjects: number(acl.tablePrivilegeObjects), columnPrivilegeColumns: number(acl.columnPrivilegeColumns),
      sequencePrivilegeObjects: number(acl.sequencePrivilegeObjects), dangerousRoutineObjects: number(acl.dangerousRoutineObjects),
    },
    effectiveInformational: {
      databaseConnect: acl.databaseConnect,
      databaseTemporary: acl.databaseTemporary,
      explicitDatabaseConnectCurrentDb: number(acl.explicitDatabaseConnectCurrentDb),
      schemaUsage: acl.schemaUsage,
      routineExecuteObjects: number(acl.routineExecuteObjects),
      typeUsageObjects: number(acl.typeUsageObjects),
    },
  };
  onStage?.('admin-count');
  const adminCount = await client.admin.count();
  return {
    facts: {
      database: head.database,
      databaseOid: head.databaseOid,
      currentUser: head.currentUser,
      sessionUser: head.sessionUser,
      projectId: head.projectId,
      branchId: head.branchId,
      markerComment: head.markerComment,
      serverVersionNum: Number(head.serverVersionNum),
      elevatedRole: head.elevatedRole !== false,
      databaseOwner: head.databaseOwner,
      adminsOwner: head.adminsOwner,
      canInsertAdmins: head.canInsertAdmins === true,
      adminCount,
      bootstrapRoleOid: bootstrap?.oid ?? null,
      bootstrapCanLogin: bootstrap?.canLogin ?? null,
      bootstrapElevatedRole: bootstrap?.elevated ?? null,
      bootstrapAcl,
      bootstrapExplicitAclCount: Object.values(bootstrapAcl.explicitGrants).reduce((sum, count) => sum + count, 0),
      projectMembershipCount: Number(memberships?.unsafeCount ?? -1),
      neonCreatorAdminOnlyMemberships: Number(memberships?.neonCreatorAdminOnlyCount ?? -1),
      migrations: migrations.map((row) => ({
        name: row.migration_name, checksum: row.checksum, finished: row.finished, rolledBack: row.rolled_back,
      })),
      schemaFingerprint: fingerprint(snapshot),
      externalTls,
    },
    snapshot,
  };
}

export async function readExceptionalFactsFromClient(
  client: DbReader,
  externalTls: ExternalTlsEvidence,
): Promise<ExceptionalBootstrapFacts> {
  return (await collectExceptionalFacts(client, externalTls)).facts;
}

export function createExceptionalMigratorDb(
  prisma: PrismaClient,
  externalTls: ExternalTlsEvidence,
  factReader: (client: DbReader, tls: ExternalTlsEvidence) => Promise<ExceptionalBootstrapFacts> = readExceptionalFactsFromClient,
): ExceptionalMigratorDb {
  return {
    readFacts: () => runSerializableReadOnlyTransaction(prisma, (tx) => factReader(tx, externalTls)),
    async insertFirstAdmin(input, expected) {
      let insertCompleted = false;
      let insertFailed = false;
      try {
        return await prisma.$transaction(async (tx) => {
          const refusal = evaluateExceptionalFacts(await factReader(tx, externalTls), expected);
          if (refusal) throw new ExceptionalBootstrapRefused(refusal.code, refusal.message);
          try {
            const created = await tx.admin.create({ data: { ...input, isActive: true }, select: { id: true } });
            insertCompleted = true;
            return created;
          } catch (error) {
            insertFailed = true;
            throw error;
          }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof ExceptionalBootstrapRefused) throw error;
        const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
        if (code === 'P2034') {
          throw new ExceptionalBootstrapRefused('CONCURRENT_BOOTSTRAP', 'Conflito Serializable detectado; esta tentativa não criou o administrador.');
        }
        if (code === 'P2002') {
          throw new ExceptionalBootstrapRefused('ADMIN_ALREADY_EXISTS', 'Já existe administrador com este e-mail.');
        }
        if (insertCompleted && !insertFailed) throw new CommitOutcomeUnknown();
        throw error;
      }
    },
  };
}

export interface ExceptionalBootstrapDeps {
  db: ExceptionalMigratorDb;
  hash: (password: string) => Promise<string>;
  readPassword: () => Promise<string>;
  validatePassword: (password: string) => string[];
}

export type ExceptionalBootstrapResult =
  | { status: 'dry-run-ok' }
  | { status: 'created'; adminId: string }
  | { status: 'outcome-unknown' }
  | { status: 'refused'; code: ExceptionalRefusal | 'INVALID_PASSWORD'; message: string };

export async function runExceptionalMigratorBootstrap(
  deps: ExceptionalBootstrapDeps,
  identity: AdminIdentity,
  mode: 'dry-run' | 'execute',
  expected: ExceptionalExpectedIdentity,
): Promise<ExceptionalBootstrapResult> {
  const refusal = evaluateExceptionalFacts(await deps.db.readFacts(), expected);
  if (refusal) return { status: 'refused', ...refusal };
  if (mode === 'dry-run') return { status: 'dry-run-ok' };

  let password = await deps.readPassword();
  const passwordProblems = deps.validatePassword(password);
  if (passwordProblems.length > 0) {
    password = '';
    return { status: 'refused', code: 'INVALID_PASSWORD', message: passwordProblems[0]! };
  }
  const passwordHash = await deps.hash(password);
  password = '';
  try {
    const created = await deps.db.insertFirstAdmin({ name: identity.name, email: identity.email, passwordHash }, expected);
    return { status: 'created', adminId: created.id };
  } catch (error) {
    if (error instanceof ExceptionalBootstrapRefused) return { status: 'refused', code: error.code, message: error.message };
    if (error instanceof CommitOutcomeUnknown) return { status: 'outcome-unknown' };
    throw error;
  }
}
