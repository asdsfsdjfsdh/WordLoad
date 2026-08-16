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
  const segs = lines
    .slice(start + 1, qStart)
    .filter((l) => !/^===== PAGE/.test(l))
    .filter((l) => !/^\s*\d+\s+https?:\/\/zhenti\.burningvocabulary\.(com|cn)\s*$/.test(l));
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
    .replace(/[。]/g, '.')
    .replace(/[！]/g, '!')
    .replace(/[？]/g, '?')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[；]/g, ';')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\b([A-Z])\.(?=\s)/g, '$1\u0001')
    .replace(/\b(?:Mr|Mrs|Ms|Dr|St|Prof|Jr|Sr|vs|etc)\.(?=\s)/gi, '$&\u0001')
    .replace(/([.!?]["\u201D)]*)(?=\s)/g, '$1\u0000')
    .split('\u0000')
    .map((s) => s.replace(/\u0001/g, '.'))
    .map((s) => s.trim())
    .filter(Boolean);

// 答案解析源
// 1) offcn 汇总文本：NN. 【答案】X(...) 【解析】...
// 2) kaoyan 跨考逐篇页（t1..t4.txt）：NN <字母> <答案文本> 后跟解析；段落锚点来自页内原文
const parseAnswerText = (t) => {
  const map = {};
  for (const m of t.matchAll(/(\d{1,2})\.\s*【答案】\s*([A-D])\s*\(([^)]*)\)\s*【解析】\s*([\s\S]*?)(?=\d{1,2}\.\s*【答案】|$)/g)) {
    map[m[1]] = { answer: m[2], analysis: m[4].replace(/\r?\n/g, '').trim(), note: m[3].trim() };
  }
  return map;
};
const kaoyanFlat = (t) =>
  t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\s*p\s*\/?>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '\u2014');
const KAOYAN_ANSWER_MARKER = /^(\d{1,2})[.,、)）。]?\s*(?:【([A-D])】|.*?\b([A-D])\b[.)、\]]?\s+)/;
const KAOYAN_QUESTION = /^\d{1,2}[.,、。]?\s*[A-Z]/;
const KAOYAN_TYPE = /(细节题|推断题|态度题|例证题|主旨题|主旨大意题|写作目的题|推理题|词语理解题|语义理解题)/;
const KAOYAN_FOOTER = /^(考研帮|手机版|触屏版|电脑版|意见反馈|关于我们|联系我们|友情链接|免责声明|备案号|返回|分享到|更多精彩|扫描|二维码|APP下载|Copyright|©|版权|编辑|上一篇|下一篇|本文关键字|声明|资料下载|推荐阅读|更多[>>〕]|考研英语核心词汇营|【考研英语】|学习得礼盒|限时免费|立即购课|更多试听|关键字)/i;
const KAOYAN_HEADER = /^(Section\s*[ⅰⅠ1-9]|Part\s+[AB]|Directions|Text\s*\d+|Read the following|Answer the questions|Mark your answers|Use of English|Section\s)/i;
const parseKaoyanAnswer = (t) => {
  const lines = kaoyanFlat(t).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const map = {};
  let cur = null;
  for (const line of lines) {
    const m = line.match(KAOYAN_ANSWER_MARKER);
    if (m && Number(m[1]) >= 21 && !KAOYAN_QUESTION.test(line)) {
      const letter = m[2] || m[3];
      if (letter) {
        const rest = line.slice(m[0].length).trim();
        const analysis = rest.replace(/^[^\u4e00-\u9fa5]*/, '');
        cur = { seq: m[1], analysis };
        map[cur.seq] = { answer: letter, analysis };
        continue;
      }
    }
    if (cur && !KAOYAN_FOOTER.test(line)) map[cur.seq].analysis += '\n' + line.replace(/^\[解析\]/, '');
  }
  for (const k of Object.keys(map)) map[k].analysis = map[k].analysis.replace(/\s+/g, ' ').trim();
  return map;
};
const parseKaoyanAnchors = (t) => {
  const flat = kaoyanFlat(t);
  const blocks = flat.split(/\n\s*\n/).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const firsts = [];
  for (const block of blocks) {
    if (/^\d{1,2}[.,、。]?\s*/.test(block)) break;
    const text = block.replace(/^[^a-zA-Z]*/, '');
    if (!/[a-zA-Z]{3,}/.test(text)) continue;
    if (KAOYAN_HEADER.test(text)) continue;
    const f = splitSentences(text)[0];
    if (f) firsts.push(f);
  }
  return firsts;
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
  // kaoyan 跨考逐篇模式：目录内 t1..t4.txt（或 text1..text4.txt）
  const files = readdirSync(OFFCN).filter((f) => /\.txt$/i.test(f));
  if (files.length) {
    const anchors = [];
    const byText = (i) =>
      files.find((f) => new RegExp(`^(t|text)${i}\\.txt$`, 'i').test(f));
    for (let i = 1; i <= 4; i++) {
      const f = byText(i);
      if (!f) throw new Error(`缺少 ${i} 篇解析文件`);
      const txt = readFileSync(resolve(OFFCN, f), 'utf-8');
      Object.assign(ans, parseKaoyanAnswer(txt));
      anchors[i - 1] = parseKaoyanAnchors(txt);
    }
    return { anchors, ans };
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