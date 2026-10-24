// 自动打点后台服务单例：每秒取一次 GPS，按去重阈值写回 CSV。
//
// 定时器和数据都在单例里——离开定位面板照样打点（这才是「服务」），
// head 上常驻图标，服务页显示运行中。面板只是订阅式视图。

import { useEffect, useState } from 'react';
import { getBlob } from '../db/blob';
import { getFile, overwriteFileContent } from '../repo/files';
import { registerService, setServiceNote, setServiceRunning } from './store';

export const SERVICE_ID = 'location-auto';

export interface Row {
  ts: string;
  lat: number;
  lng: number;
  accuracy: number;
  note: string;
}

export interface LocationAutoState {
  fileId: string | null;
  fileName: string;
  rows: Row[];
  /** 去重阈值（米）：位移小于它只刷新时间戳，不新增点 */
  threshold: number;
  running: boolean;
  /** 手动打点定位中 */
  busy: boolean;
}

let state: LocationAutoState = {
  fileId: null,
  fileName: '',
  rows: [],
  threshold: 5,
  running: false,
  busy: false,
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

// ---- 定位（高德优先，回退浏览器原生；WGS-84 → GCJ-02） ----

function getAmapKey(): string {
  try {
    return localStorage.getItem('dr.amapKey') || '';
  } catch {
    return '';
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

// ---- CSV ----

export function toCsv(rows: Row[]): string {
  const head = '时间,纬度,经度,精度(米),备注\n';
  const body = rows
    .map((r) => {
      const d = new Date(r.ts);
      const t = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
      return `"${t}",${r.lat.toFixed(6)},${r.lng.toFixed(6)},${Math.round(r.accuracy)},"${r.note.replace(/"/g, '""')}"`;
    })
    .join('\n');
  return head + body + '\n';
}

export function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts =
      lines[i]
        .match(/("([^"]|"")*"|[^,]*)(,|$)/g)
        ?.map((p) => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];
    if (parts.length < 3) continue;
    const lat = Number(parts[1]);
    const lng = Number(parts[2]);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    out.push({ ts: parts[0], lat, lng, accuracy: Number(parts[3]) || 0, note: parts[4] || '' });
  }
  return out;
}

// ---- 服务注册 ----

function registerAutoService(running: boolean): void {
  registerService({
    id: SERVICE_ID,
    kind: 'location',
    title: '自动打点',
    running,
    autostart: false, // 打点要用户先选文件，不开机自启
    target: { type: 'settings', key: 'panelLocation' },
  });
  setServiceRunning(SERVICE_ID, running);
}

/** 开机注册：服务页一开始就列得出「自动打点」（未运行） */
export function initLocationAutoService(): void {
  registerAutoService(state.running);
  restoreLastFile();
}

/** 恢复上次选的文件（localStorage 记忆） */
function restoreLastFile(): void {
  let id: string | null = null;
  try {
    id = localStorage.getItem('dr.locationFileId') || null;
  } catch {
    /* ignore */
  }
  if (!id) return;
  const f = getFile(id);
  if (!f) return;
  patch({ fileId: f.id, fileName: f.name });
  getBlob(f.id).then((blob) => {
    if (!blob) return;
    blob.text().then((text) => patch({ rows: parseCsv(text) }));
  });
}

// ---- 面板 → 单例 的操作 ----

/** 新建 / 打开 / 切换文件后调用：把文件与初始行灌进单例 */
export function setAutoFile(id: string | null, name: string, rows: Row[]): void {
  patch({ fileId: id, fileName: name, rows });
  try {
    if (id) localStorage.setItem('dr.locationFileId', id);
    else localStorage.removeItem('dr.locationFileId');
  } catch {
    /* ignore */
  }
  if (!id) stopAuto();
}

export function setThreshold(m: number): void {
  patch({ threshold: Number.isFinite(m) && m >= 0 ? m : 0 });
}

/** 手动打点：取一次位置，带去重，写回；返回新行（面板用来飞地图） */
export async function punch(note: string): Promise<Row | null> {
  if (!state.fileId) return null;
  patch({ busy: true });
  try {
    const pos = await getPosition();
    const r: Row = {
      ts: new Date().toISOString(),
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy,
      note: note.trim(),
    };
    const next = appendRow(state.rows, r, state.threshold);
    patch({ rows: next, busy: false });
    await writeBack(next);
    return next[next.length - 1];
  } catch {
    patch({ busy: false });
    throw new Error('定位失败');
  }
}

/** 「我的位置」：只取一次坐标（不写点），面板用来飞地图；失败返回 null */
export async function locateMe(): Promise<{ lat: number; lng: number } | null> {
  try {
    const pos = await getPosition();
    return { lat: pos.lat, lng: pos.lng };
  } catch {
    return null;
  }
}

function appendRow(rows: Row[], r: Row, threshold: number): Row[] {
  const last = rows[rows.length - 1];
  if (last && distM(last, r) < threshold) {
    const next = [...rows];
    next[next.length - 1] = { ...last, ts: r.ts, accuracy: r.accuracy };
    return next;
  }
  return [...rows, r];
}

async function writeBack(rows: Row[]): Promise<void> {
  if (!state.fileId) return;
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  await overwriteFileContent(state.fileId, blob);
}

// ---- 自动打点（后台服务本体） ----

let timer: number | null = null;

function tick(): void {
  getPosition()
    .then(async (pos) => {
      if (!state.fileId) return;
      const r: Row = {
        ts: new Date().toISOString(),
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        note: '',
      };
      const next = appendRow(state.rows, r, state.threshold);
      patch({ rows: next });
      setServiceNote(SERVICE_ID, undefined);
      await writeBack(next);
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
  patch({ running: false });
  setServiceRunning(SERVICE_ID, false);
  setServiceNote(SERVICE_ID, undefined);
}
