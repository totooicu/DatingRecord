// 只读预览：原始点只用于计算，地图与列表统一显示偏移后的坐标。
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { StoredFile } from '../../core/repo/files';
import { readLocation } from '../../core/location/locationFile';
import { applyOffset, type LocationDoc } from '../../core/location/format';
import { speedColors, speedLines } from '../panel/locationPaint';
import { Chev } from '../common/Paginator';
import { usePageSize } from '../prefs';
import { Empty } from '../common';

export function LocationPreview({ file }: { file: StoredFile }) {
  const [doc, setDoc] = useState<LocationDoc | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setDoc(null); setError('');
    readLocation(file).then(d => { if (alive) setDoc(d); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [file]);
  if (error) return <p className="pv-error" role="alert">{error}</p>;
  if (!doc) return <p className="pv-loading">读取定位数据中…</p>;
  return <LocationContents key={file.id} doc={doc} />;
}

function LocationContents({ doc }: { doc: LocationDoc }) {
  const points = useMemo(() => applyOffset(doc.points, doc.offset, doc.offsets), [doc]);
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const index = Math.min(selected, Math.max(0, points.length - 1));
  // 点位窗口跟着全局「每页条数」走（默认 100 → 现在的 50 也行）：
  // 这里窗口是被游标带着走的（滑块、播放都会挪），所以只用箭头翻页，不放整套分页控件。
  const size = usePageSize();
  const pageStart = Math.floor(index / size) * size;
  useEffect(() => {
    const m = L.map(host.current!, { preferCanvas: true, scrollWheelZoom: false }).setView([31.2304, 121.4737], 10);
    map.current = m;
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '高德地图',
    }).addTo(m);
    for (const line of speedLines(points)) L.polyline(line.parts, { color: line.color, weight: 4 }).addTo(m);
    if (points.length) {
      m.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number])), { padding: [20, 20], maxZoom: 17 });
      marker.current = L.circleMarker([points[0].lat, points[0].lng], { radius: 5, color: '#ef4444', fillOpacity: 1 }).addTo(m);
    }
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(host.current!);
    return () => { resize.disconnect(); marker.current = null; map.current = null; m.remove(); };
  }, [points]);
  useEffect(() => {
    const p = points[index];
    if (p && map.current && marker.current) {
      marker.current.setLatLng([p.lat, p.lng]);
      if (!map.current.getBounds().contains([p.lat, p.lng])) map.current.panTo([p.lat, p.lng], { animate: false });
    }
    const row = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && list.current) {
      const top = row.offsetTop - list.current.offsetTop;
      if (top < list.current.scrollTop || top + row.offsetHeight > list.current.scrollTop + list.current.clientHeight)
        list.current.scrollTop = top;
    }
  }, [index, points]);
  const move = (delta: number) => setSelected(Math.max(0, Math.min(points.length - 1, index + delta)));
  // 播放：每 200ms 前进一点，走到末点自动停。游标一变，列表滚动与地图标记由上面那个 effect 接手。
  useEffect(() => {
    if (!playing) return;
    if (index >= points.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setSelected(index + 1), 200);
    return () => clearTimeout(t);
  }, [playing, index, points.length]);
  return <div className="location-preview">
    <div><strong>{doc.name}</strong><div className="muted small">{points.length} 个点 · 偏移 Δ{doc.offset.lat.toFixed(6)}, Δ{doc.offset.lng.toFixed(6)} · 分段修正 {doc.offsets.length} 段</div></div>
    <div ref={host} className="location-preview-map" aria-label="定位地图预览" data-point-count={points.length} data-selected={index} />
    <div className="small">速度：慢 <i className="loc-speedbar" style={{ background: `linear-gradient(90deg, ${speedColors().ramp.join(',')})` }} /> 快（红色为本轨迹最高速度，未知为灰色）</div>
    {points.length ? <>
      <div className="location-preview-nav">
        <button className="btn btn-sm" disabled={index === 0} onClick={() => move(-1)}>上一点</button>
        <span role="status">第 {index + 1} / 共 {points.length} 点</span>
        <button className="btn btn-sm" disabled={index === points.length - 1} onClick={() => move(1)}>下一点</button>
        <input type="range" aria-label="定位点跳转" min={0} max={points.length - 1} value={index} onChange={e => { setPlaying(false); setSelected(Number(e.target.value)); }} />
        <button className="btn btn-sm" aria-pressed={playing} disabled={points.length < 2}
          onClick={() => { if (playing) setPlaying(false); else { if (index >= points.length - 1) setSelected(0); setPlaying(true); } }}>
          {playing ? '暂停播放' : '播放点位'}
        </button>
      </div>
      <ul ref={list} className="playlist-preview-list location-preview-list" tabIndex={0} aria-label="定位点清单"
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1); } }}>
        {points.slice(pageStart, pageStart + size).map((p, n) => <li key={pageStart + n} aria-current={pageStart + n === index}>
          <button type="button" onClick={() => setSelected(pageStart + n)}>
            {pageStart + n + 1}. {new Date(p.ts).toLocaleString()} · {p.lat.toFixed(6)}, {p.lng.toFixed(6)}{p.note ? ` · ${p.note}` : ''}{p.accuracy ? ` · ±${Math.round(p.accuracy)}m` : ''}
          </button>
        </li>)}
      </ul>
      {/* 窗口翻页：箭头 + 区间，和分页条同一套画法；aria-label 保留原可访问名，读屏与 e2e 不受影响 */}
      <div className="location-preview-nav">
        <button className="pager-btn" disabled={pageStart === 0} aria-label="上一页点位" title="上一页点位"
          onClick={() => setSelected(Math.max(0, pageStart - size))}><Chev dir="l" /></button>
        <span className="small">{pageStart + 1}–{Math.min(pageStart + size, points.length)}</span>
        <button className="pager-btn" disabled={pageStart + size >= points.length} aria-label="下一页点位" title="下一页点位"
          onClick={() => setSelected(Math.min(points.length - 1, pageStart + size))}><Chev dir="r" /></button>
      </div>
    </> : <Empty compact text="这个定位文件还没有点。" />}
  </div>;
}
