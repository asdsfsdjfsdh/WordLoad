// 由 PDF 提取文本（pdf.txt）构建 <year>/textN.json
// 原文+题目取 PDF（权威完整）；段落锚点/答案+解析可来自 offcn 汇总文本（<offcnAll>）或解析 JSON（<offcnDir>）
// 用法： node build-pdf-year.mjs <year> <pdf.txt> <offcnAll|offcnDir> [extra.mjs]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const YEAR = process.argv[2];
const INP = process.argv[3];
const OFFCN = process.argv[4];
const EXTRA = process.argv[5] ? (await import(pathToFileURL(resolve(process.cwd(), process.argv[5])).href)).default : {};
const OUT = resolve(import.meta.dirname, YEAR);

const clean = (t) =>
  t
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '\u2019').replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D')
    .replace(/&lsquo;/g, '\u2018').replace(/&quot;/g, '"');

const norm = (t) =>
  (t || '').toLowerCase().replace(/[\u2018\u2019']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

const overlap = (a, b) => {
  const A = norm(a), B = norm(b);
  if (!A.length || !B.length) return 0;
  const set = new Set(B);
  let hit = 0;
  for (const w of A) if (set.has(w)) hit++;
  return hit / A.length;
};

const lines = readFileSync(INP, 'utf-8').split('\n').map((l) => l.trimEnd());

// Text N 区块：paragraphs 与 questions 的分界
const textStarts = [1, 2, 3, 4].map((i) => lines.findIndex((l) => new RegExp(`^Text ${i}$`).test(l.trim())));
if (textStarts.some((s) => s < 0)) throw new Error('未找到全部 Text 区块');
const partBIdx = lines.findIndex((l) => /^Part B$/i.test(l.trim()));
const sectionEnds = textStarts.map((s, i) => textStarts[i + 1] ?? (partBIdx >= 0 ? partBIdx : lines.length));
const questionStarts = textStarts.map((s, i) => {
  for (let k = s + 1; k < sectionEnds[i]; k++) if (/^\d+\.\s/.test(lines[k])) return k;
  return sectionEnds[i];
});

// 题目：题干 + A-D 选项（PDF 权威）
const parseQuestions = (start, sectionEnd) => {
  const out = [];
  for (let i = start; i < sectionEnd; i++) {
    const qm = lines[i].match(/^(\d+)\.\s*(.+)$/);
    if (!qm) continue;
    const q = { seq: Number(qm[1]), stem: clean(qm[2]), options: {} };
    for (let j = i + 1; j < sectionEnd; j++) {
      const om = lines[j].match(/^([A-D])\.\s*(.+)$/);
      if (om) q.options[om[1]] = clean(om[2]);
      else break;
    }
    out.push(q);
  }
  return out;
};

// 段落全文（合并所有行，跳过页码标记；修复分页断裂的数字/句尾标点/孤立引号）
const paragraphFullText = (start, qStart) => {
  const segs = lines.slice(start + 1, qStart).filter((l) => !/^===== PAGE/.test(l));
  let txt = '';
  for (const raw of segs) {
    const s = raw.trim();
    if (!s) continue;
    if (!txt) { txt = s; continue; }
    const prevLast = txt[txt.length - 1];
    const nextFirst = s[0];
    if (/[”"’)\]!?.,;:]/.test(nextFirst) || /[“"‘(\[]/.test(prevLast)) txt += s;
    else txt += ' ' + s;
  }
  return txt.replace(/\s+/g, ' ').replace(/(\d)\.\s+(\d)/g, '$1.$2').replace(/--/g, '—').trim();
};

const splitSentences = (t) =>
  t
    .replace(/([.!?]["\u201D)]*)(?=\s)/g, '$1\u0000')
    .split('\u0000')
    .map((s) => s.trim())
    .filter(Boolean);

// 答案解析源（all.txt：每题答案+解析；文本段落每行一段 → 段落锚点）
const parseAnswerText = (t) => {
  const map = {};
  for (const m of t.matchAll(/(\d{1,2})\.\s*【答案】\s*([A-D])\s*\(([^)]*)\)\s*【解析】\s*([\s\S]*?)(?=\d{1,2}\.\s*【答案】|$)/g)) {
    map[m[1]] = { answer: m[2], analysis: m[4].replace(/\r?\n/g, '').trim(), note: m[3].trim() };
  }
  return map;
};
const parseAnchors = (t) => {
  const anchors = [];
  for (let i = 1; i <= 4; i++) {
    const s = t.indexOf(`Text ${i}`);
    const qm = t.slice(s).match(/^\d+\.\s/m) ?? t.slice(s).match(/\n\d+\.\s/m);
    const end = qm ? s + qm.index + qm[0].length : t.length;
    const firsts = [];
    for (const l of t.slice(s, end).split(/\r?\n/)) {
      const line = l.trim();
      if (!line || /^\d+\./.test(line) || /^[A-D]\./.test(line) || /^Text/.test(line)) continue;
      let p = line;
      const e = p.indexOf('...');
      if (e >= 0) p = p.slice(0, e);
      const first = splitSentences(p)[0];
      if (first) firsts.push(first);
    }
    anchors[i - 1] = firsts;
  }
  return anchors;
};
const loadOffcn = () => {
  const ans = {};
  const st = statSync(OFFCN);
  if (st.isFile()) {
    const txt = readFileSync(OFFCN, 'utf-8');
    Object.assign(ans, parseAnswerText(txt));
    return { anchors: parseAnchors(txt), ans };
  }
  const anchors = [];
  for (const f of readdirSync(OFFCN).filter((f) => /\.json$/i.test(f))) {
    const j = JSON.parse(readFileSync(resolve(OFFCN, f), 'utf-8'));
    if (!j.code) continue;
    const t = j.code.charCodeAt(0) - 65;
    const byPara = {};
    for (const s of j.sentences ?? []) (byPara[s.para] ||= []).push(s.en);
    const firsts = Object.keys(byPara).sort((a, b) => a - b).map((p) => byPara[p][0]);
    anchors[t] = firsts;
    for (const q of j.questions ?? []) ans[`${q.seq}`] = { answer: q.answer, analysis: q.analysis, remark: q.remark };
  }
  return { anchors, ans };
};
const { anchors, ans } = loadOffcn();

// 句子对齐到段落：锚点（offcn 各段首句）→ PDF 句子下标
const alignParagraphs = (fullText, firsts) => {
  const sents = splitSentences(fullText);
  const bounds = [0];
  let cursor = 0;
  for (const anchor of firsts.slice(1)) {
    let best = -1, bestScore = 0;
    for (let i = cursor; i < sents.length; i++) {
      const sc = overlap(anchor, sents[i]);
      if (sc > bestScore) { bestScore = sc; best = i; }
      if (sc > 0.85) break;
    }
    if (best > bounds[bounds.length - 1]) bounds.push(best);
    cursor = Math.max(cursor, best + 1);
  }
  bounds.push(sents.length);
  const assigned = new Array(sents.length).fill(0);
  for (let p = 0; p < bounds.length - 1; p++) {
    for (let i = bounds[p]; i < bounds[p + 1]; i++) assigned[i] = p + 1;
  }
  return { sents, assigned };
};

const CODE = ['A', 'B', 'C', 'D'];
mkdirSync(OUT, { recursive: true });
for (let t = 0; t < 4; t++) {
  const sectionEnd = sectionEnds[t];
  const qStart = questionStarts[t];
  const fullText = paragraphFullText(textStarts[t], qStart);
  const { sents, assigned } = alignParagraphs(fullText, anchors[t] ?? []);
  const sentences = sents.map((en, i) => ({ para: assigned[i], seq: i, en }));
  const outQ = parseQuestions(qStart, sectionEnd).map((q) => {
    const a = ans[`${q.seq}`];
    if (!a?.answer) throw new Error(`${YEAR} ${CODE[t]} 缺 ${q.seq} 答案/解析`);
    return { ...q, answer: a.answer, analysis: a.analysis || '（解析待补充）', ...(a.remark ? { remark: a.remark } : {}) };
  });
  const file = {
    code: CODE[t],
    title: `Text ${t + 1}`,
    subtitle: EXTRA.SUBTITLES?.[YEAR]?.[CODE[t]] || '',
    questionsStart: outQ[0]?.seq ?? 21,
    sentences,
    questions: outQ,
    glossary: {},
  };
  writeFileSync(resolve(OUT, `text${t + 1}.json`), JSON.stringify(file, null, 2), 'utf-8');
  const paras = new Set(assigned).size;
  console.log(`[ok] ${YEAR}/${CODE[t]}：段落 ${paras}、句子 ${sentences.length}、题目 ${outQ.length}`);
}