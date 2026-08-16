// 解析中公考研真题 HTML（sectionCon 正文）为纯文本：每段一行，转义实体解码，标签剥离
import { readFileSync, writeFileSync } from 'node:fs';

const inp = process.argv[2];
const out = process.argv[3] || inp.replace(/\.html$/i, '.txt');

let html = readFileSync(inp, 'utf-8');

const sec = html.match(/<section class="sectionCon">([\s\S]*?)<\/section>/);
const body = sec ? sec[1] : html;

const parts = [];
for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
  let t = m[1];
  t = t.replace(/<br\s*\/?\s*>/gi, '\n');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D').replace(/&lsquo;/g, '\u2018').replace(/&rsquo;/g, '\u2019').replace(/&hellip;/g, '\u2026');
  t = t.replace(/^\s+|\s+$/g, '');
  if (t) parts.push(t);
}
const text = parts.join('\n');
writeFileSync(out, text, 'utf-8');
console.log(`${parts.length} paragraphs -> ${out}`);