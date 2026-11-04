import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const products = await prisma.product.findMany();
  console.log("Products:", products.map(p => ({ id: p.id, publicKey: p.publicKey, name: p.name, isActive: p.isActive, availabilityState: p.availabilityState, price: p.price, categoryId: p.categoryId })));
  await prisma.$disconnect();
}
run();
