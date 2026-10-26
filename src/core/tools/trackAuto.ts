// 自动画路径：在一张「点 + 邻接」的图上找一条走完所有红线的顺序。
//
// 为什么不用贪心拼链：贪心只看「下一段离当前端点最近」，分叉处一旦选错，两支会被接成
// 一条回折的线，长度虚增、图上还多出一条斜线。参考页面更粗暴——BFS 确认连通后按 x,y
// 排序连起来，等于横着扫一遍，根本没在找路。
//
// 这里的做法是图论里最贴题的那个：**图的最长测地线（近似直径）当主干**。
//   ① 节点 = 骨架像素去重后的点；边 = 链内相邻点 + 同簇链端点与邻近点的桥接边；
//   ② 从任一端点出发做一次 Dijkstra 到最远点 u，再从 u 做一次到最远点 v，
//      u→v 就是这张图上最长的简单路径——一条轨迹本来就该这么长；
//   ③ 主轴之外剩下的边按连通块处理：短于 spurPx 的是细化毛刺，丢掉；
//      只挂在一个点上的长枝按「往返」写进点列（原路走回来）；
//      挂在两个点上的旁支（环线剩下的那半圈）在末尾接回去，整圈走一遍。
//
// 输出是**有序点列**而不是像素集合，所以往返那段会真的出现两遍坐标，和手动布线的
// 「点复用」是同一套语义。

import type { SkeletonPath, TrackPoint } from './trackExtract';

interface Adj {
  to: number;
  w: number;
}

/** 小顶堆：节点数千级，够用且不引依赖 */
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

interface Graph {
  pts: TrackPoint[];
  adj: Adj[][];
  chainOf: number[];
}

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/** 把一组链拼成一张无向图：链内相邻点，链端点桥接到同簇邻近点 */
function buildGraph(chains: SkeletonPath[], linkPx: number): Graph {
  const pts: TrackPoint[] = [];
  const adj: Adj[][] = [];
  const chainOf: number[] = [];
  const idOf = new Map<string, number>();

  const nodeAt = (p: TrackPoint, ci: number): number => {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const k = `${x},${y}`;
    const hit = idOf.get(k);
    if (hit != null) return hit;
    const id = pts.length;
    idOf.set(k, id);
    pts.push({ x, y });
    adj.push([]);
    chainOf.push(ci);
    return id;
  };

  const edges = new Set<string>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    const k = edgeKey(a, b);
    if (edges.has(k)) return;
    edges.add(k);
    const w = Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
  };

  const ends: number[] = [];
  chains.forEach((c, ci) => {
    let prev = -1;
    for (const p of c.path) {
      const id = nodeAt(p, ci);
      if (prev >= 0) link(prev, id);
      prev = id;
    }
    if (prev >= 0) ends.push(c.path.length ? nodeAt(c.path[0], ci) : prev, prev);
  });

  // 桶索引：桥接边只查附近几个格子，避免几千点两两比
  const cell = Math.max(4, linkPx);
  const buckets = new Map<string, number[]>();
  const bkey = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  pts.forEach((p, i) => {
    const k = bkey(p.x, p.y);
    const arr = buckets.get(k);
    if (arr) arr.push(i);
    else buckets.set(k, [i]);
  });

  // 端点 → 邻链最近点：这就是「断了几像素的红线」在图上重新连起来的地方
  for (const u of new Set(ends)) {
    const cx = Math.floor(pts[u].x / cell);
    const cy = Math.floor(pts[u].y / cell);
    let best = -1;
    let bd = linkPx;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const v of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (chainOf[v] === chainOf[u]) continue;
          const d = Math.hypot(pts[v].x - pts[u].x, pts[v].y - pts[u].y);
          if (d <= bd) {
            bd = d;
            best = v;
          }
        }
      }
    }
    if (best >= 0) link(u, best);
  }
  return { pts, adj, chainOf };
}

/** Dijkstra；allowed 非空时只在这批节点里走 */
function dijkstra(
  g: Graph,
  src: number,
  allowed?: Set<number>,
): { dist: Float64Array; prev: Int32Array } {
  const n = g.pts.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  dist[src] = 0;
  heap.push(src, 0);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    for (const e of g.adj[u]) {
      if (allowed && !allowed.has(e.to)) continue;
      const nd = dist[u] + e.w;
      if (nd < dist[e.to]) {
        dist[e.to] = nd;
        prev[e.to] = u;
        heap.push(e.to, nd);
      }
    }
  }
  return { dist, prev };
}

function farthest(dist: Float64Array, allowed?: Set<number>): number {
  let best = -1;
  let bd = -Infinity;
  for (let i = 0; i < dist.length; i += 1) {
    if (allowed && !allowed.has(i)) continue;
    if (dist[i] < Infinity && dist[i] > bd) {
      bd = dist[i];
      best = i;
    }
  }
  return best;
}

function pathTo(prev: Int32Array, from: number, to: number): number[] {
  const out: number[] = [];
  for (let v = to; v !== -1; v = prev[v]) {
    out.push(v);
    if (v === from) break;
  }
  return out.reverse();
}

/** 连通分量；只走没用过的边时就是「主轴之外剩下什么」 */
function components(g: Graph, used: Set<string> | null): number[][] {
  const seen = new Uint8Array(g.pts.length);
  const out: number[][] = [];
  for (let s = 0; s < g.pts.length; s += 1) {
    if (seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const u = stack.pop() as number;
      comp.push(u);
      for (const e of g.adj[u]) {
        if (used && used.has(edgeKey(u, e.to))) continue;
        if (seen[e.to]) continue;
        seen[e.to] = 1;
        stack.push(e.to);
      }
    }
    out.push(comp);
  }
  return out;
}

/** 把一张连通图排成一条有序点列（含往返的重复点） */
function orderGraph(g: Graph, spurPx: number): TrackPoint[] {
  if (g.pts.length < 2) return g.pts.slice();

  // ① 最长测地线：两次单源最短路就是这张图的「直径」（树上精确）
  const ends = g.adj.map((a, i) => (a.length === 1 ? i : -1)).filter((i) => i >= 0);
  const d0 = dijkstra(g, ends.length ? ends[0] : 0);
  const u = farthest(d0.dist);
  if (u < 0) return g.pts.slice();
  const d1 = dijkstra(g, u);
  const v = farthest(d1.dist);
  if (v < 0 || v === u) return [g.pts[u]];
  const main = pathTo(d1.prev, u, v);

  // ② 主轴用过的边打标，剩下的按连通块分类
  const used = new Set<string>();
  for (let i = 1; i < main.length; i += 1) used.add(edgeKey(main[i - 1], main[i]));
  const mainAt = new Map<number, number>();
  main.forEach((id, i) => mainAt.set(id, i));

  type Insert = { anchor: number; walk: number[] };
  const inserts: Insert[] = [];
  const loops: number[] = [];
  for (const comp of components(g, used)) {
    const allowed = new Set(comp);
    // 这块剩下的边整块挂在主轴上的哪几个点
    const attach = comp.filter((id) => mainAt.has(id)).sort((a, b) => mainAt.get(a)! - mainAt.get(b)!);
    if (!attach.length) continue;
    const a0 = attach[0];
    const dA = dijkstra(g, a0, allowed);
    const far = farthest(dA.dist);
    if (far < 0) continue;
    if (attach.length >= 2) {
      // 旁支把两个主节点连起来（环线剩下那半圈）：整条主轴走完再绕回来
      const a1 = attach[attach.length - 1];
      if (!Number.isFinite(dA.dist[a1])) continue;
      if (a1 === main[main.length - 1]) {
        loops.push(...pathTo(dA.prev, a0, a1).reverse());
      } else if (dA.dist[a1] >= spurPx) {
        inserts.push({ anchor: mainAt.get(a0)!, walk: pathTo(dA.prev, a0, a1) });
      }
      continue;
    }
    if (dA.dist[far] < spurPx) continue; // 短枝 = 细化毛刺/图标残渣
    inserts.push({ anchor: mainAt.get(a0)!, walk: pathTo(dA.prev, a0, far) });
  }

  // ③ 组装：主轴每到一个挂点，就把往返那段插进去
  inserts.sort((a, b) => a.anchor - b.anchor);
  const out: number[] = [];
  const byAnchor = new Map<number, number[][]>();
  for (const ins of inserts) {
    const arr = byAnchor.get(ins.anchor);
    if (arr) arr.push(ins.walk);
    else byAnchor.set(ins.anchor, [ins.walk]);
  }
  main.forEach((id, i) => {
    out.push(id);
    for (const walk of byAnchor.get(i) ?? []) {
      const forward = walk.slice(1);
      for (const w of forward) out.push(w);
      for (let k = forward.length - 1; k >= 0; k -= 1) out.push(forward[k]); // 原路走回来
    }
  });
  for (const id of loops) out.push(id);

  // ④ 转成点列；相邻重复坐标只留一个（往返拐点处会天然重复）
  const pts: TrackPoint[] = [];
  for (const id of out) {
    const p = g.pts[id];
    const last = pts[pts.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

/** 取出图里的一块，节点下标重排，chainOf 跟着走 */
function subGraph(g: Graph, ids: number[]): { g: Graph; map: number[] } {
  const map = new Map<number, number>();
  ids.forEach((id, i) => map.set(id, i));
  const g2: Graph = { pts: ids.map((id) => g.pts[id]), adj: ids.map(() => []), chainOf: ids.map((id) => g.chainOf[id]) };
  ids.forEach((id, i) => {
    for (const e of g.adj[id]) {
      const j = map.get(e.to);
      if (j != null) g2.adj[i].push({ to: j, w: e.w });
    }
  });
  return { g: g2, map: ids };
}

/**
 * 一组链 → 若干条有序点列（每条是一段「走完一片红线」的路线）。
 *
 * 传进来的通常已经是**一个连通簇**，所以结果一般只有一条；没有簇信息时（CLI 直接给全部链）
 * 图上会有好几块互不相连的红线，这里就一块给一条。
 * `spurPx` 以下的旁支当毛刺丢掉；`linkPx` 与聚类的断口阈值一致。
 */
export function autoOrder(chains: SkeletonPath[], linkPx: number, spurPx: number): TrackPoint[][] {
  if (!chains.length) return [];
  const g = buildGraph(chains, linkPx);
  if (g.pts.length < 2) return g.pts.length ? [g.pts.slice()] : [];

  // 桥接只从端点找；万一还是分开，补一次「最近点对」，保证一簇能连成一张图
  let comps = components(g, null);
  for (let guard = 0; comps.length > 1 && guard < 30; guard += 1) {
    let best: [number, number] | null = null;
    let bd = linkPx;
    const compOf = new Int32Array(g.pts.length).fill(-1);
    comps.forEach((c, ci) => c.forEach((id) => (compOf[id] = ci)));
    for (let a = 0; a < g.pts.length; a += 1) {
      for (let b = a + 1; b < g.pts.length; b += 1) {
        if (compOf[a] === compOf[b]) continue;
        const d = Math.hypot(g.pts[b].x - g.pts[a].x, g.pts[b].y - g.pts[a].y);
        if (d <= bd) {
          bd = d;
          best = [a, b];
        }
      }
    }
    if (!best) break;
    const w = Math.hypot(g.pts[best[1]].x - g.pts[best[0]].x, g.pts[best[1]].y - g.pts[best[0]].y);
    g.adj[best[0]].push({ to: best[1], w });
    g.adj[best[1]].push({ to: best[0], w });
    comps = components(g, null);
  }

  // 真的连不起来（几块红线彼此太远）：一块一条，大的在前
  return comps
    .map((ids) => orderGraph(subGraph(g, ids).g, spurPx))
    .filter((p) => p.length >= 2)
    .sort((a, b) => b.length - a.length);
}
