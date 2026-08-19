// 单词优化 · 随机抽词：从红宝书词书（考研范围）随机抽 N 词，导出 {text, tier, senses} 供外部模型优化
// 用法: tsx pipeline/export-optimize-targets.ts [--limit=50] [--out=optimize-targets.json]
// 配套：word-optimize-prompt-template.md（提示词模板）+ import-word-optimize.ts（回填）

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');

interface Options {
  limit: number;
  out: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { limit: 50, out: 'optimize-targets.json' };
  for (const a of argv) {
    if (a.startsWith('--limit=')) opts.limit = Number(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = a.split('=')[1] ?? opts.out;
  }
  return opts;
}

interface Row {
  text: string;
  tier: string;
  senses: string | null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // 从红宝书词书随机抽 N 词，义项按 idx 拼接（用 ║ 分隔，与提示词模板约定一致）
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT w.text, w.tier,
           (SELECT GROUP_CONCAT(s.meaning ORDER BY s.idx SEPARATOR ' ║ ')
              FROM WordSense s WHERE s.wordId = w.id) AS senses
      FROM Word w
      JOIN BankWord bw ON bw.wordId = w.id
      JOIN WordBank b ON b.id = bw.bankId AND b.code = 'hongbaoshu_engl1'
     ORDER BY RAND()
     LIMIT ${opts.limit}
  `;

  const targets = rows.map((r) => ({
    text: r.text,
    tier: r.tier,
    senses: r.senses ?? '',
  }));

  const outPath = resolve(DATA_DIR, opts.out);
  writeFileSync(outPath, JSON.stringify(targets, null, 2), 'utf8');
  console.log(`[optimize-export] 随机抽 ${targets.length} 词（红宝书/考研范围） → ${outPath}`);
  console.log('[optimize-export] 下一步：把该文件内容配合 word-optimize-prompt-template.md 交给模型优化，结果存为 word-optimize.json，再跑 import-word-optimize.ts 回填');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
