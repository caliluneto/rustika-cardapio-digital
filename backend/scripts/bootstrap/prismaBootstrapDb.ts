import type { PrismaClient } from '@prisma/client';
import { BootstrapRefused } from './adminBootstrap';
import { readServerFacts } from '../../src/config/serverIdentity';
import type { BootstrapDb, BootstrapFacts } from './adminBootstrap';

interface FactsRow {
  db: string; usr: string; sess: string; elevated: boolean | null; ver: number;
  can_insert: boolean; can_update: boolean; can_delete: boolean; can_truncate: boolean;
}
interface MigrationRow { migration_name: string; checksum: string; finished: boolean; rolled_back: boolean }

/** Adaptador Prisma do bootstrap. Somente leituras de catálogo + uma transação Serializable de inserção. */
export function createPrismaBootstrapDb(prisma: PrismaClient): BootstrapDb {
  return {
    async readFacts(): Promise<BootstrapFacts> {
      const rows = await prisma.$queryRaw<FactsRow[]>`
        SELECT current_database() AS db, current_user::text AS usr, session_user::text AS sess,
               (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
                  FROM pg_roles WHERE rolname = current_user) AS elevated,
               current_setting('server_version_num')::int AS ver,
               has_table_privilege(current_user, 'public.admins', 'INSERT') AS can_insert,
               has_table_privilege(current_user, 'public.admins', 'UPDATE') AS can_update,
               has_table_privilege(current_user, 'public.admins', 'DELETE') AS can_delete,
               has_table_privilege(current_user, 'public.admins', 'TRUNCATE') AS can_truncate`;
      const facts = rows[0];
      if (!facts) throw new Error('Fatos do banco indisponíveis.');
      const migrations = await prisma.$queryRaw<MigrationRow[]>`
        SELECT migration_name, checksum, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back
          FROM public._prisma_migrations ORDER BY migration_name`;
      const adminCount = await prisma.admin.count();
      const server = await readServerFacts(prisma);
      return {
        database: facts.db, currentUser: facts.usr, sessionUser: facts.sess, elevatedRole: facts.elevated !== false,
        serverVersionNum: Number(facts.ver), canInsertAdmins: facts.can_insert, canUpdateAdmins: facts.can_update,
        canDeleteAdmins: facts.can_delete, canTruncateAdmins: facts.can_truncate, adminCount, server,
        migrations: migrations.map((row) => ({ name: row.migration_name, checksum: row.checksum, finished: row.finished, rolledBack: row.rolled_back })),
      };
    },

    async insertFirstAdmin(input) {
      try {
        return await prisma.$transaction(async (tx) => {
          if ((await tx.admin.count()) > 0) throw new BootstrapRefused('ADMIN_ALREADY_EXISTS', 'Já existe administrador neste ambiente.');
          return tx.admin.create({ data: { ...input, isActive: true }, select: { id: true } });
        }, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (error instanceof BootstrapRefused) throw error;
        const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
        if (code === 'P2034') throw new BootstrapRefused('CONCURRENT_BOOTSTRAP', 'Outro bootstrap concorrente foi detectado; nada foi criado.');
        if (code === 'P2002') throw new BootstrapRefused('ADMIN_ALREADY_EXISTS', 'Já existe administrador com este e-mail.');
        throw error;
      }
    },
  };
}
