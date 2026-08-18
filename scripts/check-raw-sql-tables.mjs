#!/usr/bin/env node
/**
 * 静态检查：apps/api/src 中所有 raw SQL（$queryRawUnsafe / $queryRaw）引用的表名，
 * 必须与 db/schema.prisma 中的 model 名大小写完全一致。
 *
 * 背景：MySQL 在 Linux 上默认 lower_case_table_names=0（表名大小写敏感），
 * Prisma 以 model 名原样建表（如 `Run`），raw SQL 若写成 `run` 会在运行时
 * 报 1146 "Table doesn't exist"（历史事故：runs.service.ts reroll/advance 两个接口 500）。
 *
 * 用法：node scripts/check-raw-sql-tables.mjs   （发现任何问题 exit 1）
 * 已接入：CI 的 pnpm test、API 镜像构建阶段（Dockerfile），任何一次部署在构建期即拦截。
 *
 * 说明：这是启发式守卫（只覆盖本仓库 raw SQL 的写法），新增 raw SQL 时请保持表名
 * 与 schema model 名逐字节一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// 1. 收集 db/schema.prisma 中的 model 名（大小写精确）
const schemaPath = path.join(root, 'db', 'schema.prisma');
if (!fs.existsSync(schemaPath)) {
  console.error(`[check-raw-sql-tables] 找不到 ${schemaPath}`);
  process.exit(1);
}
const schema = fs.readFileSync(schemaPath, 'utf8');
const models = new Set();
for (const m of schema.matchAll(/^model\s+(\w+)/gm)) models.add(m[1]);

// 2. 遍历 apps/api/src 下所有 .ts（排除 spec/test），提取 raw SQL 中的表名
function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (/\.ts$/.test(ent.name) && !/\.(spec|test)\.ts$/.test(ent.name)) yield p;
  }
}

const srcDir = path.join(root, 'apps', 'api', 'src');
if (!fs.existsSync(srcDir)) {
  console.error(`[check-raw-sql-tables] 找不到 ${srcDir}`);
  process.exit(1);
}

// $queryRawUnsafe('...') 或 $queryRaw`...`
const rawSqlRe = /\$(?:queryRawUnsafe\(\s*['"]([^'"]*)['"]|queryRaw\s*`([^`]*)`)/g;
// FROM / JOIN / UPDATE / INTO 之后的标识符（可带反引号）
const tableRe = /\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/g;

const errors = [];
for (const file of walk(srcDir)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    rawSqlRe.lastIndex = 0;
    let m;
    while ((m = rawSqlRe.exec(line)) !== null) {
      const sql = m[1] ?? m[2];
      tableRe.lastIndex = 0;
      let t;
      while ((t = tableRe.exec(sql)) !== null) {
        const name = t[1];
        if (!models.has(name)) {
          const suggested = [...models].find((x) => x.toLowerCase() === name.toLowerCase());
          errors.push(
            `${path.relative(root, file)}:${i + 1} 引用表名 \`${name}\` 与 schema model 名不一致` +
              (suggested ? `（应为 \`${suggested}\`）` : `（schema 中不存在该表）`),
          );
        }
      }
    }
  });
}

if (errors.length > 0) {
  console.error('[check-raw-sql-tables] ✗ raw SQL 表名大小写/定义错误：');
  for (const e of errors) console.error('   ' + e);
  console.error('   Linux MySQL 表名大小写敏感（lower_case_table_names=0），请改为与 db/schema.prisma 的 model 名完全一致。');
  process.exit(1);
}
console.log('[check-raw-sql-tables] ✓ 所有 raw SQL 表名与 Prisma schema model 名一致');
