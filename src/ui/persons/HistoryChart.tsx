// 属性历史折线图：自绘 SVG，不引第三方库
import { formatAttrValue } from '../attr';
import { toTs, formatCompact } from '../../core/time';
import type { AttributeDef } from '../../core/types';

const W = 320;
const H = 132;
const PAD = { l: 10, r: 10, t: 20, b: 22 };

export interface ChartPoint {
  changedAt: string;
  value: unknown;
}

/** 只有数值型（number / money / rating）且每条都是数字才画曲线 */
export function numericSeries(def: AttributeDef, points: ChartPoint[]): number[] | null {
  if (!['number', 'money', 'rating'].includes(def.type)) return null;
  const nums: number[] = [];
  for (const p of points) {
    const n = typeof p.value === 'number' ? p.value : Number(p.value);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return nums.length ? nums : null;
}

export function HistoryChart({ def, points }: { def: AttributeDef; points: ChartPoint[] }) {
  const nums = numericSeries(def, points);
  if (!nums) return null;

  const xs = points.map((p) => toTs(p.changedAt) ?? Date.now());
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || Math.max(Math.abs(max), 1);
  const lo = min - span * 0.15;
  const hi = max + span * 0.15;

  const px = (i: number) =>
    nums.length === 1 ? W / 2 : PAD.l + (i * (W - PAD.l - PAD.r)) / (nums.length - 1);
  const py = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);

  const path = nums.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  // 点数多时只标首尾，避免文字互相压住
  const labelled = nums.length <= 7 ? nums.map((_, i) => i) : [0, nums.length - 1];

  return (
    <figure className="hist-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${def.label}历史曲线`}>
        <line className="hist-axis" x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} />
        <path className="hist-line" d={path} />
        {nums.map((v, i) => (
          <circle key={i} className="hist-dot" cx={px(i)} cy={py(v)} r={3} />
        ))}
        {labelled.map((i) => (
          <text key={`v${i}`} className="hist-val" x={px(i)} y={py(nums[i]) - 7} textAnchor="middle">
            {formatAttrValue(def, nums[i])}
          </text>
        ))}
        <text className="hist-date" x={PAD.l} y={H - 6} textAnchor="start">
          {formatCompact(xs[0], true)}
        </text>
        <text className="hist-date" x={W - PAD.r} y={H - 6} textAnchor="end">
          {formatCompact(xs[xs.length - 1], true)}
        </text>
      </svg>
      <figcaption>
        共 {points.length} 次变化 · {formatCompact(xs[0], true)} → {formatCompact(xs[xs.length - 1], true)}
      </figcaption>
    </figure>
  );
}
