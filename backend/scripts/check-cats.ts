import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const cats = await prisma.category.findMany();
  console.log("Categories:", cats);
  await prisma.$disconnect();
}
run();
