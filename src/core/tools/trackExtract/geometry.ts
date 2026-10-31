// ⑥ 插值：弧长 → 等距重采样 → 移动平均平滑。
// 输出的点间距均匀，可直接喂给地图/绘图，也可按需加密。

import type { TrackPoint } from './types';

export function pathLength(pts: TrackPoint[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return s;
}

/** 按弧长等距重采样（线性插值）：输出点间距均匀，便于导出与再加工 */
export function resampleByArcLength(pts: TrackPoint[], step: number): TrackPoint[] {
  if (pts.length < 2) return pts.slice();
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-6) return [pts[0]];
  const n = Math.max(2, Math.round(total / step) + 1);
  const out: TrackPoint[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span < 1e-9 ? 0 : (target - cum[seg]) / span;
    out.push({
      x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t,
      y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t,
    });
  }
  return out;
}

/** 移动平均平滑（两端原样保留），去骨架化带来的台阶锯齿 */
export function smoothMoving(pts: TrackPoint[], win: number): TrackPoint[] {
  const k = Math.max(1, win | 1);
  if (k <= 1 || pts.length < k + 2) return pts.slice();
  const half = (k - 1) / 2;
  const out: TrackPoint[] = pts.map((p) => ({ x: p.x, y: p.y }));
  for (let i = half; i < pts.length - half; i++) {
    let sx = 0;
    let sy = 0;
    for (let j = i - half; j <= i + half; j++) {
      sx += pts[j].x;
      sy += pts[j].y;
    }
    out[i] = { x: sx / k, y: sy / k };
  }
  return out;
}
