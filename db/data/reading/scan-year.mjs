// 从 start 到 end 逐步探测文章标题，匹配关键词即停止打印
const start = Number(process.argv[2]);
const end = Number(process.argv[3]);
const step = Number(process.argv[4] ?? 50);
const want = process.argv[5] ? new RegExp(process.argv[5]) : null;
const { TextDecoder } = await import('node:util');
const dec = new TextDecoder('gbk');
for (let i = start; i <= end; i += step) {
  try {
    const res = await fetch(`http://sa.kaoyan365.cn/sakybk/sakyzt/${i}.html`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const s = dec.decode(buf);
    const t = s.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
    const clean = t.replace(/[\r\n\s]+/g, ' ');
    if (want && want.test(clean)) {
      console.log(`HIT ${i} : ${clean}`);
    } else if (!want && /英语一.*阅读/.test(clean)) {
      console.log(`${i} : ${clean}`);
    }
  } catch {
    // ignore
  }
}
console.log('done');