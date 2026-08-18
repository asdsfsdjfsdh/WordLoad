// 句子知识点标注导出：把尚未标注的句子按篇分组导出为待标注清单（供外部模型用提示词标注）
// 用法: tsx pipeline/reading-knowledge-export.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReadingPassageData } from './import-reading';
import { buildContent } from './import-reading';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const READING_ROOT = resolve(DATA_DIR, 'reading');

function readKnowledge(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(resolve(READING_ROOT, 'knowledge.json'), 'utf8')) ?? {};
  } catch {
    return {};
  }
}

function readStructures(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(resolve(READING_ROOT, 'structures.json'), 'utf8')) ?? {};
  } catch {
    return {};
  }
}

function yearDirs(): number[] {
  return readdirSync(READING_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => Number(e.name))
    .sort((a, b) => a - b);
}

interface SentenceForExport {
  key: string; // `${year}:${code}:${seq}`
  seq: number;
  para: number;
  en: string;
  zh: string;
  structure?: unknown; // 结构标注（可参考，禁止照抄罗列）
}

interface PassageForExport {
  year: number;
  code: string;
  title: string;
  content: string; // 全文（提供语境，帮助产出贴合文章的知识点）
  sentences: SentenceForExport[];
}

function main(): void {
  const knowledge = readKnowledge();
  const structures = readStructures();
  const out: PassageForExport[] = [];
  let total = 0;
  let annotated = 0;
  let pending = 0;
  for (const year of yearDirs()) {
    const dir = resolve(READING_ROOT, String(year));
    for (const f of readdirSync(dir).filter((x) => /\.json$/i.test(x)).sort()) {
      const data = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as ReadingPassageData;
      const sentences: SentenceForExport[] = [];
      for (const s of data.sentences) {
        total++;
        const key = `${year}:${data.code}:${s.seq}`;
        if (knowledge[key]) {
          annotated++;
          continue;
        }
        pending++;
        sentences.push({
          key,
          seq: s.seq,
          para: s.para,
          en: s.en,
          zh: s.zh,
          ...(structures[key] ? { structure: structures[key] } : {}),
        });
      }
      if (sentences.length > 0) {
        out.push({
          year,
          code: data.code,
          title: data.title,
          content: buildContent(data.sentences, 'en'),
          sentences,
        });
      }
    }
  }
  const outPath = resolve(READING_ROOT, 'knowledge-export.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(
    `[knowledge-export] 总 ${total} 句，已标注 ${annotated}，待标注 ${pending}（${out.length} 篇）→ ${outPath}`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

export type { SentenceForExport, PassageForExport };