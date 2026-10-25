// 安卓壳「连续定位」原生服务（location.* 桥）的网页侧适配。
//
// 为什么要有这一层：页面自己的自动打点是 1s 的 setInterval，WebView 退到后台后
// JS 定时器会被冻住，记录就断了。壳里现在带一个前台服务 LocationTrackingService，
// 退到后台 / 熄屏照记；页面只负责三件事：
//   1. 把配置推下去（location.setConfig）；
//   2. 把原生记的点合并回当前 .drloc（合并逻辑在 locationAuto.ts，去重只有一份）；
//   3. 回到前台时补拉 location.getHistory（挂起期间的事件收不到，历史不会少）。
//
// 和壳的约定（见壳仓库 docs/ADAPTATION_GUIDE.md、LocationConfig.java）：
//   · 配置存在页面这边（localStorage['dr.autoLocation']），壳在 onPageFinished
//     会主动读一次，所以即使页面没调桥，原生也有最新的 enabled / thresholdM /
//     strategy / intervalBaseMs / intervalMaxMs；
//   · enabled=true 壳就拉起服务，false 就停；页面重启后按同一份配置接管；
//   · 原生点坐标是 LocationManager 的 WGS-84，页面里记的是 GCJ-02（高德），
//     所以合并前必须换算，换算放在 locationAuto.ts 里做。
//
// 这里只做协议与本地存档，不含业务判断。

import { invoke, onBridgeEvent, type BridgeResult } from '../compat/bridge';

/** 壳读的就是这个键（LocationConfig 的注释里写死了），改名要两边一起改 */
export const AUTO_CONFIG_KEY = 'dr.autoLocation';
/** 原生点合并游标：已合并到的最大原生时间戳（ms），防止 getHistory 重放 */
export const AUTO_CURSOR_KEY = 'dr.autoLocation.cursor';

/** 连续打点策略：fixed = 每次固定 base；backoff = 同点连续 n 次后等 2^n 个 base（封顶 max） */
export type SampleStrategy = 'fixed' | 'backoff';

/** 采样的基准间隔与封顶：封顶 64s 对应 n=6，见 locationAuto.ts 的 nextSampleMs() */
export const INTERVAL_BASE_MS = 1000;
export const INTERVAL_MAX_MS = 64000;

export interface AutoLocationConfig {
  enabled: boolean;
  /** 去重阈值（米），0 = 每个点都记 */
  thresholdM: number;
  /** 旧壳（≤1.0.1）用的「位置在动」门槛；新壳已改用 strategy，保留只为不破坏旧组合 */
  moveThresholdM: number;
  strategy: SampleStrategy;
  intervalBaseMs: number;
  intervalMaxMs: number;
}

const DEFAULT_CONFIG: AutoLocationConfig = {
  enabled: false,
  thresholdM: 5,
  moveThresholdM: 10,
  strategy: 'backoff',
  intervalBaseMs: INTERVAL_BASE_MS,
  intervalMaxMs: INTERVAL_MAX_MS,
};

function normalizeStrategy(v: unknown): SampleStrategy {
  return v === 'fixed' ? 'fixed' : 'backoff';
}

/**
 * 壳有没有 location.* 这套能力——**不发问环境，只发问能力**：问一次
 * `location.status`，有人回就是有。
 *
 * 以前看的是壳注入时写在 <html> 上的标记（等于「是不是在壳里」），2026-10-26 删了：
 * 注入标记只说明适配脚本跑过，壳把定位整条删掉之后它照样是「已注入」，
 * 页面就永远误判成「壳里有原生服务」。现在三种环境一套答案：
 *   普通浏览器 → 没人回 → 页面定时器；老壳 → 回了 → 原生接管；
 *   删掉定位的新壳 → 回 ok:false → 页面定时器。
 *
 * 结果按「一次页面加载」缓存：探过就不再问，避免每次开打点都等一次网络往返。
 */
let nativeProbe: boolean | null = null;

export async function nativeLocationSupported(timeoutMs = 1500): Promise<boolean> {
  if (nativeProbe !== null) return nativeProbe;
  try {
    await nativeLocationStatus(timeoutMs);
    nativeProbe = true;
  } catch {
    nativeProbe = false;
  }
  return nativeProbe;
}

export function readAutoConfig(): AutoLocationConfig {
  try {
    const raw = localStorage.getItem(AUTO_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const o = JSON.parse(raw) as Partial<AutoLocationConfig>;
    const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    const threshold = num(o.thresholdM, DEFAULT_CONFIG.thresholdM);
    const base = num(o.intervalBaseMs, DEFAULT_CONFIG.intervalBaseMs);
    const max = num(o.intervalMaxMs, DEFAULT_CONFIG.intervalMaxMs);
    return {
      enabled: o.enabled === true,
      thresholdM: threshold >= 0 ? threshold : 0,
      moveThresholdM: num(o.moveThresholdM, DEFAULT_CONFIG.moveThresholdM),
      strategy: normalizeStrategy(o.strategy),
      intervalBaseMs: base > 0 ? base : DEFAULT_CONFIG.intervalBaseMs,
      intervalMaxMs: max >= base && max > 0 ? max : DEFAULT_CONFIG.intervalMaxMs,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 只写存档：壳在页面加载完会自己读，桥不通时也不影响下次启动 */
export function writeAutoConfig(cfg: AutoLocationConfig): void {
  try {
    localStorage.setItem(AUTO_CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式写不进就算了，原生那边拿不到就按默认值 */
  }
}

/**
 * 存档 + 推给壳。调用方对失败的处理：开始打点时失败要退回页面定时器，
 * 其它场景忽略即可。
 *
 * 调用前应当先过一遍 nativeLocationSupported()：那边探不到就直接别发，
 * 免得在没人接话的环境里白等一个超时。
 */
export function pushAutoConfig(cfg: AutoLocationConfig, timeoutMs = 6000): Promise<BridgeResult> {
  writeAutoConfig(cfg);
  return invoke('location.setConfig', { ...cfg }, timeoutMs);
}

export function nativeLocationStatus(timeoutMs = 4000): Promise<BridgeResult> {
  return invoke('location.status', {}, timeoutMs);
}

/**
 * 原生记的点（每台机器一份，不分文件）；拿不到就当没有。
 * 带上已合并到的游标当 since：新壳只回比它新的点，跑一整天也不用每次回传全量
 * （旧壳不认这个参数会忽略，照旧返回全部，网页这边有游标挡着重放）。
 */
export async function fetchNativeHistory(timeoutMs = 8000): Promise<unknown[]> {
  const r = await invoke('location.getHistory', { since: readCursor() }, timeoutMs);
  return Array.isArray(r.points) ? r.points : [];
}

/** 原生每记一个点推一次；返回取消订阅 */
export function onNativePoint(cb: (point: unknown) => void): () => void {
  return onBridgeEvent('location.point', cb);
}

export function readCursor(): number {
  try {
    const n = Number(localStorage.getItem(AUTO_CURSOR_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeCursor(ts: number): void {
  try {
    localStorage.setItem(AUTO_CURSOR_KEY, String(ts));
  } catch {
    /* ignore */
  }
}
