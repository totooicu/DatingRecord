// 自动打点后台服务单例：按打点策略取 GPS，按写策略写回 .drloc 文件。
//
// 定时器和数据都在单例里——离开定位面板照样打点（这才是「服务」），
// head 上常驻图标，服务页显示运行中。面板只是订阅式视图。
//
// 服务分五层，每层只做一件事（改哪层不会牵动别的层）：
//
//   ① 获取定位      acquireFix()      → 坐标；失败就抛，不掺写的事
//   ② 带策略的写文件 writeFixWithPolicy() → 坐标进来就落，阈值 / 当前文件它自己认
//   ③ 连续获取定位  sampleOnce()      → 按打点策略取一次坐标，交给 ②
//   ④ 服务处理函数  runAutoService()  → 从内存读注册信息（③ + 参数），把服务跑起来
//   ⑤ 服务自启动    initLocationAutoService() → 从浏览器读自启动注册与参数写进内存，
//                                      再唤醒 ④
//
// 手动打点（面板按钮）只调 ① + ②：拿到坐标就写，拿不到就丢弃并弹窗，不写半个点。
// ② 的阈值和文件都不用调用方管：文件 id 在浏览器（dr.locationFileId），
// 阈值 / 策略在浏览器（dr.autoLocation），是用户在面板保存时就写进去的。
//
// 在安卓壳里则换成壳的前台服务记：页面定时器退到后台会被冻住，壳里的
// LocationTrackingService 不会。页面把配置推下去、把原生记的点合并回文件，
// 细节见 core/runtime/locationNative.ts。
//
// 数据文件是文件库里的 .drloc（见 core/location/format.ts）：
//   · points 存原始坐标，offset 记整份文件的经纬度修正量；
//   · offsets 记分段修正：从某个点起到下一个锚点前按段内偏移平移；
//   · 显示 / 落图时统一 applyOffset()，改偏移就能平移，原始点不动；
//   · 写回串行化（saveChain），偏移调整和自动打点不会互相覆盖。

import { useEffect, useState } from 'react';
import {
  getActiveLocationId,
  getLocationFile,
  readLocation,
  setActiveLocationId,
  writeLocation,
} from '../location/locationFile';
import {
  applyOffset,
  removeOffsetSegment,
  upsertOffsetSegment,
  type LocationDoc,
  type LocationOffset,
  type LocationPoint,
  type OffsetSegment,
} from '../location/format';
import {
  isServiceAutostart,
  registerService,
  setServiceAutostart,
  setServiceNote,
  setServiceRunning,
} from './store';
import {
  fetchNativeHistory,
  INTERVAL_BASE_MS,
  INTERVAL_MAX_MS,
  nativeLocationAvailable,
  nativeLocationStatus,
  onNativePoint,
  pushAutoConfig,
  readAutoConfig,
  readCursor,
  writeAutoConfig,
  writeCursor,
  type AutoLocationConfig,
  type SampleStrategy,
} from './locationNative';

export const SERVICE_ID = 'location-auto';

/** 一次实时定位结果：蓝点用它，不进文件（打点时才追加） */
export interface CurrentFix {
  ts: string;
  lat: number;
  lng: number;
  accuracy: number;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface LocationAutoState {
  fileId: string | null;
  fileName: string;
  doc: LocationDoc | null;
  /** 原始点（未加偏移），和 doc.points 同源 */
  rows: LocationPoint[];
  /** 点的结构版本：新增 / 顶替 / 删除 / 换文件时 +1
   *  （顶替会换掉最后一个点的坐标，不只是时间，所以地图要重画） */
  rev: number;
  offset: LocationOffset;
  /** 分段修正：和 doc.offsets 同源，按锚点升序 */
  offsets: OffsetSegment[];
  /** 当前 GPS 位置：地图上的蓝点 */
  current: CurrentFix | null;
  /** 去重阈值（米）：新点与「倒数第二个点」的距离小于它时，顶掉最后一个点，不新增 */
  threshold: number;
  /** 连续打点策略：定时 / 同点指数退避（壳按同一份规则记） */
  strategy: SampleStrategy;
  /** 连续落在同一个点的次数：新点归零，每次合并 +1；退避的指数 n 就是它 */
  streak: number;
  running: boolean;
  /** 跑在壳的原生服务上（页面定时器已让位），面板据此提示「退到后台也继续」 */
  native: boolean;
  /** 手动打点定位中 */
  busy: boolean;
  /** 写回文件的状态 */
  saving: SaveState;
  /** 上次选的文件内容是否已在单例里就绪（打点前必须为真，否则会把旧点覆盖掉） */
  fileReady: boolean;
}

let state: LocationAutoState = {
  fileId: null,
  fileName: '',
  doc: null,
  rows: [],
  rev: 0,
  offset: { lat: 0, lng: 0 },
  offsets: [],
  current: null,
  threshold: 5,
  strategy: 'backoff',
  streak: 0,
  running: false,
  native: false,
  busy: false,
  saving: 'idle',
  fileReady: false,
};

/**
 * 最后一次真正落到文件里的点的时间（原生点、页面采样都算）。
 * 判「壳是不是在假跑」只看这个：壳的 status 说 tracking:true 不代表真在记——
 * 壳的前台服务一启动就把 isRunning 置真，可一个点都还没推过来。
 */
let lastPointAt = 0;

/** 原地打点（去重命中）只在内存里刷新时间，最多这么久落一次盘，避免每秒整篇重写 */
let lastFlush = 0;
const FLUSH_MS = 15000;

const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}
function patch(p: Partial<LocationAutoState>): void {
  state = { ...state, ...p };
  emit();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLocationAuto(): LocationAutoState {
  return state;
}

/** 订阅式读取（仿 store.ts 的 useStore） */
export function useLocationAuto(): LocationAutoState {
  const [val, setVal] = useState<LocationAutoState>(() => state);
  useEffect(() => {
    const update = () => setVal(state);
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return val;
}

/** 地图 / 列表用：原始点按「整份偏移 + 分段修正」后的坐标 */
export function correctedRows(s: LocationAutoState = state): LocationPoint[] {
  return applyOffset(s.rows, s.offset, s.offsets);
}

// ---- 定位（高德优先，回退浏览器原生；WGS-84 → GCJ-02） ----

export function getAmapKey(): string {
  try {
    return localStorage.getItem('dr.amapKey') || '';
  } catch {
    return '';
  }
}

export function setAmapKey(key: string): void {
  try {
    localStorage.setItem('dr.amapKey', key.trim());
  } catch {
    /* ignore */
  }
}

let amapLoading: Promise<any> | null = null;
function loadAmap(): Promise<any> {
  const key = getAmapKey();
  if (!key) return Promise.reject(new Error('未配置高德 key'));
  if ((window as any).AMap) return Promise.resolve((window as any).AMap);
  if (amapLoading) return amapLoading;
  amapLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps/v=1.4.15&key=${key}`;
    s.onload = () => resolve((window as any).AMap);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return amapLoading;
}

function fallbackBrowser(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('不支持定位'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        resolve({ lat: gcj.lat, lng: gcj.lng, accuracy: pos.coords.accuracy });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return loadAmap()
    .then(
      (AMap) =>
        new Promise<{ lat: number; lng: number; accuracy: number }>((resolve, reject) => {
          AMap.plugin('AMap.Geolocation', () => {
            const g = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 });
            g.getCurrentPosition((status: string, result: any) => {
              if (status === 'complete' && result.position) {
                resolve({ lat: result.position.lat, lng: result.position.lng, accuracy: result.accuracy || 0 });
              } else {
                fallbackBrowser().then(resolve, reject);
              }
            });
          });
        }),
    )
    .catch(() => fallbackBrowser());
}

/**
 * ① 获取定位：取一次坐标（高德优先、回退浏览器原生），顺手刷新地图蓝点。
 * 定位失败直接抛——失败了要不要写是调用方的事，这一层不掺：
 * 手动打点因此丢弃并弹窗，连续打点因此跳过这一轮、按退避档重试。
 */
export async function acquireFix(): Promise<CurrentFix> {
  const pos = await getPosition();
  const fix: CurrentFix = { ts: new Date().toISOString(), lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy };
  patch({ current: fix });
  return fix;
}

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;
function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8899 || lat > 55.8271;
}
function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((y / 12.0) * PI) + 300 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
  if (outOfChina(lat, lng)) return { lat, lng };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/** 两点间距离（米），haversine */
function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---- 服务注册 ----

/**
 * 供 store 在「应用加载完毕后统一恢复自启动」时调用的启动函数。
 * 没选文件时拉不起来（打点要落点），留个说明等用户在面板选了文件再说；
 * 文件内容还在读就静默等——restoreLastFile 读完会按 bootResume 唤醒 ④。
 */
function startAutoService(): void {
  if (!state.fileId) {
    setServiceNote(SERVICE_ID, '未选择打点文件，暂无法自启动');
    return;
  }
  if (!state.fileReady) return;
  runAutoService();
}

function registerAutoService(running: boolean): void {
  // autostart 由 registerService 内部以存档为准覆盖，这里传 false 即可；
  // start 交出启动函数，开软件时 restoreAutostartServices() 统一点名恢复。
  registerService(
    {
      id: SERVICE_ID,
      kind: 'location',
      title: '自动打点',
      running,
      autostart: false,
      target: { type: 'settings', key: 'panelLocation' },
    },
    startAutoService,
  );
  setServiceRunning(SERVICE_ID, running);
}

/** 服务页「自启动」开关的写入口：落 store 存档 + 同步服务行。 */
export function setAutoServiceAutostart(on: boolean): void {
  setServiceAutostart(SERVICE_ID, on);
  // 用户在面板已经选好文件、此刻想立刻生效就把服务拉起来；
  // 没选文件时先记偏好，等选了文件再起（restoreLastFile 会触发）。
  if (on && state.fileId && state.fileReady && !state.running) startAuto();
}

let visibilityWatched = false;

/** ⑤ 从浏览器读出来的「这次开机要不要把服务拉起来」，写进内存给 ④ 用 */
let bootResume = false;

/**
 * ⑤ 服务自启动函数：软件加载完毕后自动调用。
 *
 * 它从浏览器读注册的自启动服务与参数（阈值 / 策略 / 上次是否在跑 / 用户有没有开
 * 自启动）写进内存，最后唤醒 ④ 服务处理函数——文件正文读出来之后才唤醒，
 * 因为读到一半就写会把旧点冲掉。
 *
 * 注册时一律按「未运行」登记：真把服务拉起来了才算 running。之前注册就把
 * running 记成「待恢复」，服务页会显示「运行中」而实际上一个点都没在记，
 * 这正是「刷新后打点没反应」最难看出来的地方——界面看着好好的。
 */
export function initLocationAutoService(): void {
  const cfg = readAutoConfig();
  bootResume = cfg.enabled || isServiceAutostart(SERVICE_ID);
  // 阈值 / 策略归浏览器存档：刷新后接着上次的值，和推给壳的是同一个数
  if (cfg.thresholdM !== state.threshold) patch({ threshold: cfg.thresholdM });
  if (cfg.strategy !== state.strategy) patch({ strategy: cfg.strategy });
  // 按内存里真实的运行态登记（重复 init 也不会把已在跑的服务标成未运行）
  registerAutoService(state.running);
  void restoreLastFile();
  if (!visibilityWatched) {
    visibilityWatched = true;
    document.addEventListener('visibilitychange', () => {
      // 挂起期间事件收不到，回到前台补一次历史；游标保证不重放
      if (document.visibilityState === 'visible' && state.native) void mergeNativeHistory();
    });
  }
}


/** 恢复上次的文件；正文读完、fileReady 为真之后才唤醒 ④ 拉起服务 */
async function restoreLastFile(): Promise<void> {
  const id = getActiveLocationId();
  if (!id) {
    if (bootResume) setServiceNote(SERVICE_ID, '未选择打点文件，无法自启动连续打点');
    return;
  }
  const f = getLocationFile(id);
  if (!f) {
    setActiveLocationId(null);
    if (bootResume) setServiceNote(SERVICE_ID, '未选择打点文件，无法自启动连续打点');
    return;
  }
  patch({ fileId: f.id, fileName: f.name });
  try {
    const doc = await readLocation(f);
    if (state.fileId !== f.id) return;
    patch({ doc, rows: doc.points, rev: state.rev + 1, offset: doc.offset, offsets: doc.offsets, saving: 'idle', fileReady: true });
    // 内容读完了才允许自动打点——否则先写空会把旧点覆盖掉。
    // 走 ④：壳在就让壳记，壳不在就页面定时器，两条路都有兜底，不会「刷新后死寂」。
    if (bootResume) runAutoService();
    // 原生在跑而这里是刚读出文件：把挂起期间记的点补进来
    if (state.native) void mergeNativeHistory();
  } catch {
    // 文件损坏：宁可回到未选择状态，也不拿空队列覆盖它
    if (state.fileId === f.id) {
      setActiveLocationId(null);
      patch({ fileId: null, fileName: '', doc: null, rows: [], rev: state.rev + 1, offset: { lat: 0, lng: 0 }, offsets: [], saving: 'idle', fileReady: false });
    }
  }
}

// ---- 面板 → 单例 的操作 ----

/** 打开 / 新建后把文件与正文灌进单例；id=null 表示卸下当前文件 */
export function openLocationFile(id: string | null, name: string, doc: LocationDoc | null): void {
  setActiveLocationId(id);
  if (!id || !doc) {
    stopAuto();
    patch({ fileId: null, fileName: '', doc: null, rows: [], rev: state.rev + 1, offset: { lat: 0, lng: 0 }, offsets: [], saving: 'idle', fileReady: false });
    return;
  }
  patch({
    fileId: id,
    fileName: name,
    doc,
    rows: doc.points,
    rev: state.rev + 1,
    offset: doc.offset,
    offsets: doc.offsets,
    saving: 'idle',
    fileReady: true,
  });
  // 切文件时原生可能已经记了一些点：游标挡掉重复，新的补进来
  if (state.native) void mergeNativeHistory();
}

export function setThreshold(m: number): void {
  const next = Number.isFinite(m) && m >= 0 ? m : 0;
  patch({ threshold: next });
  // 阈值也归页面这边存档：壳在页面加载完会读 dr.autoLocation，
  // 页面这边的输入框每次按键都会走到这里，所以桥调用压一下抖动。
  writeAutoConfig(configOf(state.running));
  scheduleConfigPush();
  // 运行中改阈值要「即时生效」：把已排程的下一次采样提前（退避计数清零，
  // 按基准间隔立刻采一次），之后的退避节奏按实际位移重新累计。
  // 和 setSampleStrategy 一个路子；壳跑时由壳自己调度，这里不插手。
  if (state.running && !state.native) {
    patch({ streak: 0 });
    armNextTick();
  }
}

/** 切换连续打点策略；正在跑时立刻按新规则安排下一次采样 */
export function setSampleStrategy(s: SampleStrategy): void {
  if (s === state.strategy) return;
  patch({ strategy: s, streak: 0 });
  writeAutoConfig(configOf(state.running));
  scheduleConfigPush();
  if (state.running && !state.native) {
    armNextTick();
  } else if (state.running && state.native) {
    // 原生模式下切策略：顺手确认壳还在不在记，不在就立刻退回页面定时器，
    // 否则 native:true 压着页面定时器、壳又不推点，切到哪种策略都「没反应」。
    void nativeLocationStatus(2000)
      .then((st) => {
        if (!(st && st.tracking === true)) startNativeTrack();
      })
      .catch(() => startNativeTrack());
  }
}

/**
 * 连续打点的采样间隔：a) 定时 → 恒为 base；b) 同点退避 → base·2^n，封顶 max。
 * n = 连续落在同一个点的次数（streak），新点归零。
 * 例（base=1s，max=64s）：1,1,1,2,4,8,16,32,64,64,64…
 */
export function nextSampleMs(streak: number, strategy: SampleStrategy): number {
  if (strategy === 'fixed') return INTERVAL_BASE_MS;
  // 指数钳一下，避免 2^n 溢出；超过 max 之后本来也是常数
  const n = Math.min(Math.max(0, Math.floor(streak)), 20);
  return Math.min(INTERVAL_BASE_MS * 2 ** n, INTERVAL_MAX_MS);
}

// ---- 与壳的配置同步（location.* 桥） ----

/** 「位置在动」的门槛：只给 ≤1.0.1 的旧壳切 1s / 30s / 60s 用，新壳看 strategy */
const MOVE_THRESHOLD_M = 10;

function configOf(enabled: boolean): AutoLocationConfig {
  return {
    enabled,
    thresholdM: state.threshold,
    moveThresholdM: MOVE_THRESHOLD_M,
    strategy: state.strategy,
    intervalBaseMs: INTERVAL_BASE_MS,
    intervalMaxMs: INTERVAL_MAX_MS,
  };
}

let configPushTimer: number | null = null;

/** 只用于阈值这种连续输入：存档已同步写，桥调用合并成一次 */
function scheduleConfigPush(): void {
  if (!nativeLocationAvailable()) return;
  if (configPushTimer) window.clearTimeout(configPushTimer);
  configPushTimer = window.setTimeout(() => {
    configPushTimer = null;
    void pushAutoConfig(configOf(state.running)).catch(() => {
      setServiceNote(SERVICE_ID, '壳没有响应定位配置，下次开始打点时会重试');
    });
  }, 400);
}

function normalizeOffset(offset: LocationOffset): LocationOffset {
  const r = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0);
  return { lat: r(offset.lat), lng: r(offset.lng) };
}

/** 写入串行链：自动打点与偏移调整按顺序落盘，后写不会被先写盖回去 */
let saveChain: Promise<void> = Promise.resolve();

/** 落盘期间的变更哨兵：偏移 / 分段 / 点数任一变了，旧一次写回的「已保存」就不算数 */
function offsetSignature(doc: LocationDoc): string {
  return `${doc.offset.lat},${doc.offset.lng}|${doc.offsets
    .map((s) => `${s.fromIndex}:${s.lat},${s.lng}`)
    .join(';')}|${doc.points.length}`;
}

function persist(doc: LocationDoc): Promise<void> {
  const id = state.fileId;
  if (!id) return saveChain;
  const snapshot: LocationDoc = { ...doc, points: [...doc.points] };
  const sig = offsetSignature(snapshot);
  patch({ saving: 'saving' });
  saveChain = saveChain.then(async () => {
    try {
      await writeLocation(id, snapshot);
      const cur = state.doc;
      const unchanged = cur != null && offsetSignature({ ...cur, offsets: state.offsets }) === sig;
      if (state.fileId === id && unchanged) {
        patch({ saving: 'saved' });
      }
    } catch {
      if (state.fileId === id) patch({ saving: 'error' });
    }
  });
  return saveChain;
}

/** 修改整份文件偏移：原始点不动，只改 offset 并写回 */
export async function setLocationOffset(offset: LocationOffset): Promise<void> {
  const doc = state.doc;
  if (!doc) return;
  const next: LocationDoc = { ...doc, offset: normalizeOffset(offset) };
  patch({ doc: next, offset: next.offset });
  await persist(next);
}

/**
 * 分段修正：给第 fromIndex 个点（0 基）起填一段偏移，到下一个锚点前生效。
 * 原始点不动；同锚点再填就是改这一段，删段走 removeLocationOffsetSegment。
 */
export async function setLocationOffsetSegment(fromIndex: number, offset: LocationOffset): Promise<void> {
  const doc = state.doc;
  if (!doc || !Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= state.rows.length) return;
  const segments = upsertOffsetSegment(state.offsets, fromIndex, normalizeOffset(offset));
  const next: LocationDoc = { ...doc, offsets: segments };
  patch({ doc: next, offsets: segments });
  await persist(next);
}

/** 删掉第 fromIndex 个点起的修正段 */
export async function removeLocationOffsetSegment(fromIndex: number): Promise<void> {
  const doc = state.doc;
  if (!doc) return;
  const segments = removeOffsetSegment(state.offsets, fromIndex);
  const next: LocationDoc = { ...doc, offsets: segments };
  patch({ doc: next, offsets: segments });
  await persist(next);
}

export interface PunchResult {
  point: LocationPoint;
  /** 点落在行数组里的下标：去重替换最后一条时也指向最后一条，面板据此选中 */
  index: number;
}

/** 写的结果：added=false 表示这一点顶掉了最后一个点，行数没变 */
interface WriteResult {
  point: LocationPoint;
  index: number;
  added: boolean;
}

/**
 * ② 带策略的写定位文件：给一个坐标就写，其余一概自己认——
 *
 *   · 写哪个文件：当前激活的（id 存在浏览器 dr.locationFileId，不用调用方传）；
 *   · 阈值多少：从浏览器 dr.autoLocation 现读（用户在面板保存时就写进去了），
 *     所以这里和壳那边永远是同一个数，不会两边去重标准不一致；
 *   · 怎么去重：走 appendPoint 的写策略（跟倒数第二个点比距离，近了就顶掉末点）。
 *
 * 调用方（手动打点 / 连续采样）无脑调即可。传进来的坐标只可能是 ① 拿到的真坐标：
 * 定位失败压根不该调到这里，失败了就丢弃 + 弹窗，不写半个点。
 *
 * force=true 表示立刻落盘（手动打点要「已保存」的确定感）；连续采样走节流，
 * 原地顶替的最多攒 FLUSH_MS 再写，免得每秒整篇重写。
 */
async function writeFixWithPolicy(fix: CurrentFix, note: string, force = false): Promise<WriteResult | null> {
  const doc0 = state.doc;
  if (!state.fileId || !doc0) return null;
  // 阈值以浏览器存档为准：面板改了会写进去，壳读的也是这一份
  const cfg = readAutoConfig();
  if (cfg.thresholdM !== state.threshold) patch({ threshold: cfg.thresholdM });
  const r: LocationPoint = {
    ts: fix.ts,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    note: note.trim(),
  };
  const { points, added } = appendPoint(state.rows, r, cfg.thresholdM);
  const doc: LocationDoc = { ...doc0, points };
  // 顶替也换掉了最后一个点的坐标，所以 rev 一律 +1（地图要重画）
  patch({ rows: points, doc, rev: state.rev + 1 });
  lastPointAt = Date.now();
  const now = Date.now();
  if (force || added || now - lastFlush >= FLUSH_MS) {
    lastFlush = now;
    await persist(doc);
  }
  return { point: points[points.length - 1], index: points.length - 1, added };
}

/** 手动打点：① 获取定位 → ② 带策略的写；返回新行与下标（面板用来飞地图 / 选中）。
 *  定位失败就抛，由面板弹窗——不写、不重试、不留半个点。 */
export async function punch(note: string): Promise<PunchResult | null> {
  if (!state.fileId || !state.doc) return null;
  patch({ busy: true });
  try {
    const fix = await acquireFix();
    const r = await writeFixWithPolicy(fix, note, true);
    patch({ busy: false });
    if (!r) return null;
    return { point: r.point, index: r.index };
  } catch {
    patch({ busy: false });
    throw new Error('定位失败');
  }
}

/** 「我的位置」：只刷新蓝点，不写文件；失败返回 null */
export async function locateMe(): Promise<CurrentFix | null> {
  try {
    return await acquireFix();
  } catch {
    return null;
  }
}

/** 删除一个点；返回删除后的点数，下标越界返回 null */
export async function removePoint(index: number): Promise<number | null> {
  if (!state.doc || !Number.isInteger(index) || index < 0 || index >= state.rows.length) return null;
  const points = state.rows.filter((_, i) => i !== index);
  const doc: LocationDoc = { ...state.doc, points };
  patch({ rows: points, doc, rev: state.rev + 1 });
  await persist(doc);
  return points.length;
}

/**
 * 写策略（去重 / 顶替）——用户 2026-10-26 定稿。
 *
 * 和「倒数第二个点 a」比距离，**不是**和最后一个点 b 比。
 * 跟 b 比并顶掉 b 会让最后一个点被一路推着往前挪（漂移），轨迹塌成首尾：
 * 序列 1 2 3 4 5 6、阈值 d=1.9 会只剩 1 和 6，中间的几何全丢。
 * 跟 a 比则锚点固定，只有真正离开锚点超过阈值才落新点，几何得以保留。
 *
 *   点数 < 2  → 没有锚点可比，直接追加
 *   |a - c|<d → c 整个顶掉最后一个点 b（坐标 / 时间 / 精度全用 c 的），added=false
 *   否则      → 追加 c，added=true
 */
function appendPoint(
  rows: LocationPoint[],
  r: LocationPoint,
  threshold: number,
): { points: LocationPoint[]; added: boolean } {
  const anchor = rows.length >= 2 ? rows[rows.length - 2] : null;
  if (anchor && distM(anchor, r) < threshold) {
    const next = [...rows];
    next[next.length - 1] = { ...r };
    return { points: next, added: false };
  }
  return { points: [...rows, r], added: true };
}

// ---- 壳的原生连续定位（location.* 桥） ----
//
// 壳里跑的时候，页面定时器退到后台会被冻住，所以连续记录交给壳的前台服务；
// 页面收事件、补历史，再走上面同一个 appendPoint 落进当前文件。
// 坐标要换：原生给的是 WGS-84，页面记的是 GCJ-02（高德底图）。

let nativeUnsub: (() => void) | null = null;

function toNativePoint(raw: unknown): { ms: number; point: LocationPoint } | null {
  const o = (raw ?? {}) as {
    ts?: unknown;
    lat?: unknown;
    lng?: unknown;
    accuracy?: unknown;
    note?: unknown;
  };
  const ms = typeof o.ts === 'number' ? o.ts : typeof o.ts === 'string' ? Date.parse(o.ts) : Number.NaN;
  if (!Number.isFinite(ms) || typeof o.lat !== 'number' || typeof o.lng !== 'number') return null;
  const gcj = wgs84ToGcj02(o.lat, o.lng);
  return {
    ms,
    point: {
      ts: new Date(ms).toISOString(),
      lat: gcj.lat,
      lng: gcj.lng,
      accuracy: typeof o.accuracy === 'number' && o.accuracy > 0 ? o.accuracy : 0,
      note: typeof o.note === 'string' ? o.note.trim() : '',
    },
  };
}

/** 事件与历史可能同时到：串成一条链，按到达顺序一条条过 appendPoint */
let mergeChain: Promise<void> = Promise.resolve();

function mergeNativePoints(rawList: unknown[]): Promise<void> {
  mergeChain = mergeChain.then(() => doMergeNative(rawList)).catch(() => {
    /* 单次失败不打断后续：游标没动，下次历史还会把点带回来 */
  });
  return mergeChain;
}

async function doMergeNative(rawList: unknown[]): Promise<void> {
  const base = state.doc;
  if (!base || !state.fileId) return;
  const cursor = readCursor();
  let rows = state.rows;
  let added = false;
  let newest = cursor;
  for (const raw of rawList) {
    const p = toNativePoint(raw);
    // 游标按时间戳：getHistory 每次返回全量，重放的点在这里被挡掉
    if (!p || p.ms <= cursor) continue;
    const r = appendPoint(rows, p.point, state.threshold);
    rows = r.points;
    added = added || r.added;
    if (p.ms > newest) newest = p.ms;
  }
  if (newest === cursor) return;
  const doc: LocationDoc = { ...base, points: rows };
  patch({ rows, doc, rev: state.rev + 1 });
  // 壳确实在记（有更新的点到了），看门狗据此不判它假跑
  lastPointAt = Date.now();
  const now = Date.now();
  if (added || now - lastFlush >= FLUSH_MS) {
    lastFlush = now;
    await persist(doc);
  }
  // 游标落盘放在最后：写失败时下次还能从历史里补回来
  writeCursor(newest);
}

async function mergeNativeHistory(): Promise<void> {
  try {
    const points = await fetchNativeHistory();
    if (points.length > 0) await mergeNativePoints(points);
  } catch {
    /* 旧壳没有 location.* 或暂时拿不到：事件到了照样合 */
  }
}

function attachNative(): void {
  if (nativeUnsub) return;
  nativeUnsub = onNativePoint((data) => {
    void mergeNativePoints([data]);
  });
  // 从这一刻起给壳 NATIVE_SILENT_MS 的冷启时间：首次定位本来就要几秒，
  // 别一上来就判它假跑（GPS 冷启慢是常态）
  lastPointAt = Date.now();
  patch({ running: true, native: true });
  registerAutoService(true);
  setServiceNote(SERVICE_ID, '由壳的原生服务记录，退到后台也继续');
  startNativeWatchdog();
  void mergeNativeHistory();
}

function detachNative(): void {
  nativeUnsub?.();
  nativeUnsub = null;
  stopNativeWatchdog();
  if (state.native) patch({ native: false });
}

/**
 * 让页面定时器接管，但**不断开**壳的事件订阅：壳要是回魂了，它推的点照样合并进
 * 来（游标 + 写策略挡重复），不至于白丢一段轨迹。只有停止服务才真断开。
 */
function yieldToPageTimer(note: string): void {
  stopNativeWatchdog();
  nativeFailStreak = 0;
  silentStreak = 0;
  // 万一还留着上一次页面定时器的排程，先清掉，保证下面的 startPageTimer 能真跑起来
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  patch({ native: false });
  setServiceNote(SERVICE_ID, note);
  startPageTimer();
}

/** 壳里开始打点：乐观接管（点亮原生界面 + 订阅事件），把配置推下去；
 *  壳到底在不在记，交给原生看门狗在宽限期内确认——不在才退回页面定时器。
 *  不在 startNativeTrack 里立刻退回，是因为壳读 dr.autoLocation 自起服务需要时间，
 *  刚刷新时桥 / 服务可能还没就绪，过早退回会让「壳和页面双记」。 */
function startNativeTrack(): void {
  attachNative();
  startNativeWatchdog();
  void pushAutoConfig(configOf(true), 8000)
    .then((r) => {
      // 壳明确回了、但服务没真起来（缺权限等）：这是确定性的「壳现在记不了」，
      // 立即退回页面定时器（此时壳也不会按 dr.autoLocation 自起，不会双记）。
      if (r.tracking === true) return;
      yieldToPageTimer('壳的定位服务没起来（可能没授权定位），已退回页面定时器记录');
    })
    .catch(() => {
      // 配置没推到壳（桥还没就绪 / 超时）：不急着重退，交给看门狗在宽限期内再确认，
      // 避免刚刷新时壳正按 dr.autoLocation 自起服务，过早退回会「双记」。
      setServiceNote(SERVICE_ID, '壳暂时没响应定位配置，正在重试');
    });
}

// ---- 原生看门狗 ----
//
// 原生模式最怕「壳静默停了 / 根本没在记」：权限被收回、被系统杀后台、桥断了，
// 页面却还停在 native:true——armNextTick 早退不排程、壳又不推点，于是「连续打点
// 没反应」，界面还显示运行中。这就是刷新后打不上点的根因。
//
// 判据有两条，任何一条成立就退回页面定时器：
//
//   A 壳自己说没在记（status.tracking !== true）——连续 N 次确认，宽限期给壳
//     按 dr.autoLocation 自起服务留时间，避免过早退回导致双记。
//   B 壳说在记，但 NATIVE_SILENT_MS 了一个点都没到——「假跑」。壳的前台服务一
//     启动就把 isRunning 置真，可定位源可能压根没给它点（没授权 / 冷启失败），
//     于是 status 永远 tracking:true，页面却永远等不到点。这时候先补一次历史
//     （挂起期间可能真记了，只是事件没送到），补不到才确认假跑、退回页面定时器。
//
// 退回只是让页面定时器接管，不断开事件订阅：壳回魂了点照样合并，不会白丢一段。

let nativeWatchdog: number | null = null;
let nativeFailStreak = 0;
let silentStreak = 0;
const NATIVE_WATCHDOG_MS = 6000;
const NATIVE_FAIL_LIMIT = 3; // 连续 3 次（约 18s）没在记录才退，壳冷起通常几秒就好
/** 壳说在记、却这么久一个点都没到 → 怀疑假跑（GPS 冷启慢是常态，别设太短） */
const NATIVE_SILENT_MS = 25000;
const NATIVE_SILENT_LIMIT = 2; // 补过历史仍无新点，再确认一次（约 12s）就退

function startNativeWatchdog(): void {
  if (nativeWatchdog !== null) return;
  nativeWatchdog = window.setInterval(() => {
    // 不在原生模式（退回页面定时器或已停止）就自停，别空转
    if (!state.running || !state.native) {
      stopNativeWatchdog();
      return;
    }
    void nativeLocationStatus(2000)
      .then(async (st) => {
        const tracking = st?.tracking === true;
        const silent = Date.now() - lastPointAt > NATIVE_SILENT_MS;
        if (tracking && !silent) {
          nativeFailStreak = 0;
          silentStreak = 0;
          return;
        }
        if (tracking) {
          // 假跑嫌疑：先补一次历史，补到了就说明壳确实在记（挂起期间只进了历史）
          await mergeNativeHistory();
          if (Date.now() - lastPointAt <= NATIVE_SILENT_MS) {
            silentStreak = 0;
            return;
          }
          silentStreak += 1;
          if (silentStreak >= NATIVE_SILENT_LIMIT) {
            yieldToPageTimer('壳一直没推点，已退回页面定时器记录（退到后台会暂停）');
          }
          return;
        }
        nativeFailStreak += 1;
        if (nativeFailStreak >= NATIVE_FAIL_LIMIT) {
          yieldToPageTimer('壳的定位服务没在记录，已退回页面定时器（退到后台会暂停）');
        }
      })
      .catch(() => {
        nativeFailStreak += 1;
        if (nativeFailStreak >= NATIVE_FAIL_LIMIT) {
          yieldToPageTimer('壳没有响应定位状态，已退回页面定时器（退到后台会暂停）');
        }
      });
  }, NATIVE_WATCHDOG_MS);
}

function stopNativeWatchdog(): void {
  if (nativeWatchdog !== null) {
    window.clearInterval(nativeWatchdog);
    nativeWatchdog = null;
  }
  nativeFailStreak = 0;
  silentStreak = 0;
}


// ---- 自动打点（后台服务本体） ----

let timer: number | null = null;

/** 按当前 streak / 策略安排下一次采样；停用或已交给壳时什么也不做 */
function armNextTick(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  if (!state.running || state.native) return;
  timer = window.setTimeout(() => {
    timer = null;
    void sampleOnce();
  }, nextSampleMs(state.streak, state.strategy));
}

/**
 * ③ 连续获取定位：按打点策略取一次坐标，交给 ② 写。
 * 定位失败这一轮就跳过（留个说明），按当前退避档重试——服务不因此停摆。
 * 拿到点没有新增（被顶替）就把「同点连击」+1，下次间隔翻倍；新增则清零。
 */
async function sampleOnce(): Promise<void> {
  try {
    const fix = await acquireFix();
    const r = await writeFixWithPolicy(fix, '');
    setServiceNote(SERVICE_ID, undefined);
    if (r) patch({ streak: r.added ? 0 : state.streak + 1 });
  } catch {
    // 定位失败或文件没就绪：不打断服务，留个说明，下一轮照常
    setServiceNote(SERVICE_ID, '上一次定位失败，重试中');
  } finally {
    armNextTick();
  }
}

function startPageTimer(): void {
  if (timer !== null) return;
  patch({ running: true, native: false, streak: 0 });
  registerAutoService(true);
  // 先立刻取一次（第一个点不该等），之后由 sampleOnce 按策略接力
  void sampleOnce();
}

/**
 * ④ 服务处理函数：从内存（单例）里读注册信息——处理函数是 ③ 连续获取定位，
 * 参数是当前文件与打点策略——然后把它跑起来。
 *
 * 壳在就交给壳的前台服务（退到后台 / 熄屏不断），不在就用页面定时器。
 * 没选文件或内容还没读出来就什么都不做：这时候写会把旧点冲掉。
 * 已经在跑也不重复起（定时器 / 原生订阅都只能有一份）。
 */
function runAutoService(): void {
  if (!state.fileId || !state.fileReady || state.running) return;
  if (nativeLocationAvailable()) {
    // 壳里：交给原生前台服务，WebView 退到后台 / 熄屏都不会断
    startNativeTrack();
    return;
  }
  writeAutoConfig(configOf(true));
  startPageTimer();
}

export function startAuto(): boolean {
  if (!state.fileId || !state.fileReady) return false;
  if (state.running) return true;
  runAutoService();
  return true;
}

export function stopAuto(): void {
  if (configPushTimer) {
    window.clearTimeout(configPushTimer);
    configPushTimer = null;
  }
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  // 停止 / 切文件前把「原地刷新」的最后一条时间戳也落盘
  if (state.doc) void persist(state.doc);
  const wasNative = nativeUnsub !== null;
  detachNative();
  // 存档与壳同步：enabled=false 壳会立刻停前台服务
  if (wasNative || nativeLocationAvailable()) {
    void pushAutoConfig(configOf(false)).catch(() => {
      // 旧壳没有 location.*：本来就没在跑原生服务，不必报错
      if (wasNative) setServiceNote(SERVICE_ID, '停止指令没送达壳，原生服务可能还在记录');
    });
  } else {
    writeAutoConfig(configOf(false));
  }
  patch({ running: false, streak: 0 });
  setServiceRunning(SERVICE_ID, false);
  setServiceNote(SERVICE_ID, undefined);
}
