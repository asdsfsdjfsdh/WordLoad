// 红宝书词库导入管线：红宝书词表 txt → 候选词 → 富化（tb_vocabulary / words.json 兜底）→ 质量校验 → 难度评估 → 写入 DB
// 词表结构：`#必考词 Unit N` / `#基础词 Unit N` / `#超纲词 X` 分节，每行一词
// stage 复合编码（两层地图，不动 schema）：外层阶段=百位，内层关卡=个位
//   必考词 Unit N → 100 + N（101~126）
//   基础词 Unit N → 200 + N（201~231）
//   超纲词 X     → 300 + 字母序（301~326）
// 用法: tsx pipeline/import-hongbaoshu.ts [--dry-run] [--force]

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateDifficulties, normalizeByQuantile } from './difficulty';
import { checkQuality, collectCandidates, type WordCandidate } from './quality';
import type { RawExample, RawWord } from './types';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');

interface Options {
  dryRun: boolean;
  force: boolean;
}

interface WordEntry {
  word: string;
  region: '必考词' | '基础词' | '超纲词';
  unit: number; // 必考/基础：Unit N；超纲：字母序 1~26
}

interface EnrichedWord {
  word: string;
  ukPhonetic: string | null;
  usPhonetic: string | null;
  paraphrase: string | null;
  frequency: number;
  examples: { en: string; cn: string }[];
  region: '必考词' | '基础词' | '超纲词';
  unit: number;
}

// ECDICT 音标兜底：word → 音标（部分 tb_vocabulary 缺音标的词）
type PhoneticMap = Record<string, string>;

function parseArgs(argv: string[]): Options {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  };
}

// 解析红宝书词表 txt：分节标题 → region/unit，其余行为单词
export function parseHongbaoshu(content: string): WordEntry[] {
  const entries: WordEntry[] = [];
  let region: '必考词' | '基础词' | '超纲词' | null = null;
  let unit = 0;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const mustHeader = line.match(/^#必考词\s*Unit\s*(\d+)$/);
    const baseHeader = line.match(/^#基础词\s*Unit\s*(\d+)$/);
    const baseHeaderAlt = line.match(/^#基础词汇\s*Unit\s*(\d+)$/);
    const simpleHeader = line.match(/^#Unit\s*(\d+)\s*简单基础词/);
    const superHeader = line.match(/^#超纲词\s*([A-Z])$/);
    const superAlt = line.match(/^#超纲\s*([A-Z])$/);

    if (mustHeader) {
      region = '必考词';
      unit = Number(mustHeader[1]);
    } else if (baseHeader || baseHeaderAlt) {
      region = '基础词';
      unit = Number((baseHeader ?? baseHeaderAlt)?.[1]);
    } else if (simpleHeader) {
      region = '基础词';
      unit = Number(simpleHeader[1]);
    } else if (superHeader || superAlt) {
      region = '超纲词';
      unit = (superHeader ?? superAlt)![1]!.charCodeAt(0) - 64; // A→1
    } else if (line.startsWith('#')) {
      // 未知分节头：跳过（不中断）
      region = null;
    } else if (region) {
      entries.push({ word: line, region, unit });
    }
  }
  return entries;
}

// 变体匹配：-ise↔-ize、去连字符、去空格，用于 tb_vocabulary 二次匹配
function variantKeys(word: string): string[] {
  const lower = word.toLowerCase();
  const keys = new Set<string>();
  keys.add(lower);
  const iseToIze = lower.replace(/(\w)ise$/i, '$1ize');
  if (iseToIze !== lower) keys.add(iseToIze);
  const izeToIse = lower.replace(/(\w)ize$/i, '$1ise');
  if (izeToIse !== lower) keys.add(izeToIse);
  keys.add(lower.replace(/-/g, ''));
  keys.add(lower.replace(/\s+/g, ''));
  keys.add(lower.replace(/-/g, ' '));
  return [...keys];
}

// 富化：tb_vocabulary（双音标/释义/词频）优先 → 变体规则 → ECDICT 音标兜底 → words.json 释义兜底
export function enrichEntries(
  entries: WordEntry[],
  vocabulary: RawWord[],
  examples: RawExample[],
  meanings: { word: string; meaning: string }[],
  phonetics?: PhoneticMap,
): EnrichedWord[] {
  const vocabBySpell = new Map<string, RawWord>();
  for (const v of vocabulary) vocabBySpell.set(v.spelling.toLowerCase(), v);

  const exByWord = new Map<number, { en: string; cn: string }[]>();
  for (const ex of examples) {
    const list = exByWord.get(ex.wordid) ?? [];
    list.push({ en: ex.en, cn: ex.cn });
    exByWord.set(ex.wordid, list);
  }

  const meaningByWord = new Map<string, string>();
  for (const m of meanings) meaningByWord.set(m.word.toLowerCase(), m.meaning);

  return entries.map((e) => {
    let hit: RawWord | undefined = vocabBySpell.get(e.word.toLowerCase());
    let viaVariant = false;
    if (!hit) {
      for (const key of variantKeys(e.word)) {
        const v = vocabBySpell.get(key);
        if (v) {
          hit = v;
          viaVariant = true;
          break;
        }
      }
    }

    // 红宝书释义优先（含熟词僻义，比 tb_vocabulary 更全），tb_vocabulary 兜底
    let paraphrase: string | null = meaningByWord.get(e.word.toLowerCase()) ?? null;
    if (!paraphrase) paraphrase = hit?.paraphrase ?? null;

    // 音标：tb_vocabulary 优先，缺则 ECDICT 兜底
    let uk = hit?.UKphonetic ?? null;
    let us = hit?.USphonetic ?? null;
    if (!uk && !us && phonetics) {
      const p = phonetics[e.word.toLowerCase()];
      if (p) us = p; // ECDICT 为美式/通用音标，记入美式
    }

    const exs = hit ? (exByWord.get(hit.wordid) ?? []) : [];
    return {
      word: e.word,
      ukPhonetic: uk,
      usPhonetic: us,
      paraphrase,
      frequency: hit?.frequency ?? 0,
      examples: exs,
      region: e.region,
      unit: e.unit,
    };
  });
}

// stage 复合编码：外层阶段=百位，内层关卡=个位
export function stageFor(region: '必考词' | '基础词' | '超纲词', unit: number): number {
  if (region === '必考词') return 100 + unit;
  if (region === '基础词') return 200 + unit;
  return 300 + unit; // 超纲词
}

// 词性标记（长词在前，避免 vt/vi/adj/adv 被 v/a 抢先匹配）
const POS_TOKENS = 'prep|conj|pron|num|int|aux|art|det|vt|vi|adj|adv|n|v';

// 按词性标记切分释义为「词性 + 义项组」段。
// 兼容红宝书「；」内联格式（n. 地址；网址 vt. 处理）与 tb_vocabulary「\n」分段格式（n.地址\nv.写地址）。
export function splitSensesByPos(paraphrase: string | null, word: string): string[] {
  if (!paraphrase || !paraphrase.trim()) return [word];
  const re = new RegExp(`(?:^|[\\n；;/、]|\\s)(${POS_TOKENS})\\.`, 'g');
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(paraphrase)) !== null) {
    const prefixLen = m[0].length - m[1].length - 1; // 去掉前缀分隔符 + 词性 + '.'
    starts.push(m.index + prefixLen);
  }
  if (starts.length === 0) {
    // 无词性标记：回退为 /；;\n 分隔
    const parts = paraphrase.split(/[\n/；;]/).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [word];
  }
  const parts: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : paraphrase.length;
    const seg = paraphrase.slice(start, end).trim();
    if (seg) parts.push(seg);
  }
  // 合并「纯词性标记」段（如 "vi. vt. 义项" 切出的 "vi. "）到下一段，形成 "vi. vt. 义项"
  const merged: string[] = [];
  let pending = '';
  for (const seg of parts) {
    if (!/[\u4e00-\u9fff]/.test(seg)) {
      pending += ' ' + seg.trim();
    } else {
      merged.push((pending + ' ' + seg).trim());
      pending = '';
    }
  }
  return merged.length > 0 ? merged : parts;
}

// 例句是否含目标词干（与 import.ts 一致）
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

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const wordsTxt = readFileSync(resolve(DATA_DIR, 'hongbaoshu_words.txt'), 'utf8');
  const entries = parseHongbaoshu(wordsTxt);
  console.log(`[import-hbs] 解析词表: ${entries.length} 词`);

  const vocabulary = JSON.parse(readFileSync(resolve(DATA_DIR, 'tb_vocabulary.json'), 'utf8')) as RawWord[];
  const examples = JSON.parse(readFileSync(resolve(DATA_DIR, 'tb_voc_examples.json'), 'utf8')) as RawExample[];
  const meanings = JSON.parse(readFileSync(resolve(DATA_DIR, 'hongbaoshu_meanings.json'), 'utf8')) as { word: string; meaning: string }[];
  const phonetics = JSON.parse(readFileSync(resolve(DATA_DIR, 'hongbaoshu_phonetics.json'), 'utf8')) as PhoneticMap;

  const enriched = enrichEntries(entries, vocabulary, examples, meanings, phonetics);

  // 质量校验（复用 quality.ts 的 checkQuality 逻辑）
  const candidates: WordCandidate[] = enriched.map((e) => ({
    word: e.word,
    ukPhonetic: e.ukPhonetic,
    usPhonetic: e.usPhonetic,
    paraphrase: e.paraphrase,
    frequency: e.frequency,
    examples: e.examples,
  }));
  const report = checkQuality(candidates);
  console.log(`[import-hbs] 质量报告: 总 ${report.total}, fatal ${report.fatal}`);
  for (const issue of report.issues.filter((i) => i.fatal).slice(0, 20)) {
    console.log(`  [fatal] ${issue.word}: ${issue.detail}`);
  }

  const fatalWords = new Set(
    report.issues.filter((i) => i.fatal).map((i) => i.word.toLowerCase()),
  );
  const working = enriched.filter((e) => !fatalWords.has(e.word.toLowerCase()));
  console.log(`[import-hbs] 可导入: ${working.length}`);

  // 难度评估：与 import.ts 一致（书内分位数归一 → 4 档）
  const firstPass = working.map((e) => {
    const senses = splitSensesByPos(e.paraphrase, e.word);
    return {
      entry: e,
      senses,
      diff: evaluateDifficulties({
        senses: senses.length,
        spelling: e.word.split(/[\s\-]/)[0] ?? e.word,
        frequency: e.frequency,
        confusableCount: 0,
      }),
    };
  });
  const { normalized, tiers } = normalizeByQuantile(firstPass.map((f) => f.diff.score));

  const enrichedFinal = firstPass.map((f, i) => {
    const e = f.entry;
    const score = normalized.get(i) ?? 0;
    const tier = tiers.get(i) ?? 'I';
    const usable = e.examples.filter((x) => sentenceContainsStem(x.en, e.word));
    const senseDefs = f.senses.map((meaning, si) => {
      const ex = usable.length > 0 ? usable[si % usable.length] : undefined;
      return {
        meaning: meaning.trim(),
        example: ex ? ex.en : '',
        exampleCn: ex ? ex.cn : '',
      };
    });
    return {
      entry: e,
      senses: senseDefs,
      difficulty: { ...f.diff, score, tier },
    };
  });

  if (opts.dryRun) {
    const stageDist = new Map<number, number>();
    for (const item of enrichedFinal) {
      const st = stageFor(item.entry.region, item.entry.unit);
      stageDist.set(st, (stageDist.get(st) ?? 0) + 1);
    }
    console.log(`[import-hbs] DRY RUN：将写入 ${enrichedFinal.length} 词、${enrichedFinal.reduce((s, e) => s + e.senses.length, 0)} 义项`);
    console.log(`[import-hbs] 阶段分布（stage→词数，按外层阶段汇总）:`);
    const byRegion = new Map<string, number>();
    for (const item of enrichedFinal) {
      byRegion.set(item.entry.region, (byRegion.get(item.entry.region) ?? 0) + 1);
    }
    for (const [region, cnt] of byRegion) console.log(`  ${region}: ${cnt} 词`);
    const stageKeys = [...stageDist.keys()].sort((a, b) => a - b);
    console.log(`  stage 范围: ${stageKeys[0]} ~ ${stageKeys[stageKeys.length - 1]}, 共 ${stageDist.size} 关`);
    return;
  }

  const bank = await prisma.wordBank.upsert({
    where: { code: 'hongbaoshu_engl1' },
    update: {},
    create: { code: 'hongbaoshu_engl1', name: '红宝书·英语一' },
  });
  console.log(`[import-hbs] bank: ${bank.code} (id=${bank.id})`);

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
  for (const item of enrichedFinal) {
    const e = item.entry;
    const existing = await prisma.word.findUnique({ where: { text: e.word } });

    let w;
    if (existing) {
      const hasSenses = await prisma.wordSense.count({ where: { wordId: existing.id } });
      if (hasSenses > 0) {
        // 词已存在且有义项（跨词书共享或本词书旧数据）：仅更新 bankWord 关联与难度/音标，不重写义项
        await prisma.word.update({
          where: { id: existing.id },
          data: {
            difficultyScore: item.difficulty.score,
            tier: item.difficulty.tier,
            difficultyDims: item.difficulty.dimensions,
            phoneticAm: e.usPhonetic ?? existing.phoneticAm,
            phoneticEn: e.ukPhonetic ?? existing.phoneticEn,
          },
        });
        const stage = stageFor(e.region, e.unit);
        await prisma.bankWord.upsert({
          where: { bankId_wordId: { bankId: bank.id, wordId: existing.id } },
          update: { stage },
          create: { bankId: bank.id, wordId: existing.id, stage },
        });
        skipped++;
        continue;
      }
      w = await prisma.word.update({
        where: { id: existing.id },
        data: {
          difficultyScore: item.difficulty.score,
          tier: item.difficulty.tier,
          difficultyDims: item.difficulty.dimensions,
          phoneticAm: e.usPhonetic ?? existing.phoneticAm,
          phoneticEn: e.ukPhonetic ?? existing.phoneticEn,
        },
      });
    } else {
      w = await prisma.word.create({
        data: {
          text: e.word,
          phoneticAm: e.usPhonetic,
          phoneticEn: e.ukPhonetic,
          difficultyScore: item.difficulty.score,
          tier: item.difficulty.tier,
          difficultyDims: item.difficulty.dimensions,
        },
      });
    }

    await prisma.wordSense.createMany({
      data: item.senses.map((s, idx) => ({
        wordId: w.id,
        idx,
        meaning: s.meaning,
        example: s.example,
      })),
    });

    const stage = stageFor(e.region, e.unit);
    await prisma.bankWord.upsert({
      where: { bankId_wordId: { bankId: bank.id, wordId: w.id } },
      update: { stage },
      create: { bankId: bank.id, wordId: w.id, stage },
    });

    inserted++;
  }

  const wordCount = await prisma.bankWord.count({ where: { bankId: bank.id } });
  console.log(`[import-hbs] 完成: 新增/更新 ${inserted}, 跳过 ${skipped}, bank 内词数 ${wordCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
