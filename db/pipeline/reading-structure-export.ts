// 句子结构标注导出：把尚未标注的句子导出为待标注清单（供外部模型用提示词标注）
// 用法: tsx pipeline/reading-structure-export.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReadingPassageData, ReadingSentenceData } from './import-reading';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const READING_ROOT = resolve(DATA_DIR, 'reading');

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
  code: string;
  seq: number;
  para: number;
  en: string;
  zh: string;
}

function main(): void {
  const structures = readStructures();
  const out: SentenceForExport[] = [];
  let total = 0;
  let annotated = 0;
  for (const year of yearDirs()) {
    const dir = resolve(READING_ROOT, String(year));
    for (const f of readdirSync(dir).filter((x) => /\.json$/i.test(x)).sort()) {
      const data = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as ReadingPassageData;
      for (const s of data.sentences) {
        total++;
        const key = `${year}:${data.code}:${s.seq}`;
        if (structures[key]) {
          annotated++;
          continue;
        }
        out.push({ key, code: data.code, seq: s.seq, para: s.para, en: s.en, zh: s.zh });
      }
    }
  }
  const outPath = resolve(READING_ROOT, 'structures-export.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[structure-export] 总 ${total} 句，已标注 ${annotated}，待标注 ${out.length} → ${outPath}`);
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

export type { SentenceForExport, ReadingSentenceData };
