// 主流程与导出：只提点（extractPoints）→ 自动连线（buildTrack）→ 一步到位（extractTrack）
// → 导出 CSV（toCsv）。每一步的取舍都写在对应函数头上。

import { autoOrder } from '../trackAuto';
import { pathLength, resampleByArcLength, smoothMoving } from './geometry';
import { scanSkeleton } from './scan';
import {
  DEFAULT_OPTIONS,
  type Calibration,
  type ExtractOptions,
  type ExtractPointsResult,
  type ExtractResult,
  type SkeletonPath,
  type TrackSegment,
} from './types';

function nowMs(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * 第一步：只提取点。
 *
 * 与 `extractTrack` 的区别是「不串联、不排序、不重采样」——输出的是骨架点云，
 * 页面上就是一片点，还谈不上一条轨迹。轨迹留到第二步：自动连线（`buildTrack`）、
 * 手动点 A/B、或交给模型优化。
 */
export function extractPoints(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  userOpts: Partial<ExtractOptions> = {},
): ExtractPointsResult {
  const t0 = nowMs();
  const o: ExtractOptions = { ...DEFAULT_OPTIONS, ...userOpts };
  const sc = scanSkeleton(data, w, h, o);

  // 链是逐像素走的，直接摊平成点云；同一像素只留一次（邻链在分叉点会重叠）
  const seen = new Set<string>();
  const points: { x: number; y: number }[] = [];
  for (const sg of sc.segs) {
    for (const p of sg.path) {
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ x: p.x, y: p.y });
    }
  }

  return {
    chains: sc.segs,
    points,
    stats: {
      redPx: sc.redPx,
      keptChains: sc.segs.length,
      droppedSegments: sc.dropped,
      droppedBy: sc.droppedBy,
      outPoints: points.length,
      ms: nowMs() - t0,
    },
  };
}

/**
 * 第二步（自动）：把第一步留下的骨架链串成有序轨迹 → 平滑 → 等距重采样 → 定标。
 * 数据来源仍是第一步那张图，所以阈值/断口改了要重跑 `extractPoints` 再连线。
 */
export function buildTrack(
  segsInput: SkeletonPath[],
  userOpts: Partial<ExtractOptions> = {},
  meta: {
    redPx?: number;
    droppedBy?: Record<string, number>;
    droppedSegments?: number;
    t0?: number;
    /** 与 segsInput 对齐的簇号（距离聚类的结果）：只在簇内串链 */
    clusterOf?: number[];
  } = {},
): ExtractResult {
  const t0 = meta.t0 ?? nowMs();
  const o: ExtractOptions = { ...DEFAULT_OPTIONS, ...userOpts };
  const redPx = meta.redPx ?? 0;
  const droppedBy = meta.droppedBy ?? {};
  const droppedSegments = meta.droppedSegments ?? Object.values(droppedBy).reduce((a, b) => a + b, 0);
  // 排序会改传入数组的顺序，复制一份
  const segs = segsInput.slice();

  if (!segs.length) {
    return {
      segments: [],
      gaps: [],
      calibration: {
        mPerPx: 0,
        source: 'none',
        totalPx: 0,
        totalM: 0,
        officialM: o.mileageKm * 1000,
        coverage: -1,
      },
      stats: {
        redPx,
        keptSegments: 0,
        droppedSegments,
        droppedBy,
        outPoints: 0,
        ms: nowMs() - t0,
      },
    };
  }

  // ⑤ 自动画路径：按连通簇分组，簇内在点图上找最长测地线当主干（见 trackAuto.ts）
  const groups: number[][] = [];
  if (meta.clusterOf && meta.clusterOf.length === segs.length) {
    const byCluster = new Map<number, number[]>();
    segs.forEach((_, i) => {
      const c = meta.clusterOf![i];
      const arr = byCluster.get(c);
      if (arr) arr.push(i);
      else byCluster.set(c, [i]);
    });
    const sizeOf = (ids: number[]) => ids.reduce((sum, i) => sum + segs[i].len, 0);
    groups.push(...[...byCluster.values()].sort((a, b) => sizeOf(b) - sizeOf(a)));
  } else {
    groups.push(segs.map((_, i) => i));
  }

  // ⑥ 每簇（或每块连不起来的网）一条有序点列 → 平滑 → 等距重采样
  // 短于一个断口阈值的旁支基本是图标残渣/细化毛刺，当往返补进点列只会让长度虚增
  const spur = Math.max(30, o.gapPx);
  const segments: TrackSegment[] = [];
  for (const group of groups) {
    const pool = group.map((i) => segs[i]);
    const area = pool.reduce((m, x) => Math.max(m, x.area), 0);
    for (const ordered of autoOrder(pool, o.gapPx, spur)) {
      if (ordered.length < 2) continue;
      const dense = resampleByArcLength(ordered, Math.max(0.5, o.resamplePx));
      const sm = smoothMoving(dense, o.smoothWin);
      segments.push({ points: sm, lengthPx: pathLength(sm), skelPx: ordered.length, area });
    }
  }
  const kept = segments.filter((seg) => seg.lengthPx >= o.minFinalPx);

  // 断口：相邻链端点距离
  const gaps: { afterSegment: number; distPx: number }[] = [];
  for (let i = 0; i < kept.length - 1; i++) {
    const a = kept[i].points[kept[i].points.length - 1];
    const b = kept[i + 1].points[0];
    gaps.push({ afterSegment: i, distPx: Math.hypot(a.x - b.x, a.y - b.y) });
  }

  // ⑦ 校准：比例尺优先（独立定标），否则用官方里程反推
  const totalPx = kept.reduce((s, x) => s + x.lengthPx, 0);
  const officialM = o.mileageKm * 1000;
  let mPerPx = 0;
  let source: Calibration['source'] = 'none';
  if (o.scaleMeter > 0 && o.scalePx > 0) {
    mPerPx = o.scaleMeter / o.scalePx;
    source = 'scale';
  } else if (officialM > 0 && totalPx > 0) {
    mPerPx = officialM / totalPx;
    source = 'mileage';
  }
  const totalM = totalPx * mPerPx;
  // 覆盖率只在「比例尺独立定标 + 有官方里程」时才有意义
  const coverage = source === 'scale' && officialM > 0 ? totalM / officialM : -1;

  const outPoints = kept.reduce((s, x) => s + x.points.length, 0);

  return {
    segments: kept,
    gaps,
    calibration: { mPerPx, source, totalPx, totalM, officialM, coverage },
    stats: {
      redPx,
      keptSegments: kept.length,
      droppedSegments,
      droppedBy,
      outPoints,
      ms: nowMs() - t0,
    },
  };
}

/** 一步到位的旧接口：提取点 + 自动连线（CLI / 回归脚本还在用） */
export function extractTrack(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  userOpts: Partial<ExtractOptions> = {},
): ExtractResult {
  const t0 = nowMs();
  const o: ExtractOptions = { ...DEFAULT_OPTIONS, ...userOpts };
  const sc = scanSkeleton(data, w, h, o);
  return buildTrack(sc.segs, o, {
    redPx: sc.redPx,
    droppedBy: sc.droppedBy,
    droppedSegments: sc.dropped,
    t0,
  });
}

/**
 * 导出 CSV：
 *   idx,x,y,x_m,y_m,cum_m,seg
 * x/y 为图像像素；(x_m,y_m) 以首点为原点、y 轴翻转成「向上为正」，仅在给了里程时非零；
 * cum_m 为该段内累计米数；seg 为断口分段的段号。
 */
export function toCsv(result: ExtractResult): string {
  const { mPerPx } = result.calibration;
  const lines = ['idx,x,y,x_m,y_m,cum_m,seg'];
  let idx = 0;
  result.segments.forEach((seg, si) => {
    const origin = seg.points[0];
    let cum = 0;
    for (let i = 0; i < seg.points.length; i++) {
      const p = seg.points[i];
      if (i > 0) cum += Math.hypot(p.x - seg.points[i - 1].x, p.y - seg.points[i - 1].y) * mPerPx;
      const xm = mPerPx > 0 ? (p.x - origin.x) * mPerPx : 0;
      const ym = mPerPx > 0 ? -(p.y - origin.y) * mPerPx : 0;
      lines.push(
        `${idx++},${p.x.toFixed(2)},${p.y.toFixed(2)},${xm.toFixed(2)},${ym.toFixed(2)},${cum.toFixed(
          2,
        )},${si}`,
      );
    }
  });
  return lines.join('\n');
}
