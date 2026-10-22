// 构建后处理：把 public/sw.js 里的缓存名占位符替换成带构建时间戳的名字。
//
// 为什么需要这一步：service worker 只在 sw.js 的「字节内容」发生变化时才会被浏览器
// 重新安装。如果缓存名写死（如 dating-record-v3），每次重新构建 sw.js 内容都相同，
// 浏览器就一直用着旧 SW、旧缓存的页面 —— 表现为「改了代码却看不到更新」。
// 把缓存名带上构建时间戳后，每次构建产物不同，浏览器会重新安装 SW 并清掉旧缓存。

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dst = resolve(here, '..', 'dist', 'sw.js');

try {
  const src = readFileSync(dst, 'utf8');
  if (!src.includes('__SW_CACHE__')) {
    console.log('[bust-sw] dist/sw.js 未含占位符，跳过（可能已是带时间戳版本）');
    process.exit(0);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = src.replace('__SW_CACHE__', `dating-record-${stamp}`);
  writeFileSync(dst, out);
  console.log(`[bust-sw] SW 缓存名已替换为 dating-record-${stamp}`);
} catch (e) {
  console.error('[bust-sw] 失败：', e.message);
  process.exit(1);
}
