// 手动布线：在截图点两个点，自动沿「已提取的轨迹」找一条路走过去。
//
// 为什么不是自由手画：手画一条贴着红线的曲线，怎么都不如已有的骨架准，还要额外
// 处理抖动和平滑。而用户真正想表达的往往只是「从这里，沿这条路，到那里」——把这件
// 事交给图搜索，画出来的线天然贴合轨迹，也天然支持原路返回（A→B→A 走两遍）。
//
// 图的形状：
//   · 节点 = 提取结果里的每个点（已平滑、等距重采样）；
//   · 边 = 同一段内相邻的点，权重是像素距离；
//   · 段与段之间不连边——提取器把能接的都接上了，剩下的「断口」就是真的不连通，
//     这时 A→B 按「一条直线」处理，和用户的预期一致。
//
// 于是「重复路径」自然成立：路径是**有序点列**而不是像素集合，A→B→A 会在序列里
// 出现两遍同样的坐标，长度、复现、保存都按两遍算，不会被去重压平。

import type { ExtractResult, TrackPoint } from './trackExtract';

export interface RouteGraph {
  /** 全部节点（像素坐标），按段拼接 */
  pts: TrackPoint[];
  /** 邻接表：to + 权重（像素距离） */
  adj: { to: number; w: number }[][];
  /** 每个节点属于第几段 */
  segOf: number[];
}

/** 极简二叉堆：节点数几千，够用且不占依赖 */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const ti = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = ti;
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
  }
}

/**
 * 从提取结果建图。
 * 只连段内的相邻点：段间的断口是有意留白的，连上会把「不连通」这一个信息抹掉。
 */
export function buildRouteGraph(result: ExtractResult): RouteGraph {
  const pts: TrackPoint[] = [];
  const segOf: number[] = [];
  const ranges: { from: number; to: number }[] = [];
  result.segments.forEach((seg, si) => {
    const from = pts.length;
    for (const p of seg.points) {
      pts.push(p);
      segOf.push(si);
    }
    ranges.push({ from, to: pts.length - 1 });
  });

  const adj: { to: number; w: number }[][] = pts.map(() => []);
  const link = (i: number, j: number) => {
    const w = Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y);
    adj[i].push({ to: j, w });
    adj[j].push({ to: i, w });
  };
  for (const r of ranges) {
    for (let i = r.from; i < r.to; i += 1) link(i, i + 1);
  }
  return { pts, adj, segOf };
}

/** 找到离 (x,y) 最近的节点；超过 maxDist 当作「不在轨迹上」 */
export function nearestNode(
  g: RouteGraph,
  x: number,
  y: number,
  maxDist: number,
): { idx: number; dist: number } | null {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < g.pts.length; i += 1) {
    const p = g.pts[i];
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best >= 0 && bd <= maxDist ? { idx: best, dist: bd } : null;
}

/** 图上最短路；两点不连通返回 null（调用方据此走直线） */
export function shortestPath(g: RouteGraph, a: number, b: number, turnPenalty = 0): TrackPoint[] | null {
  if (a === b) return [g.pts[a]];
  if (turnPenalty > 0) return smoothShortestPath(g, a, b, turnPenalty);
  const n = g.pts.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  dist[a] = 0;
  heap.push(a, 0);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === b) break;
    for (const e of g.adj[u]) {
      const nd = dist[u] + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
        heap.push(e.to, nd);
      }
    }
  }
  if (!done[b]) return null;
  const path: TrackPoint[] = [];
  for (let v = b; v !== -1; v = prev[v]) {
    path.push(g.pts[v]);
    if (v === a) break;
  }
  return path.reverse();
}

/**
 * 带转角惩罚的最短路：状态是「有向边」，所以 Dijkstra 知道「从哪个方向来的」。
 *
 * 为什么需要：纯最短距离在岔路口会贴着最短路切，锯齿一样来回抖；人走路会挑「顺着走」
 * 的那条。代价 = 边长 × (1 + k·(1−cosθ))，θ 是前后两段方向的夹角，直行 θ=0 不加钱，
 * 掉头 θ=180° 加最多。k 取 0.8 时路口基本不会乱拐，也不会为了直而绕远路。
 */
function smoothShortestPath(g: RouteGraph, a: number, b: number, k: number): TrackPoint[] | null {
  const n = g.pts.length;
  // 把无向边拆成两向状态：每条状态记得自己是「从哪里来、到哪里去」
  const from: number[] = [];
  const to: number[] = [];
  const wgt: number[] = [];
  const out: number[][] = Array.from({ length: n }, () => []);
  g.adj.forEach((list, u) => {
    for (const e of list) {
      const id = from.length;
      from.push(u);
      to.push(e.to);
      wgt.push(e.w);
      out[u].push(id);
    }
  });

  const dist = new Float64Array(from.length).fill(Infinity);
  const prev = new Int32Array(from.length).fill(-1);
  const done = new Uint8Array(from.length);
  const heap = new MinHeap();
  for (const s of out[a]) {
    dist[s] = wgt[s];
    heap.push(s, dist[s]);
  }
  let hit = -1;
  while (heap.size) {
    const s = heap.pop();
    if (done[s]) continue;
    done[s] = 1;
    if (to[s] === b) {
      hit = s;
      break;
    }
    const f = from[s];
    const t = to[s];
    const ax = g.pts[t].x - g.pts[f].x;
    const ay = g.pts[t].y - g.pts[f].y;
    const al = Math.hypot(ax, ay) || 1;
    for (const s2 of out[t]) {
      if (done[s2]) continue;
      const nx = g.pts[to[s2]].x - g.pts[t].x;
      const ny = g.pts[to[s2]].y - g.pts[t].y;
      const nl = Math.hypot(nx, ny) || 1;
      const cos = (ax * nx + ay * ny) / (al * nl);
      const extra = wgt[s2] * (1 + k * (1 - cos));
      const nd = dist[s] + extra;
      if (nd < dist[s2]) {
        dist[s2] = nd;
        prev[s2] = s;
        heap.push(s2, nd);
      }
    }
  }
  if (hit < 0) return null;
  const path: TrackPoint[] = [g.pts[b]];
  for (let s = hit; s !== -1; s = prev[s]) {
    path.push(g.pts[from[s]]);
    if (from[s] === a) break;
  }
  return path.reverse();
}

/** 两点之间直接取直线（按 stepPx 加密，密度和重采样点列一致） */
export function straightLine(a: TrackPoint, b: TrackPoint, stepPx = 2): TrackPoint[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / Math.max(0.5, stepPx)));
  const out: TrackPoint[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** 手动路径的长度与「重复经过」统计（重复 = 坐标回到之前走过的位置） */
export function manualStats(pts: TrackPoint[]): { lenPx: number; dupPts: number } {
  let lenPx = 0;
  const seen = new Set<string>();
  let dupPts = 0;
  for (let i = 0; i < pts.length; i += 1) {
    if (i > 0) lenPx += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const key = `${Math.round(pts[i].x)},${Math.round(pts[i].y)}`;
    if (seen.has(key)) dupPts += 1;
    else seen.add(key);
  }
  return { lenPx, dupPts };
}
