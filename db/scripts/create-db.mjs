// 创建 word_journey 数据库（幂等，utf8mb4）
import { createConnection } from 'mysql2/promise';

const env = {
  MYSQL_HOST: process.env.MYSQL_HOST ?? 'localhost',
  MYSQL_PORT: Number(process.env.MYSQL_PORT ?? 3306),
  MYSQL_USER: process.env.MYSQL_USER ?? 'root',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? '123456',
  MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? 'word_journey',
};

async function main(): Promise<void> {
  const conn = await createConnection({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.MYSQL_DATABASE}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.end();
  console.log(`[db] database "${env.MYSQL_DATABASE}" ready`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});