// 词库导入管线：源 JSON → 候选词 → 质量校验 → 难度评估 → 写入 DB
// 用法: tsx pipeline/import.ts [--book-id=<id>] [--dry-run] [--force]

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateDifficulties, normalizeByQuantile } from './difficulty';
import { checkQuality, collectCandidates, reportToText } from './quality';
import type { RawBook, RawBookWord, RawExample, RawWord } from './types';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');
const KAOYAN_BOOK_ID = 2; // 考研词汇便携版

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(readFileSync(resolve(DATA_DIR, name), 'utf8')) as T;
}

interface Options {
  bookId: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { bookId: KAOYAN_BOOK_ID, dryRun: false, force: false };
  for (const a of argv) {
    if (a.startsWith('--book-id=')) opts.bookId = Number(a.split('=')[1]);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--force') opts.force = true;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const [books, bookWords, words, examples] = await Promise.all([
    loadJson<RawBook[]>('tb_book.json'),
    loadJson<RawBookWord[]>('tb_voc_book.json'),
    loadJson<RawWord[]>('tb_vocabulary.json'),
    loadJson<RawExample[]>('tb_voc_examples.json'),
  ]);

  const book = books.find((b) => b.bookid === opts.bookId);
  if (!book) throw new Error(`词书 bookid=${opts.bookId} 不存在`);
  console.log(`[import] 词书: ${book.bookname} (${book.voccount} 词)`);

  const wordIds = new Set(
    bookWords.filter((r) => r.bookid === opts.bookId).map((r) => r.wordid),
  );
  const bookWords2 = words.filter((w) => wordIds.has(w.wordid));
  console.log(`[import] 命中词条: ${bookWords2.length}`);

  // 1) 候选词
  const candidates = collectCandidates(bookWords2, examples);
  console.log(`[import] 候选词: ${candidates.length}`);

  // 2) 质量校验
  const report = checkQuality(candidates);
  console.log(reportToText(report));

  // 3) 难度评估（剔除缺音标/缺释义/拼写异常的候选——无法出题）
  const fatalWords = new Set(
    report.issues.filter((i) => i.fatal).map((i) => i.word.toLowerCase()),
  );
  const working = candidates.filter((c) => !fatalWords.has(c.word.toLowerCase()));

  // 第一遍：原始维度分
  const firstPass = working.map((c) => {
    const senses = splitSenses(c.paraphrase, c.word);
    return {
      candidate: c,
      senses,
      diff: evaluateDifficulties({
        senses: senses.length,
        spelling: c.word.split(/[\s\-]/)[0] ?? c.word,
        frequency: c.frequency,
        confusableCount: 0,
      }),
    };
  });

  // 第二遍：书内分位数归一 → 0~1 均匀分布，分 4 档
  const { normalized, tiers } = normalizeByQuantile(firstPass.map((f) => f.diff.score));

  const enriched = firstPass.map((f, i) => {
    const c = f.candidate;
    const score = normalized.get(i) ?? 0;
    const tier = tiers.get(i) ?? 'I';

    // 为每个义项挑选含目标词干的例句（多个义项时依次轮换分配）
    const usable = c.examples.filter((e) => sentenceContainsStem(e.en, c.word));
    const senseDefs = f.senses.map((meaning, si) => {
      const ex = usable.length > 0 ? usable[si % usable.length] : undefined;
      return {
        meaning: meaning.trim(),
        example: ex ? ex.en : '',
        exampleCn: ex ? ex.cn : '',
      };
    });

    return {
      candidate: c,
      senses: senseDefs,
      difficulty: { ...f.diff, score, tier },
    };
  });

  // 4) 写入 DB（非 dry-run）
  if (opts.dryRun) {
    console.log(`[import] DRY RUN：将写入 ${enriched.length} 词、${enriched.reduce((s, e) => s + e.senses.length, 0)} 义项`);
    return;
  }

  const bank = await prisma.wordBank.upsert({
    where: { code: 'kaoyan_engl1' },
    update: {},
    create: { code: 'kaoyan_engl1', name: '考研英语一' },
  });
  console.log(`[import] bank: ${bank.code} (id=${bank.id})`);

  // 清空该 bank 的旧数据（-force）或仅新增
  if (opts.force) {
    await prisma.$transaction([
      prisma.bankWord.deleteMany({ where: { bankId: bank.id } }),
      prisma.wordPair.deleteMany({
        where: {
          OR: [
            { wordA: { bankWords: { none: {} } } },
            { wordB: { bankWords: { none: {} } } },
          ],
        },
      }),
      prisma.wordSense.deleteMany({ where: { word: { bankWords: { none: {} } } } }),
      prisma.word.deleteMany({ where: { bankWords: { none: {} } } }),
    ]);
  }

  let inserted = 0;
  let skipped = 0;
  for (const item of enriched) {
    const existing = await prisma.word.findUnique({ where: { text: item.candidate.word } });
    const wordId = existing?.id ?? '';

    let w;
    if (existing) {
      // 已存在：仅补 senses 缺失的
      if (existing && !opts.force) {
        const hasSenses = await prisma.wordSense.count({ where: { wordId: existing.id } });
        if (hasSenses > 0) {
          // bankWord 关联仍需建立/更新（非 force 模式下词可能属于新词书）
          const stage = stageForTier(item.difficulty.tier);
          await prisma.bankWord.upsert({
            where: { bankId_wordId: { bankId: bank.id, wordId: existing.id } },
            update: { stage },
            create: { bankId: bank.id, wordId: existing.id, stage },
          });
          skipped++;
          continue;
        }
      }
      w = await prisma.word.update({
        where: { id: existing.id },
        data: {
          difficultyScore: item.difficulty.score,
          tier: item.difficulty.tier,
          difficultyDims: item.difficulty.dimensions,
          phoneticAm: item.candidate.usPhonetic ?? existing.phoneticAm,
          phoneticEn: item.candidate.ukPhonetic ?? existing.phoneticEn,
        },
      });
    } else {
      w = await prisma.word.create({
        data: {
          text: item.candidate.word,
          phoneticAm: item.candidate.usPhonetic,
          phoneticEn: item.candidate.ukPhonetic,
          difficultyScore: item.difficulty.score,
          tier: item.difficulty.tier,
          difficultyDims: item.difficulty.dimensions,
        },
      });
    }

    // 义项
    await prisma.wordSense.createMany({
      data: item.senses.map((s, idx) => ({
        wordId: w.id,
        idx,
        meaning: s.meaning,
        example: s.example,
      })),
    });

    // bank 关联（stage 初值 1，后续按 tier 分阶段）
    const stage = stageForTier(item.difficulty.tier);
    await prisma.bankWord.upsert({
      where: { bankId_wordId: { bankId: bank.id, wordId: w.id } },
      update: { stage },
      create: { bankId: bank.id, wordId: w.id, stage },
    });

    inserted++;
  }

  const wordCount = await prisma.bankWord.count({ where: { bankId: bank.id } });
  console.log(`[import] 完成: 新增/更新 ${inserted}, 跳过 ${skipped}, bank 内词数 ${wordCount}`);
}

function stageForTier(tier: 'I' | 'II' | 'III' | 'IV'): number {
  return { I: 1, II: 2, III: 3, IV: 4 }[tier];
}

// 义项切分：\n 分段（每段含词性+逗号分隔义项）；回退为 /；; 分隔
function splitSenses(paraphrase: string | null, word: string): string[] {
  if (!paraphrase || !paraphrase.trim()) return [word];
  let parts: string[] = [];
  if (paraphrase.includes('\n')) {
    parts = paraphrase.split('\n').map((s) => s.trim()).filter(Boolean);
  } else {
    parts = paraphrase.split(/[/；;]/).map((s) => s.trim()).filter(Boolean);
  }
  return parts.length > 0 ? parts : [word];
}

// 例句是否含目标词干（容忍词形变化与词干子串）
function sentenceContainsStem(en: string, word: string): boolean {
  const enBase = en.toLowerCase();
  const target = word.toLowerCase().replace(/[.'\-]/g, '');
  if (!target) return false;
  const tokens = enBase.replace(/[^a-z']/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.some((t) => {
    const stem = t.toLowerCase().replace(/[^a-z]/g, '');
    return (
      stem === target ||
      (stem.startsWith(target) && /^(s|es|ed|ing|er|est|'s)$/.test(stem.slice(target.length)))
    );
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());