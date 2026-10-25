// 「功能体验 → 轨迹提取」独立子页。
//
// 参考了一份外部「两步路轨迹提取器」：上传两步路 App 的截图，按 HSV 阈值筛出红色
// 轨迹线，连通域（最小面积）去噪，网格化取点，双 canvas 显示 + 悬停看坐标 + 导出 CSV。
// 把它的算法原样搬过来，UI 换成应用的卡片/变量配色（按钮用 btn-primary，轨迹线用
// 主题色 --primary，面板用 --panel/--border），不再是工具自带的硬编码绿/蓝。
//
// 工具只在本机跑（canvas + FileReader），图片不出浏览器，也不碰本库的数据——
// 和「边缘分割」「软件适配测试」同一套「本地小工具」定位。
import { type MouseEvent, useCallback, useRef, useState } from 'react';

import { LabHead } from './LabEdgeSection';

/** 主题变量实时读取：canvas 没法用 CSS var，只能取计算后的值；随外观改主题也跟着变 */
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/* ---------------- 算法（与原工具一致） ---------------- */

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const h = 0;
  const s = max === 0 ? 0 : (max - min) / max;
  const v = max;
  let hue = h;
  const d = max - min;
  if (d !== 0) {
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue /= 6;
  }
  return [hue * 180, s * 255, v * 255];
}

/** 红色判定：饱和度与明度都要过阈值，色相落在红/品红两端（0~18 或 162~180） */
function isRed(r: number, g: number, b: number, th: number): boolean {
  const [h, s, v] = rgb2hsv(r, g, b);
  if (s < th || v < th) return false;
  return h <= 18 || h >= 162;
}

/** 4-邻接连通域；面积小于 minArea 的当噪点丢掉 */
function connectedComponents(mask: Uint8Array, w: number, h: number, minArea: number): number[][] {
  const labels = new Int32Array(w * h).fill(-1);
  const comps: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i] !== -1) continue;
    const stack = [i];
    labels[i] = comps.length;
    const pixels: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      pixels.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] && labels[ni] === -1) {
            labels[ni] = comps.length;
            stack.push(ni);
          }
        }
      }
    }
    if (pixels.length >= minArea) comps.push(pixels);
  }
  return comps;
}

interface TrackPoint {
  x: number;
  y: number;
}

/* ---------------- 页面 ---------------- */

export function LabTrackSection() {
  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [thresh, setThresh] = useState(70);
  const [minArea, setMinArea] = useState(3000);
  const [hasImage, setHasImage] = useState(false);
  const [hasPoints, setHasPoints] = useState(false);
  const [status, setStatus] = useState('就绪：选一张两步路截图');
  const [pointInfo, setPointInfo] = useState('');
  const [coord, setCoord] = useState('悬停右图看坐标');

  const trackPointsRef = useRef<TrackPoint[]>([]);

  const loadFile = useCallback((file: File) => {
    setStatus(`正在加载: ${file.name}`);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const oc = origCanvasRef.current;
        const rc = resultCanvasRef.current;
        if (!oc || !rc) return;
        const octx = oc.getContext('2d');
        const rctx = rc.getContext('2d');
        if (!octx || !rctx) return;
        oc.width = img.width;
        oc.height = img.height;
        octx.drawImage(img, 0, 0);
        rc.width = img.width;
        rc.height = img.height;
        rctx.fillStyle = '#ffffff';
        rctx.fillRect(0, 0, img.width, img.height);
        setStatus(`已加载 ${img.width}×${img.height}，点「提取轨迹」`);
        setHasImage(true);
        setHasPoints(false);
        trackPointsRef.current = [];
        setPointInfo('');
      };
      img.onerror = () => setStatus('图片加载失败');
      img.src = e.target?.result as string;
    };
    reader.onerror = () => setStatus('文件读取失败');
    reader.readAsDataURL(file);
  }, []);

  const doExtract = useCallback(() => {
    const oc = origCanvasRef.current;
    const rc = resultCanvasRef.current;
    if (!oc || !rc) return;
    const octx = oc.getContext('2d');
    const rctx = rc.getContext('2d');
    if (!octx || !rctx) return;

    const w = oc.width;
    const h = oc.height;
    const { data } = octx.getImageData(0, 0, w, h);
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      mask[i] = isRed(r, g, b, thresh) ? 1 : 0;
    }

    const comps = connectedComponents(mask, w, h, minArea);
    const points: TrackPoint[] = [];
    rctx.fillStyle = '#ffffff';
    rctx.fillRect(0, 0, w, h);

    const trackColor = cssVar('--primary', '#d9536b');
    rctx.fillStyle = trackColor;
    let totalPx = 0;
    for (const pixels of comps) {
      totalPx += pixels.length;
      const seen = new Set<string>();
      for (const p of pixels) {
        const px = p % w;
        const py = (p / w) | 0;
        rctx.fillRect(px, py, 1.5, 1.5);
        const gx = Math.round(px / 4) * 4;
        const gy = Math.round(py / 4) * 4;
        const key = `${gx},${gy}`;
        if (!seen.has(key)) {
          seen.add(key);
          points.push({ x: gx, y: gy });
        }
      }
    }

    trackPointsRef.current = points;
    setPointInfo(`（${points.length} 点，${comps.length} 段，${totalPx} 红像素）`);

    if (points.length) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      setStatus(
        `完成：${points.length} 点，bbox x[${minX},${maxX}] y[${minY},${maxY}]`,
      );
      setHasPoints(true);
    } else {
      setStatus('没提取到红色轨迹，调低红色阈值或减小最小连通域试试');
      setHasPoints(false);
    }
  }, [thresh, minArea]);

  const downloadCSV = useCallback(() => {
    const points = trackPointsRef.current;
    if (!points.length) return;
    let csv = 'idx,x,y\n';
    for (let i = 0; i < points.length; i++) {
      csv += `${i},${points[i].x},${points[i].y}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'track_points.csv';
    a.click();
  }, []);

  const onMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    const rc = resultCanvasRef.current;
    if (!rc) return;
    const rect = rc.getBoundingClientRect();
    const sx = rc.width / rect.width;
    const sy = rc.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * sx);
    const y = Math.round((e.clientY - rect.top) * sy);
    setCoord(`坐标: (${x}, ${y})`);
  }, []);

  return (
    <div className="lab-page">
      <LabHead title="轨迹提取" subKey="labTrack" />

      <p className="muted small lab-track-lead">
        把两步路 App 的截图拖进来：按红色阈值筛出轨迹线，连通域去噪，网格化取点导出 CSV。
        图片只在你浏览器里处理，不上传、不入库。
      </p>

      <div className="lab-track-bar">
        <label className="lab-track-file">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
            }}
          />
        </label>
        <label>
          红色阈值
          <input
            type="range"
            min={30}
            max={150}
            value={thresh}
            onChange={(e) => setThresh(Number(e.target.value))}
          />
          <span className="lab-track-val">{thresh}</span>
        </label>
        <label>
          最小连通域
          <input
            type="range"
            min={200}
            max={20000}
            step={100}
            value={minArea}
            onChange={(e) => setMinArea(Number(e.target.value))}
          />
          <span className="lab-track-val">{minArea}</span>
        </label>
        <button className="btn btn-primary" disabled={!hasImage} onClick={doExtract}>
          提取轨迹
        </button>
        <button className="btn" disabled={!hasPoints} onClick={downloadCSV}>
          下载 CSV
        </button>
        <span className="lab-track-coord">{coord}</span>
      </div>

      <div className="lab-track-panels">
        <div className="lab-track-panel">
          <h3>原图</h3>
          <canvas ref={origCanvasRef} className="lab-track-canvas" />
        </div>
        <div className="lab-track-panel">
          <h3>
            提取结果 <span className="lab-track-count">{pointInfo}</span>
          </h3>
          <canvas
            ref={resultCanvasRef}
            className="lab-track-canvas"
            onMouseMove={onMove}
          />
        </div>
      </div>

      <div className="lab-track-status">{status}</div>

      <details className="lab-help">
        <summary>它是怎么取的</summary>
        <p className="muted small">
          截图每一像素转 HSV：饱和度与明度都过「红色阈值」，且色相落在红/品红两端（0~18° 或
          162~180°）才算红色。红色像素做 4-邻接连通域，「最小连通域」以下的当作噪点丢。
          剩下每段轨迹按 4px 网格采样成点，右侧画布用主题色描出，悬停看坐标，点「下载 CSV」导出
          idx,x,y。调不出来的时候：把「红色阈值」往下调、或把「最小连通域」调小通常能救回细线。
        </p>
      </details>
    </div>
  );
}
