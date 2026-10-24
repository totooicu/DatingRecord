// 功能面板 · 高精度定位诊断（高德官方 demo 移植）。
//
// 直接跑高德 AMap.Geolocation，输出坐标、定位类别、精度、是否纠偏。
// 用来对比我们自己定位页和高德官方 demo 的差异。

import { useEffect, useRef, useState } from 'react';
import { showToast as toast } from '../toast';

const AMAP_KEY = (() => {
  try { return localStorage.getItem('dr.amapKey') || ''; } catch { return ''; }
})();

export function PreciseLocationPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!AMAP_KEY) { setStatus('未配置高德 key'); return; }
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=1.4.15&key=${AMAP_KEY}`;
    s.onload = () => {
      const AMap = (window as any).AMap;
      const map = new AMap.Map(containerRef.current, { resizeEnable: true });
      AMap.plugin('AMap.Geolocation', () => {
        const g = new AMap.Geolocation({
          enableHighAccuracy: true,
          timeout: 10000,
          zoomToAccuracy: true,
        });
        map.addControl(g);
        g.getCurrentPosition((st: string, data: any) => {
          if (st === 'complete' && data.position) {
            setStatus('定位成功');
            const rows: string[] = [];
            rows.push(`经度：${data.position.lng.toFixed(6)}`);
            rows.push(`纬度：${data.position.lat.toFixed(6)}`);
            rows.push(`定位类别：${data.location_type || '未知'}`);
            if (data.accuracy) rows.push(`精度：${Math.round(data.accuracy)} 米`);
            rows.push(`是否经过纠偏：${data.isConverted ? '是' : '否'}`);
            if (data.formattedAddress) rows.push(`地址：${data.formattedAddress}`);
            setResult(rows);
          } else {
            setStatus('定位失败');
            setResult([`原因：${data?.message || '未知'}`]);
          }
        });
      });
      setReady(true);
    };
    s.onerror = () => setStatus('高德脚本加载失败');
    document.head.appendChild(s);
  }, []);

  return (
    <div className="music-panel">
      <div className="music-now">
        <div className="music-disc">🎯</div>
        <div className="music-meta">
          <div className="music-title">高精度定位诊断</div>
          <div className="music-sub muted small">高德官方 demo 直跑</div>
        </div>
      </div>

      {!AMAP_KEY && (
        <div className="music-row muted small">
          请到「定位」页顶部填入高德 Web key 后回来刷新。
        </div>
      )}

      <div ref={containerRef} className="map-leaflet" />

      <div className="music-list" style={{ marginTop: 12 }}>
        <div className="music-row">
          <span className="music-row-name"><strong>{status || '定位中…'}</strong></span>
        </div>
        {result.map((r, i) => (
          <div key={i} className="music-row">
            <span className="music-row-name">{r}</span>
          </div>
        ))}
      </div>

      {ready && (
        <div className="music-add">
          <button className="music-add-btn" onClick={() => toast('刷新页面重新定位')}>刷新重测</button>
        </div>
      )}
    </div>
  );
}
