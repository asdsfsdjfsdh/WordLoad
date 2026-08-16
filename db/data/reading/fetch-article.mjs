// 抓取中公考研真题文章正文为纯文本（编码自动识别），用法：
//   node fetch-article.mjs <url> [out.txt]
import { readFileSync, writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'article.txt';

const res = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    'Referer': 'https://www.baidu.com/',
  },
});
let buf = Buffer.from(await res.arrayBuffer());

// 编码识别：优先 meta charset，其次探测
let charset = 'utf-8';
const head = buf.subarray(0, 2048).toString('latin1');
const m = head.match(/charset=["']?([\w-]+)/i);
if (m) charset = m[1];
if (!/utf-?8/i.test(charset)) {
  try {
    // GBK/GB2312 解码
    const { TextDecoder } = await import('node:util');
    const dec = new TextDecoder(charset === 'gb2312' ? 'gbk' : charset);
    const text = dec.decode(buf);
    if (text.includes('\uFFFD') === false || text.length > 100) {
      writeFileSync(out, text);
      console.log(`decoded ${charset}, ${text.length} chars -> ${out}`);
      process.exit(0);
    }
  } catch {}
}
const text = buf.toString('utf-8');
writeFileSync(out, text);
console.log(`utf-8 ${text.length} chars -> ${out}`);