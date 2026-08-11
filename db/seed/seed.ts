import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MATERIALS = [
  { code: 'essence_1', tier: 1, name: '普通精华' },
  { code: 'essence_2', tier: 2, name: '稀有精华' },
  { code: 'essence_3', tier: 3, name: '史诗精华' },
  { code: 'essence_4', tier: 4, name: '传说精华' },
];

async function main(): Promise<void> {
  const bank = await prisma.wordBank.upsert({
    where: { code: 'kaoyan_engl1' },
    update: {},
    create: { code: 'kaoyan_engl1', name: '考研英语一' },
  });
  console.log('[seed] word bank ready:', bank.code);

  for (const m of MATERIALS) {
    await prisma.material.upsert({
      where: { code: m.code },
      update: { tier: m.tier, name: m.name },
      create: m,
    });
  }
  console.log('[seed] materials ready:', MATERIALS.length);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());