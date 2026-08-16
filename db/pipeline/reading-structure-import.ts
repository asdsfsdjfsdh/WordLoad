// 句子结构标注回填：校验外部模型输出的 structures.json → 合并写回 → 持久化到 DB
// 用法: tsx pipeline/reading-structure-import.ts [--year 2023]
import { PrismaClient } from '@prisma/client';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReadingPassageData } from './import-reading';
import { validateReadingStructure } from './reading-structure';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');
const READING_ROOT = resolve(DATA_DIR, 'reading');
const STRUCTURES_PATH = resolve(READING_ROOT, 'structures.json');

interface StructureEntry {
  clauses: { role: string; label: string; text: string }[];
  main?: { subject: string; predicate: string; object?: string };
}

// 全量读入各篇句子：key -> en
function loadSentences(): Map<string, { en: string }> {
  const map = new Map<string, { en: string }>();
  for (const year of readdirSync(READING_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => Number(e.name))) {
    const dir = resolve(READING_ROOT, String(year));
    for (const f of readdirSync(dir).filter((x) => /\.json$/i.test(x)).sort()) {
      const data = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as ReadingPassageData;
      for (const s of data.sentences) map.set(`${year}:${data.code}:${s.seq}`, { en: s.en });
    }
  }
  return map;
}

async function main(): Promise<void> {
  const raw = JSON.parse(readFileSync(STRUCTURES_PATH, 'utf8')) as Record<string, unknown>;
  const sentences = loadSentences();

  const valid: Record<string, StructureEntry> = {};
  const invalid: { key: string; issues: string[] }[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!sentences.has(key)) {
      invalid.push({ key, issues: ['句子不存在（key 无对应原文）'] });
      continue;
    }
    const issues = validateReadingStructure(value, sentences.get(key)!.en);
    if (issues.length > 0) invalid.push({ key, issues });
    else valid[key] = value as StructureEntry;
  }

  // 写回合法项（非法项剔除，留档在 structures-invalid.json）
  writeFileSync(STRUCTURES_PATH, JSON.stringify(valid, null, 2), 'utf8');
  if (invalid.length > 0) {
    writeFileSync(resolve(READING_ROOT, 'structures-invalid.json'), JSON.stringify(invalid, null, 2), 'utf8');
  }

  console.log(`[structure-import] 合法 ${Object.keys(valid).length} 条，非法 ${invalid.length} 条`);
  for (const bad of invalid.slice(0, 20)) {
    console.log(`  [invalid] ${bad.key}: ${bad.issues.join('; ')}`);
  }

  // 持久化到 DB（按 passage.code + seq 定位）
  if (Object.keys(valid).length > 0) {
    const codes = [...new Set(Object.keys(valid).map((k) => k.split(':')[1]))];
    const passages = await prisma.readingPassage.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true, sentences: { select: { id: true, seq: true } } },
    });
    const sentenceByKey = new Map<string, number>();
    for (const p of passages) {
      for (const s of p.sentences) {
        // year 由 passage 所在 paper 决定：这里 code 唯一（当前仅 2023），用 code:seq 兜底
        sentenceByKey.set(`${p.code}:${s.seq}`, s.id);
      }
    }
    const updates: { id: number; structure: StructureEntry }[] = [];
    for (const [key, structure] of Object.entries(valid)) {
      const [, code, seq] = key.split(':');
      const id = sentenceByKey.get(`${code}:${seq}`);
      if (id != null) updates.push({ id, structure });
      else invalid.push({ key, issues: ['DB 中未找到对应句子（code:seq）'] });
    }
    for (let i = 0; i < updates.length; i += 50) {
      const chunk = updates.slice(i, i + 50);
      await prisma.$transaction(chunk.map((u) => prisma.readingSentence.update({ where: { id: u.id }, data: { structure: u.structure as never } })));
    }
    console.log(`[structure-import] 已写入 DB ${updates.length} 条`);
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
