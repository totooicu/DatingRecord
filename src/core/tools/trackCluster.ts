// 距离聚类：把「能连起来的点」归成一个个连通网络。
//
// 为什么先聚类、再画路径：像素级取点之后，点与点之间的「谁和谁是一伙的」是独立于
// 「先后顺序」的事实。两条相距 40px 的红线在图上都在，但它们中间没有像素——聚类
// 这一步把这件事明确下来：阈值内的连通、阈值外的断开。
//
// 聚类放在「链」上而不是原始像素上：链本来就是把一个连通域的骨架按分叉点切出来的，
// 链内天然连通；需要判断的只是「这条链和那条链离得够不够近」。链数量是几十条量级，
// 两两算最小距离完全够快，也避免了几千个像素两两比较。

import type { SkeletonPath } from './trackExtract';

export interface PointCluster {
  /** 属于这个簇的链下标（升序） */
  ids: number[];
  /** 簇内点数 */
  points: number;
  /** 包围盒，画图和统计用 */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ClusterResult {
  /** 下标与 chains 对齐：第 i 条链属于第几簇 */
  clusterOf: number[];
  /** 按点数从多到少排好序的簇 */
  clusters: PointCluster[];
}

/** 两条链最近的两个点之间有多远；bbox 已经分开很远就直接给个上界，不算点对 */
function chainDistance(a: SkeletonPath, b: SkeletonPath, cut: number): number {
  let ax0 = Infinity;
  let ay0 = Infinity;
  let ax1 = -Infinity;
  let ay1 = -Infinity;
  for (const p of a.path) {
    if (p.x < ax0) ax0 = p.x;
    if (p.y < ay0) ay0 = p.y;
    if (p.x > ax1) ax1 = p.x;
    if (p.y > ay1) ay1 = p.y;
  }
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const p of b.path) {
    if (p.x < bx0) bx0 = p.x;
    if (p.y < by0) by0 = p.y;
    if (p.x > bx1) bx1 = p.x;
    if (p.y > by1) by1 = p.y;
  }
  // bbox 之间的空隙已经超过阈值，最近点不可能更近
  const gx = Math.max(0, Math.max(ax0 - bx1, bx0 - ax1));
  const gy = Math.max(0, Math.max(ay0 - by1, by0 - ay1));
  if (Math.hypot(gx, gy) > cut) return Infinity;
  let best = Infinity;
  for (const p of a.path) {
    for (const q of b.path) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best) {
        best = d;
        if (best <= 0) return 0;
      }
    }
  }
  return best;
}

/**
 * 按距离把链聚成连通簇。
 * 两条链的最近距离 ≤ `linkPx` 就并到一簇（传递闭包）。
 */
export function clusterChains(chains: SkeletonPath[], linkPx: number): ClusterResult {
  const n = chains.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const nx = parent[x];
      parent[x] = r;
      x = nx;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (find(i) === find(j)) continue;
      if (chainDistance(chains[i], chains[j], linkPx) <= linkPx) union(i, j);
    }
  }

  const clusterOf = new Array<number>(n).fill(-1);
  const byRoot = new Map<number, PointCluster>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    let c = byRoot.get(root);
    if (!c) {
      c = { ids: [], points: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      byRoot.set(root, c);
    }
    c.ids.push(i);
    for (const p of chains[i].path) {
      c.points += 1;
      if (p.x < c.minX) c.minX = p.x;
      if (p.y < c.minY) c.minY = p.y;
      if (p.x > c.maxX) c.maxX = p.x;
      if (p.y > c.maxY) c.maxY = p.y;
    }
  }

  // 大簇在前：第一条就是主轨迹，画图和「自动连线」都按这个顺序
  const clusters = [...byRoot.values()].sort((a, b) => b.points - a.points);
  clusters.forEach((c, i) => {
    for (const id of c.ids) clusterOf[id] = i;
  });
  return { clusterOf, clusters };
}

/** 调色板：相邻簇颜色差得开，叠在截图上也看得清 */
export const CLUSTER_COLORS = [
  '#00897B',
  '#8E24AA',
  '#3949AB',
  '#00838F',
  '#6D4C41',
  '#558B2F',
  '#C2185B',
  '#546E7A',
];

export function clusterColor(idx: number): string {
  return CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
}
