// 列出 HTML 中匹配标题的链接： node list-links.mjs <html> <标题正则>
import { readFileSync } from 'node:fs';

const [, , inp, pat] = process.argv;
const html = readFileSync(inp, 'utf-8');
const re = new RegExp(pat, 'i');
const hrefRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
let m;
const out = [];
while ((m = hrefRe.exec(html))) {
  const t = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (re.test(t)) out.push(`${t} | ${m[1]}`);
}
console.log([...new Set(out)].join('\n') || 'NO MATCH');