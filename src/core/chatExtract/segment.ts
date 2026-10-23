// 用「边缘分割」那套算法把模型给的图片框收一收。
//
// 视觉模型偶尔会把引用卡片、文字气泡当成图片，或者框得比实际内容大一圈；
// 边缘分割工具（public/edge-split.html）对这种截图更可靠，所以这里把它的
// 灰度 → 模糊 → Sobel → 膨胀 → 连通区域搬过来，在模型框附近找更像照片的那块。
//
// 只在模型框「不像照片」时才替换：框里本来就色彩丰富、纹理密，就原样用，
// 免得把一张已经裁好的表情包又切碎了。全部在本机 canvas 里算，不上传。

import type { ImageBox, Shot } from './index';

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
}

const DETECT_MAX = 640;

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

function composeDetectImage(img: HTMLImageElement): { canvas: HTMLCanvasElement; scale: number } | null {
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, DETECT_MAX / longest);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, scale };
}

/** 找「比模型框更像照片」的那块；找不到就原样返回 */
export async function refineImageBox(shot: Shot, box: ImageBox): Promise<ImageBox> {
  try {
    const img = await loadImage(shot.dataUrl);
    const composed = composeDetectImage(img);
    if (!composed) return box;
    const { canvas, scale } = composed;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return box;

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

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = toGray(imageData.data);
    const blurred = gaussianBlur(gray, canvas.width, canvas.height, 1);
    const edges = sobelEdge(blurred, canvas.width, canvas.height, 55);
    const dilated = dilate(edges, canvas.width, canvas.height, 2);
    const regions = findContours(dilated, canvas.width, canvas.height);

    const total = canvas.width * canvas.height;
    let best: { region: Region; score: number } | null = null;
    for (const r of regions) {
      // 太小的候选多半是表情包里的眼睛 / 文字笔画，换上去只会把图裁碎
      if (r.area < total * 0.0008 || r.area < detectBox.w * detectBox.h * 0.03) continue;
      if (r.area > total * 0.35 || r.area > detectBox.w * detectBox.h * 1.2) continue;
      const aspect = r.w / r.h;
      if (aspect < 0.25 || aspect > 4) continue;
      const overlap = overlapOf(r, detectBox);
      if (overlap < 0.12) continue;
      const score = photoScore(ctx, r);
      if (!best || score > best.score) best = { region: r, score };
    }

    // 模型框本身已经像照片，就别再动它；只有明显更像照片的候选才替换
    if (!best || best.score < 0.6 || best.score < baseScore + 0.08) return box;

    const margin = Math.max(1, Math.round(Math.min(best.region.w, best.region.h) * 0.03));
    const x = Math.max(0, best.region.x - margin);
    const y = Math.max(0, best.region.y - margin);
    const w = Math.min(canvas.width - x, best.region.w + margin * 2);
    const h = Math.min(canvas.height - y, best.region.h + margin * 2);
    const inv = 1 / scale;
    return {
      page: box.page,
      x: (x * inv) / img.naturalWidth,
      y: (y * inv) / img.naturalHeight,
      w: (w * inv) / img.naturalWidth,
      h: (h * inv) / img.naturalHeight,
    };
  } catch {
    return box;
  }
}
