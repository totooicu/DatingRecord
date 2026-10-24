// 功能面板 · 定位地图。
//
// 从文件库选一个 CSV（LocationPanel 存的那种），解析经纬度，
// 用 Canvas 画散点 + 时间连线。完全离线，不依赖外部地图 tiles。
// 点某个点显示时间/备注。

import { useEffect, useRef, useState } from 'react';
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
    // 简易 CSV 解析：字段可能带引号
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
  const [hover, setHover] = useState<Row | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  useEffect(() => {
    if (rows.length === 0 || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const lats = rows.map((r) => r.lat);
    const lngs = rows.map((r) => r.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad = 40;
    const spanLat = maxLat - minLat || 1;
    const spanLng = maxLng - minLng || 1;

    const x = (lng: number) => pad + ((lng - minLng) / spanLng) * (W - pad * 2);
    const y = (lat: number) => H - pad - ((lat - minLat) / spanLat) * (H - pad * 2);

    // 连线
    ctx.strokeStyle = 'rgba(217, 83, 107, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    rows.forEach((r, i) => {
      if (i === 0) ctx.moveTo(x(r.lng), y(r.lat));
      else ctx.lineTo(x(r.lng), y(r.lat));
    });
    ctx.stroke();

    // 点
    rows.forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(x(r.lng), y(r.lat), 5, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#2d5a5a' : '#d9536b';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
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
        <div className="map-wrap">
          <canvas ref={canvasRef} className="map-canvas"
            onClick={(e) => {
              // 简单点选：找最近的点
              const rect = canvasRef.current!.getBoundingClientRect();
              const mx = e.clientX - rect.left;
              const my = e.clientY - rect.top;
              const lats = rows.map((r) => r.lat);
              const lngs = rows.map((r) => r.lng);
              const minLat = Math.min(...lats), maxLat = Math.max(...lats);
              const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
              const pad = 40;
              const W = rect.width, H = rect.height;
              const spanLat = maxLat - minLat || 1;
              const spanLng = maxLng - minLng || 1;
              const x = (lng: number) => pad + ((lng - minLng) / spanLng) * (W - pad * 2);
              const y = (lat: number) => H - pad - ((lat - minLat) / spanLat) * (H - pad * 2);
              let best: Row | null = null;
              let bestD = 20;
              for (const r of rows) {
                const d = Math.hypot(x(r.lng) - mx, y(r.lat) - my);
                if (d < bestD) { best = r; bestD = d; }
              }
              setHover(best);
            }}
          />
          {hover && (
            <div className="map-toast">
              <div><strong>{hover.ts}</strong></div>
              <div className="muted small">{hover.lat.toFixed(5)}, {hover.lng.toFixed(5)}</div>
              {hover.note && <div>{hover.note}</div>}
            </div>
          )}
        </div>
      )}

      <ul className="music-list">
        {rows.length === 0 && <li className="muted small">还没选文件。点上面按钮从文件库选一个 CSV。</li>}
        {rows.slice().reverse().map((r, i) => (
          <li key={i} className="music-row" onClick={() => setHover(r)}>
            <span className="music-row-idx">{rows.length - i}</span>
            <span className="music-row-name">{r.ts} · {r.lat.toFixed(4)},{r.lng.toFixed(4)}{r.note ? ` · ${r.note}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
