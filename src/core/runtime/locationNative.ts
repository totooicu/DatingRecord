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
//     会主动读一次，所以即使页面没调桥，原生也有最新的 enabled / thresholdM；
//   · enabled=true 壳就拉起服务，false 就停；页面重启后按同一份配置接管；
//   · 原生点坐标是 LocationManager 的 WGS-84，页面里记的是 GCJ-02（高德），
//     所以合并前必须换算，换算放在 locationAuto.ts 里做。
//
// 这里只做协议与本地存档，不含业务判断。

import { bridgeDiagnostics, invoke, onBridgeEvent, type BridgeResult } from '../compat/bridge';

/** 壳读的就是这个键（LocationConfig 的注释里写死了），改名要两边一起改 */
export const AUTO_CONFIG_KEY = 'dr.autoLocation';
/** 原生点合并游标：已合并到的最大原生时间戳（ms），防止 getHistory 重放 */
export const AUTO_CURSOR_KEY = 'dr.autoLocation.cursor';

export interface AutoLocationConfig {
  enabled: boolean;
  /** 去重阈值（米），0 = 每个点都记 */
  thresholdM: number;
  /** 位移超过它算「位置在动」，壳用它切快频 */
  moveThresholdM: number;
}

const DEFAULT_CONFIG: AutoLocationConfig = { enabled: false, thresholdM: 5, moveThresholdM: 10 };

/** 桥在不在：壳的适配脚本会把标记写在 <html> 上，普通浏览器里没有 */
export function nativeLocationAvailable(): boolean {
  return bridgeDiagnostics().injected;
}

export function readAutoConfig(): AutoLocationConfig {
  try {
    const raw = localStorage.getItem(AUTO_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const o = JSON.parse(raw) as Partial<AutoLocationConfig>;
    const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    const threshold = num(o.thresholdM, DEFAULT_CONFIG.thresholdM);
    return {
      enabled: o.enabled === true,
      thresholdM: threshold >= 0 ? threshold : 0,
      moveThresholdM: num(o.moveThresholdM, DEFAULT_CONFIG.moveThresholdM),
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
 * 存档 + 推给壳。桥不在（普通浏览器）只存档，返回 resolved。
 * 调用方对失败的处理：开始打点时失败要退回页面定时器，其它场景忽略即可。
 */
export function pushAutoConfig(cfg: AutoLocationConfig, timeoutMs = 6000): Promise<BridgeResult> {
  writeAutoConfig(cfg);
  if (!nativeLocationAvailable()) return Promise.resolve({});
  return invoke('location.setConfig', { ...cfg }, timeoutMs);
}

export function nativeLocationStatus(timeoutMs = 4000): Promise<BridgeResult> {
  return invoke('location.status', {}, timeoutMs);
}

/** 原生记的全部点（每台机器一份，不分文件）；拿不到就当没有 */
export async function fetchNativeHistory(timeoutMs = 8000): Promise<unknown[]> {
  const r = await invoke('location.getHistory', {}, timeoutMs);
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
