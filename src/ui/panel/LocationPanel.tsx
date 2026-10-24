// 功能面板 · 定位（记录 + 地图合并页）。
//
// 一页搞定：选/建 CSV 文件 → 地图上看轨迹 → 点「记录位置」打点写回 CSV，
// 点「我的位置」地图飞到当前 GPS。

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getFile, overwriteFileContent, type StoredFile } from '../../core/repo/files';
import { getBlob } from '../../core/db/blob';
import { uploadFile } from '../../core/files';
import { FilesPanel } from '../files';
import { showToast as toast } from '../toast';

function getAmapKey(): string {
  try { return localStorage.getItem('dr.amapKey') || ''; } catch { return ''; }
}
let amapLoading: Promise<any> | null = null;
function loadAmap(): Promise<any> {
  const key = getAmapKey();
  if (!key) return Promise.reject(new Error('未配置高德 key'));
  if ((window as any).AMap) return Promise.resolve((window as any).AMap);
  if (amapLoading) return amapLoading;
  amapLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${key}`;
    s.onload = () => resolve((window as any).AMap);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return amapLoading;
}

/** 优先用高德定位，失败回退浏览器原生 */
function getPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return loadAmap().then(
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
  ).catch(() => fallbackBrowser());
}

function fallbackBrowser(): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('不支持定位')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

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

export function LocationPanel() {
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [auto, setAuto] = useState(false);
  const [threshold, setThreshold] = useState(5); // 米
  const [amapKey, setAmapKey] = useState(() => getAmapKey());
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  // 用 ref 存最新 rows/fileId，避免 setInterval 闭包拿旧值
  const rowsRef = useRef<Row[]>([]);
  const fileIdRef = useRef<string | null>(null);
  rowsRef.current = rows;
  fileIdRef.current = fileId;

  const current = fileId ? getFile(fileId) : null;

  // 初始化地图
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#d9536b;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
    mapRef.current = L.map(containerRef.current).setView([30.2741, 120.1551], 12);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '© 高德地图',
    }).addTo(mapRef.current);
    (mapRef.current as any)._drIcon = icon;
    setTimeout(() => mapRef.current?.invalidateSize(), 100);
  }, []);

  // 数据变化重画
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    map.eachLayer((layer) => { if (!(layer instanceof L.TileLayer)) map.removeLayer(layer); });
    if (rows.length === 0) return;
    const latlngs = rows.map((r) => [r.lat, r.lng] as [number, number]);
    L.polyline(latlngs, { color: '#d9536b', weight: 2, opacity: 0.7 }).addTo(map);
    const icon = (map as any)._drIcon as L.DivIcon;
    rows.forEach((r) => {
      L.marker([r.lat, r.lng], { icon }).addTo(map)
        .bindPopup(`<div><strong>${r.ts}</strong><br/>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}${r.note ? `<br/>${r.note}` : ''}</div>`);
    });
    map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }, [rows]);

  const selectExisting = async (f: StoredFile) => {
    const blob = await getBlob(f.id);
    if (!blob) { toast('读不到文件'); return; }
    const text = await blob.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    setFileId(f.id);
    setFileName(f.name);
    setPicking(false);
    toast(`已打开「${f.name}」，${parsed.length} 条记录`);
  };

  const createNew = async () => {
    const name = fileName.trim() || '定位记录.csv';
    const blob = new Blob([toCsv([])], { type: 'text/csv;charset=utf-8' });
    const file = new File([blob], name, { type: 'text/csv' });
    const out = await uploadFile(file, { smallLimit: 5 * 1024 * 1024 });
    const f = out.kind === 'created' ? out.file : out.kind === 'reused' ? out.file : null;
    if (f) { setFileId(f.id); setFileName(f.name); setRows([]); toast(`已创建「${f.name}」`); }
  };

  const writeBack = async (next: Row[]) => {
    if (!fileId) return;
    const blob = new Blob([toCsv(next)], { type: 'text/csv;charset=utf-8' });
    await overwriteFileContent(fileId, blob);
  };

  const record = () => {
    if (!fileId) { toast('先选或新建一个 CSV 文件'); return; }
    setBusy(true);
    getPosition()
      .then(async (pos) => {
        setBusy(false);
        const r: Row = {
          ts: new Date().toISOString(),
          lat: pos.lat, lng: pos.lng,
          accuracy: pos.accuracy, note: note.trim(),
        };
        const next = [...rows, r];
        setRows(next); setNote('');
        await writeBack(next);
        mapRef.current?.setView([r.lat, r.lng], 16);
        toast('已记录并保存');
      })
      .catch((err) => { setBusy(false); toast(`定位失败：${err.message || err}`); });
  };

  const locateMe = () => {
    getPosition()
      .then((pos) => mapRef.current?.setView([pos.lat, pos.lng], 16))
      .catch(() => toast('定位失败'));
  };

  const tick = () => {
    getPosition().then(async (pos) => {
      const fid = fileIdRef.current;
      if (!fid) return;
      const last = rowsRef.current[rowsRef.current.length - 1];
      const cur = { lat: pos.lat, lng: pos.lng };
      let next: Row[];
      if (last && distM(last, cur) < threshold) {
        next = [...rowsRef.current];
        next[next.length - 1] = { ...last, ts: new Date().toISOString(), accuracy: pos.accuracy };
        } else {
          // 新位置：append
          next = [...rowsRef.current, {
            ts: new Date().toISOString(), lat: cur.lat, lng: cur.lng,
            accuracy: pos.accuracy, note: '',
          }];
        }
        rowsRef.current = next;
        setRows(next);
        await writeBack(next);
      })
      .catch(() => {});
  };

  const startAuto = () => {
    if (!fileId) { toast('先选或新建一个 CSV 文件'); return; }
    setAuto(true);
    tick();
    timerRef.current = window.setInterval(tick, 1000);
    toast('自动打点已开始（每秒）');
  };

  const stopAuto = () => {
    setAuto(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  // 卸载时清定时器
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return (
    <div className="music-panel">
      <div className="music-now">
        <div className="music-disc">📍</div>
        <div className="music-meta">
          <div className="music-title">{current ? current.name : '未选择文件'}</div>
          <div className="music-sub muted small">{rows.length} 条记录</div>
        </div>
      </div>

      <div className="music-add" style={{ marginBottom: 8 }}>
        <input className="music-name-input" value={amapKey}
          onChange={(e) => setAmapKey(e.target.value)}
          placeholder="高德 Web key（lbs.amap.com 申请）" />
        <button className="music-add-btn" onClick={() => {
          try { localStorage.setItem('dr.amapKey', amapKey.trim()); } catch {}
          toast('key 已保存');
        }}>保存 key</button>
      </div>

      {!fileId && (
        <>
          <input className="music-name-input" value={fileName} onChange={(e) => setFileName(e.target.value)}
            placeholder="新文件名（默认 定位记录.csv）" />
          <div className="music-add">
            <button className="music-add-btn primary" onClick={createNew}>新建文件</button>
            <button className="music-add-btn" onClick={() => setPicking(true)}>选已有 CSV</button>
          </div>
        </>
      )}

      {fileId && (
        <>
          <input className="music-name-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选，手动打点时带）" />
          <div className="music-add">
            <button className="music-add-btn primary" onClick={record} disabled={busy || auto}>
              {busy ? '定位中…' : '记录位置'}
            </button>
            <button className="music-add-btn" onClick={locateMe}>我的位置</button>
            <button className="music-add-btn" onClick={() => { setFileId(null); setRows([]); }}>切换文件</button>
          </div>
          <div className="music-add" style={{ marginTop: 8 }}>
            <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              去重阈值
              <input type="number" min="0" style={{ width: 70 }} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value) || 0)} />
              米内视为同一点
            </label>
            {auto ? (
              <button className="music-add-btn" onClick={stopAuto}>⏹ 停止自动打点</button>
            ) : (
              <button className="music-add-btn primary" onClick={startAuto}>▶ 自动打点（1秒/次）</button>
            )}
          </div>
        </>
      )}

      <div ref={containerRef} className="map-leaflet" />

      <ul className="music-list">
        {rows.length === 0 && <li className="muted small">打点会出现在地图上。</li>}
        {rows.slice().reverse().map((r, i) => (
          <li key={i} className="music-row" onClick={() => mapRef.current?.setView([r.lat, r.lng], 16)}>
            <span className="music-row-idx">{rows.length - i}</span>
            <span className="music-row-name">
              {new Date(r.ts).toLocaleString()} · {r.lat.toFixed(4)},{r.lng.toFixed(4)}
              {r.note ? ` · ${r.note}` : ''}
            </span>
            <span className="music-row-size muted small">±{Math.round(r.accuracy)}m</span>
          </li>
        ))}
      </ul>

      {picking && (
        <div className="music-picker-mask" onClick={() => setPicking(false)}>
          <div className="music-picker" onClick={(e) => e.stopPropagation()}>
            <div className="music-picker-head">
              <strong>选定位 CSV</strong>
              <button onClick={() => setPicking(false)}>✕</button>
            </div>
            <div className="music-picker-body">
              <FilesPanel onPick={(f) => selectExisting(f)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
