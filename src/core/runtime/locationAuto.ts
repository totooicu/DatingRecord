// 自动打点后台服务单例：每秒取一次 GPS，按去重阈值写回 .drloc 文件。
//
// 定时器和数据都在单例里——离开定位面板照样打点（这才是「服务」），
// head 上常驻图标，服务页显示运行中。面板只是订阅式视图。
//
// 数据文件是文件库里的 .drloc（见 core/location/format.ts）：
//   · points 存原始坐标，offset 记这个文件的经纬度修正量；
//   · 显示 / 落图时统一 applyOffset()，改偏移就能整体平移；
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
  type LocationDoc,
  type LocationOffset,
  type LocationPoint,
} from '../location/format';
import { registerService, setServiceNote, setServiceRunning } from './store';

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
  /** 点的结构版本：新增 / 删除 / 换文件时 +1（去重只改最后一条的时间不算，地图不必重画） */
  rev: number;
  offset: LocationOffset;
  /** 当前 GPS 位置：地图上的蓝点 */
  current: CurrentFix | null;
  /** 去重阈值（米）：位移小于它只刷新时间戳，不新增点 */
  threshold: number;
  running: boolean;
  /** 手动打点定位中 */
  busy: boolean;
  /** 写回文件的状态 */
  saving: SaveState;
}

let state: LocationAutoState = {
  fileId: null,
  fileName: '',
  doc: null,
  rows: [],
  rev: 0,
  offset: { lat: 0, lng: 0 },
  current: null,
  threshold: 5,
  running: false,
  busy: false,
  saving: 'idle',
};

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

/** 地图 / 列表用：原始点加上文件偏移 */
export function correctedRows(s: LocationAutoState = state): LocationPoint[] {
  return applyOffset(s.rows, s.offset);
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

/** 取一次位置并更新蓝点 */
async function readFix(): Promise<CurrentFix> {
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

function registerAutoService(running: boolean): void {
  registerService({
    id: SERVICE_ID,
    kind: 'location',
    title: '自动打点',
    running,
    autostart: false, // 打点要先选文件，不开机自启
    target: { type: 'settings', key: 'panelLocation' },
  });
  setServiceRunning(SERVICE_ID, running);
}

/** 开机注册：服务页一开始就列得出「自动打点」（未运行），并恢复上次文件 */
export function initLocationAutoService(): void {
  registerAutoService(state.running);
  void restoreLastFile();
}

async function restoreLastFile(): Promise<void> {
  const id = getActiveLocationId();
  if (!id) return;
  const f = getLocationFile(id);
  if (!f) {
    setActiveLocationId(null);
    return;
  }
  patch({ fileId: f.id, fileName: f.name });
  try {
    const doc = await readLocation(f);
    if (state.fileId !== f.id) return;
    patch({ doc, rows: doc.points, rev: state.rev + 1, offset: doc.offset, saving: 'idle' });
  } catch {
    // 文件损坏：宁可回到未选择状态，也不拿空队列覆盖它
    if (state.fileId === f.id) {
      setActiveLocationId(null);
      patch({ fileId: null, fileName: '', doc: null, rows: [], rev: state.rev + 1, offset: { lat: 0, lng: 0 }, saving: 'idle' });
    }
  }
}

// ---- 面板 → 单例 的操作 ----

/** 打开 / 新建后把文件与正文灌进单例；id=null 表示卸下当前文件 */
export function openLocationFile(id: string | null, name: string, doc: LocationDoc | null): void {
  setActiveLocationId(id);
  if (!id || !doc) {
    stopAuto();
    patch({ fileId: null, fileName: '', doc: null, rows: [], rev: state.rev + 1, offset: { lat: 0, lng: 0 }, saving: 'idle' });
    return;
  }
  patch({
    fileId: id,
    fileName: name,
    doc,
    rows: doc.points,
    rev: state.rev + 1,
    offset: doc.offset,
    saving: 'idle',
  });
}

export function setThreshold(m: number): void {
  patch({ threshold: Number.isFinite(m) && m >= 0 ? m : 0 });
}

function normalizeOffset(offset: LocationOffset): LocationOffset {
  const r = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0);
  return { lat: r(offset.lat), lng: r(offset.lng) };
}

/** 写入串行链：自动打点与偏移调整按顺序落盘，后写不会被先写盖回去 */
let saveChain: Promise<void> = Promise.resolve();

function persist(doc: LocationDoc): Promise<void> {
  const id = state.fileId;
  if (!id) return saveChain;
  const snapshot: LocationDoc = { ...doc, points: [...doc.points] };
  const rev = state.offset.lat + state.offset.lng + snapshot.points.length;
  patch({ saving: 'saving' });
  saveChain = saveChain.then(async () => {
    try {
      await writeLocation(id, snapshot);
      if (state.fileId === id && state.offset.lat + state.offset.lng + state.rows.length === rev) {
        patch({ saving: 'saved' });
      }
    } catch {
      if (state.fileId === id) patch({ saving: 'error' });
    }
  });
  return saveChain;
}

/** 修改文件偏移：原始点不动，只改 offset 并写回 */
export async function setLocationOffset(offset: LocationOffset): Promise<void> {
  const doc = state.doc;
  if (!doc) return;
  const next: LocationDoc = { ...doc, offset: normalizeOffset(offset) };
  patch({ doc: next, offset: next.offset });
  await persist(next);
}

export interface PunchResult {
  point: LocationPoint;
  /** 点落在行数组里的下标：去重替换最后一条时也指向最后一条，面板据此选中 */
  index: number;
}

/** 手动打点：取一次位置，带去重，写回；返回新行与下标（面板用来飞地图 / 选中） */
export async function punch(note: string): Promise<PunchResult | null> {
  if (!state.fileId || !state.doc) return null;
  patch({ busy: true });
  try {
    const fix = await readFix();
    const r: LocationPoint = {
      ts: fix.ts,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      note: note.trim(),
    };
    const { points, added } = appendPoint(state.rows, r, state.threshold);
    const doc: LocationDoc = { ...state.doc, points };
    patch({ rows: points, doc, rev: added ? state.rev + 1 : state.rev, busy: false });
    await persist(doc);
    return { point: points[points.length - 1], index: points.length - 1 };
  } catch {
    patch({ busy: false });
    throw new Error('定位失败');
  }
}

/** 「我的位置」：只刷新蓝点，不写文件；失败返回 null */
export async function locateMe(): Promise<CurrentFix | null> {
  try {
    return await readFix();
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

function appendPoint(
  rows: LocationPoint[],
  r: LocationPoint,
  threshold: number,
): { points: LocationPoint[]; added: boolean } {
  const last = rows[rows.length - 1];
  if (last && distM(last, r) < threshold) {
    const next = [...rows];
    next[next.length - 1] = { ...last, ts: r.ts, accuracy: r.accuracy };
    return { points: next, added: false };
  }
  return { points: [...rows, r], added: true };
}

// ---- 自动打点（后台服务本体） ----

let timer: number | null = null;
/** 原地打点（去重命中）只在内存里刷新时间，最多这么久落一次盘，避免每秒整篇重写 */
let lastFlush = 0;
const FLUSH_MS = 15000;

function tick(): void {
  readFix()
    .then(async (fix) => {
      if (!state.fileId || !state.doc) return;
      const r: LocationPoint = {
        ts: fix.ts,
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        note: '',
      };
      const { points, added } = appendPoint(state.rows, r, state.threshold);
      const doc: LocationDoc = { ...state.doc, points };
      patch({ rows: points, doc, rev: added ? state.rev + 1 : state.rev });
      setServiceNote(SERVICE_ID, undefined);
      const now = Date.now();
      if (added || now - lastFlush >= FLUSH_MS) {
        lastFlush = now;
        await persist(doc);
      }
    })
    .catch(() => {
      // 定位失败不打断服务：在服务状态上留个说明，下一秒再试
      setServiceNote(SERVICE_ID, '上一次定位失败，重试中');
    });
}

export function startAuto(): boolean {
  if (!state.fileId) return false;
  if (timer) return true;
  timer = window.setInterval(tick, 1000);
  tick();
  patch({ running: true });
  registerAutoService(true);
  return true;
}

export function stopAuto(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // 停止 / 切文件前把「原地刷新」的最后一条时间戳也落盘
  if (state.doc) void persist(state.doc);
  patch({ running: false });
  setServiceRunning(SERVICE_ID, false);
  setServiceNote(SERVICE_ID, undefined);
}
