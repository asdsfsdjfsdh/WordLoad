// 探测一列文章 ID 的标题（gbk 解码）： node probe-titles.mjs <start> <end>
const start = Number(process.argv[2]);
const end = Number(process.argv[3]);
const { TextDecoder } = await import('node:util');
const dec = new TextDecoder('gbk');
for (let i = start; i <= end; i++) {
  try {
    const res = await fetch(`http://sa.kaoyan365.cn/sakybk/sakyzt/${i}.html`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const s = dec.decode(buf);
    const t = s.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'NO TITLE';
    console.log(`${i} : ${t.replace(/[\r\n\s]+/g, ' ')}`);
  } catch {
    console.log(`${i} : ERR`);
  }
}