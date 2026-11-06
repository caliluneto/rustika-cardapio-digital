import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Impressão digital de schema (3D.5.2-A) para detectar DRIFT entre ambientes (Dev, Test, Homologação) e para provar a
 * equivalência entre o schema do replay histórico e o da homologação. Somente leitura de catálogo; nunca corrige nada:
 * qualquer correção exige uma nova migration revisada. Os nomes físicos das roles são trocados por papéis lógicos
 * (runtime, migrator, bootstrap, placeholder) para que ambientes com nomes diferentes sejam comparáveis.
 */
export const SECTIONS = [
  'migrations', 'schemas', 'tables', 'columns', 'constraints', 'indexes', 'enums', 'sequences', 'functions', 'views', 'triggers', 'policies',
  'owners', 'tableAcls', 'columnAcls', 'schemaAcls', 'databaseAcls', 'defaultAcls', 'roles', 'memberships', 'settings', 'databaseProps',
] as const;
export type Section = (typeof SECTIONS)[number];
export type SchemaSnapshot = Record<Section, string[]>;

export const DEFAULT_ROLE_ALIASES: Readonly<Record<string, string>> = {
  cardapio_test_app: 'runtime', cardapio_dev_app: 'placeholder', cardapio_migrator: 'migrator',
  cardapio_homolog_app: 'runtime', cardapio_homolog_placeholder: 'placeholder', cardapio_homolog_migrator: 'migrator',
  cardapio_homolog_bootstrap: 'bootstrap',
};

export const aliasRole = (role: string, aliases: Readonly<Record<string, string>> = DEFAULT_ROLE_ALIASES): string =>
  role === 'PUBLIC' ? 'PUBLIC' : (aliases[role] ?? `?${role}`);

export function fingerprint(snapshot: SchemaSnapshot): string {
  const normalized = Object.fromEntries(SECTIONS.map((section) => [section, [...snapshot[section]].sort()]));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export interface SnapshotDifference { section: Section; onlyInA: string[]; onlyInB: string[] }

export function diffSnapshots(a: SchemaSnapshot, b: SchemaSnapshot): SnapshotDifference[] {
  const differences: SnapshotDifference[] = [];
  for (const section of SECTIONS) {
    const left = new Set(a[section]); const right = new Set(b[section]);
    const onlyInA = [...left].filter((item) => !right.has(item)).sort();
    const onlyInB = [...right].filter((item) => !left.has(item)).sort();
    if (onlyInA.length > 0 || onlyInB.length > 0) differences.push({ section, onlyInA, onlyInB });
  }
  return differences;
}

interface Row { item: string }
interface AclRow { obj: string; grantee: string; priv: string; grantable: boolean }

export async function readSchemaSnapshot(prisma: PrismaClient, aliases: Readonly<Record<string, string>> = DEFAULT_ROLE_ALIASES): Promise<SchemaSnapshot> {
  const items = async (rows: Promise<Row[]>): Promise<string[]> => (await rows).map((row) => row.item);
  const acl = async (rows: Promise<AclRow[]>): Promise<string[]> =>
    (await rows).map((row) => `${row.obj}:${aliasRole(row.grantee, aliases)}:${row.priv}:${row.grantable}`);
  const owner = (name: string): string => aliasRole(name, aliases);

  const tables = await items(prisma.$queryRaw<Row[]>`
    SELECT c.relname || ':rls=' || c.relrowsecurity::text || ':force=' || c.relforcerowsecurity::text || ':kind=' || c.relkind::text AS item FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`);
  const columns = await items(prisma.$queryRaw<Row[]>`
    SELECT c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS item
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`);
  const constraints = await items(prisma.$queryRaw<Row[]>`
    SELECT c.relname || '.' || k.conname || ':' || k.contype::text || ':' || pg_get_constraintdef(k.oid) AS item
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`);
  const indexes = await items(prisma.$queryRaw<Row[]>`SELECT tablename || '.' || indexname || ':' || indexdef AS item FROM pg_indexes WHERE schemaname = 'public'`);
  const enums = await items(prisma.$queryRaw<Row[]>`
    SELECT t.typname || ':' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS item
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' GROUP BY t.typname`);
  const sequences = await items(prisma.$queryRaw<Row[]>`
    SELECT c.relname || ':' || format_type(s.seqtypid, NULL) || ':' || s.seqstart || ':' || s.seqincrement || ':' || s.seqmin || ':' || s.seqmax || ':' || s.seqcycle::text AS item
      FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`);
  const owners = (await prisma.$queryRaw<Array<{ obj: string; owner: string }>>`
    SELECT c.relname::text AS obj, pg_get_userbyid(c.relowner)::text AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S')`).map((row) => `${row.obj}:${owner(row.owner)}`);
  const databaseOwner = (await prisma.$queryRaw<Array<{ owner: string }>>`SELECT pg_get_userbyid(datdba)::text AS owner FROM pg_database WHERE datname = current_database()`)
    .map((row) => `database:${owner(row.owner)}`);

  const schemas = (await prisma.$queryRaw<Array<{ obj: string; owner: string }>>`
    SELECT nspname::text AS obj, pg_get_userbyid(nspowner)::text AS owner FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'`)
    .map((row) => `${row.obj}:${owner(row.owner)}`);
  const functions = (await prisma.$queryRaw<Array<{ obj: string; owner: string; def: string }>>`
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS obj, pg_get_userbyid(p.proowner)::text AS owner, md5(pg_get_functiondef(p.oid)) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')`)
    .map((row) => `${row.obj}:${owner(row.owner)}:${row.def}`);
  const views = (await prisma.$queryRaw<Array<{ obj: string; owner: string; def: string }>>`
    SELECT c.relname::text AS obj, pg_get_userbyid(c.relowner)::text AS owner, md5(pg_get_viewdef(c.oid)) AS def
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')`)
    .map((row) => `${row.obj}:${owner(row.owner)}:${row.def}`);
  const triggers = await items(prisma.$queryRaw<Row[]>`
    SELECT c.relname || '.' || t.tgname || ':' || md5(pg_get_triggerdef(t.oid)) AS item
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal`);
  const policies = (await prisma.$queryRaw<Array<{ obj: string; cmd: string; roles: string; qual: string; chk: string }>>`
    SELECT c.relname || '.' || pol.polname AS obj, pol.polcmd::text AS cmd,
           array_to_string(ARRAY(SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END FROM unnest(pol.polroles) r ORDER BY 1), ',') AS roles,
           COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') AS qual, COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') AS chk
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`)
    .map((row) => `${row.obj}:${row.cmd}:${row.roles.split(',').map((role) => aliasRole(role, aliases)).sort().join('+')}:${row.qual}:${row.chk}`);
  const roles = (await prisma.$queryRaw<Array<{ name: string; flags: string }>>`
    SELECT rolname::text AS name, 'super=' || rolsuper::text || ':inherit=' || rolinherit::text || ':createrole=' || rolcreaterole::text || ':createdb=' || rolcreatedb::text
           || ':login=' || rolcanlogin::text || ':repl=' || rolreplication::text || ':bypassrls=' || rolbypassrls::text || ':conn=' || rolconnlimit::text AS flags
      FROM pg_roles WHERE rolname LIKE 'cardapio\\_%'`).map((row) => `${aliasRole(row.name, aliases)}:${row.flags}`);
  const memberships = (await prisma.$queryRaw<Array<{ granted: string; member: string; admin: boolean }>>`
    SELECT pg_get_userbyid(m.roleid)::text AS granted, pg_get_userbyid(m.member)::text AS member, m.admin_option AS admin FROM pg_auth_members m
     WHERE pg_get_userbyid(m.roleid) LIKE 'cardapio\\_%' OR pg_get_userbyid(m.member) LIKE 'cardapio\\_%'`)
    .map((row) => `${aliasRole(row.granted, aliases)}<-${aliasRole(row.member, aliases)}:${row.admin}`);
  const settings = (await prisma.$queryRaw<Array<{ db: string; role: string; cfg: string }>>`
    SELECT CASE WHEN s.setdatabase = 0 THEN '*' ELSE 'database' END AS db, CASE WHEN s.setrole = 0 THEN '*' ELSE pg_get_userbyid(s.setrole)::text END AS role,
           array_to_string(s.setconfig, ';') AS cfg
      FROM pg_db_role_setting s WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))`)
    .map((row) => `${row.db}:${row.role === '*' ? '*' : aliasRole(row.role, aliases)}:${row.cfg}`);
  const databaseProps = await items(prisma.$queryRaw<Row[]>`
    SELECT pg_encoding_to_char(encoding) || ':' || datcollate || ':' || datctype || ':conn=' || datconnlimit::text || ':allow=' || datallowconn::text || ':template=' || datistemplate::text AS item
      FROM pg_database WHERE datname = current_database()`);

  const tableAcls = await acl(prisma.$queryRaw<AclRow[]>`
    SELECT c.relname::text AS obj, CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END AS grantee, x.privilege_type::text AS priv, x.is_grantable AS grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE n.nspname = 'public' AND c.relacl IS NOT NULL AND c.relkind IN ('r', 'p', 'S')`);
  const columnAcls = await acl(prisma.$queryRaw<AclRow[]>`
    SELECT c.relname || '.' || a.attname AS obj, CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END AS grantee, x.privilege_type::text AS priv, x.is_grantable AS grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped`);
  const schemaAcls = await acl(prisma.$queryRaw<AclRow[]>`
    SELECT 'schema:public' AS obj, CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END AS grantee, x.privilege_type::text AS priv, x.is_grantable AS grantable
      FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x WHERE n.nspname = 'public' AND n.nspacl IS NOT NULL`);
  const databaseAcls = await acl(prisma.$queryRaw<AclRow[]>`
    SELECT 'database' AS obj, CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END AS grantee, x.privilege_type::text AS priv, x.is_grantable AS grantable
      FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) x WHERE d.datname = current_database() AND d.datacl IS NOT NULL`);
  const defaultAcls = (await prisma.$queryRaw<Array<AclRow & { definer: string; scope: string }>>`
    SELECT pg_get_userbyid(d.defaclrole)::text AS definer, d.defaclobjtype::text AS obj, COALESCE(n.nspname, '*')::text AS scope,
           CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee)::text END AS grantee, x.privilege_type::text AS priv, x.is_grantable AS grantable
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) x`)
    .map((row) => `${owner(row.definer)}:${row.scope}:${row.obj}:${aliasRole(row.grantee, aliases)}:${row.priv}:${row.grantable}`);
  const migrations = await items(prisma.$queryRaw<Row[]>`
    SELECT migration_name || ':' || checksum || ':' || (finished_at IS NOT NULL)::text || ':' || (rolled_back_at IS NOT NULL)::text AS item FROM public._prisma_migrations`);

  return {
    migrations, schemas, tables, columns, constraints, indexes, enums, sequences, functions, views, triggers, policies,
    owners: [...owners, ...databaseOwner], tableAcls, columnAcls, schemaAcls, databaseAcls, defaultAcls, roles, memberships, settings, databaseProps,
  };
}

/** Renomeações LEGÍTIMAS aprovadas (banco e roles) — qualquer outra diferença de identidade é inesperada. */
export const APPROVED_RENAMES: Readonly<Record<string, string>> = {
  cardapio_digital_test: 'cardapio_digital_homolog',
  cardapio_test_app: 'cardapio_homolog_app',
  cardapio_migrator: 'cardapio_homolog_migrator',
  cardapio_dev_app: 'cardapio_homolog_placeholder',
};

export interface PhysicalIdentity { database: string; projectRoles: string[] }

export async function readPhysicalIdentity(prisma: PrismaClient): Promise<PhysicalIdentity> {
  const database = (await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database()::text AS db`)[0]?.db ?? '';
  const projectRoles = (await prisma.$queryRaw<Array<{ rolname: string }>>`SELECT rolname::text AS rolname FROM pg_roles WHERE rolname LIKE 'cardapio\\_%' ORDER BY 1`).map((row) => row.rolname);
  return { database, projectRoles };
}

export interface RenameReport { renamed: Array<{ from: string; to: string }>; unexpected: string[] }

/**
 * Compara identidades físicas antes/depois. Renomeações aprovadas viram `renamed`; o que não estiver na tabela aprovada
 * (banco ou role sumida, mantida, nova ou com destino diferente) é `unexpected`. Roles do projeto SEM mapeamento (bootstrap,
 * que não é renomeada) devem existir iguais antes e depois.
 */
export function classifyRenames(before: PhysicalIdentity, after: PhysicalIdentity, approved: Readonly<Record<string, string>> = APPROVED_RENAMES): RenameReport {
  const renamed: RenameReport['renamed'] = []; const unexpected: string[] = [];
  const afterSet = new Set(after.projectRoles);
  const expectedAfter = new Set<string>();
  const dbTarget = approved[before.database];
  if (dbTarget !== undefined && dbTarget === after.database) renamed.push({ from: before.database, to: after.database });
  else unexpected.push(`banco ${before.database} → ${after.database}`);
  for (const role of before.projectRoles) {
    const target = approved[role];
    if (target === undefined) { expectedAfter.add(role); if (!afterSet.has(role)) unexpected.push(`role ${role} desapareceu`); continue; }
    expectedAfter.add(target);
    if (afterSet.has(target) && !afterSet.has(role)) renamed.push({ from: role, to: target });
    else unexpected.push(`role ${role} não virou ${target}`);
  }
  for (const role of after.projectRoles) if (!expectedAfter.has(role)) unexpected.push(`role inesperada após a renomeação: ${role}`);
  return { renamed, unexpected };
}
