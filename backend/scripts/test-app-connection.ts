import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile, redactSecrets } from '../src/config/secrets';

async function testAppConnection() {
  const profile = loadDatabaseProfile('app-dev', { purpose: 'runtime' });
  const prisma = new PrismaClient({
    datasources: { db: { url: profile.databaseUrl } },
  });

  try {
    await prisma.$transaction(async (tx) => {
      // Garantir isolamento somente de leitura no nível do banco de dados
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;

      // 1 & 2. Validar Identidade e Role
      const id = await tx.$queryRaw<any[]>`SELECT current_database() as db, current_user as usr`;
      const dbName = id[0].db;
      const userName = id[0].usr;

      console.log('=== IDENTIDADE CONECTADA ===');
      console.log(`Banco Atual: ${dbName}`);
      console.log(`Role Atual:  ${userName}`);

      if (dbName !== 'cardapio_digital_dev' || userName !== 'cardapio_dev_app') {
        throw new Error(`Incompatibilidade de identidade! Esperado: cardapio_digital_dev / cardapio_dev_app. Obtido: ${dbName} / ${userName}`);
      }

      console.log('\n=== RESULTADO DAS CONSULTAS (READ-ONLY) ===');
      
      // 4. Executar consultas aos domínios via Prisma Client
      const admins = await tx.admin.findMany();
      console.log(`[OK] admins: ${admins.length} registros (Consulta bem-sucedida, resultado vazio esperado)`);

      const categories = await tx.category.findMany();
      console.log(`[OK] categories: ${categories.length} registros (Consulta bem-sucedida, resultado vazio esperado)`);

      const products = await tx.product.findMany();
      console.log(`[OK] products: ${products.length} registros (Consulta bem-sucedida, resultado vazio esperado)`);

      const comandas = await tx.comanda.findMany();
      console.log(`[OK] comandas: ${comandas.length} registros (Consulta bem-sucedida, resultado vazio esperado)`);

      const sessions = await tx.comandaSession.findMany();
      console.log(`[OK] comanda_sessions: ${sessions.length} registros (Consulta bem-sucedida, resultado vazio esperado)`);

      const orders = await tx.order.findMany();
      console.log(`[OK] orders: ${orders.length} registros (Consulta bem-sucedida, resultado vazio esperado)`);

    });

    console.log('\nConexão validada com sucesso! O ORM mapeou os modelos corretamente com as permissões da Role.');

  } catch (error: any) {
    console.error('Erro de Validação:', redactSecrets(error.message));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

testAppConnection().catch(console.error);