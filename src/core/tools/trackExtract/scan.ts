// 扫描：红色掩码 → 闭运算 → 连通域 → 形状校准 → 骨架切链。
// 只得到「点/短链」，不串联、不重采样（那两步在 pipeline.ts）。

import { buildRedMask, closeMask } from './mask';
import { labelComponents, type Component } from './components';
import { pruneSkeleton, skeletonChains, thinZhangSuen, type SkeletonChain } from './skeleton';
import type { ExtractOptions, SkeletonPath } from './types';

/** 取 bbox 内掩码，可选降采样，骨架化后切成简单链，坐标还原到原图 */
function componentChains(
  labels: Int32Array,
  w: number,
  comp: Component,
  scale: number,
): { chains: SkeletonChain[]; skelPx: number; scale: number } {
  const bw = comp.x1 - comp.x0 + 1;
  const bh = comp.y1 - comp.y0 + 1;
  const s = Math.max(1, Math.floor(scale));
  const sw = Math.ceil(bw / s);
  const sh = Math.ceil(bh / s);
  const local = new Uint8Array(sw * sh);
  for (let y = 0; y < bh; y++) {
    const gy = comp.y0 + y;
    const ly = (y / s) | 0;
    for (let x = 0; x < bw; x++) {
      if (labels[gy * w + comp.x0 + x] === comp.label) local[ly * sw + ((x / s) | 0)] = 1;
    }
  }
  const rawSkel = thinZhangSuen(local, sw, sh);
  // 修剪掉 2×2 粗块，保证后续切链拿到的是干净的 1px 图
  const skel = pruneSkeleton(rawSkel, sw, sh);
  let skelPx = 0;
  for (let i = 0; i < skel.length; i++) if (skel[i]) skelPx++;
  const chains = skeletonChains(skel, sw, sh).map((c) => ({
    pts: c.pts.map((p) => ({ x: comp.x0 + p.x * s, y: comp.y0 + p.y * s })),
    endIsNode: c.endIsNode,
    lenPx: c.lenPx * s,
  }));
  return { chains, skelPx, scale: s };
}

/**
 * 判断一个小连通域是不是「十字/星形」图标（如两步路左上角的红色 ✕ 关闭按钮）。
 *
 * 关键特征：✕ 的骨架会切成 **四条等长的短臂**（实测 23,23,23,23），而真实轨迹哪怕
 * 被底图打断，切出来的链也长短悬殊（200,166,126…）。所以判据是：小尺寸 + ≥4 条
 * 臂 + 前四条臂长度接近（最大/最小 ≤ 1.35）+ 臂都很短（≤45px）。
 *
 * 用「等长」而不是「端点个数」判：pruneSkeleton 会把 ✕ 的中心啃成一团度数 3 的
 * 节点，端点计数会变成 0，但「四条 23px 的等长臂」这个结构依然稳。
 */
function looksLikeStarIcon(chains: SkeletonChain[], skelPx: number): boolean {
  if (skelPx > 220) return false; // 大块一定是轨迹，不误伤
  const arms = chains
    .map((c) => c.lenPx)
    .filter((l) => l >= 6)
    .sort((a, b) => b - a);
  if (arms.length < 4) return false;
  const top = arms.slice(0, 4);
  if (top[3] > 45) return false;
  return top[0] / top[3] <= 1.35;
}

export interface ScanResult {
  segs: SkeletonPath[];
  redPx: number;
  droppedBy: Record<string, number>;
  dropped: number;
}

export function scanSkeleton(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  o: ExtractOptions,
): ScanResult {
  // ① 掩码
  let mask = buildRedMask(data, w, h, o);
  let redPx = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) redPx++;

  // ② 闭运算补断口
  if (o.closeIter > 0) mask = closeMask(mask, w, h, o.closeIter);

  // ③ 连通域
  const { labels, comps } = labelComponents(mask, w, h);

  // ④⑤ 形状校准 + 每段主路径
  const droppedBy: Record<string, number> = {};
  const drop = (why: string) => {
    droppedBy[why] = (droppedBy[why] || 0) + 1;
  };
  const segs: SkeletonPath[] = [];
  for (const comp of comps) {
    if (comp.area < o.minArea) {
      drop('面积太小');
      continue;
    }
    const dw = comp.x1 - comp.x0 + 1;
    const dh = comp.y1 - comp.y0 + 1;
    const diag = Math.hypot(dw, dh);
    const fill = comp.area / (dw * dh);
    // 先排除明显实心块（红底标签、按钮），省一次骨架化
    if (fill > 0.62) {
      drop('实心块（图标/按钮）');
      continue;
    }
    const { chains: rawChains, skelPx, scale } = componentChains(labels, w, comp, o.skeletonScale);
    if (skelPx < o.minSkelPx) {
      drop('骨架太短（碎片）');
      continue;
    }
    // 关键校准：线的骨架长必然超过 bbox 对角线；圆环只有 0.5~0.6 倍
    if (skelPx / diag < 0.95) {
      drop('像圆形图标（骨架不弯）');
      continue;
    }
    // 十字/星形图标（✕ 关闭按钮、部分 POI 图标）：四条等长短路臂
    if (looksLikeStarIcon(rawChains, skelPx)) {
      drop('十字/星形图标');
      continue;
    }
    // 骨架切链后逐个收：短且连着分叉点的，是细化产生的毛刺，丢掉；
    // 两端都是"端点"的短链要留——那是轨迹被底图打断的独立小段。
    for (const c of rawChains) {
      if (c.pts.length < 2) continue;
      if (c.lenPx < o.spurPx && (c.endIsNode[0] || c.endIsNode[1])) {
        drop('毛刺');
        continue;
      }
      segs.push({
        path: c.pts,
        len: c.lenPx,
        skelPx: Math.max(1, Math.round(c.pts.length * scale)),
        area: comp.area,
      });
    }
  }
  return { segs, redPx, droppedBy, dropped: Object.values(droppedBy).reduce((a, b) => a + b, 0) };
}
