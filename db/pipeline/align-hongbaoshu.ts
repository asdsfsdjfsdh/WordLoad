// 红宝书 vs DB 义项对齐：以红宝书释义为基准，找出 DB 整组缺失的词性（尤其熟词僻义）。
// 判定：归一化词性集合（v/n/adj/adv/...）对比——红宝书有、DB 完全无该词性的，即「整组缺失」。
//   例：object 红宝书有 vi./vt.（反对），DB 只有 n.（物体）→ 动词整组缺失。
// 用法: tsx pipeline/align-hongbaoshu.ts [--apply] [--verbose]
//   默认 dry-run：只输出差异报告，不写 DB。
//   --apply：把「整组缺失」的词性段补入 DB（补充到该词最后一个义项之后）。

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitSensesByPos } from './import-hongbaoshu';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');

// 归一化词性：vt/vi/v → v；识别一个义项字符串里出现的**所有**词性（DB 里常见「n. 猿 vt. 模仿」多词性合并）
function normPosSet(m: string): Set<string> {
  const set = new Set<string>();
  const re = /(vt|vi|adj|adv|prep|conj|pron|num|int|aux|art|det|n|v)\./g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(m)) !== null) {
    const t = match[1];
    if (t === 'vt' || t === 'vi' || t === 'v') set.add('v');
    else if (t === 'n') set.add('n');
    else if (t === 'adj') set.add('adj');
    else if (t === 'adv') set.add('adv');
    else if (t === 'prep') set.add('prep');
    else if (t === 'conj') set.add('conj');
  }
  return set;
}

interface Diff {
  word: string;
  hbsSenses: string[];
  dbMeanings: string[];
  missingPos: string[]; // 红宝书有、DB 整组缺失的归一化词性
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const verbose = process.argv.includes('--verbose');

  const meanings = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'hongbaoshu_meanings.json'), 'utf8'),
  ) as { word: string; meaning: string }[];

  const bank = await prisma.wordBank.findUnique({ where: { code: 'hongbaoshu_engl1' } });
  if (!bank) {
    console.error('红宝书词书 hongbaoshu_engl1 不存在');
    return;
  }
  const bankWords = await prisma.bankWord.findMany({
    where: { bankId: bank.id },
    include: { word: { include: { senses: { orderBy: { idx: 'asc' } } } } },
  });
  const dbByWord = new Map(bankWords.map((bw) => [bw.word.text.toLowerCase(), bw.word]));

  const diffs: Diff[] = [];
  for (const { word, meaning } of meanings) {
    const w = dbByWord.get(word.toLowerCase());
    if (!w) continue;
    const dbMeanings = w.senses.map((s) => s.meaning);
    const hbsSenses = splitSensesByPos(meaning, word);

    const hbsPos = new Set<string>();
    for (const seg of hbsSenses) for (const p of normPosSet(seg)) hbsPos.add(p);
    const dbPos = new Set<string>();
    for (const m of dbMeanings) for (const p of normPosSet(m)) dbPos.add(p);
    const missingPos = [...hbsPos].filter((p) => !dbPos.has(p));

    if (missingPos.length > 0) {
      diffs.push({ word, hbsSenses, dbMeanings, missingPos });
    }
  }

  // 统计（按缺失词性分类）
  const byPos = new Map<string, number>();
  for (const d of diffs) for (const p of d.missingPos) byPos.set(p, (byPos.get(p) ?? 0) + 1);
  console.log(`[align] 红宝书词书词数: ${bankWords.length}`);
  console.log(`[align] 有整组缺失词性的词: ${diffs.length}`);
  for (const [pos, cnt] of [...byPos.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pos}: ${cnt} 词`);
  }

  const sorted = [...diffs].sort((a, b) => a.word.localeCompare(b.word));
  const show = verbose ? diffs.length : 300;
  for (const d of sorted.slice(0, show)) {
    console.log(`\n${d.word}  [缺:${d.missingPos.join(',')}]`);
    console.log(`  红宝书: ${d.hbsSenses.join(' ║ ')}`);
    console.log(`  DB:     ${d.dbMeanings.join(' ║ ')}`);
  }

  if (apply) {
    let added = 0;
    for (const d of diffs) {
      // 排除大写开头词（August/Catholic/she 等大小写混淆，需人工处理，不自动补）
      if (/^[A-Z]/.test(d.word)) continue;
      const w = dbByWord.get(d.word.toLowerCase())!;
      // 仅补「动词/名词」整组缺失（高价值熟词僻义），adj/adv/prep/conj 多为词性标注差异，暂不自动补
      const toAdd = d.hbsSenses.filter((s) =>
        [...normPosSet(s)].some((p) => (p === 'v' || p === 'n') && d.missingPos.includes(p)),
      );
      let nextIdx = w.senses.length; // idx 从 0 起，下一个 = 现有义项数
      for (const seg of toAdd) {
        const already = d.dbMeanings.some((m) => m.includes(seg));
        if (already) continue;
        await prisma.wordSense.create({
          data: { wordId: w.id, idx: nextIdx++, meaning: seg, example: '' },
        });
        console.log(`[apply] ${d.word}: +${seg}`);
        added++;
      }
    }
    console.log(`[align] 新增义项: ${added}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
