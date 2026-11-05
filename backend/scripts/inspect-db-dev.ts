import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile, redactSecrets } from '../src/config/secrets';

async function inspect() {
  const profile = loadDatabaseProfile('migrate-dev');
  const client = new PrismaClient({
    datasources: { db: { url: profile.databaseUrl } },
  });

  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET statement_timeout = '5000'`;

      // 1. Identity & Version
      const id = await tx.$queryRaw<any[]>`SELECT current_database() as db, current_user as usr, session_user as sess_usr, version() as ver`;
      console.log('--- Identidade ---');
      console.log(id[0]);

      if (id[0].db !== 'cardapio_digital_dev') {
        throw new Error(`Banco incorreto identificado: ${id[0].db}. Interrompendo inspeção.`);
      }

      // 2. Roles
      const roles = await tx.$queryRaw<any[]>`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname IN ('cardapio_dev_app', 'cardapio_migrator')`;
      console.log('\n--- Roles ---');
      console.table(roles);

      // 3. Tabela _prisma_migrations
      const migrationsExists = await tx.$queryRaw<any[]>`SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') as has_migrations`;
      console.log('\n--- Tabela _prisma_migrations Existe? ---');
      console.log(migrationsExists[0].has_migrations);

      if (migrationsExists[0].has_migrations) {
        const migrations = await tx.$queryRaw<any[]>`SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY finished_at DESC`;
        console.log('\n--- Migrations Aplicadas ---');
        console.table(migrations);
      }

      // 4 & 5. Tabelas Existentes e Proprietários
      const tables = await tx.$queryRaw<any[]>`SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public'`;
      console.log('\n--- Tabelas no Schema Public ---');
      console.table(tables);

      // 6 & 7. Sequences e Proprietários
      const sequences = await tx.$queryRaw<any[]>`
        SELECT c.relname as sequence_name, pg_get_userbyid(c.relowner) as owner
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND n.nspname = 'public'
      `;
      console.log('\n--- Sequences no Schema Public ---');
      console.table(sequences);

      // 8. Privilégios (Tabelas e Sequences)
      const tableGrants = await tx.$queryRaw<any[]>`
        SELECT grantee, privilege_type, table_name
        FROM information_schema.role_table_grants
        WHERE grantee IN ('cardapio_dev_app', 'cardapio_migrator') AND table_schema = 'public'
      `;
      console.log('\n--- Privilégios de Tabelas ---');
      console.table(tableGrants);

      const schemaGrants = await tx.$queryRaw<any[]>`
        SELECT r.rolname AS grantee,
               has_schema_privilege(r.rolname, 'public', 'USAGE') as has_usage,
               has_schema_privilege(r.rolname, 'public', 'CREATE') as has_create
        FROM pg_roles r
        WHERE r.rolname IN ('cardapio_dev_app', 'cardapio_migrator')
      `;
      console.log('\n--- Privilégios no Schema Public ---');
      console.table(schemaGrants);
    });
  } catch (error: any) {
    console.error(redactSecrets(error.message));
  } finally {
    await client.$disconnect();
  }
}

inspect().catch(console.error);