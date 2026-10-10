import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const purchases = await prisma.purchaseVerification.findMany();
  console.log(purchases);
}

run().finally(() => prisma.$disconnect());
