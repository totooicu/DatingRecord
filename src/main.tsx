import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { LockGate } from './ui/lock/LockGate';
import { EncUnlock } from './ui/enc/EncUnlock';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initDb, probeEnc } from './core/db';
import { unlock } from './core/lock';
import {
  bootClient,
  clientConfigFromPageUrl,
  prepareClientBoot,
  saveClientConfig,
  savedHostConfig,
  startHost,
  takeRemoteTip,
  initRemoteResilience,
  type RemoteConfig,
} from './core/remote';
import { showToast } from './ui/toast';
import { initAppearance, initAppearanceShare } from './ui/theme';
import { initPrefs } from './ui/prefs';
import './styles.css';

// 主题变量尽早贴上：index.html 的首屏脚本已经按缓存刷过一次，
// 这里再做一次是为了校验存储内容，并顺便更新浏览器状态栏颜色。
initAppearance();
// 外观随连接同步：服务端的配色会在客户端连上后贴过去（不覆盖本机存档）
initAppearanceShare();
// 连接自愈：回到前台补同步，心跳发现假死连接就原地重连
initRemoteResilience();
// 界面引导强度（陪伴 / 专注）同步贴上，驱动 .guide-only 的显隐
initPrefs();

const el = document.getElementById('root')!;
const boot = document.getElementById('boot');
const bootTip = document.getElementById('boot-tip');
const bootPct = document.getElementById('boot-pct');
const bootBar = document.getElementById('boot-progress');
const bootFill = document.getElementById('boot-fill');

/**
 * 更新首屏加载态（启动画面直接写在 index.html 里，JS 到达前就可见）。
 *
 * `ratio` 为 null 表示这一阶段量不出进度，条子切成来回扫的不确定态——
 * 与其显示一个不动的 0%，不如明确告诉用户「在动，只是说不准多久」。
 */
let slowHint = false;
let lastTip: { msg: string; ratio: number | null } = { msg: '正在启动…', ratio: null };

function setTip(msg: string, ratio: number | null = null): void {
  lastTip = { msg, ratio };
  paintBoot();
}

function paintBoot(): void {
  const { msg, ratio } = lastTip;
  if (bootTip) bootTip.textContent = slowHint ? `${msg} · 网络较慢，稍等` : msg;
  if (bootPct) bootPct.textContent = ratio === null ? '' : `${Math.round(ratio * 100)}%`;
  if (bootBar) bootBar.classList.toggle('is-unknown', ratio === null);
  if (bootFill) bootFill.style.width = ratio === null ? '' : `${Math.round(ratio * 100)}%`;
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
    'border-radius:8px;background:var(--primary,#d9536b);color:#fff;font-size:14px">重新加载</button>';
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
  const register = () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 注册失败不影响使用 */
    });
  };
  // 这里是引擎加载完之后才调用的，而 load 事件往往早就过去了（它只等资源下载完）。
  // 以前无条件监听 load 就等于永远等不到，SW 一直没注册——离线、预缓存、
  // 版本更新全是摆设，表现为「每次打开都要重新下载数据库引擎」。
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

// 慢网提示：8 秒还没起来说明引擎还没下完。
// 只补一句后缀、不动进度——进度是从实际字节数算出来的，比拍脑袋的文案可信
const slowTimer = window.setTimeout(() => {
  slowHint = true;
  paintBoot();
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

// 启动分两步：先看库是不是加密的，是的话拦住要口令；拿到明文后再 initDb。
//
// 顺序不能反——initDb 内部要 new sql.Database(明文)，密文状态下它什么都读不出来。
// 所以「加密且锁着」时先挂一个只有解锁界面的 React 树，解锁成功再走原来的路。
//
// 跨设备客户端是例外：它不读本地库，直接连服务端；本地加不加密都不影响它。
// 但必须先 prepareClientBoot() 把本地落盘堵住，再 initDb（迁移会 markDirty）。
// 壳端「一键打开」：别的设备把 http://手机IP:4173/?token=… 粘进浏览器，
// 页面自己认出 token 并按客户端启动；token 立刻从地址栏抹掉，只剩会话里的连接。
// 必须在 prepareClientBoot() 之前：它是照着会话标记决定这次是不是客户端启动的。
const joinCfg = clientConfigFromPageUrl(location.href);
if (joinCfg) {
  saveClientConfig(joinCfg);
  try {
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
  } catch {
    /* 地址栏不让改（少数内嵌浏览器）：token 留在地址里也能用 */
  }
}

const clientCfg = prepareClientBoot();

/** 统一的 React 挂载：本地 / 远程成功后都走这里 */
function renderApp(): void {
  createRoot(el).render(
    <ErrorBoundary>
      <LockGate>
        <App />
      </LockGate>
    </ErrorBoundary>,
  );
  finishBoot();
  registerServiceWorker();
  const tip = takeRemoteTip();
  if (tip) showToast(tip, 3200);
  // 服务端刷新后自动恢复：不断开中继，客户端就还能继续用
  const hostCfg = savedHostConfig();
  if (hostCfg) {
    void startHost(hostCfg).catch(() => {
      /* 失败会由远程状态条显示；本机数据照常可用 */
    });
  }
}

if (clientCfg) {
  startRemote(clientCfg);
} else {
  probeEnc()
    .then((status) => {
      if (status !== 'locked') {
        startDb();
        return;
      }
      createRoot(el).render(
        <ErrorBoundary>
          <EncUnlock
            onUnlocked={() => {
              // 口令刚验过一次，应用锁没必要再问一遍
              unlock();
              startDb();
            }}
          />
        </ErrorBoundary>,
      );
      finishBoot();
    })
    .catch(() => {
      // 探测失败（IndexedDB 被禁之类）别在这儿卡死，照常尝试启动
      startDb();
    });
}

/** 客户端启动：连上服务端、换库成功后才渲染；失败就退回本地库 */
function startRemote(cfg: RemoteConfig): void {
  setTip('正在连接服务端…', null);
  initDb(setTip)
    .then(async () => {
      try {
        await bootClient(cfg, (msg) => setTip(msg, null));
        window.clearTimeout(slowTimer);
        window.clearTimeout(hardTimer);
        renderApp();
      } catch {
        window.clearTimeout(slowTimer);
        window.clearTimeout(hardTimer);
        // 本地库一直在盘上，渲染出来就是自己的数据；错误由远程状态条说明
        renderApp();
        showToast('连不上服务端，已显示本地数据', 3600);
      }
    })
    .catch((err: unknown) => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(hardTimer);
      const raw = err instanceof Error ? err.message : String(err);
      finishBoot(errorCard('启动失败', raw));
    });
}

function startDb(): void {
  initDb(setTip)
    .then(() => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(hardTimer);
      renderApp();
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
}
