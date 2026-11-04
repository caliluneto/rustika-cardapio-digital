import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile, redactSecrets } from '../src/config/secrets';

async function inspectRole() {
  const profile = loadDatabaseProfile('migrate-dev');
  const client = new PrismaClient({
    datasources: { db: { url: profile.databaseUrl } },
  });

  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET statement_timeout = '5000'`;

      const id = await tx.$queryRaw<any[]>`SELECT current_database() as db, current_user as usr`;
      const dbName = id[0].db;
      const user = id[0].usr;

      console.log(`Banco conectado: ${dbName}`);
      console.log(`Role utilizada: ${user}`);

      if (dbName !== 'cardapio_digital_dev') {
        throw new Error(`Banco incorreto identificado: ${dbName}. Interrompendo inspeção.`);
      }

      const roles = await tx.$queryRaw<any[]>`SELECT rolname FROM pg_roles WHERE rolname = 'cardapio_test_app'`;
      console.log('Resultado da consulta (cardapio_test_app):');
      console.log(roles);
    });
  } catch (error: any) {
    console.error(redactSecrets(error.message));
  } finally {
    await client.$disconnect();
  }
}

inspectRole().catch(console.error);