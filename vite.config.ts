import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
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
});
