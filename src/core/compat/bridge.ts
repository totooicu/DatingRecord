// GeckoView 壳（geckoview_example）原生桥的网页侧客户端。
//
// 协议和壳里 assets/test.html 完全一致，改一边就得同步另一边：
//   请求 → window.postMessage({ type: 'gv-bridge-request', id, action, params }, '*')
//   响应 ← { type: 'gv-bridge-response', id, ok, result | error }
//   事件 ← { type: 'gv-bridge-event', event, data }   （扫描到设备、收到通知、录屏结束等）
//
// 壳把注入情况写在 <html> 的 data-gv-bridge-* 属性上，所以「桥在不在」不用等请求
// 超时也能先看一眼；普通浏览器里这些属性不存在，页面据此显示「未注入」。
//
// 这里只做协议收发，不含任何业务；页面在 ui/settings/LabCompatSection.tsx。

/** 一次原生调用的结果：壳返回什么就是什么，不做结构假设 */
export type BridgeResult = Record<string, unknown>;

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
      reject(new Error(`超时：${Math.round(timeoutMs / 1000)} 秒没有收到壳的回应`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ type: 'gv-bridge-request', id, action, params }, '*');
  });
}

/** 订阅原生事件（如 ble.deviceFound）。返回取消订阅的函数 */
export function onBridgeEvent(event: string, cb: (data: unknown) => void): () => void {
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

/** 壳在 <html> 上留下的注入痕迹；普通浏览器里全是空值 */
export interface BridgeDiagnostics {
  injected: boolean;
  stage: string;
  native: string;
}

export function bridgeDiagnostics(): BridgeDiagnostics {
  const de = typeof document !== 'undefined' ? document.documentElement : null;
  const attr = (name: string) => de?.getAttribute(name) ?? '';
  return {
    injected: attr('data-gv-bridge-injected') === 'true',
    stage: attr('data-gv-bridge-stage') || '(none)',
    native: attr('data-gv-bridge-native') || '(no heartbeat)',
  };
}

/** 壳的 ping：通了才算桥真的可用（注入属性只说明脚本跑过） */
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
    // Firefox / GeckoView 的 UA 里有 Gecko/xxxx；Chromium 系没有，别用 AppleWebKit 反推
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
