import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  try {
    const totalProducts = await prisma.product.count();
    const publicProducts = await prisma.product.count({ where: { publicKey: { not: null } } });
    const internalProducts = await prisma.product.count({ where: { publicKey: null } });
    const totalCategories = await prisma.category.count();

    console.log(`Total Products: ${totalProducts}`);
    console.log(`Public Products: ${publicProducts}`);
    console.log(`Internal Products: ${internalProducts}`);
    console.log(`Total Categories: ${totalCategories}`);

    const migrations: any = await prisma.$queryRaw`SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5`;
    console.log('Last Migrations:', migrations.map((m: any) => m.migration_name));

    // Get constraints on products table
    const constraints: any = await prisma.$queryRaw`
      SELECT conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'products'
    `;
    console.log('Constraints on products:', constraints);

  } finally {
    await prisma.$disconnect();
  }
}
run();
