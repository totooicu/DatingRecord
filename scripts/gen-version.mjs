// 构建后生成 version.json：记录整体版本和每个文件的内容 hash。
//
// SW 启动时 fetch 这个小文件，和本地存的版本对比：
//   · 整体 version 没变 → 直接用本地缓存，不重新下载
//   · 某个文件 hash 变了 → 只重新下载那一个文件
//   · 整体 version 变了 → 全量更新
//
// 这样用户下次打开 PWA 时，99% 的情况是秒开（本地缓存），
// 只有真的发了新版本才走网络。

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');

// 遍历 dist 下所有静态文件（排除 sw.js 本身和 version.json，它们是更新入口）
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist)
  .map((f) => {
    const rel = '/' + relative(dist, f).split(/[\\/]/).join('/');
    if (rel === '/sw.js' || rel === '/version.json') return null;
    const buf = readFileSync(f);
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    return { version: hash, link: rel };
  })
  .filter(Boolean)
  .sort((a, b) => a.link.localeCompare(b.link));

const version = new Date().toISOString();
const out = {
  version,
  link: '/index.html',
  subversion: files,
};

writeFileSync(join(dist, 'version.json'), JSON.stringify(out, null, 2));
console.log(`[gen-version] version=${version}, files=${files.length}`);
