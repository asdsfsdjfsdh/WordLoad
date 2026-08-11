import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const bank = await prisma.wordBank.upsert({
    where: { code: 'kaoyan_engl1' },
    update: {},
    create: { code: 'kaoyan_engl1', name: '考研英语一' },
  });
  console.log('[seed] word bank ready:', bank.code);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());