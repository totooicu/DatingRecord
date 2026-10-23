// 用「边缘分割」那套算法把模型给的图片框收一收。
//
// public/edge-split.html 里那套流程（灰度 → 模糊 → Sobel → 膨胀 → 连通区域）
// 对聊天截图里的表情包、头像很有效，这里搬的是同一份算法、同一组默认参数：
//   threshold=80, blur=2, 膨胀 2 次, minArea=3000, margin=5
// 唯一的变化是 minArea / maxArea / margin 会按截图面积等比缩放，
// 否则小截图上的头像会被 3000 这个绝对阈值全部过滤掉。
//
// 用法不是「重新发明一个框」：先把同一张截图切成候选区域，再拿模型框去对，
// 在明显更像照片的候选里挑和模型框最贴的那个。这样分割信息是真的参与决策的。
//
// 全部在本机 canvas 里算，不上传；同一张截图只算一次，多张图片消息共用结果。

import type { ImageBox, Shot } from './index';

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

interface Analysis {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  regions: Region[];
  /** minArea 等参数按截图面积缩放的比例 */
  scale: number;
}

/** edge-split.html 的默认参数（1080×2378 原图下） */
const EDGE_THRESHOLD = 80;
const EDGE_BLUR = 2;
const EDGE_DILATE = 2;
const EDGE_MIN_AREA = 3000;
const EDGE_MAX_AREA = 500000;
const EDGE_MARGIN = 5;
/** 参数基准：edge-split.html 里那张 1080×2378 截图 */
const BASE_AREA = 1080 * 2378;

const cache = new WeakMap<Shot, Promise<Analysis | null>>();

function toGray(data: Uint8ClampedArray): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(data.length / 4);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) | 0;
  }
  return gray;
}

function gaussianBlur(gray: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius <= 0) return gray.slice();
  const kernel: number[] = [];
  const sigma = radius / 2 || 1;
  let sum = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= sum;

  const temp = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        v += gray[y * width + xx] * kernel[k + radius];
      }
      temp[y * width + x] = v;
    }
  }
  const result = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        v += temp[yy * width + x] * kernel[k + radius];
      }
      result[y * width + x] = v;
    }
  }
  return result;
}

function sobelEdge(gray: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const edges = new Uint8Array(gray.length);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sx = 0;
      let sy = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const idx = (y + ky) * width + (x + kx);
          const ki = (ky + 1) * 3 + (kx + 1);
          sx += gray[idx] * gx[ki];
          sy += gray[idx] * gy[ki];
        }
      }
      edges[y * width + x] = Math.sqrt(sx * sx + sy * sy) > threshold ? 255 : 0;
    }
  }
  return edges;
}

function dilate(edges: Uint8Array, width: number, height: number, iterations: number): Uint8Array {
  let result = edges.slice();
  for (let iter = 0; iter < iterations; iter += 1) {
    const temp = result.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        if (temp[y * width + x] === 255) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy += 1) {
          for (let dx = -1; dx <= 1 && !hit; dx += 1) {
            if (temp[(y + dy) * width + (x + dx)] === 255) hit = true;
          }
        }
        if (hit) result[y * width + x] = 255;
      }
    }
  }
  return result;
}

function findContours(edges: Uint8Array, width: number, height: number): Region[] {
  const visited = new Uint8Array(edges.length);
  const queue = new Int32Array(edges.length);
  const regions: Region[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (edges[idx] !== 255 || visited[idx]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = idx;
      visited[idx] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      while (head < tail) {
        const cur = queue[head++];
        count += 1;
        const cx = cur % width;
        const cy = (cur / width) | 0;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nidx = ny * width + nx;
            if (edges[nidx] === 255 && !visited[nidx]) {
              visited[nidx] = 1;
              queue[tail++] = nidx;
            }
          }
        }
      }
      regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area: count });
    }
  }
  return regions;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = src;
  });
}

interface BoxPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlapOf(a: BoxPx, b: BoxPx): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * 「像不像一张照片」：色彩、明暗层次、细碎边缘都算加分；
 * 大片白底 / 深色文字则减分。引用卡片和文字气泡通常白底多、层次少。
 */
function photoScore(ctx: CanvasRenderingContext2D, box: BoxPx): number {
  const x1 = Math.max(0, Math.min(ctx.canvas.width - 1, Math.round(box.x)));
  const y1 = Math.max(0, Math.min(ctx.canvas.height - 1, Math.round(box.y)));
  const x2 = Math.max(x1 + 1, Math.min(ctx.canvas.width, Math.round(box.x + box.w)));
  const y2 = Math.max(y1 + 1, Math.min(ctx.canvas.height, Math.round(box.y + box.h)));
  const data = ctx.getImageData(x1, y1, x2 - x1, y2 - y1);
  const { width, height } = data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 36));
  let n = 0;
  let satSum = 0;
  let lumSum = 0;
  let lumSq = 0;
  let dark = 0;
  let flat = 0;
  let edge = 0;
  let edgeN = 0;
  const lumAt = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
  };
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      n += 1;
      satSum += sat;
      lumSum += lum;
      lumSq += lum * lum;
      if (lum < 80) dark += 1;
      if (sat < 0.06 && lum > 210) flat += 1;
      const nx = Math.min(width - 1, x + step);
      const ny = Math.min(height - 1, y + step);
      const gx = Math.abs(lumAt(nx, y) - lum);
      const gy = Math.abs(lumAt(x, ny) - lum);
      edgeN += 1;
      if (gx + gy > 22) edge += 1;
    }
  }
  if (!n) return 0;
  const satMean = satSum / n;
  const lumMean = lumSum / n;
  const lumStd = Math.sqrt(Math.max(0, lumSq / n - lumMean * lumMean));
  const edgeFrac = edgeN ? edge / edgeN : 0;
  const darkFrac = dark / n;
  const flatFrac = flat / n;
  return satMean * 1.25 + lumStd / 90 + edgeFrac * 1.5 - darkFrac * 0.55 - flatFrac * 0.35;
}

/** 对一张截图做一次完整分割，结果按 Shot 对象缓存 */
function analyze(shot: Shot): Promise<Analysis | null> {
  const hit = cache.get(shot);
  if (hit) return hit;
  const task = (async (): Promise<Analysis | null> => {
    const img = await loadImage(shot.dataUrl);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);

    const total = width * height;
    const scale = total / BASE_AREA;
    const minArea = Math.max(400, Math.round(EDGE_MIN_AREA * scale));
    const maxArea = Math.max(minArea * 2, Math.round(EDGE_MAX_AREA * scale));

    const imageData = ctx.getImageData(0, 0, width, height);
    const gray = toGray(imageData.data);
    const blurred = gaussianBlur(gray, width, height, EDGE_BLUR);
    const edges = sobelEdge(blurred, width, height, EDGE_THRESHOLD);
    const dilated = dilate(edges, width, height, EDGE_DILATE);
    const raw = findContours(dilated, width, height);

    const regions = raw.filter((r) => {
      const aspect = r.w / r.h;
      return r.area >= minArea && r.area <= maxArea && aspect >= 0.4 && aspect <= 2.5;
    });
    regions.sort((a, b) => b.area - a.area);
    return { canvas, ctx, regions, scale };
  })();
  cache.set(shot, task);
  task.catch(() => cache.delete(shot));
  return task;
}

/** 找「比模型框更像照片」的那块；找不到就原样返回 */
export async function refineImageBox(shot: Shot, box: ImageBox): Promise<ImageBox> {
  try {
    const analysis = await analyze(shot);
    if (!analysis) return box;
    const { canvas, ctx, regions, scale } = analysis;

    const detectBox: BoxPx = {
      x: box.x * canvas.width,
      y: box.y * canvas.height,
      w: Math.max(1, box.w * canvas.width),
      h: Math.max(1, box.h * canvas.height),
    };
    const baseScore = photoScore(ctx, detectBox);
    // 模型框本身已经像照片（色彩 / 纹理足够），就完全不动它：
    // 否则边缘候选只会在四周多切或少切一点，反而把一张好图改坏。
    if (baseScore >= 0.65) return box;

    // 先只看「像照片」的候选（表情包 / 头像 / 照片），文字气泡和引用卡片会被筛掉；
    // 如果这张截图里一个都没有，再退回全部候选里按重合度挑。
    // overlap 用「候选面积 / 候选自身面积」在框内的小区域上会全是 1，
    // 于是鼻子眼睛这种小块反而占便宜。这里另算 coverage：候选覆盖了模型框的多少。
    const boxArea = Math.max(1, detectBox.w * detectBox.h);
    const withScore = regions
      .filter((r) => overlapOf(r, detectBox) >= 0.08)
      .map((r) => {
        const ix = Math.max(0, Math.min(r.x + r.w, detectBox.x + detectBox.w) - Math.max(r.x, detectBox.x));
        const iy = Math.max(0, Math.min(r.y + r.h, detectBox.y + detectBox.h) - Math.max(r.y, detectBox.y));
        return {
          region: r,
          score: photoScore(ctx, r),
          overlap: overlapOf(r, detectBox),
          coverage: (ix * iy) / boxArea,
        };
      });
    const photoLike = withScore.filter((c) => c.score >= 0.6);
    const pool = photoLike.length ? photoLike : withScore;
    if (!pool.length) return box;

    pool.sort((a, b) => b.coverage * (0.6 + b.score * 0.4) - a.coverage * (0.6 + a.score * 0.4));
    const best = pool[0];

    // 重合度太低说明模型框和候选根本不在同一块，宁可用原框
    if (best.overlap < 0.15 || best.coverage < 0.02) return box;

    const margin = Math.max(2, Math.round(EDGE_MARGIN * Math.sqrt(scale)));
    const x = Math.max(0, best.region.x - margin);
    const y = Math.max(0, best.region.y - margin);
    const w = Math.min(canvas.width - x, best.region.w + margin * 2);
    const h = Math.min(canvas.height - y, best.region.h + margin * 2);
    return {
      page: box.page,
      x: x / canvas.width,
      y: y / canvas.height,
      w: w / canvas.width,
      h: h / canvas.height,
    };
  } catch {
    return box;
  }
}
