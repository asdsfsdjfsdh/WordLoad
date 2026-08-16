// 真题阅读导入管线：db/data/reading/<year>/<code>.json → ReadingPaper/Passage/Sentence/Question/Glossary
// 用法: tsx pipeline/import-reading.ts [--year 2023] [--force]

import { PrismaClient } from '@prisma/client';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReadingSentenceData {
  para: number;
  seq: number;
  en: string;
  zh: string;
}

export interface ReadingQuestionData {
  seq: number;
  stem: string;
  options: { A: string; B: string; C: string; D: string };
  answer: string;
  analysis: string;
  remark?: string;
}

export interface ReadingPassageData {
  code: string; // A / B / C / D
  title: string; // Text 1
  subtitle?: string;
  questionsStart: number;
  sentences: ReadingSentenceData[];
  questions: ReadingQuestionData[];
  glossary: Record<string, { phonetic?: string; meaning: string }>;
}

export interface ReadingPaperData {
  year: number;
  examName?: string;
  passages: ReadingPassageData[];
}

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');

// ── 校验纯函数 ──
export function validateReadingFile(data: unknown): string[] {
  const issues: string[] = [];
  if (!data || typeof data !== 'object') return ['文件不是对象'];
  const d = data as Partial<ReadingPassageData>;

  const code = d.code;
  if (typeof code !== 'string' || !/^[A-D]$/.test(code)) issues.push(`code 非法: ${String(code)}`);
  if (typeof d.title !== 'string' || !d.title.trim()) issues.push('title 为空');
  if (typeof d.questionsStart !== 'number' || d.questionsStart < 1) issues.push('questionsStart 非法');

  // sentences
  if (!Array.isArray(d.sentences) || d.sentences.length === 0) {
    issues.push('sentences 为空');
  } else {
    const seqSet = new Set<number>();
    d.sentences.forEach((s, i) => {
      if (!s || typeof s !== 'object') {
        issues.push(`sentences[${i}] 非法`);
        return;
      }
      const st = s as Partial<ReadingSentenceData>;
      if (typeof st.para !== 'number' || st.para < 1) issues.push(`sentences[${i}].para 非法`);
      if (typeof st.seq !== 'number' || st.seq < 0) issues.push(`sentences[${i}].seq 非法`);
      else if (seqSet.has(st.seq)) issues.push(`sentences[${i}].seq 重复: ${st.seq}`);
      else seqSet.add(st.seq);
      if (typeof st.en !== 'string' || !st.en.trim()) issues.push(`sentences[${i}].en 为空`);
      if (typeof st.zh !== 'string' || !st.zh.trim()) issues.push(`sentences[${i}].zh 为空`);
    });
  }

  // questions
  if (!Array.isArray(d.questions) || d.questions.length === 0) {
    issues.push('questions 为空');
  } else {
    const qseq = new Set<number>();
    d.questions.forEach((q, i) => {
      if (!q || typeof q !== 'object') {
        issues.push(`questions[${i}] 非法`);
        return;
      }
      const qt = q as Partial<ReadingQuestionData>;
      if (typeof qt.seq !== 'number') issues.push(`questions[${i}].seq 非法`);
      else if (qseq.has(qt.seq)) issues.push(`questions[${i}].seq 重复: ${qt.seq}`);
      else qseq.add(qt.seq);
      if (typeof qt.stem !== 'string' || !qt.stem.trim()) issues.push(`questions[${i}].stem 为空`);
      const opts = qt.options as { A?: string; B?: string; C?: string; D?: string } | undefined;
      if (!opts || typeof opts !== 'object') issues.push(`questions[${i}].options 缺失`);
      else {
        for (const k of ['A', 'B', 'C', 'D']) {
          if (typeof opts[k] !== 'string' || !opts[k]!.trim()) issues.push(`questions[${i}].options.${k} 为空`);
        }
      }
      if (typeof qt.answer !== 'string' || !/^[A-D]$/.test(qt.answer)) issues.push(`questions[${i}].answer 非法: ${String(qt.answer)}`);
      if (typeof qt.analysis !== 'string' || !qt.analysis.trim()) issues.push(`questions[${i}].analysis 为空`);
    });
  }

  // glossary
  const glossary = d.glossary as Record<string, { phonetic?: string; meaning: string }> | undefined;
  if (!glossary || typeof glossary !== 'object' || Object.keys(glossary).length === 0) {
    issues.push('glossary 为空');
  } else {
    for (const [word, g] of Object.entries(glossary)) {
      if (!g || typeof g !== 'object') {
        issues.push(`glossary.${word} 非法`);
        continue;
      }
      if (typeof g.meaning !== 'string' || !g.meaning.trim()) issues.push(`glossary.${word}.meaning 为空`);
    }
  }

  return issues;
}

// 由句子拼出全文 / 全文译文
export function buildContent(sentences: ReadingSentenceData[], key: 'en' | 'zh'): string {
  const byPara = new Map<number, ReadingSentenceData[]>();
  for (const s of sentences) {
    const list = byPara.get(s.para) ?? [];
    list.push(s);
    byPara.set(s.para, list);
  }
  const paras = [...byPara.keys()].sort((a, b) => a - b).map((p) =>
    [...byPara.get(p)!].sort((a, b) => a.seq - b.seq).map((s) => s[key]).join(' '),
  );
  return paras.join('\n\n');
}

function parseArgs(argv: string[]): { year?: number; force: boolean } {
  const yearIdx = argv.indexOf('--year');
  const year = yearIdx >= 0 ? Number(argv[yearIdx + 1]) : undefined;
  return { year, force: argv.includes('--force') };
}

// 结构标注索引（db/data/reading/structures.json）：{ "A:0": { clauses, main }, ... }
function readStructures(): Record<string, { clauses: unknown[]; main?: unknown }> {
  const p = resolve(DATA_DIR, 'reading', 'structures.json');
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, { clauses: unknown[]; main?: unknown }>;
    return raw ?? {};
  } catch {
    return {};
  }
}

async function importPaper(
  fileData: ReadingPassageData,
  year: number,
  order: number,
  structures: Record<string, { clauses: unknown[]; main?: unknown }>,
): Promise<void> {
  const issues = validateReadingFile(fileData);
  if (issues.length > 0) {
    console.error(`  [invalid] ${fileData.code}:`);
    for (const i of issues) console.error(`    - ${i}`);
    throw new Error(`数据校验失败: ${fileData.code}`);
  }

  const examName = `${year}年全国硕士研究生招生考试英语（一）`;
  const paper = await prisma.readingPaper.upsert({
    where: { year },
    update: { examName },
    create: { year, examName },
  });

  const content = buildContent(fileData.sentences, 'en');
  const translation = buildContent(fileData.sentences, 'zh');

  const passage = await prisma.readingPassage.upsert({
    where: { paperId_code: { paperId: paper.id, code: fileData.code } },
    update: {
      title: fileData.title,
      subtitle: fileData.subtitle ?? null,
      questionsStart: fileData.questionsStart,
      order,
      content,
      translation,
    },
    create: {
      paperId: paper.id,
      code: fileData.code,
      title: fileData.title,
      subtitle: fileData.subtitle ?? null,
      questionsStart: fileData.questionsStart,
      order,
      content,
      translation,
    },
  });

  // 词表关联 Word 总表（按词形匹配）
  const glossaryWords = Object.keys(fileData.glossary);
  const words = glossaryWords.length
    ? await prisma.word.findMany({ where: { text: { in: glossaryWords } }, select: { id: true, text: true } })
    : [];
  const wordIdByText = new Map(words.map((w) => [w.text, w.id]));
  const unmatched = glossaryWords.filter((w) => !wordIdByText.has(w));
  if (unmatched.length > 0) {
    console.log(`  [glossary] ${fileData.code} 未命中词库 ${unmatched.length} 词（点词将走篇内词义）: ${unmatched.slice(0, 20).join(', ')}`);
  }

  await prisma.$transaction([
    prisma.readingSentence.deleteMany({ where: { passageId: passage.id } }),
    prisma.readingQuestion.deleteMany({ where: { passageId: passage.id } }),
    prisma.readingGlossary.deleteMany({ where: { passageId: passage.id } }),
    prisma.readingSentence.createMany({
      data: fileData.sentences.map((s) => {
        const structure = structures[`${year}:${fileData.code}:${s.seq}`];
        return {
          passageId: passage.id,
          para: s.para,
          seq: s.seq,
          en: s.en,
          zh: s.zh,
          ...(structure ? { structure: structure as never } : {}),
        };
      }),
    }),
    prisma.readingQuestion.createMany({
      data: fileData.questions.map((q) => ({
        passageId: passage.id,
        seq: q.seq,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        ...(q.remark ? { remark: q.remark } : {}),
      })),
    }),
    prisma.readingGlossary.createMany({
      data: Object.entries(fileData.glossary).map(([word, g]) => ({
        passageId: passage.id,
        word,
        meaning: g.meaning,
        wordId: wordIdByText.get(word) ?? null,
      })),
    }),
  ]);
  console.log(
    `  [ok] ${fileData.code} ${fileData.title}：句子 ${fileData.sentences.length}、题目 ${fileData.questions.length}、词表 ${glossaryWords.length}`,
  );
}

async function main(): Promise<void> {
  const { year: filterYear, force } = parseArgs(process.argv.slice(2));
  const readingRoot = resolve(DATA_DIR, 'reading');
  const yearDirs = readdirSync(readingRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => Number(e.name))
    .sort((a, b) => a - b);
  if (yearDirs.length === 0) throw new Error(`未找到真题数据目录: ${readingRoot}`);

  let any = false;
  const structures = readStructures();
  const structureCount = Object.keys(structures).length;
  if (structureCount > 0) console.log(`[import-reading] 结构标注 ${structureCount} 条（structures.json）`);
  for (const year of yearDirs) {
    if (filterYear && filterYear !== year) continue;
    const dir = resolve(readingRoot, String(year));
    const files = readdirSync(dir).filter((f) => /\.json$/i.test(f)).sort();
    console.log(`[import-reading] ${year} 年：${files.length} 个篇章文件`);
    for (const f of files) {
      const data = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as ReadingPassageData;
      const order = ['A', 'B', 'C', 'D'].indexOf(data.code ?? '');
      if (order < 0) throw new Error(`文件 ${f} 的 code 非法: ${data.code}`);
      await importPaper(data, year, order, structures);
      any = true;
    }
  }
  if (!any) throw new Error('没有可导入的数据（可用 --year 指定）');
  console.log('[import-reading] 完成');
}

// 直接执行时才运行（避免被单测 import 时连库）
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
