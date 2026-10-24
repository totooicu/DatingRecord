// 功能面板 · 定位（记录 + 地图合并页）。
//
// 一页搞定：选/建 CSV 文件 → 地图上看轨迹 → 点「记录位置」打点写回 CSV，
// 点「我的位置」地图飞到当前 GPS。
//
// 数据与自动打点定时器都在 core/runtime/locationAuto.ts 单例里：
// 离开本页照样打点（服务语义），本页只是订阅式视图 + 地图渲染。

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getFile, type StoredFile } from '../../core/repo/files';
import { getBlob } from '../../core/db/blob';
import { uploadFile } from '../../core/files';
import { FilesPanel } from '../files';
import { showToast as toast } from '../toast';
import {
  locateMe as locateOnce,
  parseCsv,
  punch,
  setAutoFile,
  setThreshold,
  startAuto,
  stopAuto,
  toCsv,
  useLocationAuto,
} from '../../core/runtime/locationAuto';

export function LocationPanel() {
  const la = useLocationAuto();
  const { fileId, fileName, rows, threshold, running: auto, busy } = la;
  const [note, setNote] = useState('');
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState('');
  const [amapKey, setAmapKey] = useState(() => {
    try {
      return localStorage.getItem('dr.amapKey') || '';
    } catch {
      return '';
    }
  });
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = fileId ? getFile(fileId) : null;

  // 初始化地图
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#d9536b;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    mapRef.current = L.map(containerRef.current).setView([30.2741, 120.1551], 12);
    L.control.scale({ imperial: false, metric: true }).addTo(mapRef.current);
    L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      { subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '© 高德地图' },
    ).addTo(mapRef.current);
    (mapRef.current as any)._drIcon = icon;
    setTimeout(() => mapRef.current?.invalidateSize(), 100);
  }, []);

  // 数据变化重画
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    map.eachLayer((layer) => {
      if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });
    if (rows.length === 0) return;
    const latlngs = rows.map((r) => [r.lat, r.lng] as [number, number]);
    L.polyline(latlngs, { color: '#FFC107', weight: 2, opacity: 0.7 }).addTo(map);
    rows.forEach((r, i) => {
      const isLast = i === rows.length - 1;
      const isSelected = i === selectedIdx;
      const color = isSelected ? '#d9536b' : isLast ? '#2196F3' : '#FFC107';
      const size = isSelected ? 22 : isLast ? 18 : 12;
      const glow = isSelected ? 'box-shadow:0 0 10px rgba(217,83,107,0.7);' : '';
      const dotIcon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);${glow}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      L.marker([r.lat, r.lng], { icon: dotIcon })
        .addTo(map)
        .bindPopup(
          `<div><strong>${r.ts}</strong><br/>${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}${r.note ? `<br/>${r.note}` : ''}</div>`,
        );
    });
    map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }, [rows, selectedIdx]);

  const selectExisting = async (f: StoredFile) => {
    const blob = await getBlob(f.id);
    if (!blob) {
      toast('读不到文件');
      return;
    }
    const text = await blob.text();
    const parsed = parseCsv(text);
    setAutoFile(f.id, f.name, parsed);
    setPicking(false);
    toast(`已打开「${f.name}」，${parsed.length} 条记录`);
  };

  const createNew = async () => {
    const name = newName.trim() || '定位记录.csv';
    const blob = new Blob([toCsv([])], { type: 'text/csv;charset=utf-8' });
    const file = new File([blob], name, { type: 'text/csv' });
    const out = await uploadFile(file, { smallLimit: 5 * 1024 * 1024 });
    const f = out.kind === 'created' || out.kind === 'reused' ? out.file : null;
    if (f) {
      setAutoFile(f.id, f.name, []);
      toast(`已创建「${f.name}」`);
    }
  };

  const record = async () => {
    if (!fileId) {
      toast('先选或新建一个 CSV 文件');
      return;
    }
    try {
      const r = await punch(note);
      setNote('');
      if (r) {
        mapRef.current?.setView([r.lat, r.lng], 16);
        toast('已记录并保存');
      }
    } catch (e) {
      toast(`定位失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const locateMe = () => {
    locateOnce()
      .then((pos) => {
        if (pos) mapRef.current?.setView([pos.lat, pos.lng], 16);
        else toast('定位失败');
      })
      .catch(() => toast('定位失败'));
  };

  return (
    <div className="music-panel">
      <div className="music-add" style={{ marginBottom: 8 }}>
        <input
          type="password"
          className="music-name-input"
          value={amapKey}
          onChange={(e) => setAmapKey(e.target.value)}
          placeholder="高德 Web key"
        />
        <button
          className="music-add-btn"
          style={{ padding: '4px 10px', fontSize: 12 }}
          onClick={() => {
            try {
              localStorage.setItem('dr.amapKey', amapKey.trim());
            } catch {
              /* ignore */
            }
            toast('key 已保存');
          }}
        >
          保存
        </button>
      </div>

      <div className="music-now">
        <div className="music-disc">📍</div>
        <div className="music-meta">
          <div className="music-title">{current ? current.name : fileName || '未选择文件'}</div>
          <div className="music-sub muted small">{rows.length} 条记录</div>
        </div>
      </div>

      {!fileId && (
        <>
          <input
            className="music-name-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新文件名（默认 定位记录.csv）"
          />
          <div className="music-add">
            <button className="music-add-btn primary" onClick={createNew}>
              新建文件
            </button>
            <button className="music-add-btn" onClick={() => setPicking(true)}>
              选已有 CSV
            </button>
          </div>
        </>
      )}

      {fileId && (
        <>
          <input
            className="music-name-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选，手动打点时带）"
          />
          <div className="music-add">
            <button className="music-add-btn primary" onClick={record} disabled={busy || auto}>
              {busy ? '定位中…' : '记录位置'}
            </button>
            <button className="music-add-btn" onClick={locateMe}>
              我的位置
            </button>
            <button className="music-add-btn" onClick={() => setAutoFile(null, '', [])}>
              切换文件
            </button>
          </div>
        </>
      )}

      {fileId && (
        <div className="music-add" style={{ marginBottom: 8 }}>
          <label className="muted small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            去重阈值
            <input
              type="number"
              min={0}
              style={{ width: 70 }}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 0)}
            />
            米
          </label>
          {auto ? (
            <button className="music-add-btn" onClick={stopAuto}>
              ⏹ 停止
            </button>
          ) : (
            <button
              className="music-add-btn primary"
              onClick={() => {
                if (!startAuto()) toast('先选或新建一个 CSV 文件');
              }}
            >
              ▶ 自动打点
            </button>
          )}
        </div>
      )}

      <div ref={containerRef} className="map-leaflet" />

      <ul className="music-list">
        {rows.length === 0 && <li className="muted small">打点会出现在地图上。</li>}
        {rows
          .slice()
          .reverse()
          .map((r, i) => {
            const realIdx = rows.length - 1 - i;
            const isSel = realIdx === selectedIdx;
            return (
              <li
                key={i}
                className="music-row"
                style={isSel ? { background: '#ffe8ec', borderLeft: '3px solid #d9536b' } : {}}
                onClick={() => {
                  setSelectedIdx(realIdx);
                  mapRef.current?.setView([r.lat, r.lng], 16);
                }}
              >
                <span className="music-row-idx">{rows.length - i}</span>
                <span className="music-row-name">
                  {new Date(r.ts).toLocaleString()} · {r.lat.toFixed(6)},{r.lng.toFixed(6)}
                  {r.note ? ` · ${r.note}` : ''}
                </span>
                <span className="music-row-size muted small">±{Math.round(r.accuracy)}m</span>
              </li>
            );
          })}
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
