// 记忆锚点 · 导出待生成清单：找出 mnemonic 为空的词，导出 {text, tier, meaning} 供外部模型批量生成
// 用法: tsx pipeline/export-mnemonic-targets.ts [--bank-code=<code>] [--limit=<n>] [--out=<file>]
// 配套：mnemonic-prompt-template.md（提示词模板）+ import-mnemonics.ts（回填）

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');

interface Options {
  bankCode?: string;
  limit: number;
  out: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { limit: 200, out: 'mnemonic-targets.json' };
  for (const a of argv) {
    if (a.startsWith('--bank-code=')) opts.bankCode = a.split('=')[1];
    else if (a.startsWith('--limit=')) opts.limit = Number(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = a.split('=')[1] ?? opts.out;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const where = opts.bankCode
    ? { mnemonic: null, bankWords: { some: { bank: { code: opts.bankCode } } } }
    : { mnemonic: null };

  const words = await prisma.word.findMany({
    where,
    orderBy: { difficultyScore: 'asc' },
    take: opts.limit,
    include: { senses: { orderBy: { idx: 'asc' }, take: 1 } },
  });

  const targets = words.map((w) => ({
    text: w.text,
    tier: w.tier,
    meaning: w.senses[0]?.meaning ?? '',
  }));

  const outPath = resolve(DATA_DIR, opts.out);
  writeFileSync(outPath, JSON.stringify(targets, null, 2), 'utf8');
  console.log(`[mnemonic-export] 导出 ${targets.length} 词 → ${outPath}`);
  console.log('[mnemonic-export] 下一步：把该文件内容配合 mnemonic-prompt-template.md 交给外部模型生成，结果存回同结构 JSON，再跑 pipeline:mnemonic-import 回填');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
