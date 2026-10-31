// ① 红色掩码 + ② 形态学（膨胀 / 腐蚀 / 闭）。
//
// 掩码不是「取红色像素」，而是三条判据同时成立：
//   HSV 双端色相（红 0~hueHi / 品红 hueLo~180）+ 饱和度明度下限
//   + **R 通道优势**（r > ratio·g 且 r > ratio·b）。
// 最后一条是关键：两步路底图里橙黄色道路（h≈25~40）和蓝色水面（h≈200）在 HSV
// 上离红不远，光靠色相会把「奉桐线」那种黄色道路吃进来，加一条 RGB 上的红优势
// 判据就干净了。

import type { ExtractOptions } from './types';

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
