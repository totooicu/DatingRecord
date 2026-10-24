// 功能面板 · 定位地图（Leaflet + OpenStreetMap）。
//
// 从文件库选一个定位 CSV，用 Leaflet 画 marker + 轨迹连线。
// 底图走 OSM tiles（联网），离线时 marker 仍能在灰底上看到。

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getBlob } from '../../core/db/blob';
import { FilesPanel } from '../files';
import { showToast as toast } from '../toast';

interface Row {
  ts: string;
  lat: number;
  lng: number;
  accuracy: number;
  note: string;
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
    out.push({
      ts: parts[0],
      lat,
      lng,
      accuracy: Number(parts[3]) || 0,
      note: parts[4] || '',
    });
  }
  return out;
}

export function LocationMapPanel() {
  const [picking, setPicking] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState('');
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPickFile = async (f: { id: string; name: string }) => {
    const blob = await getBlob(f.id);
    if (!blob) { toast('读不到文件内容'); return; }
    const text = await blob.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) { toast('CSV 里没解析出坐标'); return; }
    setRows(parsed);
    setFileName(f.name);
    setPicking(false);
    toast(`读入 ${parsed.length} 个点`);
  };

  // 初始化地图（只一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // 打包后默认 marker 图标路径会 404，用 divIcon 自己画
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#d9536b;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    mapRef.current = L.map(containerRef.current).setView([30.2741, 120.1551], 12);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
      attribution: '© 高德地图',
    }).addTo(mapRef.current);
    (mapRef.current as any)._drIcon = icon;
  }, []);

  // 数据变化时重画
  useEffect(() => {
    if (!mapRef.current || rows.length === 0) return;
    const map = mapRef.current;
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });

    const latlngs = rows.map((r) => [r.lat, r.lng] as [number, number]);
    L.polyline(latlngs, { color: '#d9536b', weight: 2, opacity: 0.7 }).addTo(map);

    rows.forEach((r) => {
      const icon = (map as any)._drIcon as L.DivIcon;
      const marker = L.marker([r.lat, r.lng], { icon }).addTo(map);
      marker.bindPopup(
        `<div><strong>${r.ts}</strong><br/>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}${r.note ? `<br/>${r.note}` : ''}</div>`,
      );
    });

    map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }, [rows]);

  if (picking) {
    return (
      <div className="music-panel">
        <div className="music-pick-back">
          <button className="music-add-btn" onClick={() => setPicking(false)}>← 返回地图</button>
          <span className="muted small">选一个定位 CSV 文件</span>
        </div>
        <FilesPanel onPick={(f) => onPickFile(f)} />
      </div>
    );
  }

  return (
    <div className="music-panel">
      <div className="music-now">
        <div className="music-disc">🗺</div>
        <div className="music-meta">
          <div className="music-title">{fileName || '定位地图'}</div>
          <div className="music-sub muted small">{rows.length ? `${rows.length} 个点` : '从文件库选 CSV'}</div>
        </div>
      </div>

      <div className="music-add">
        <button className="music-add-btn primary" onClick={() => setPicking(true)}>从文件库选 CSV</button>
      </div>

      {rows.length > 0 && (
        <div className="music-list">
          {rows.slice().reverse().map((r, i) => (
            <li key={i} className="music-row" onClick={() => {
              mapRef.current?.setView([r.lat, r.lng], 16);
            }}>
              <span className="music-row-idx">{rows.length - i}</span>
              <span className="music-row-name">{r.ts} · {r.lat.toFixed(4)},{r.lng.toFixed(4)}{r.note ? ` · ${r.note}` : ''}</span>
            </li>
          ))}
        </div>
      )}

      <div ref={containerRef} className="map-leaflet" />
    </div>
  );
}
