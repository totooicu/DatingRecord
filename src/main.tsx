import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { initDb } from './core/db';
import './styles.css';

const el = document.getElementById('root')!;

/** 仅在产物环境注册 SW：dev 模式下会干扰 HMR 与模块热替换 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  // 只在 http(s) 下可用；file:// 直接打开时跳过
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 注册失败不影响使用 */
    });
  });
}

initDb()
  .then(() => {
    createRoot(el).render(<App />);
    registerServiceWorker();
  })
  .catch((err: unknown) => {
    el.innerHTML = `<div style="padding:40px;font-family:system-ui">
      <h2>数据库初始化失败</h2>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <p style="color:#888">请确认浏览器支持 WebAssembly 与 IndexedDB（建议使用较新版本的 Chrome / Edge / Safari）。</p>
    </div>`;
  });
