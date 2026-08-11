// 词库质量校验 CLI（独立于导入，供 CI 使用）
// 用法: tsx pipeline/check.ts
// 从源 JSON 加载候选词并跑质量校验，fatal>0 时以非 0 退出码退出

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkQuality, collectCandidates, reportToText } from './quality';
import type { RawBookWord, RawExample, RawWord } from './types';

const DATA_DIR = resolve(import.meta.dirname, '../data');
const KAOYAN_BOOK_ID = 2;

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, name), 'utf8')) as T;
}

async function main(): Promise<void> {
  const [bookWords, words, examples] = await Promise.all([
    Promise.resolve(loadJson<RawBookWord[]>('tb_voc_book.json')),
    Promise.resolve(loadJson<RawWord[]>('tb_vocabulary.json')),
    Promise.resolve(loadJson<RawExample[]>('tb_voc_examples.json')),
  ]);

  const wordIds = new Set(bookWords.filter((r) => r.bookid === KAOYAN_BOOK_ID).map((r) => r.wordid));
  const candidates = collectCandidates(words.filter((w) => wordIds.has(w.wordid)), examples);

  const report = checkQuality(candidates);
  console.log(reportToText(report));

  if (report.fatal > 0) {
    console.error(`[check] FAIL: fatal 问题 ${report.fatal} 个`);
    process.exit(1);
  }
  console.log('[check] PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});