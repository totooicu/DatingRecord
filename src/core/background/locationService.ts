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
let threshold = 5;

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

async function tick() {
  if (!fileId) return;
  try {
    const pos = await getPosition();
    const last = rows[rows.length - 1];
    let next: Row[];
    if (last && distM(last, pos) < threshold) {
      next = [...rows];
      next[next.length - 1] = { ...last, ts: new Date().toISOString(), accuracy: pos.accuracy };
    } else {
      next = [...rows, {
        ts: new Date().toISOString(), lat: pos.lat, lng: pos.lng,
        accuracy: pos.accuracy, note: '',
      }];
    }
    rows = next;
    const blob = new Blob([toCsv(next)], { type: 'text/csv;charset=utf-8' });
    await overwriteFileContent(fileId, blob);
  } catch {
    // 定位失败忽略，下一秒再试
  }
}

let timer: number | null = null;

export async function startLocationService(): Promise<boolean> {
  if (timer) return true;
  try {
    fileId = localStorage.getItem('dr.locationFileId');
    if (!fileId || !getFile(fileId)) return false;
    const savedThreshold = Number(localStorage.getItem('dr.locationThreshold'));
    if (isFinite(savedThreshold) && savedThreshold >= 0) threshold = savedThreshold;
    const blob = await getBlob(fileId);
    if (!blob) return false;
    rows = parseCsv(await blob.text());
    tick();
    timer = window.setInterval(tick, 1000);
    return true;
  } catch {
    return false;
  }
}

export function stopLocationService() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function isLocationServiceRunning(): boolean {
  return timer !== null;
}

export function getServiceRows(): Row[] { return rows; }
export function getServiceFileId(): string | null { return fileId; }
export function setServiceThreshold(t: number) { threshold = t; }
