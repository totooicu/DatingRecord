// 把 CLI 打成一个自包含的 CJS 文件：dist-cli/cli.cjs
//
// 几个坑，改之前先读：
//   1. format 必须是 cjs——sql.js 的 UMD 外壳里有 module.exports / __dirname，
//      打进 ESM 会直接报 __dirname is not defined。
//   2. sql.js 必须 external——它的 wasm 是运行时 locateFile 找的，
//      而且上面那条 UMD 问题在打包后依然存在。让 node 从 node_modules 里 require。
//   3. noExternal 里那几个是纯 ESM 或 CJS 混血的依赖，SSR 构建默认会把它们
//      当外部依赖留一手，Node 就跑不起来（dompurify 在浏览器分支里有 window 引用）。
//   4. 入口在 src/ 里：rollup 的 ssr 入口必须在项目 root 之内。

import { build } from 'vite';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  root,
  logLevel: 'warn',
  ssr: {
    noExternal: ['aes-js', 'fflate', 'marked', 'dompurify'],
  },
  build: {
    ssr: path.join(root, 'src/cli/index.ts'),
    outDir: path.join(root, 'dist-cli'),
    emptyOutDir: true,
    minify: false,
    target: 'node18',
    rollupOptions: {
      external: ['sql.js'],
      output: {
        format: 'cjs',
        entryFileNames: 'cli.cjs',
        exports: 'auto',
      },
    },
  },
});

console.log('CLI built: dist-cli/cli.cjs');
