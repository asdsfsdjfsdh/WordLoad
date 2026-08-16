// 抓取并解析单篇正文： node grab-article.mjs <url> <out.txt>
import { writeFileSync } from 'node:fs';
const { TextDecoder } = await import('node:util');
const dec = new TextDecoder('gbk');
const url = process.argv[2];
const out = process.argv[3];
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124', 'Referer': 'https://www.baidu.com/' } });
let buf = Buffer.from(await res.arrayBuffer());
let html = dec.decode(buf);
if (html.includes('\uFFFD')) html = buf.toString('utf-8');
const sec = html.match(/<section class="sectionCon">([\s\S]*?)<\/section>/);
const body = sec ? sec[1] : html;
const parts = [];
for (const m of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
  let t = m[1].replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D').replace(/&lsquo;/g, '\u2018').replace(/&rsquo;/g, '\u2019').replace(/&hellip;/g, '\u2026');
  t = t.replace(/^\s+|\s+$/g, '');
  if (t) parts.push(t);
}
writeFileSync(out, parts.join('\n'), 'utf-8');
console.log(`${parts.length} paragraphs -> ${out}`);