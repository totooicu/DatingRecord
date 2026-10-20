import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { initDb } from './core/db';
import './styles.css';

const el = document.getElementById('root')!;

initDb()
  .then(() => {
    createRoot(el).render(<App />);
  })
  .catch((err: unknown) => {
    el.innerHTML = `<div style="padding:40px;font-family:system-ui">
      <h2>数据库初始化失败</h2>
      <p>${err instanceof Error ? err.message : String(err)}</p>
      <p style="color:#888">请确认浏览器支持 WebAssembly 与 IndexedDB（建议使用较新版本的 Chrome / Edge / Safari）。</p>
    </div>`;
  });
