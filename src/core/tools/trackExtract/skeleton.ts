// ④ 骨架化（Zhang-Suen 细化 → 修剪成 1px → 在分叉/端点处切成简单链）。
//
// 为什么不「两次 BFS 求直径」：那条路只能在树上走一条简单路径，一遇到分叉就
// 抄近路——实测卫星图截图上，直径路径会直接从一侧斜穿到另一侧，把马腿、马鬃
// 那种支线全跳过（漏掉 28% 的骨架，画出来就是一条假直线）。正确做法是在度数
// ≠2 的点（端点/分叉）把骨架切成简单链，再整体串联：每条链都走一遍。

import type { TrackPoint } from './types';

const NB8: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export interface SkeletonChain {
  pts: TrackPoint[];
  /** 两端是否是分叉/端点（用来区分「支线毛刺」与「独立断段」） */
  endIsNode: [boolean, boolean];
  lenPx: number;
}

function chainLen(pts: TrackPoint[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return s;
}

/** 对局部二值图做 Zhang-Suen 细化；返回同尺寸骨架掩码 */
export function thinZhangSuen(src: Uint8Array, w: number, h: number): Uint8Array {
  const img = src.slice();
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]);
  let changed = true;
  const toClear: number[] = [];
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toClear.length = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!img[y * w + x]) continue;
          const p2 = at(x, y - 1);
          const p3 = at(x + 1, y - 1);
          const p4 = at(x + 1, y);
          const p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1);
          const p7 = at(x - 1, y + 1);
          const p8 = at(x - 1, y);
          const p9 = at(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
          if (A !== 1) continue;
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }
          toClear.push(y * w + x);
        }
      }
      if (toClear.length) {
        changed = true;
        for (const p of toClear) img[p] = 0;
      }
    }
  }
  return img;
}

/**
 * 骨架修剪：删掉「冗余像素」把 2×2 的粗块压成单像素。
 *
 * Zhang-Suen 保证 8-连通、但**不保证处处 1px 宽**——粗线拐角、两条线贴近处会
 * 留下 2×2 实心块，里头每个点的度数都是 3~4。实测一张卫星图截图里 34% 的骨架点
 * 度数≥3，切链时炸成 1275 条碎片（大部分长度 1），串联必然乱。
 *
 * 判据：删掉这个点之后，它的邻居之间还能互相走到（局部连通性不变）→ 这个点是
 * 多余的。端点（度数 1）永远不删，否则线会被啃短。
 */
export function pruneSkeleton(skel: Uint8Array, w: number, h: number, iter = 3): Uint8Array {
  const img = skel.slice();
  const nbrOf = (x: number, y: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const [dx, dy] of NB8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (img[ny * w + nx]) out.push([nx, ny]);
    }
    return out;
  };
  /** p 的邻居（去掉 p）之间是否仍然 8-连通 */
  const neighborsConnected = (ns: [number, number][]): boolean => {
    if (ns.length <= 1) return true;
    const set = new Set(ns.map(([a, b]) => `${a},${b}`));
    const seen = new Set<string>([`${ns[0][0]},${ns[0][1]}`]);
    const stack = [ns[0]];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      for (const [dx, dy] of NB8) {
        const k = `${cx + dx},${cy + dy}`;
        if (!set.has(k) || seen.has(k)) continue;
        seen.add(k);
        stack.push([cx + dx, cy + dy]);
      }
    }
    return seen.size === set.size;
  };

  for (let it = 0; it < iter; it++) {
    let removed = 0;
    // 逐点判断、立即删除：一轮里批量删两个相邻点会把线剪断（判定都基于删除前的
    // 状态，但实际同时消失），img1 那张细线截图就是被这一步啃成 168px 的。
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!img[y * w + x]) continue;
        const ns = nbrOf(x, y);
        if (ns.length < 2) continue; // 端点/孤立点保留
        if (!neighborsConnected(ns)) continue;
        img[y * w + x] = 0;
        removed++;
      }
    }
    if (!removed) break;
  }
  return img;
}

/** 把骨架切成简单链：从每个「度数≠2」的点出发走未走过的边，剩下的孤立环单独成链 */
export function skeletonChains(skel: Uint8Array, w: number, h: number): SkeletonChain[] {
  const mark = new Uint8Array(w * h);
  const pts: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (skel[i]) {
      mark[i] = 1;
      pts.push(i);
    }
  }
  if (!pts.length) return [];

  const deg = new Uint8Array(w * h);
  // 8-邻接 + 「对角冗余」修正：若 (x+dx, y) 与 (x, y+dy) 都在，则对角 (x+dx, y+dy)
  // 不算真邻居。不做这一步，45° 斜线骨架会凭空长出大量度数 3 的伪分叉点，
  // 一条线被切成十几段碎片，串联时顺序全乱（实测卫星图就是这样崩的）。
  const nbrs = (p: number): number[] => {
    const px = p % w;
    const py = (p - px) / w;
    const out: number[] = [];
    for (const [dx, dy] of NB8) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (!mark[ny * w + nx]) continue;
      if (dx && dy) {
        const side1 = mark[py * w + nx];
        const side2 = mark[ny * w + px];
        if (side1 && side2) continue;
      }
      out.push(ny * w + nx);
    }
    return out;
  };
  for (const p of pts) deg[p] = Math.min(9, nbrs(p).length);

  const isNode = (p: number) => deg[p] !== 2;
  const visited = new Set<number>();
  const key = (a: number, b: number) => (a < b ? a * (w * h) + b : b * (w * h) + a);
  const chains: SkeletonChain[] = [];

  const walk = (from: number, to: number): number[] => {
    const chain = [from, to];
    visited.add(key(from, to));
    let prev = from;
    let cur = to;
    while (!isNode(cur)) {
      const cands = nbrs(cur).filter((n) => n !== prev && !visited.has(key(cur, n)));
      if (!cands.length) break;
      const n = cands[0];
      visited.add(key(cur, n));
      chain.push(n);
      prev = cur;
      cur = n;
    }
    return chain;
  };

  const toPt = (p: number): TrackPoint => {
    const x = p % w;
    return { x, y: (p - x) / w };
  };

  for (const p of pts) {
    if (!isNode(p)) continue;
    for (const q of nbrs(p)) {
      if (visited.has(key(p, q))) continue;
      const idxs = walk(p, q);
      const arr = idxs.map(toPt);
      chains.push({
        pts: arr,
        endIsNode: [true, isNode(idxs[idxs.length - 1])],
        lenPx: chainLen(arr),
      });
    }
  }
  // 剩下的纯环（度数全 2）
  for (const p of pts) {
    for (const q of nbrs(p)) {
      if (visited.has(key(p, q))) continue;
      const idxs = walk(p, q);
      const arr = idxs.map(toPt);
      // 闭环：首尾相接
      if (Math.hypot(arr[0].x - arr[arr.length - 1].x, arr[0].y - arr[arr.length - 1].y) < 1.6) {
        arr.push({ x: arr[0].x, y: arr[0].y });
      }
      chains.push({ pts: arr, endIsNode: [false, false], lenPx: chainLen(arr) });
    }
  }
  return chains;
}
