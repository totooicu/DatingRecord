// 截图轨迹 → 地理坐标：把像素点列落到地图上，以及两条轨迹的差异对比。
//
// 截图只有像素坐标，要落图就必须有参照。这里用一个锚点把「像素」映射到「经纬度」：
//   · anchor.px/py：锚点像素（默认取轨迹起点）；
//   · anchor.lat/lng：这个像素对应的真实经纬度（地图上点一下 / 用当前定位 / AI 给）；
//   · anchor.mPerPx：校准出来的米/像素；
//   · anchor.bearing：图像「向上」方向相对真北的方位角（度，顺时针），0 = 正北朝上。
//
// 换算只有一次旋转 + 一次比例：屏幕上 y 向下，所以北向分量取负。
// 纯函数，不碰 DOM，方便单测与复用到「保存为 .drloc」。

import type { LocationPoint } from '../location/format';
import type { ExtractResult, TrackPoint } from './trackExtract';

/** 像素 → 经纬度的参照 */
export interface GeoAnchor {
  /** 锚点像素 */
  px: number;
  py: number;
  /** 锚点像素对应的经纬度 */
  lat: number;
  lng: number;
  /** 米 / 像素（0 表示还没校准，不能换算） */
  mPerPx: number;
  /** 图像向上方向相对真北的方位角（度，顺时针 0~360） */
  bearing: number;
}

/** 纬度的米/度换算（经度按纬度收缩） */
const M_PER_DEG_LAT = 111320;

/** 像素点 → 经纬度；mPerPx 为 0 时返回锚点本身（调用方应先检查） */
export function pxToGeo(a: GeoAnchor, x: number, y: number): { lat: number; lng: number } {
  const east = (x - a.px) * a.mPerPx;
  const north = -(y - a.py) * a.mPerPx;
  const rad = (a.bearing * Math.PI) / 180;
  // bearing 是「图上方向相对真北」的转角：把局部 (east, north) 反向旋转回去
  const e = east * Math.cos(rad) - north * Math.sin(rad);
  const n = east * Math.sin(rad) + north * Math.cos(rad);
  const lat = a.lat + n / M_PER_DEG_LAT;
  const cos = Math.max(0.2, Math.cos((a.lat * Math.PI) / 180));
  return { lat, lng: a.lng + e / (M_PER_DEG_LAT * cos) };
}

/** 把断口用直线补起来，拼成一条连续的路径（保存 .drloc 用；和虚线显示一致） */
export function flattenSegments(result: ExtractResult, stepPx = 8): TrackPoint[] {
  const out: TrackPoint[] = [];
  result.segments.forEach((seg, i) => {
    for (const p of seg.points) out.push(p);
    const next = result.segments[i + 1];
    if (!next) return;
    const a = seg.points[seg.points.length - 1];
    const b = next.points[0];
    if (!a || !b) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(dist / Math.max(1, stepPx)));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  });
  return out;
}

/** 路径像素长度（逐段累加，不含断口） */
export function pathLengthPx(pts: TrackPoint[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return sum;
}

/** 按弧长等距重采样成 n 个点（两条轨迹对比前先统一采样，否则点数不同没法比） */
export function resampleByArc(pts: TrackPoint[], n: number): TrackPoint[] {
  if (pts.length < 2 || n < 2) return pts.slice(0, Math.max(0, n));
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const out: TrackPoint[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    const a = pts[j - 1];
    const b = pts[j];
    const span = cum[j] - cum[j - 1] || 1;
    const t = Math.max(0, Math.min(1, (target - cum[j - 1]) / span));
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

export interface TrackDiff {
  /** 采样点数（对比用的） */
  n: number;
  meanPx: number;
  maxPx: number;
  /** 路径长度差（百分比，以 a 为基准；a 为 0 时为 0） */
  lenDiffPct: number;
}

/** 两条轨迹的差异：按弧长各取 N 点后逐点比距离（同一起点、同一方向才有意义） */
export function compareTracks(a: TrackPoint[], b: TrackPoint[], n = 120): TrackDiff {
  const N = Math.max(2, Math.min(n, Math.min(a.length, b.length)));
  if (a.length < 2 || b.length < 2) return { n: 0, meanPx: 0, maxPx: 0, lenDiffPct: 0 };
  const ra = resampleByArc(a, N);
  const rb = resampleByArc(b, N);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < N; i++) {
    const d = Math.hypot(ra[i].x - rb[i].x, ra[i].y - rb[i].y);
    sum += d;
    if (d > max) max = d;
  }
  const la = pathLengthPx(a);
  const lb = pathLengthPx(b);
  return { n: N, meanPx: sum / N, maxPx: max, lenDiffPct: la > 0 ? ((lb - la) / la) * 100 : 0 };
}

export interface SaveOptions {
  /** 起始时间（毫秒）；默认「现在」往前推到走完为止 */
  startMs?: number;
  /** 行进速度（米/秒），决定每个点的时间戳；默认 1.2 m/s（快走） */
  speedMps?: number;
  /** 备注前缀：写进每个点的 note，方便在地图/列表里认出来 */
  note?: string;
}

/**
 * 像素路径 → 定位点：按米制距离均匀分配时间戳。
 * 点数太多会让 .drloc 变胖，默认再抽样到不超过 1200 个点。
 */
export function toLocationPoints(pts: TrackPoint[], anchor: GeoAnchor, o: SaveOptions = {}): LocationPoint[] {
  if (pts.length < 2) return [];
  const step = Math.max(1, Math.ceil(pts.length / 1200));
  const picked = pts.filter((_, i) => i % step === 0);
  if (picked[picked.length - 1] !== pts[pts.length - 1]) picked.push(pts[pts.length - 1]);
  const speed = o.speedMps && o.speedMps > 0 ? o.speedMps : 1.2;
  const totalM = pathLengthPx(picked) * anchor.mPerPx;
  const start = o.startMs ?? Date.now() - (totalM / speed) * 1000;
  const note = (o.note ?? '').slice(0, 80);
  let cum = 0;
  return picked.map((p, i) => {
    if (i > 0) cum += Math.hypot(p.x - picked[i - 1].x, p.y - picked[i - 1].y) * anchor.mPerPx;
    const geo = pxToGeo(anchor, p.x, p.y);
    return {
      ts: new Date(Math.round(start + (cum / speed) * 1000)).toISOString(),
      lat: Number(geo.lat.toFixed(6)),
      lng: Number(geo.lng.toFixed(6)),
      accuracy: 0,
      note: note && i === 0 ? note : '',
    };
  });
}

/** 归一化坐标（0~1）→ 像素：AI 返回的比例坐标要用截图尺寸还原 */
export function normToPx(norm: { x: number; y: number }[], w: number, h: number): TrackPoint[] {
  return norm.map((p) => ({ x: p.x * w, y: p.y * h }));
}
