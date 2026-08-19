// 单词优化 · 回填导入：读模型生成的优化结果 JSON，按 text 匹配回填
//   - senses：增量追加 DB 尚不存在的义项（保护 UserSenseProgress 的 senseIdx 关联，不重排/不删除）
//   - phrases：覆盖 Word.phrases（[{phrase, meaning}...]）
//   - mnemonic：覆盖 Word.mnemonic
// 用法: tsx pipeline/import-word-optimize.ts [--file=word-optimize.json] [--dry-run]
// 配套：export-optimize-targets.ts（随机抽词）+ word-optimize-prompt-template.md（提示词模板）

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();
const DATA_DIR = resolve(import.meta.dirname, '../data');
const MNEMONIC_MAX = 300; // 与 schema Word.mnemonic VarChar(300) 对齐

interface SenseItem {
  meaning: string;
  rare: boolean;
  rareNote: string;
}
interface PhraseItem {
  phrase: string;
  meaning: string;
}
interface OptimizeEntry {
  text: string;
  senses: SenseItem[];
  phrases: PhraseItem[];
  mnemonic: string;
}

interface Options {
  file: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { file: 'word-optimize.json', dryRun: false };
  for (const a of argv) {
    if (a.startsWith('--file=')) opts.file = a.split('=')[1] ?? opts.file;
    else if (a === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

// 从义项文本提取中文核心词（去词性前缀/括号/标点）
function coreWords(meaning: string): string[] {
  const body = meaning.replace(/^(prep|conj|pron|num|int|aux|art|det|vt|vi|adj|adv|n|v)\.\s*/, '');
  return body
    .split(/[；;，,、/║|｜]/)
    .map((s) => s.replace(/[（(][^)）]*[)）]/g, '').trim())
    .filter((s) => /[\u4e00-\u9fff]/.test(s));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(readFileSync(resolve(DATA_DIR, opts.file), 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${opts.file} 必须是 [{ text, senses, phrases, mnemonic }] 数组`);
  const entries = raw as OptimizeEntry[];

  let senseAdded = 0;
  let phraseUpdated = 0;
  let mnemonicUpdated = 0;
  let notFound = 0;
  const notFoundList: string[] = [];

  for (const e of entries) {
    const text = (e.text ?? '').trim();
    if (!text) continue;

    const word = await prisma.word.findUnique({
      where: { text },
      include: { senses: { orderBy: { idx: 'asc' } } },
    });
    if (!word) {
      notFound++;
      notFoundList.push(text);
      continue;
    }

    const existingMeanings = word.senses.map((s) => s.meaning);
    const existingCores = existingMeanings.flatMap(coreWords);

    // 1) 义项：增量追加缺失（判定：优化义项的核心词与现有义项核心词无交集 → 追加）
    const maxIdx = word.senses.reduce((m, s) => Math.max(m, s.idx), -1);
    let nextIdx = maxIdx + 1;
    for (const sense of e.senses ?? []) {
      const meaning = (sense.meaning ?? '').trim();
      if (!meaning) continue;
      const cores = coreWords(meaning);
      if (cores.length === 0) continue;
      // 与现有义项核心词有交集 → 视为已存在，跳过
      const overlap = cores.some((c) => existingCores.includes(c));
      if (overlap) continue;
      if (!opts.dryRun) {
        await prisma.wordSense.create({
          data: { wordId: word.id, idx: nextIdx++, meaning, example: '' },
        });
      }
      senseAdded++;
    }

    // 2) 词组：覆盖 Word.phrases
    const phrases = (e.phrases ?? [])
      .map((p) => ({ phrase: (p.phrase ?? '').trim(), meaning: (p.meaning ?? '').trim() }))
      .filter((p) => p.phrase);
    if (phrases.length > 0) {
      if (!opts.dryRun) {
        await prisma.word.update({ where: { id: word.id }, data: { phrases } });
      }
      phraseUpdated++;
    }

    // 3) 记忆锚点：覆盖 Word.mnemonic
    const mnemonic = (e.mnemonic ?? '').trim().slice(0, MNEMONIC_MAX);
    if (mnemonic) {
      if (!opts.dryRun) {
        await prisma.word.update({ where: { id: word.id }, data: { mnemonic } });
      }
      mnemonicUpdated++;
    }
  }

  console.log(
    `[optimize-import] ${opts.dryRun ? 'DRY RUN：' : ''}` +
      `追加义项 ${senseAdded} / 更新词组 ${phraseUpdated} / 更新记忆锚点 ${mnemonicUpdated} / 未匹配词 ${notFound}（共 ${entries.length} 条）`,
  );
  if (notFoundList.length > 0) {
    console.log(`[optimize-import] 未匹配到的词（前 20 个）: ${notFoundList.slice(0, 20).join(', ')}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
