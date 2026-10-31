// 安卓壳（geckoview_example 这类，当前跑在系统 WebView 上）原生桥的网页侧客户端。
//
// 协议和壳里 assets/test.html 完全一致，改一边就得同步另一边：
//   请求 → window.postMessage({ type: 'gv-bridge-request', id, action, params }, '*')
//   响应 ← { type: 'gv-bridge-response', id, ok, result | error }
//   事件 ← { type: 'gv-bridge-event', event, data }   （扫描到设备、收到通知、录屏结束等）
//
// 这里只做协议收发，不含任何业务；页面在 ui/settings/LabCompatSection.tsx。
//
// **不判断「是不是在壳里」**：网页在壳里和在浏览器里行为一致，唯一的区别是
// 「有没有人接这条 postMessage」——而那只能靠发一次 action 试出来（ping / 具体
// action），不是靠读环境猜。旧的 pairing / 注入标记判断已于 2026-10-26 删除。

/** 一次原生调用的结果：壳返回什么就是什么，不做结构假设 */
export type BridgeResult = Record<string, unknown>;

/** invoke 失败时抛出的错误：超时的哪一种额外带标记，调用方据此分「没人回」与「壳回了但拒绝」 */
export interface BridgeError extends Error {
  /** true = 到了时间没人回包（多半是根本没有壳） */
  bridgeTimeout?: boolean;
}

/**
 * 这条错误是不是「没人回」。
 *
 * 别去匹配错误文案里的「超时」两个字——那句话由本文件写，改了文案调用方就悄悄失效。
 * save.ts 靠它分岔：没人回 = 浏览器，可以退回 &lt;a download&gt;；
 * 有人回了却说不认识这个 action = 有壳、壳太旧，那条退路在壳里同样是死的。
 */
export function isBridgeTimeout(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as BridgeError).bridgeTimeout === true;
}

interface PendingCall {
  resolve: (v: BridgeResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingCall>();
const listeners = new Map<string, Set<(data: unknown) => void>>();
let seq = 0;
let listening = false;

/** 只装一次监听：桥的响应和事件都走同一个 message 通道 */
function ensureListener(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { type?: unknown; id?: unknown; ok?: unknown; result?: unknown; error?: unknown; event?: unknown; data?: unknown } | null;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
    if (m.type === 'gv-bridge-response') {
      const p = pending.get(String(m.id));
      if (!p) return;
      pending.delete(String(m.id));
      clearTimeout(p.timer);
      if (m.ok) p.resolve((m.result ?? {}) as BridgeResult);
      else p.reject(new Error(typeof m.error === 'string' && m.error ? m.error : '原生返回失败'));
    } else if (m.type === 'gv-bridge-event' && typeof m.event === 'string') {
      const set = listeners.get(m.event);
      if (!set) return;
      set.forEach((cb) => {
        try {
          cb(m.data);
        } catch {
          // 单个回调出错不该带走其它回调，也不该冒泡成页面错误
        }
      });
    }
  });
}

/**
 * 调一次原生能力。
 *
 * 超时默认 15s（录屏启停、文件读写都可能慢），但桥根本不存在时这个等待太浪费，
 * 所以「检查桥」用 3s 的 ping；其余按钮只在人点了之后才会等。
 */
export function invoke(action: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<BridgeResult> {
  if (typeof window === 'undefined') return Promise.reject(new Error('当前环境没有 window'));
  ensureListener();
  return new Promise<BridgeResult>((resolve, reject) => {
    const id = `r${++seq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      const err: BridgeError = new Error(`超时：${Math.round(timeoutMs / 1000)} 秒没有收到壳的回应`);
      err.bridgeTimeout = true;
      reject(err);
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ type: 'gv-bridge-request', id, action, params }, '*');
  });
}

/** 订阅原生事件（如 ble.deviceFound）。返回取消订阅的函数 */
export function onBridgeEvent(event: string, cb: (data: unknown) => void): () => void {
  // 只订阅不调用也得先装消息监听：返回键这类事件用不着发请求，
  // 页面刚起来还没 invoke 过的时候，事件不能因为没挂监听被丢掉。
  ensureListener();
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

/**
 * 壳的 ping：通了才算桥真的可用。
 *
 * 以前还读 <html> 上的 data-gv-bridge-* 注入痕迹来「判断是不是在壳里」，
 * 2026-10-26 连同 pairing 一起删了：注入标记只说明壳的适配脚本跑过，
 * 答不了「这个壳有没有某个能力」，拿它做分支判断会一直误判。
 * 现在只剩这一条规矩：**想知道某个能力在不在，就发一次 action 看有没有人回**。
 */
export function pingBridge(): Promise<BridgeResult> {
  return invoke('ping', {}, 3000);
}

/** 文本 → base64。壳按 UTF-8 解，btoa 只吃 Latin-1，所以先自己编码 */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

/** base64 → 文本；解不开就把原文还回去（壳有时直接给明文） */
export function fromBase64(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return b64;
  }
}

/**
 * 字节 → base64（无换行）。
 *
 * 二进制要穿过 JSON 就只能 base64：壳的 net.request 收发分片都靠它。
 * 这里按视图遍历，`subarray` 出来的偏移才不会串位。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  // 分块转字符串：一次 String.fromCharCode(*大数组) 在手机上可能爆栈
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

/** base64 → 字节；壳给的空串返回零长度，不返回 null */
export function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** 引擎信息：判断「现在跑在什么内核里」用，不做能力开关 */
export interface EngineInfo {
  ua: string;
  secure: boolean;
  gecko: boolean;
  android: boolean;
  standalone: boolean;
  displayMode: string;
}

export function engineInfo(): EngineInfo {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
  return {
    ua,
    secure: typeof window !== 'undefined' ? window.isSecureContext === true : false,
    // Firefox / GeckoView 的 UA 里有 Gecko/xxxx；Chromium 系（含系统 WebView）没有，别用 AppleWebKit 反推
    gecko: /Gecko\/|Firefox\//.test(ua),
    android: /Android/i.test(ua),
    standalone,
    displayMode:
      typeof window !== 'undefined'
        ? (['standalone', 'minimal-ui', 'fullscreen', 'browser'].find(
            (m) => window.matchMedia?.(`(display-mode: ${m})`).matches,
          ) ?? 'browser')
        : 'browser',
  };
}

/**
 * 诊断用：读壳的 getEnv()。
 *
 * 壳通过 addJavascriptInterface 把 JsBridge 注册成 window.AndroidBridge，
 * getEnv() 是同步 Java 方法，直接返回 JSON 字符串（含 app/version/builtAt/commit）。
 * 普通浏览器里 window.AndroidBridge 不存在，本函数返回 null。
 *
 * ⚠️ 这是 2026-10-26 之后的临时诊断：之前把「判断是不是在壳里」整套删了，
 * 版本条不再显示壳的那一半；现在要验证「网页读不到壳版本时间」是否就是删这段导致，
 * 所以临时恢复「读 getEnv + 展示」。它只做展示，不拿返回值做任何业务分支判断。
 */
export interface ShellEnv {
  app: string;
  version: string;
  builtAt: string;
  commit: string;
  platform?: string;
  isApp?: boolean;
  bridge?: string;
}

export function shellEnv(): ShellEnv | null {
  try {
    const bridge = (window as unknown as { AndroidBridge?: { getEnv?: () => string } }).AndroidBridge;
    const raw = bridge?.getEnv?.();
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<ShellEnv>;
    if (!o || typeof o !== 'object') return null;
    return {
      app: o.app ?? '',
      version: o.version ?? '',
      builtAt: o.builtAt ?? '',
      commit: o.commit ?? '',
      platform: o.platform,
      isApp: o.isApp,
      bridge: o.bridge,
    };
  } catch {
    return null;
  }
}
