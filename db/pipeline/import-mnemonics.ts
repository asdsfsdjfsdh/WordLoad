// 记忆锚点 · 回填导入：读取外部模型生成的 {text, mnemonic}[] JSON，按 text 匹配写入 Word.mnemonic
// 用法: tsx pipeline/import-mnemonics.ts [--file=<name>] [--dry-run]
// 配套：export-mnemonic-targets.ts（导出待生成清单）+ mnemonic-prompt-template.md（提示词模板）

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');
const MAX_LEN = 300; // 与 schema.prisma Word.mnemonic 的 VarChar(300) 对齐

interface MnemonicEntry {
  text: string;
  mnemonic: string;
}

interface Options {
  file: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { file: 'mnemonics.json', dryRun: false };
  for (const a of argv) {
    if (a.startsWith('--file=')) opts.file = a.split('=')[1] ?? opts.file;
    else if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const path = resolve(DATA_DIR, opts.file);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;

  if (!Array.isArray(raw)) {
    throw new Error(`${opts.file} 必须是 [{ text, mnemonic }] 数组`);
  }

  const entries = raw as MnemonicEntry[];
  let updated = 0;
  let notFound = 0;
  let skippedEmpty = 0;
  const notFoundList: string[] = [];

  for (const e of entries) {
    const text = (e.text ?? '').trim();
    const mnemonic = (e.mnemonic ?? '').trim().slice(0, MAX_LEN);
    if (!text || !mnemonic) {
      skippedEmpty++;
      continue;
    }
    if (opts.dryRun) {
      const exists = await prisma.word.findUnique({ where: { text }, select: { id: true } });
      if (!exists) {
        notFound++;
        notFoundList.push(text);
      } else {
        updated++;
      }
      continue;
    }
    const result = await prisma.word.updateMany({ where: { text }, data: { mnemonic } });
    if (result.count === 0) {
      notFound++;
      notFoundList.push(text);
    } else {
      updated++;
    }
  }

  console.log(`[mnemonic-import] ${opts.dryRun ? 'DRY RUN：' : ''}更新 ${updated} / 未匹配到词 ${notFound} / 空内容跳过 ${skippedEmpty}（共 ${entries.length} 条）`);
  if (notFoundList.length > 0) {
    console.log(`[mnemonic-import] 未匹配到的词（前 20 个）: ${notFoundList.slice(0, 20).join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
