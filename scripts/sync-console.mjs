#!/usr/bin/env node
/**
 * 把 local-console 的实现同步进插件的 console/ 目录，避免两份代码漂移。
 * 用法：node scripts/sync-console.mjs [<local-console 目录>]
 * 默认源：F:\agent\local-console（可用环境变量 LC_SOURCE_DIR 覆盖）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, '..');
const SRC = process.argv[2] || process.env.LC_SOURCE_DIR || 'F:\\agent\\local-console';
const pairs = [
  [path.join(SRC, 'server.mjs'), path.join(PKG, 'console', 'server.mjs')],
  [path.join(SRC, 'public', 'index.html'), path.join(PKG, 'console', 'public', 'index.html')],
];

for (const [from, to] of pairs) {
  if (!existsSync(from)) {
    console.error(`缺少源文件: ${from}`);
    process.exit(1);
  }
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  const bytes = readFileSync(to);
  console.log(`synced ${path.relative(PKG, to)} (${bytes.length} B)`);
}
console.log('done. 记得重新跑 node --test test/ 与 npm pack --dry-run');