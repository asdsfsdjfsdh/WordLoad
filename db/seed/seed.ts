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

  const wordCount = await prisma.word.count();
  if (wordCount === 0) {
    console.log('[seed] 无单词数据，尝试导入...');
    try {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const { evaluateDifficulties, normalizeByQuantile } = await import('./pipeline/difficulty');
      const { checkQuality, collectCandidates } = await import('./pipeline/quality');
      const dataDir = resolve(import.meta.dirname, 'data');
      const [books, bookWords, words, examples] = await Promise.all([
        JSON.parse(readFileSync(resolve(dataDir, 'tb_book.json'), 'utf8')),
        JSON.parse(readFileSync(resolve(dataDir, 'tb_voc_book.json'), 'utf8')),
        JSON.parse(readFileSync(resolve(dataDir, 'tb_vocabulary.json'), 'utf8')),
        JSON.parse(readFileSync(resolve(dataDir, 'tb_voc_examples.json'), 'utf8')),
      ]);
      const KAOYAN_BOOK_ID = 2;
      const book = books.find((b: { bookid: number }) => b.bookid === KAOYAN_BOOK_ID);
      if (!book) throw new Error(`词书 bookid=${KAOYAN_BOOK_ID} 不存在`);
      const wIds = new Set(bookWords.filter((r: { bookid: number }) => r.bookid === KAOYAN_BOOK_ID).map((r: { wordid: string }) => r.wordid));
      const bw = words.filter((w: { wordid: string }) => wIds.has(w.wordid));
      const candidates = collectCandidates(bw, examples);
      checkQuality(candidates);
      console.log(`[seed] 候选词 ${candidates.length}，正在写入...`);
      for (const c of candidates) {
        const phoneticAm = c.word.phonetic && typeof c.word.phonetic === 'object' && !Array.isArray(c.word.phonetic)
          ? (c.word.phonetic as Record<string, string>).us || (c.word.phonetic as Record<string, string>).uk
          : null;
        const { id: wordId } = await prisma.word.upsert({
          where: { text: c.word.headWord },
          update: { phoneticAm, tier: 'I' },
          create: { text: c.word.headWord, phoneticAm, tier: 'I' },
        });
        for (let idx = 0; idx < c.senses.length; idx++) {
          await prisma.wordSense.upsert({
            where: { wordId_idx: { wordId, idx } },
            update: { meaning: c.senses[idx], example: c.examples[idx] || null },
            create: { wordId, idx, meaning: c.senses[idx], example: c.examples[idx] || null },
          });
        }
        await prisma.bankWord.upsert({
          where: { bankId_wordId: { bankId: bank.id, wordId } },
          update: {},
          create: { bankId: bank.id, wordId, stage: 1 },
        });
      }
      const difficulties = evaluateDifficulties(candidates);
      normalizeByQuantile(difficulties);
      await Promise.all(difficulties.map(async ({ wordId: wid, tier }: { wordId: string; tier: string }) => {
        const w = candidates.find((x: { word: { headWord: string } }) => x.word.headWord === wid);
        if (!w) return;
        const wr = await prisma.word.findUnique({ where: { text: wid } });
        if (wr) await prisma.word.update({ where: { id: wr.id }, data: { tier, difficultyScore: 0 } });
      }));
      console.log('[seed] 单词导入完成');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[seed] 自动导入失败: ${msg}`);
      console.warn('[seed] 请手动运行: pnpm --filter @word-journey/db pipeline:import -- --force');
    }
  } else {
    console.log(`[seed] 已有 ${wordCount} 个单词，跳过导入`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());