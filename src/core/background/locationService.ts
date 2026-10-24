// 自动打点服务核心逻辑（全局，不随组件卸载）。
//
// 启动时：读 localStorage 里的 fileId 和阈值，自动开始打点。

import { getBlob } from '../db/blob';
import { getFile, overwriteFileContent } from '../repo/files';

interface Row {
  ts: string;
  lat: number;
  lng: number;
  accuracy: number;
  note: string;
}

function toCsv(rows: Row[]): string {
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

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((p) => p.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];
    if (parts.length < 3) continue;
    const lat = Number(parts[1]);
    const lng = Number(parts[2]);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    out.push({ ts: parts[0], lat, lng, accuracy: Number(parts[3]) || 0, note: parts[4] || '' });
  }
  return out;
}

function distM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

let rows: Row[] = [];
let fileId: string | null = null;
let threshold = 20; // 默认 20 米，GPS 静止漂移范围内

function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('不支持定位')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

async function writeBack() {
  if (!fileId) return;
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  await overwriteFileContent(fileId, blob);
}

async function tick() {
  if (!fileId) return;
  try {
    const pos = await getPosition();
    const last = rows[rows.length - 1];
    if (last && distM(last, pos) < threshold) {
      // 同一点：刷新最后一条时间戳，不新增
      rows[rows.length - 1] = { ...last, ts: new Date().toISOString(), accuracy: pos.accuracy };
    } else {
      rows.push({
        ts: new Date().toISOString(), lat: pos.lat, lng: pos.lng,
        accuracy: pos.accuracy, note: '',
      });
    }
    await writeBack();
  } catch {
    // 定位失败忽略，下一秒再试
  }
}

let timer: number | null = null;

/** 手动打点（组件里调），追加一条记录 */
export async function manualRecord(note: string): Promise<Row | null> {
  if (!fileId) return null;
  try {
    const pos = await getPosition();
    const last = rows[rows.length - 1];
    if (last && distM(last, pos) < threshold) {
      rows[rows.length - 1] = { ...last, ts: new Date().toISOString(), note: note || last.note };
    } else {
      rows.push({
        ts: new Date().toISOString(), lat: pos.lat, lng: pos.lng,
        accuracy: pos.accuracy, note,
      });
    }
    await writeBack();
    return rows[rows.length - 1];
  } catch {
    return null;
  }
}

/** 打开/切换文件：加载 CSV 到全局 rows */
export async function openFile(fid: string): Promise<number> {
  const blob = await getBlob(fid);
  if (!blob) return 0;
  fileId = fid;
  rows = parseCsv(await blob.text());
  return rows.length;
}

export async function startLocationService(): Promise<boolean> {
  if (timer) return true;
  if (!fileId) {
    // 从 localStorage 恢复
    const saved = localStorage.getItem('dr.locationFileId');
    if (!saved || !getFile(saved)) return false;
    await openFile(saved);
  }
  const savedThreshold = Number(localStorage.getItem('dr.locationThreshold'));
  if (isFinite(savedThreshold) && savedThreshold > 0) threshold = savedThreshold;
  tick();
  timer = window.setInterval(tick, 1000);
  return true;
}

export function stopLocationService() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function isLocationServiceRunning(): boolean {
  return timer !== null;
}

export function getServiceRows(): Row[] { return rows; }
export function getServiceFileId(): string | null { return fileId; }
export function setServiceThreshold(t: number) { threshold = Math.max(1, t || 1); }
export function setServiceFileId(fid: string | null) { fileId = fid; }
