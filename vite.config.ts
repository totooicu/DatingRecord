import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 产品版本写在 package.json，构建时注入页面：壳与网页的版本配对靠它对齐，
// 免得「页面说 1.0.0、包里其实是别的版本」。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  optimizeDeps: {
    // 必须让 Vite 预构建 sql.js：dev 模式下若直接加载其 ESM 入口
    // （sql-wasm-browser.js），该模块只有具名导出 initSqlJs、没有 default，
    // 会让 `import initSqlJs from 'sql.js'` 直接报错、页面白屏。
    include: ['sql.js'],
  },
  server: {
    fs: {
      // 允许访问 node_modules 下 pnpm 软链指向的真实路径
      strict: false,
    },
  },
  preview: {
    // 关键：强制不缓存，避免平台预览代理把旧构建（含旧 sw.js）缓存住，
    // 导致改完代码刷新仍显示旧版。no-store 比 no-cache 更彻底。
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  },
});
