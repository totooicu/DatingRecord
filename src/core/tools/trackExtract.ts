// 轨迹提取（两步路截图 → 有序轨迹点）。
//
// 这不是「取红色像素导坐标」，而是一条完整的 提取 → 校准 → 插值 流水线：
//
//   ① 红色掩码：HSV 双端色相（红 0~hueHi / 品红 hueLo~180）+ 饱和度明度下限
//      + **R 通道优势**（r > ratio·g 且 r > ratio·b）。后者是关键：两步路底图里
//      橙黄色道路（h≈25~40）和蓝色水面（h≈200）在 HSV 上离红不远，光靠色相会把
//      「奉桐线」那种黄色道路吃进来，加一条 RGB 上的红优势判据就干净了。
//   ② 形态学闭运算补 1~3px 的细断口（截图缩放会把手绘线打散）。
//   ③ 连通域 + 形状校准：轨迹是**细长弯曲的线**，而 UI 上的红圈「终」、红色 POI
//      图标、左上关闭按钮都是**圆形/实心块**。判据是「骨架长 / bbox 对角线」——
//      一条线的骨架长必然明显超过 bbox 对角线；圆环只有对角线的 0.5~0.6 倍。
//      这一条能把红圈按钮从轨迹里踢出去，是原版工具（只按面积过滤）做不到的。
//   ④ 每段骨架化（Zhang-Suen）→ 修剪成 1px → 在分叉/端点处切成若干「简单链」，
//      这样分叉处的每条支线都会被走到，不会被抄近路画成假直线。
//   ⑤ 自动画路径（见 trackAuto.ts）：按连通簇分组后，在「点 + 邻接」图上找最长测地线
//      当主干；主轴之外的短枝丢掉、长枝按往返写回点列。**跨簇不连**、**不跨 gapPx 硬接**。
//   ⑥ 插值：弧长参数化 → 等距重采样（resamplePx）→ 移动平均平滑（smoothWin），
//      输出的点间距均匀，可直接喂给地图/绘图，也可按需加密。
//   ⑦ 校准：截图里有人眼一看就有的「官方里程」。给一个里程，就把整条路径换算成
//      米制（mPerPx = 里程米 / 路径像素长），同时算出「提取覆盖率」——这才是可
//      量化的精度指标：覆盖率 100% 说明一条红线都没漏。
//
// 纯函数、不碰 DOM：输入 ImageData 的 data 数组，输出点列。UI 只负责画和导出。

import { autoOrder } from './trackAuto';

export interface TrackPoint {
  x: number;
  y: number;
}

/** 一段连续轨迹（断口切开后的一段） */
export interface TrackSegment {
  /** 已平滑、等距重采样的点（图像像素坐标，原点左上，y 向下） */
  points: TrackPoint[];
  /** 段内累计长度（像素） */
  lengthPx: number;
  /** 原始骨架像素数，用于报告 */
  skelPx: number;
  /** 原始连通域面积（像素） */
  area: number;
}

export interface ExtractOptions {
  /** 饱和度下限 0~255 */
  redSat: number;
  /** 明度下限 0~255 */
  redVal: number;
  /** 红色色相上界（°），通常 10~18 */
  hueHi: number;
  /** 品红色相下界（°），通常 160~172 */
  hueLo: number;
  /** R 相对 G/B 的优势倍数，1.0 = 不做判据，1.3~1.5 较稳 */
  rDominance: number;
  /** 连通域最小面积（像素），小于此视为噪点 */
  minArea: number;
  /** 骨架最短长度（像素），小于此视为图标/碎片 */
  minSkelPx: number;
  /** 毛刺阈值（像素）：短于此且一端连着分叉点的链视为细化毛刺，丢弃 */
  spurPx: number;
  /** 闭运算迭代次数（3x3），0 = 不做 */
  closeIter: number;
  /** 允许串联的最大段间距（像素），超过则断成两段 */
  gapPx: number;
  /** 平滑窗口（奇数，点数），1 = 不平滑 */
  smoothWin: number;
  /** 重采样点间距（像素） */
  resamplePx: number;
  /** 最终成段后的最小长度（像素），短于此视为噪点碎片丢弃（几米量级，无意义） */
  minFinalPx: number;
  /** 骨架计算的降采样倍数（1 = 原分辨率，2 = 快 4 倍、误差 <=2px） */
  skeletonScale: number;
  /** 官方里程（公里）：用于输出米制坐标，或（与比例尺同给时）验收覆盖率 */
  mileageKm: number;
  /** 截图比例尺代表的米数（如 500m 那条 = 500）；与 scalePx 同时 >0 才生效 */
  scaleMeter: number;
  /** 比例尺条在截图上的像素宽度 */
  scalePx: number;
}

export const DEFAULT_OPTIONS: ExtractOptions = {
  redSat: 75,
  redVal: 45,
  hueHi: 12,
  hueLo: 165,
  rDominance: 1.15,
  minArea: 300,
  minSkelPx: 24,
  spurPx: 16,
  closeIter: 2,
  gapPx: 60,
  smoothWin: 9,
  resamplePx: 2,
  minFinalPx: 45,
  // 必须 1：2x max-pool 会把 4~6px 的线拍成 2px 偶数宽，Zhang-Suen 细化不了
  // 偶数宽线（每个点都是关键点），骨架变成一片双排像素，切链时炸成几百条碎片。
  skeletonScale: 1,
  mileageKm: 0,
  scaleMeter: 0,
  scalePx: 0,
};

export interface Calibration {
  /** 每像素多少米；0 表示没校准 */
  mPerPx: number;
  /**
   * 比例尺来源：
   * - `scale`   用截图比例尺独立定标（最可信，可用来验收里程）
   * - `mileage` 用官方里程反推（能出米制坐标，但没有独立精度指标）
   * - `none`    没给任何校准信息，只输出像素
   */
  source: 'scale' | 'mileage' | 'none';
  /** 路径总像素长 */
  totalPx: number;
  /** 按 mPerPx 换算的路径总长（米） */
  totalM: number;
  /** 官方里程（米），没填为 0 */
  officialM: number;
  /**
   * 覆盖率 = 提取米数 / 官方里程。只有 `source === 'scale'` 且填了里程时才有效，
   * 否则为 -1（不适用）——这是本工具的精度指标：1.0 = 一条红线都没漏。
   */
  coverage: number;
}

export interface ExtractResult {
  /** 断口切开的各段（顺序即行走顺序），首段是主段 */
  segments: TrackSegment[];
  /** 断口记录：在哪两段之间、间距多少像素（被 gapPx 判为「不接」的） */
  gaps: { afterSegment: number; distPx: number }[];
  calibration: Calibration;
  stats: {
    /** 红色掩码像素数 */
    redPx: number;
    /** 通过校准的段数 */
    keptSegments: number;
    /** 被丢弃的段数 */
    droppedSegments: number;
    /** 丢弃原因统计 */
    droppedBy: Record<string, number>;
    /** 输出总点数 */
    outPoints: number;
    /** 耗时（毫秒） */
    ms: number;
  };
}

/* ------------------------------------------------------------------ */
/* ① 红色掩码                                                          */
/* ------------------------------------------------------------------ */

export function buildRedMask(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  o: ExtractOptions,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const satMin = o.redSat;
  const valMin = o.redVal;
  const ratio = o.rDominance;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    // 快速淘汰：红色必须足够亮，且 R 明显压过 G/B（整数比较，不做除法）
    if (r < valMin) continue;
    if (r * 100 < g * ratio * 100 || r * 100 < b * ratio * 100) continue;

    const max = r > g ? (r > b ? r : b) : g > b ? g : b;
    const min = r < g ? (r < b ? r : b) : g < b ? g : b;
    if (max === 0) continue;
    const s = ((max - min) * 255) / max;
    if (s < satMin) continue;

    const d = max - min;
    let hue = 0;
    if (d !== 0) {
      if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) hue = ((b - r) / d + 2) * 60;
      else hue = ((r - g) / d + 4) * 60;
    }
    if (hue <= o.hueHi || hue >= o.hueLo) mask[i] = 1;
  }
  return mask;
}

/* ------------------------------------------------------------------ */
/* ② 形态学：膨胀 / 腐蚀 / 闭                                            */
/* ------------------------------------------------------------------ */

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) {
        out[i] = 1;
        continue;
      }
      let hit = 0;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (mask[ny * w + nx]) {
            hit = 1;
            break;
          }
        }
      }
      out[i] = hit;
    }
  }
  return out;
}

function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let all = 1;
      for (let dy = -1; dy <= 1 && all; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) {
          all = 0;
          break;
        }
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) {
            all = 0;
            break;
          }
          if (!mask[ny * w + nx]) {
            all = 0;
            break;
          }
        }
      }
      out[i] = all;
    }
  }
  return out;
}

/** 闭运算：先膨胀后腐蚀，补细小断口，不改变整体形状 */
export function closeMask(mask: Uint8Array, w: number, h: number, iter: number): Uint8Array {
  let m = mask;
  for (let k = 0; k < iter; k++) {
    m = erode(dilate(m, w, h), w, h);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* ③ 连通域                                                            */
/* ------------------------------------------------------------------ */

export interface Component {
  label: number;
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function labelComponents(
  mask: Uint8Array,
  w: number,
  h: number,
): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(w * h).fill(-1);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let seed = 0; seed < w * h; seed++) {
    if (!mask[seed] || labels[seed] !== -1) continue;
    const label = comps.length;
    let sp = 0;
    stack[sp++] = seed;
    labels[seed] = label;
    let area = 0;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const px = p % w;
      const py = (p - px) / w;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      // 8-邻接
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const ni = ny * w + nx;
          if (mask[ni] && labels[ni] === -1) {
            labels[ni] = label;
            stack[sp++] = ni;
          }
        }
      }
    }
    comps.push({ label, area, x0, y0, x1, y1 });
  }
  return { labels, comps };
}

/* ------------------------------------------------------------------ */
/* ④ 骨架化（Zhang-Suen 细化）                                          */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* ⑤ 骨架 → 简单链（分叉处切开）                                        */
/* ------------------------------------------------------------------ */

// 为什么不用「两次 BFS 求直径」：那条路只能在树上走一条简单路径，一遇到分叉就
// 抄近路——实测卫星图截图上，直径路径会直接从一侧斜穿到另一侧，把马腿、马鬃
// 那种支线全跳过（漏掉 28% 的骨架，画出来就是一条假直线）。正确做法是在度数
// ≠2 的点（端点/分叉）把骨架切成简单链，再整体串联：每条链都走一遍。

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

/* ------------------------------------------------------------------ */
/* ⑥ 插值：重采样 + 平滑                                                */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* ⑦ 主流程                                                            */
/* ------------------------------------------------------------------ */

/** 骨架切出来的一段简单链（还没串联成「轨迹」，也没有整体顺序） */
export interface SkeletonPath {
  path: TrackPoint[];
  len: number;
  skelPx: number;
  area: number;
}

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


/** 扫描：红色掩码 → 闭运算 → 连通域 → 形状校准 → 骨架切链。只得到「点/短链」，不串联、不重采样 */
interface ScanResult {
  segs: SkeletonPath[];
  redPx: number;
  droppedBy: Record<string, number>;
  dropped: number;
}

function scanSkeleton(
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
export interface ExtractPointsResult {
  /** 保留下来的骨架链（只是短链，没有整体顺序；自动连线要用） */
  chains: SkeletonPath[];
  /** 去重后的骨架点：画在图上就是点云，也是「有多少点」的答案 */
  points: TrackPoint[];
  stats: {
    /** 红色掩码像素数 */
    redPx: number;
    /** 留下的骨架链数 */
    keptChains: number;
    /** 被丢弃的色块数 */
    droppedSegments: number;
    /** 丢弃原因统计 */
    droppedBy: Record<string, number>;
    /** 输出的点数 */
    outPoints: number;
    /** 耗时（毫秒） */
    ms: number;
  };
}

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
  const points: TrackPoint[] = [];
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

/* ------------------------------------------------------------------ */
/* 导出 CSV                                                            */
/* ------------------------------------------------------------------ */

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
