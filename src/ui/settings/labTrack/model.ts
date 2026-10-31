// 轨迹提取子页的「纯数据层」：常量、类型、纯函数。
//
// 从 LabTrackSection.tsx 里分出来：这些玩意儿不碰 React 状态，也不读组件里的任何变量，
// 单独放一个文件后，那段 1800 行的组件体就能只管交互。
// 抽离原则：能在这里算完的，绝不搬进组件。

import type {
  ExtractOptions,
  ExtractResult,
  TrackPoint,
} from '../../../core/tools/trackExtract';

/** 主题变量实时读取：canvas 没法用 CSS var，只能取计算后的值；随外观改主题也跟着变 */
export function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** 自动校准的评分：选「留下的红像素多、断口少」的那组参数 */
export function scoreOf(r: ExtractResult): number {
  const { calibration: cal, stats, gaps } = r;
  if (!r.segments.length) return -1e6;
  // 有独立比例尺校准 + 官方里程 → 直接按覆盖率误差评分（最硬的标准）
  if (cal.source === 'scale' && cal.officialM > 0) {
    const err = Math.abs(cal.coverage - 1);
    // 覆盖率超过 1 说明把图标/杂色也算进里程了（假里程），额外扣分——否则评分会
    // 被「多提取 = 覆盖率更接近 1」这种假象骗过去，专挑一堆噪点的参数。
    const over = cal.coverage > 1.03 ? 15 : 0;
    return -err * 100 - over - gaps.length * 0.5;
  }
  // 否则用代理指标：有效像素召回（占红色总量）+ 连续性
  const keptPx = r.segments.reduce((s, x) => s + x.skelPx, 0);
  const recall = stats.redPx > 0 ? Math.min(1, keptPx / (stats.redPx * 0.12)) : 0;
  const continuity = 1 / (1 + gaps.length * 0.6);
  return recall * 0.65 + continuity * 0.35;
}

/** 按米/像素把像素距离说成人话 */
export function fmtLen(m: number): string {
  if (!(m > 0)) return '未定标';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} 公里` : `${Math.round(m)} 米`;
}

// 参数网格：色相窗口是主开关（实测 12° 最能把深红轨迹从卫星底图里捞全），
// 明度/红优势/最小面积只在收噪时微调。第 4 组即默认值。
export const AUTO_GRID: Partial<ExtractOptions>[] = [
  { redSat: 70, redVal: 40, hueHi: 12, rDominance: 1.1, minArea: 200, gapPx: 60 },
  { redSat: 80, redVal: 45, hueHi: 13, rDominance: 1.2, minArea: 300, gapPx: 60 },
  { redSat: 90, redVal: 55, hueHi: 15, rDominance: 1.3, minArea: 500, gapPx: 80 },
  { redSat: 75, redVal: 45, hueHi: 12, rDominance: 1.15, minArea: 300, gapPx: 60 },
  { redSat: 85, redVal: 50, hueHi: 16, rDominance: 1.35, minArea: 400, gapPx: 100 },
  { redSat: 70, redVal: 35, hueHi: 11, rDominance: 1.05, minArea: 150, gapPx: 45 },
];

/** 对比图里的图层：底图 / 提取的点 / 算法轨迹 / AI 优化 / 手动布线 */
export interface Layers {
  img: boolean;
  pts: boolean;
  alg: boolean;
  ai: boolean;
  man: boolean;
}

export type Scheme = 'alg' | 'ai' | 'man';

export const COLOR_AI = '#2196F3';
export const COLOR_ALG = '#d9536b';
export const COLOR_MAN = '#F57C00';
/** 点云用青色：和原图红线、AI 蓝、手动橙都能分开 */
export const COLOR_DOT = '#00897B';

/** 手动布线的一条腿：沿线走 or 两段不连通只能拉直线 */
export interface ManualLeg {
  pts: TrackPoint[];
  straight: boolean;
}

/** 点选时离轨迹多远以内算「点在轨迹上」 */
export const SNAP_PX = 18;
/** 手动布线的转角权重：直行不加钱，急转加价，路口就不会来回切 */
export const TURN_K = 0.8;

/** 顶部「1 导入 → 5 落图」的步骤按钮：序号 + 文案。
 *  原样搬自组件内，只是提到了模块级——它每次渲染都是同一份，没必要跟着组件重建。 */
export const STEPS: { n: 1 | 2 | 3 | 4 | 5; label: string }[] = [
  { n: 1, label: '导入图片' },
  { n: 2, label: '自动取点' },
  { n: 3, label: '修点' },
  { n: 4, label: '画路径' },
  { n: 5, label: '地图对齐' },
];
