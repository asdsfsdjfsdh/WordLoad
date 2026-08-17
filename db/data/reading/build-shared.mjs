// 各 build-*.mjs 的公共工具：HTML 实体清洗 / 代码字母 / 句子切分 / 标准输出文件组装
// 三个构建脚本（build-pdf-year / build-offcn / build-year）来源格式各异，仅共享以下逻辑
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 四篇代码字母
export const CODE = ['A', 'B', 'C', 'D'];

// HTML 实体 → 字符
export const clean = (t) =>
  t
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '\u2019').replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018').replace(/&quot;/g, '"');

// 简单句子切分（offcn / build-year 用；保留引号/缩写尽量安全）
export const splitSentencesSimple = (para) =>
  [...para.matchAll(/[^.!?]+[.!?]*["\u201D)]?/g)].map((m) => m[0].trim()).filter(Boolean);

// 组装并写出 <year>/textN.json（标准文件结构：title / subtitle / questionsStart / sentences / questions / glossary）
export const writeTextJson = (outDir, t, { subtitle, questionsStart, sentences, questions }) => {
  const file = {
    code: CODE[t],
    title: `Text ${t + 1}`,
    subtitle,
    questionsStart,
    sentences,
    questions,
    glossary: {},
  };
  const p = resolve(outDir, `text${t + 1}.json`);
  writeFileSync(p, JSON.stringify(file, null, 2), 'utf-8');
  return p;
};