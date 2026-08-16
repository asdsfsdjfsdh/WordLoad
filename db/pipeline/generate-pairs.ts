// 易混词对生成入库：从 DB 读取词库，生成形近/音近候选并写入 word_pairs
// 用法: tsx pipeline/generate-pairs.ts [--dry-run] [--bank-code=<code>]

import { PrismaClient } from '@prisma/client';
import { findHomophonePairs, findOrthographicPairs, mergePairs, type PairCandidate } from './confusable.ts';

const prisma = new PrismaClient();

function parseBankCode(argv: string[]): string {
  const arg = argv.find((a) => a.startsWith('--bank-code='));
  return arg ? arg.split('=')[1] : 'kaoyan_engl1';
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const bankCode = parseBankCode(process.argv.slice(2));

  const bank = await prisma.wordBank.findUnique({ where: { code: bankCode } });
  if (!bank) throw new Error(`词书 ${bankCode} 不存在，请先跑 import`);

  const words = await prisma.word.findMany({
    where: { bankWords: { some: { bankId: bank.id } } },
    select: { id: true, text: true, phoneticEn: true, phoneticAm: true },
  });
  console.log(`[confusable] 词库 ${words.length} 词`);

  const texts = words.map((w) => w.text.toLowerCase());

  const ortho = findOrthographicPairs(texts, { maxDistance: 2, minLength: 4 });
  console.log(`[confusable] 形近候选: ${ortho.length}`);

  // 音近：优先用英式音标，缺则美式
  const phoneticWords = words.map((w) => ({
    text: w.text.toLowerCase(),
    phonetic: w.phoneticEn ?? w.phoneticAm,
  }));
  const homo = findHomophonePairs(phoneticWords);
  console.log(`[confusable] 音近候选: ${homo.length}`);

  const merged = mergePairs(ortho, homo);
  console.log(`[confusable] 合并去重后: ${merged.length}`);

  // 音近需排除拼写完全相同（如 honor/honour 属拼写变体，保留但 note 区分）
  if (dryRun) {
    const byType = merged.reduce<Record<string, number>>((acc, p) => {
      acc[p.type] = (acc[p.type] ?? 0) + 1;
      return acc;
    }, {});
    console.log('[confusable] DRY RUN 分布:', JSON.stringify(byType));
    const samples = merged.slice(0, 20);
    for (const s of samples) console.log(`  [${s.type}] ${s.wordA} ↔ ${s.wordB}`);
    return;
  }

  // 写库（upsert，幂等）
  let written = 0;
  for (const p of merged) {
    const wordA = words.find((w) => w.text.toLowerCase() === p.wordA);
    const wordB = words.find((w) => w.text.toLowerCase() === p.wordB);
    if (!wordA || !wordB) continue;
    const [minW, maxW] = wordA.id < wordB.id ? [wordA, wordB] : [wordB, wordA];
    await prisma.wordPair.upsert({
      where: { wordAId_wordBId: { wordAId: minW.id, wordBId: maxW.id } },
      update: { type: p.type, note: p.note },
      create: { wordAId: minW.id, wordBId: maxW.id, type: p.type, note: p.note },
    });
    written++;
  }
  console.log(`[confusable] 写入 ${written} 对`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());