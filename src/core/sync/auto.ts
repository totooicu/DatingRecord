// 自动同步服务：开软件自启动，之后自己按两种节拍跑一趟——
//   · 定时：每 N 分钟一趟（把别的设备的改动拉回来，也把本机改动推上去）
//   · 有变化就同步：本机写过东西、且已经安静了一会儿，就补一趟
//
// 「开软件时先拉齐一次」以前是个死设置（nutstore.auto 存了没人读），这里就是它的使用方。
//
// 为什么不会自己喂自己：同步引擎往库里补的那些（合并进来的行、补算的指纹、baseline、
// last_at）都在 db/persist.ts 的 syncWrite() 里，不计入「本机欠着没传」；
// 只有真成功了才把对齐点推到快照那一刻（见 engine.syncNow）。所以一趟跑完
// pendingLocalWrites() 归零，不会再触发下一趟。
//
// 失败不丢改动：失败那趟不做对齐，下一拍（退避 retryMs 之后）接着传同一批内容。
// 唯一的代价是同一时刻只许一趟（engine 里排队），手动点同步时这一拍直接跳过。

import { bump } from '../../store';
import { lastUserWriteAt, pendingLocalWrites } from '../db';
import {
  isServiceAutostart,
  registerService,
  setServiceAutostart,
  setServiceDetail,
  setServiceNote,
  setServiceRunning,
} from '../runtime/store';
import { isSyncing, syncNow } from './engine';
import { isConfigured, loadSettings, saveSettings, toConfig, type NutstoreSettings } from './settings';

export const AUTO_SERVICE_ID = 'nutstore-sync';

/** 这一趟是谁叫起来的，用来说给用户听的话 */
export type PassReason = 'boot' | 'timer' | 'change';
const REASON_TEXT: Record<PassReason, string> = {
  boot: '开软件',
  timer: '定时',
  change: '本机改动',
};
const ACTION_TEXT: Record<string, string> = {
  upload: '已传本机改动',
  download: '已拉云端改动',
  both: '已合并两边改动',
  noop: '两边一致',
};

/**
 * 节拍参数。默认值是给人用的；测试里把 minuteMs / quietMs 调小，
 * 不然「每 1 分钟」就得真等 60 秒。生产代码一律不传。
 */
export interface AutoTuning {
  /** 隔多久看一眼该不该跑 */
  tickMs: number;
  /** 本机最后一次写入安静多久才算「改完了」 */
  quietMs: number;
  /** 失败后的退避：这段时间内不再重试，免得对着一台报错的服务端猛打 */
  retryMs: number;
  /** 设置里「1 分钟」到底是多长（正常是 60000） */
  minuteMs: number;
}
const DEFAULT_TUNING: AutoTuning = {
  tickMs: 15_000,
  quietMs: 60_000,
  retryMs: 300_000,
  minuteMs: 60_000,
};

interface AutoState {
  timer: ReturnType<typeof setInterval> | null;
  tuning: AutoTuning;
  passing: boolean;
  lastPassAt: number;
  lastOkAt: number;
  lastReason: PassReason | null;
  lastAction: string | null;
  lastError: string | null;
  nextRetryAt: number;
  passes: number;
}

const st: AutoState = {
  timer: null,
  tuning: DEFAULT_TUNING,
  passing: false,
  lastPassAt: 0,
  lastOkAt: 0,
  lastReason: null,
  lastAction: null,
  lastError: null,
  nextRetryAt: 0,
  passes: 0,
};

export interface AutoStatus {
  /** 服务在跑（有定时器在按节拍看一眼） */
  running: boolean;
  /** 设置里的总开关 */
  enabled: boolean;
  everyMin: number;
  onChanged: boolean;
  /** 账号是否填齐：没填的话 startAutoSync 起不来 */
  configured: boolean;
  /** 本机欠着没传的写入次数（0 = 和上次成功同步时一致） */
  pendingWrites: number;
  lastPassAt: number;
  lastOkAt: number;
  lastReason: PassReason | null;
  lastAction: string | null;
  lastError: string | null;
  /** 失败退避到什么时候（毫秒时间戳，0 = 没在退避） */
  nextRetryAt: number;
  /** 这个会话里自动跑了几趟 */
  passes: number;
  /** 下一趟最早可能什么时候跑（定时与改动两个条件取早的） */
  nextAt: number;
}

export function autoStatus(s: NutstoreSettings = loadSettings()): AutoStatus {
  const now = Date.now();
  const everyMs = s.everyMin * st.tuning.minuteMs;
  const byTimer = s.everyMin > 0 && st.lastPassAt > 0 ? st.lastPassAt + everyMs : s.everyMin > 0 ? now : 0;
  const byChange = s.onChanged && pendingLocalWrites() > 0 ? lastUserWriteAt() + st.tuning.quietMs : 0;
  const cands = [byTimer, byChange].filter((x) => x > 0);
  return {
    running: st.timer !== null,
    enabled: s.auto,
    everyMin: s.everyMin,
    onChanged: s.onChanged,
    configured: isConfigured(s),
    pendingWrites: pendingLocalWrites(),
    lastPassAt: st.lastPassAt,
    lastOkAt: st.lastOkAt,
    lastReason: st.lastReason,
    lastAction: st.lastAction,
    lastError: st.lastError,
    nextRetryAt: st.nextRetryAt,
    passes: st.passes,
    // 服务没起来就别说「下一趟几点跑」，否则看着像它在等
    nextAt: st.timer !== null && cands.length ? Math.max(Math.min(...cands), st.nextRetryAt) : 0,
  };
}

/**
 * App 启动时注册（交出启动函数，让 restoreAutostartServices() 点名）。
 *
 * 开关只有一个真相：库里的 nutstore.auto。服务页那个「自启动」checkbox 存的是
 * 浏览器 localStorage，两边不一致就会出现「服务页关着、坚果云页开着」这种说不清的
 * 状态，所以注册完立刻以库为准覆写一次存档。
 */
export function registerAutoSyncService(): void {
  const on = loadSettings().auto;
  registerService(
    {
      id: AUTO_SERVICE_ID,
      kind: 'sync',
      title: '坚果云自动同步',
      running: st.timer !== null,
      autostart: on,
      note: on ? undefined : '未开启自动同步',
      target: { type: 'settings', key: 'sync' },
    },
    () => {
      startAutoSync();
    },
  );
  if (isServiceAutostart(AUTO_SERVICE_ID) !== on) setServiceAutostart(AUTO_SERVICE_ID, on);
}

export function isAutoRunning(): boolean {
  return st.timer !== null;
}

/**
 * 起服务。账号没填就不起（并留一句话说明为什么起不来），返回 false。
 * 已经在跑时再调一次只换节拍参数，不会重复补一趟开软件同步。
 */
export function startAutoSync(tuning: Partial<AutoTuning> = {}): boolean {
  const s = loadSettings();
  if (!isConfigured(s)) {
    setServiceRunning(AUTO_SERVICE_ID, false);
    setServiceNote(AUTO_SERVICE_ID, '还没填坚果云账号，自动同步起不来');
    return false;
  }
  const wasRunning = st.timer !== null;
  st.tuning = { ...st.tuning, ...tuning };
  if (st.timer !== null) clearInterval(st.timer);
  st.timer = setInterval(tick, st.tuning.tickMs);
  setServiceNote(AUTO_SERVICE_ID, undefined);
  setServiceRunning(AUTO_SERVICE_ID, true);
  if (!wasRunning) void runPass('boot', s);
  return true;
}

export function stopAutoSync(): void {
  if (st.timer !== null) {
    clearInterval(st.timer);
    st.timer = null;
  }
  setServiceRunning(AUTO_SERVICE_ID, false, '已停止');
  setServiceDetail(AUTO_SERVICE_ID, undefined);
}

/**
 * 总开关（设置页 checkbox / 服务页自启动 / system.setAutoSync 三条路都走这里）。
 *
 * @param draft 界面上还没点「保存设置」的编辑一并存进去：否则用户填完账号直接勾自动同步，
 *              这次勾选反而会把刚填的账号覆盖成库里的旧值。
 */
export function setAutoEnabled(on: boolean, draft: NutstoreSettings = loadSettings()): void {
  const next: NutstoreSettings = { ...draft, auto: on };
  saveSettings(next);
  setServiceAutostart(AUTO_SERVICE_ID, on);
  // 上面已经把 next 落进 meta 了，startAutoSync 自己会读到，不必再传一遍
  if (on) startAutoSync();
  else stopAutoSync();
}

/** 每拍只做「该不该跑」的判断，跑不跑都不阻塞 */
function tick(): void {
  // 上一趟还在跑、或用户正在手动同步：这一拍直接跳过，不排队（下一拍再看）
  if (st.passing || isSyncing()) return;
  const s = loadSettings();
  if (!isConfigured(s)) {
    // 账号被清掉了：自己停掉，别再按节拍起来
    stopAutoSync();
    setServiceNote(AUTO_SERVICE_ID, '还没填坚果云账号，自动同步已停');
    return;
  }
  const now = Date.now();
  if (st.nextRetryAt > now) return;
  const everyMs = s.everyMin * st.tuning.minuteMs;
  const byTimer = s.everyMin > 0 && now - st.lastPassAt >= everyMs;
  const byChange = s.onChanged && pendingLocalWrites() > 0 && now - lastUserWriteAt() >= st.tuning.quietMs;
  if (!byTimer && !byChange) return;
  void runPass(byChange ? 'change' : 'timer', s);
}

async function runPass(reason: PassReason, s: NutstoreSettings = loadSettings()): Promise<void> {
  st.passing = true;
  st.lastReason = reason;
  st.passes += 1;
  st.lastPassAt = Date.now();
  setServiceDetail(AUTO_SERVICE_ID, `${REASON_TEXT[reason]} · 正在同步…`);
  try {
    const r = await syncNow(toConfig(s), { attachments: s.attachments });
    st.lastOkAt = Date.now();
    st.lastAction = r.action;
    st.lastError = null;
    st.nextRetryAt = 0;
    setServiceNote(AUTO_SERVICE_ID, undefined);
    setServiceDetail(AUTO_SERVICE_ID, `${REASON_TEXT[reason]} · ${ACTION_TEXT[r.action] ?? r.action}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    st.lastError = msg;
    st.nextRetryAt = Date.now() + st.tuning.retryMs;
    setServiceNote(AUTO_SERVICE_ID, `自动同步失败：${msg}`);
    setServiceDetail(AUTO_SERVICE_ID, `${REASON_TEXT[reason]} · 失败`);
  } finally {
    st.passing = false;
    // 这一趟可能把云端的改动合了进来、或补回了附件字节：开着页面的地方要重查
    bump();
  }
}
