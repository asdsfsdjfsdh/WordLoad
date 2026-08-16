// 管理员设置：将用户标记为后台管理员
// 用法: node scripts/set-admin.mjs <username> [true|false]
import { createConnection } from 'mysql2/promise';
import { readFileSync } from 'node:fs';

function parseUrl(url) {
  const m = /^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/.exec(url);
  if (!m) throw new Error(`无法解析 DATABASE_URL: ${url}`);
  return { user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5] };
}

async function main() {
  const [username, flag = 'true'] = process.argv.slice(2);
  if (!username) {
    console.error('用法: node scripts/set-admin.mjs <username> [true|false]');
    process.exit(1);
  }
  let url = process.env.DATABASE_URL;
  if (!url) {
    const env = readFileSync(resolveEnv(), 'utf8').replace(/^\uFEFF/, '');
    const line = env.split(/\r?\n/).find((l) => l.trim().startsWith('DATABASE_URL='));
    if (line) {
      const eq = line.indexOf('=');
      url = line.slice(eq + 1).trim();
    }
  }
  if (!url) throw new Error('未找到 DATABASE_URL（可在 db/.env 配置）');
  url = url.replace(/^["']|["']$/g, ''); // 去掉 .env 中可能带的双引号;

  const isAdmin = flag === 'true';
  const conn = await createConnection(parseUrl(url));
  const [res] = await conn.execute('UPDATE `user` SET `isAdmin` = ? WHERE `username` = ?', [isAdmin, username]);
  if (res.affectedRows === 0) {
    console.error(`用户不存在: ${username}`);
    process.exit(1);
  }
  console.log(`已将 ${username} 设为 ${isAdmin ? '管理员' : '普通用户'}`);
  await conn.end();
}

function resolveEnv() {
  const p = new URL('../.env', import.meta.url).pathname;
  return decodeURIComponent(p).replace(/^\/([A-Za-z]:)/, '$1');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
