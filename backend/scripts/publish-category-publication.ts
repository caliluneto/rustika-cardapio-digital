import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { planCategoryPublication, type CategorySnapshot, type ProductSnapshot } from '../src/domain/categoryPublication';
import { loadDatabaseProfile, resolveSecretsDir } from '../src/config/secrets';

dotenv.config();

const CONFIRMATION = 'cardapio_digital_dev';
const EXPECTED = {
  categories: 12,
  updates: 10,
  categoriesAfter: 12,
  publicKeyProducts: 144,
  internalProducts: 24,
  eligibleAfter: 144,
} as const;

type CatalogReader = Pick<PrismaClient, 'category' | 'product'>;

interface Snapshot {
  categories: readonly CategorySnapshot[];
  products: readonly ProductSnapshot[];
}

async function readSnapshot(reader: CatalogReader): Promise<Snapshot> {
  const categories = await reader.category.findMany({
    select: { id: true, name: true, publicKey: true, isActive: true, displayOrder: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
  const products = await reader.product.findMany({
    select: {
      id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
      name: true, price: true, isActive: true, availabilityState: true, categoryId: true,
    },
    orderBy: [{ categoryId: 'asc' }, { publicKey: 'asc' }],
  });
  return {
    categories,
    products: products.map((product) => ({
      ...product,
      priceInCents: product.price.mul(100).toNumber(),
    })),
  };
}

function assertPlan(plan: ReturnType<typeof planCategoryPublication>): void {
  if (plan.totals.categories !== EXPECTED.categories ||
      (plan.updates.length !== 0 && plan.updates.length !== EXPECTED.updates) ||
      plan.totals.categoriesAfter !== EXPECTED.categoriesAfter ||
      plan.totals.publicKeyProducts !== EXPECTED.publicKeyProducts ||
      plan.totals.internalProducts !== EXPECTED.internalProducts ||
      plan.totals.eligibleAfter !== EXPECTED.eligibleAfter ||
      !plan.eligibleProductIds.includes('rustika-PA062240')) {
    throw new Error('Plano divergente do snapshot aprovado. Execução interrompida.');
  }
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const confirmation = process.argv.find((argument) => argument.startsWith('--confirm='))?.slice('--confirm='.length);
  if (execute && confirmation !== CONFIRMATION) {
    throw new Error(`Execução exige --confirm=${CONFIRMATION}.`);
  }

  const database = loadDatabaseProfile('migrate-dev', {
    purpose: 'migration',
    secretsDir: resolveSecretsDir(),
  });
  const prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });

  try {
    const identity = await prisma.$queryRaw<{ db: string; usr: string }[]>`
      SELECT current_database() as db, current_user as usr
    `;
    const session = identity[0];
    if (!session || session.db !== CONFIRMATION || session.usr !== 'cardapio_migrator') {
      throw new Error('Identidade de banco/role não autorizada para publicação.');
    }

    if (!execute) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '10000'`;
        const snapshot = await readSnapshot(tx);
        const plan = planCategoryPublication(snapshot.categories, snapshot.products);
        assertPlan(plan);
        console.log(JSON.stringify({
          mode: 'dry-run',
          database: database.describe(),
          updates: plan.updates,
          totals: plan.totals,
        }, null, 2));
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '30000'`;
      const before = await readSnapshot(tx);
      const plan = planCategoryPublication(before.categories, before.products);
      assertPlan(plan);

      if (plan.updates.length === 0) {
        console.log(JSON.stringify({
          mode: 'already-published',
          database: database.describe(),
          updated: 0,
          totals: plan.totals,
        }, null, 2));
        return;
      }

      for (const update of plan.updates) {
        const result = await tx.category.updateMany({
          where: { id: update.id, name: update.name, publicKey: null },
          data: { publicKey: update.publicKey },
        });
        if (result.count !== 1) throw new Error(`Categoria não atualizada: ${update.name}`);
      }

      const after = await readSnapshot(tx);
      const verification = planCategoryPublication(after.categories, after.products);
      if (verification.updates.length !== 0 ||
          verification.totals.categoriesAfter !== EXPECTED.categoriesAfter ||
          verification.totals.eligibleAfter !== EXPECTED.eligibleAfter ||
          verification.totals.internalProducts !== EXPECTED.internalProducts ||
          !verification.eligibleProductIds.includes('rustika-PA062240')) {
        throw new Error('Verificação pós-atualização falhou. Transação revertida.');
      }
      console.log(JSON.stringify({
        mode: 'execute',
        database: database.describe(),
        updated: plan.updates.length,
        totals: verification.totals,
      }, null, 2));
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha na publicação de categorias.');
  process.exitCode = 1;
});
