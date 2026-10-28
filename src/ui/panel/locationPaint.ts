// 定位轨迹的着色：速度色阶 + 点样式。
//
// 用户看到一条线时最想知道的是「哪一段快、哪一段慢」，所以线不再是一个颜色，
// 而是按相邻两点的速度分档染色；颜色本身从当前主题色派生（同一色相、浅→深），
// 换主题时整条线跟着换，不用另配一套调色板。
//
// 性能：一条轨迹可能有上千个点，逐段一条 polyline 会拖死渲染。这里把
// 「同一个档位且首尾相接」的段合并成一条折线，最终只有 ≤7 条多段线。

import { segmentSpeeds } from '../../core/location/format';
import { tintHex } from '../theme';

/** 0 到当前轨迹最高速度等分六档；另有 -1 表示速度未知。 */
export const SPEED_BUCKETS = 6;

export function maxTrackSpeed(speeds: (number | null)[]): number | null {
  return speeds.reduce<number | null>((max, speed) =>
    speed === null || !Number.isFinite(speed) ? max : Math.max(max ?? 0, speed), null);
}

/** 落到第几档；速度未知（时间没前进 / 时间解析不出来）给 -1 */
export function speedBucket(kmh: number | null, maxSpeed: number | null): number {
  if (kmh === null || !Number.isFinite(kmh) || maxSpeed === null) return -1;
  if (maxSpeed <= 0) return 0;
  return Math.min(SPEED_BUCKETS - 1, Math.floor(Math.max(0, kmh) / maxSpeed * SPEED_BUCKETS));
}

/** 速度色阶（慢 → 快）：主题色从浅到深；「未知」用低饱和中性色，不占色阶位置 */
export function speedColors(accent: string): { ramp: string[]; unknown: string } {
  const ramp = Array.from({ length: SPEED_BUCKETS }, (_, i) => {
    const t = SPEED_BUCKETS > 1 ? i / (SPEED_BUCKETS - 1) : 0;
    // 跨度拉大：相邻档差 10% 亮度才分得出来；最浅档也不能淡到看不见
    return tintHex(accent, 0.74 - 0.5 * t, 0.66 + 0.34 * t);
  });
  return { ramp, unknown: tintHex(accent, 0.56, 0.12) };
}

export interface SpeedLine {
  color: string;
  /** 多段折线：每段都是一串 [lat, lng] */
  parts: [number, number][][];
}

/**
 * 把轨迹拆成「按速度着色」的折线。
 *
 * 相邻两点的速度决定这一小段的颜色；同档位且首尾相接的段合并成一条，
 * 所以点再多也只有 ≤7 条 polyline，靠 canvas 渲染基本不花时间。
 */
export function speedLines(pts: { lat: number; lng: number; ts: string }[], accent: string): SpeedLine[] {
  if (pts.length < 2) return [];
  const { ramp, unknown } = speedColors(accent);
  const groups = new Map<number, SpeedLine>();
  const chainTail = new Map<number, [number, number][]>();
  const speeds = segmentSpeeds(pts);
  const maxSpeed = maxTrackSpeed(speeds);

  for (let i = 0; i < speeds.length; i += 1) {
    const bucket = speedBucket(speeds[i], maxSpeed);
    const a: [number, number] = [pts[i].lat, pts[i].lng];
    const b: [number, number] = [pts[i + 1].lat, pts[i + 1].lng];
    let group = groups.get(bucket);
    if (!group) {
      group = { color: bucket < 0 ? unknown : ramp[bucket], parts: [] };
      groups.set(bucket, group);
    }
    const tail = chainTail.get(bucket);
    // 上一段同档位且正好接到这段的起点：直接延长，别另起一条
    if (tail && tail.length > 1) {
      const end = tail[tail.length - 1];
      if (end[0] === a[0] && end[1] === a[1]) {
        tail.push(b);
        continue;
      }
    }
    const part: [number, number][] = [a, b];
    group.parts.push(part);
    chainTail.set(bucket, part);
  }

  // 慢的在下、快的在上：深色（快）盖住浅色（慢）时更好分辨
  return [...groups.entries()].sort((x, y) => x[0] - y[0]).map(([, g]) => g);
}
