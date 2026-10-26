// 点云级的两种手工修正：擦掉误检的点、补一条漏掉的直线。
//
// 为什么改「点」而不是改「轨迹」：擦掉一个图标之后要重新聚类、重新找路，改轨迹点就
// 只是把一条画错的线补几笔，下次重连还会错。参考页面最实用的也正是这一手——点一下
// 删掉一圈误检，再让自动/手动去画。
//
// 两个函数都返回新的 `ExtractPointsResult`，`chains` 与 `points` 保持一致，调用方拿到
// 结果直接重聚类即可。

import type { ExtractPointsResult, SkeletonPath, TrackPoint } from './trackExtract';

function rebuild(chains: SkeletonPath[], src: ExtractPointsResult): ExtractPointsResult {
  const seen = new Set<string>();
  const points: TrackPoint[] = [];
  for (const c of chains) {
    for (const p of c.path) {
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ x: p.x, y: p.y });
    }
  }
  return {
    chains,
    points,
    stats: {
      ...src.stats,
      keptChains: chains.length,
      outPoints: points.length,
    },
  };
}

/**
 * 擦掉 (cx,cy) 半径 r 内的点：链被切断后按段保留，太短的碎屑丢掉。
 * `minRunPx` 要小一点，否则擦一下会把附近本来就断的短链一起吃掉。
 */
export function erasePoints(
  src: ExtractPointsResult,
  cx: number,
  cy: number,
  r: number,
  minRunPx = 12,
): ExtractPointsResult {
  const out: SkeletonPath[] = [];
  for (const c of src.chains) {
    let run: TrackPoint[] = [];
    let len = 0;
    const flush = () => {
      if (run.length >= 2 && len >= minRunPx) {
        out.push({ path: run, len, skelPx: Math.max(1, Math.round(len)), area: c.area });
      }
      run = [];
      len = 0;
    };
    for (const p of c.path) {
      if (Math.hypot(p.x - cx, p.y - cy) <= r) {
        flush();
        continue;
      }
      const prev = run[run.length - 1];
      if (prev) len += Math.hypot(p.x - prev.x, p.y - prev.y);
      run.push(p);
    }
    flush();
  }
  return rebuild(out, src);
}

/**
 * 补一条直线（漏提取的直路段）：按骨架点密度加密后当成一条链塞进去，
 * 之后聚类/找路会把它一起考虑。
 */
export function addLinePath(
  src: ExtractPointsResult,
  a: TrackPoint,
  b: TrackPoint,
  stepPx = 2,
): ExtractPointsResult {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 1) return src;
  const n = Math.max(2, Math.ceil(d / Math.max(1, stepPx)));
  const path: TrackPoint[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  const area = src.chains.reduce((m, c) => Math.max(m, c.area), 0);
  return rebuild([...src.chains, { path, len: d, skelPx: Math.round(d), area }], src);
}

/**
 * 画点（自由笔迹）：把手指/鼠标划过的一串坐标按 `stepPx` 加密成一条链塞进点云。
 *
 * 与「补直线」的区别是一个画直线、一个画曲线；与「擦除点」正好互补——误检擦掉，
 * 漏掉的弯道自己描回去。点一下（只有一个坐标）也是有意义的：单点链能桥接两侧
 * 断口，因为它两端都是它自己。
 */
export function addStrokePoints(
  src: ExtractPointsResult,
  stroke: TrackPoint[],
  stepPx = 2,
): ExtractPointsResult {
  if (!stroke.length) return src;
  const step = Math.max(1, stepPx);
  const path: TrackPoint[] = [{ x: stroke[0].x, y: stroke[0].y }];
  for (let i = 1; i < stroke.length; i += 1) {
    const a = stroke[i - 1];
    const b = stroke[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 0.5) continue;
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k += 1) {
      const t = k / n;
      path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  let len = 0;
  for (let i = 1; i < path.length; i += 1) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  const area = src.chains.reduce((m, c) => Math.max(m, c.area), 0);
  return rebuild([...src.chains, { path, len, skelPx: Math.max(1, Math.round(len)), area }], src);
}
