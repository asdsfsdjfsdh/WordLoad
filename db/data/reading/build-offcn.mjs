// 由中公 offcn 汇总页（all.txt：Text1-4 原文+题目+答案+解析）构建 <year>/textN.json
// 用法： node build-offcn.mjs <year> <all.txt> [extra.mjs]
// extra.mjs 可选：export const SUBTITLES / export const FIX_TEXT(段文本替换) / export const REMARKS
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const YEAR = process.argv[2];
const INP = process.argv[3];
const EXTRA = process.argv[4] ? (await import(pathToFileURL(resolve(process.cwd(), process.argv[4])).href)).default : {};
const OUT = resolve(import.meta.dirname, YEAR);

const clean = (t) =>
  t
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '\u2019').replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018').replace(/&quot;/g, '"');

const lines = readFileSync(INP, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);

// 定位 Text 1..4 区块（原文+题目+答案+解析连续存放）
const textMarkers = ['Text 1', 'Text 2', 'Text 3', 'Text 4'];
const bounds = [];
for (let i = 0; i < 4; i++) {
  const start = lines.findIndex((l) => l === textMarkers[i]);
  const end = i < 3 ? lines.findIndex((l) => l === textMarkers[i + 1]) : lines.length;
  bounds.push([start, end]);
}
if (bounds.some(([s]) => s < 0)) throw new Error('未找到全部 Text 区块');

const paragraphs = (lines, start, end) => {
  const out = [];
  for (let i = start + 1; i < end; i++) {
    const l = lines[i];
    if (/^\d+\.\s/.test(l)) break;
    if (/^[A-D]\.\s/.test(l)) break;
    if (/^【/.test(l)) break;
    out.push(clean(l));
  }
  return out;
};

const questions = (lines, start, end) => {
  const out = [];
  for (let i = start + 1; i < end; i++) {
    const qm = lines[i].match(/^(\d+)\.\s*(.+)$/);
    if (!qm || /【答案】/.test(lines[i])) continue;
    const q = { seq: Number(qm[1]), stem: clean(qm[2]), options: {} };
    for (let j = i + 1; j < end; j++) {
      const om = lines[j].match(/^([A-D])\.\s*(.+)$/);
      if (om && !/^\d+\./.test(lines[j])) q.options[om[1]] = clean(om[2]);
      else break;
    }
    out.push(q);
  }
  return out;
};

const answers = (lines, start, end) => {
  const map = {};
  let lastSeq = null;
  for (let i = start + 1; i < end; i++) {
    const am = lines[i].match(/^(\d+)\.\s*【答案】([A-D])(?:\((.*)\))?/);
    if (am) {
      lastSeq = Number(am[1]);
      map[lastSeq] = { answer: am[2], analysis: '' };
    } else {
      const em = lines[i].match(/^【解析】(.+)$/);
      if (em && lastSeq !== null && map[lastSeq]) map[lastSeq].analysis += em[1];
    }
  }
  return map;
};

const splitSentences = (para) =>
  [...para.matchAll(/[^.!?]+[.!?]*["\u201D)]?/g)].map((m) => m[0].trim()).filter(Boolean);

mkdirSync(OUT, { recursive: true });
const code = ['A', 'B', 'C', 'D'];
for (let t = 0; t < 4; t++) {
  const [start, end] = bounds[t];
  let paras = paragraphs(lines, start, end);
  const qs = questions(lines, start, end);
  const ans = answers(lines, start, end);

  // 省略段修复（FIX_TEXT）
  const fixed = (EXTRA.FIX_TEXT && EXTRA.FIX_TEXT[YEAR]?.[code[t]]) || {};
  paras = paras.map((p) => (fixed[p] ? fixed[p] : p));

  const sentences = [];
  let seq = 0;
  paras.forEach((p, pi) => {
    for (const s of splitSentences(p)) sentences.push({ para: pi + 1, seq: seq++, en: s });
  });

  const outQ = qs.map((q) => {
    const a = ans[q.seq];
    if (!a) throw new Error(`${YEAR} ${code[t]} 缺 ${q.seq} 答案`);
    return {
      ...q,
      answer: a.answer,
      analysis: a.analysis || '（解析待补充）',
      ...(EXTRA.REMARKS?.[YEAR]?.[code[t]]?.includes(q.seq) ? { remark: '此题答案待权威来源复核' } : {}),
    };
  });

  const file = {
    code: code[t],
    title: `Text ${t + 1}`,
    subtitle: (EXTRA.SUBTITLES && EXTRA.SUBTITLES[YEAR]?.[code[t]]) || '',
    questionsStart: qs[0]?.seq ?? 21,
    sentences,
    questions: outQ,
    glossary: {},
  };
  const p = resolve(OUT, `text${t + 1}.json`);
  writeFileSync(p, JSON.stringify(file, null, 2), 'utf-8');
  console.log(`[ok] ${YEAR}/${code[t]} Text ${t + 1}：句子 ${sentences.length}、题目 ${outQ.length}、解析 ${outQ.filter((q) => q.analysis.length > 30).length} 题详细`);
}

// 输出含省略号的段（供修复）
const ellipsis = [];
for (let t = 0; t < 4; t++) {
  const [start, end] = bounds[t];
  paragraphs(lines, start, end).forEach((p, i) => {
    if (p.includes('...')) ellipsis.push(`${code[t]}#${i + 1}: ${p.slice(0, 90)}`);
  });
}
if (ellipsis.length) console.log('\n[省略段待修复]\n' + ellipsis.join('\n'));