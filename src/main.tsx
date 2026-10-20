import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { initDb } from './core/db';
import './styles.css';

const el = document.getElementById('root')!;
const boot = document.getElementById('boot');
const bootTip = document.getElementById('boot-tip');

/** 更新首屏加载态文案（启动画面直接写在 index.html 里，JS 到达前就可见） */
function setTip(msg: string): void {
  if (bootTip) bootTip.textContent = msg;
}

/** 收起启动画面；出错时把它替换成可读的错误卡片，绝不留下白屏 */
function finishBoot(errHtml?: string): void {
  if (!boot) return;
  if (errHtml) {
    boot.innerHTML = errHtml;
  } else {
    boot.remove();
  }
}

function errorCard(title: string, detail: string): string {
  const btn =
    '<button onclick="location.reload()" style="margin-top:16px;padding:9px 22px;border:none;' +
    'border-radius:8px;background:#d9536b;color:#fff;font-size:14px">重新加载</button>';
  return `<div style="max-width:420px;padding:24px;text-align:center">
      <div style="font-size:17px;font-weight:700;color:#2f2c28;margin-bottom:10px">${title}</div>
      <div style="font-size:13px;color:#8b857c;line-height:1.7">${detail}</div>
      ${btn}
    </div>`;
}

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

// 慢网提示：8 秒还没起来说明引擎还没下完，给个说法而不是无声转圈
const slowTimer = window.setTimeout(() => {
  setTip('网络较慢，正在下载数据库引擎（约 700KB）…');
}, 8000);

// 硬超时：90 秒仍未就绪就当作失败，给出可点重试的错误页。
// 断网、网络拦截 github.io、旧版 WebView 不支持 WASM，都会卡在这一步。
const hardTimer = window.setTimeout(() => {
  finishBoot(
    errorCard(
      '加载超时',
      '数据库引擎没能加载完成，通常是网络问题（首次打开需下载约 700KB）。',
    ),
  );
}, 90_000);

initDb(setTip)
  .then(() => {
    window.clearTimeout(slowTimer);
    window.clearTimeout(hardTimer);
    createRoot(el).render(<App />);
    finishBoot();
    registerServiceWorker();
  })
  .catch((err: unknown) => {
    window.clearTimeout(slowTimer);
    window.clearTimeout(hardTimer);
    const raw = err instanceof Error ? err.message : String(err);
    finishBoot(
      errorCard(
        '启动失败',
        '数据库引擎没能加载。<br />请确认浏览器支持 WebAssembly 与 IndexedDB' +
          '（建议较新版本的 Chrome / Edge / Safari，并关闭无痕模式），或稍后重试。' +
          `<details style="margin-top:12px;font-size:12px;color:#a8a29a"><summary style="cursor:pointer">技术细节</summary>` +
          `<div style="margin-top:6px;word-break:break-all">${raw}</div></details>`,
      ),
    );
  });
