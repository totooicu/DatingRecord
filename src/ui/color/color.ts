// 颜色值的解析与换算：所有取色入口（图标前后景、属性颜色、主题色）共用。
//
// 手输只认三种常见写法：#rgb / #rrggbb / rgb(r,g,b)，另外容忍 3 个裸数字
// （「255, 0, 0」——从别处复制色值时经常带着这种形式）。
// 落库统一用小写 #rrggbb，避免同一个颜色因为写法不同被当成两种。

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const HEX6 = /^#[0-9a-f]{6}$/;
const HEX3 = /^#[0-9a-f]{3}$/;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseRgbText(v: string): Rgb | null {
  const wrapped = v.match(/^rgba?\s*\(([^)]*)\)$/);
  const body = (wrapped ? wrapped[1] : v).trim();
  if (!/^\d{1,3}[\s,，]+\d{1,3}[\s,，]+\d{1,3}$/.test(body)) return null;
  const nums = body.split(/[\s,，]+/).map(Number);
  if (!nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
  return { r: clamp(nums[0], 0, 255), g: clamp(nums[1], 0, 255), b: clamp(nums[2], 0, 255) };
}

export function rgbToHex(rgb: Rgb): string {
  const h = (n: number) => clamp(n, 0, 255).toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

/** 任意受支持的写法 → 小写 #rrggbb；认不出来返回 null（输入过程中会一直返回 null） */
export function normalizeHex(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  const withHash = v.startsWith('#') ? v : `#${v}`;
  if (HEX6.test(withHash)) return withHash;
  if (HEX3.test(withHash)) {
    const s = withHash.slice(1);
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  const rgb = parseRgbText(v);
  return rgb ? rgbToHex(rgb) : null;
}

export function hexToRgb(raw: string): Rgb | null {
  const hex = normalizeHex(raw);
  if (!hex) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** rgb 文案：面板里显示、复制都用它 */
export function rgbText(raw: string): string {
  const rgb = hexToRgb(raw);
  return rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : '';
}

export function hexToHsl(raw: string): Hsl | null {
  const rgb = hexToRgb(raw);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

/** hsl → #rrggbb：彩虹面板按「色相 + 明度」取色，这里统一换算 */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const seg = Math.floor(hh / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}
