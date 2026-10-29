import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Modal } from '../common';
import { acquireFix } from '../../core/runtime/locationAuto';

type Geo = { lat: number; lng: number };
export function PlacePicker({ value, onSave, onClose }: { value: Geo | null; onSave: (point: Geo) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [point, setPoint] = useState<Geo | null>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const m = L.map(host.current!).setView(value ? [value.lat, value.lng] : [31.2304, 121.4737], value ? 16 : 10);
    map.current = m;
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: ['1', '2', '3', '4'], maxZoom: 18, attribution: '高德地图',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const p = e.latlng.wrap();
      if (Math.abs(p.lat) <= 90) setPoint({ lat: p.lat, lng: p.lng });
    });
    return () => { alive.current = false; map.current = null; m.remove(); };
  }, []);
  useEffect(() => {
    if (!point || !map.current) return;
    const marker = L.marker([point.lat, point.lng], {
      draggable: true,
      icon: L.divIcon({ className: '', html: '<span style="display:block;width:18px;height:18px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 1px 5px #333"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(map.current);
    marker.on('dragend', () => {
      const p = marker.getLatLng().wrap();
      if (Math.abs(p.lat) <= 90) setPoint({ lat: p.lat, lng: p.lng });
    });
    return () => { marker.remove(); };
  }, [point]);
  const locate = async () => {
    setBusy(true); setError('');
    try {
      const fix = await acquireFix();
      if (!alive.current) return;
      setPoint({ lat: fix.lat, lng: fix.lng });
      map.current?.setView([fix.lat, fix.lng], 16);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '定位失败，可直接在地图选点');
    } finally { if (alive.current) setBusy(false); }
  };
  return <Modal title="地图选点" onClose={onClose}>
    <p className="muted small">点击地图选点，可拖动红点微调；地点文本不会被覆盖。</p>
    <div ref={host} className="place-map" style={{ height: 'min(50vh, 360px)', width: '100%' }} />
    <p role="status">{point ? `纬度 ${point.lat.toFixed(6)}，经度 ${point.lng.toFixed(6)}` : '尚未选点'}</p>
    {error && <p role="alert">{error}</p>}
    <div className="modal-foot">
      <button type="button" className="btn" disabled={busy} onClick={locate}>{busy ? '定位中…' : '用我当前定位'}</button>
      <button type="button" className="btn" onClick={onClose}>取消选点</button>
      <button type="button" className="btn btn-primary" disabled={!point} onClick={() => point && onSave(point)}>确认选点</button>
    </div>
  </Modal>;
}
