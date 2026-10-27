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
// 实测两条，改这块之前先知道（见壳仓库 docs/LOCATION_BACKGROUND.md 第八、九节）：
//   · `location.status` 除 tracking/points/rev/lastFixAt 外还回 `intervalCurrentMs`
//     （壳此刻实际用的间隔，退避是否真在走就看它）、`ticks`、`diag`、`journalBytes`；
//   · 前台服务 + 唤醒锁 + 电池加白 三件套齐了也可能被整段冻住——国产 ROM 的
//     「后台行为」不放行时照样停摆，放行后同一台机 tick 覆盖率从 15% 回到 98%。
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

/**
 * 取证模式（0.3.1-tune 起，壳侧 docs/LOCATION_BACKGROUND.md）：壳把采样强制压成
 * 每秒一次并把每一拍写进 files/bg_journal.jsonl，用来回答「后台这一秒到底发生了什么」。
 *
 * 三条必须知道的副作用：
 *   · 开着它 `strategy` / `intervalBaseMs` / `intervalMaxMs` 都不生效——间隔被钉在 1s，
 *     退避不会长（`nextInterval()` 第一条分支就是 diag）；
 *   · 开着它壳拒绝停：页面推 `enabled:false` 会被顶回 `enabled:true`，回包带
 *     `keptForDiag=true`（否则账本当场断流，看着跟睡着一样）；
 *   · `location.setConfig` 不带 `diag` 时壳沿用现状，不会把正在进行的取证静默关掉。
 */
export function nativeSetDiag(on: boolean, timeoutMs = 12000): Promise<BridgeResult> {
  return invoke('location.setDiag', { on }, timeoutMs);
}

/** 账本一行（ kinds：tick|skip|fix|fail|screen|provider|start|stop|taskRemoved|destroy|diag|probe|wake ） */
export interface NativeJournalLine {
  /** 落笔时刻（墙钟 ms） */
  t: number;
  k: string;
  /** 行号 */
  n?: number;
  /** 当时的 provider */
  p?: string;
  /** 唤醒锁是否在手上 */
  wl?: boolean;
  f?: number;
  x?: number;
  pts?: number;
  diag?: boolean;
  /** skip/fail 的原因：pending-fix | timeout | wakelock-lost | requestSingleUpdate | wake-resume-blocked */
  why?: string;
  waitMs?: number;
  /** start/stop 是谁按的：page | system-restart | … */
  enabled?: boolean;
  /** 屏幕事件名（android.intent.action.SCREEN_OFF 等） */
  what?: string;
  lat?: number;
  lng?: number;
  acc?: number;
  /** probe 行：三个时钟各走了多久（判「整机深睡」还是「进程被冻」） */
  gapWall?: number;
  gapUp?: number;
  gapEl?: number;
  idle?: boolean;
  light?: boolean;
  saver?: boolean;
  gpsOn?: boolean;
  netOn?: boolean;
  interactive?: boolean;
  opt?: boolean;
  bat?: number;
  plugged?: boolean;
  /** wake 行：闹钟比预定晚了多少 ms */
  late?: number;
}

export interface NativeJournal {
  lines: NativeJournalLine[];
  /** 账本总行数 / 字节数（tail 裁过之后仍能报全量） */
  total: number;
  bytes: number;
  /** 壳自启动以来的累计 tick 计数 */
  ticks: number;
  diag: boolean;
  tracking: boolean;
}

/**
 * 读壳的逐秒账本。`since` 只要比它新的行；`tail` 最多回多少行。
 * 判读口径见 public/location-lab 的「休眠分析」：先看有没有 2.5 秒以上的空档，
 * 再看空档两头有没有 stop 行，最后用 probe / wake 分清「整机深睡」「进程被冻」「线程没被调度」。
 */
export async function fetchNativeJournal(
  opts: { since?: number; tail?: number } = {},
  timeoutMs = 20000,
): Promise<NativeJournal> {
  const r = await invoke('location.journal', { since: opts.since ?? 0, tail: opts.tail ?? 20000 }, timeoutMs);
  const raw = Array.isArray(r.lines) ? r.lines : [];
  return {
    lines: raw as NativeJournalLine[],
    total: Number(r.total) || raw.length,
    bytes: Number(r.bytes) || 0,
    ticks: Number(r.ticks) || 0,
    diag: r.diag === true,
    tracking: r.tracking === true,
  };
}

export function clearNativeJournal(timeoutMs = 8000): Promise<BridgeResult> {
  return invoke('location.clearJournal', {}, timeoutMs);
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
