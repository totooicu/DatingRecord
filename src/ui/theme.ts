// 外观主题：主题色 + 底色。
//
// 只覆盖 base.css 里那几个颜色变量，不动任何布局。页面里 500 多处
// var(--primary) / var(--border) 会自动跟着变，所以改一处就能换整张皮。
//
// 存 localStorage 而不是 meta 表：这是「这台设备看着顺眼」的偏好，
// 不是库数据，换设备、清缓存后回到默认都可以接受。
//
// 主题色不是想给什么就给什么：按钮上是白字，太浅的颜色会让字消失。
// 这里统一把亮度过高的颜色压暗到白字对比度 ≥ 3:1（WCAG 大字号标准），
// 页面会告诉用户「已自动加深」。

export interface BaseTone {
  key: string;
  name: string;
  hint: string;
  vars: {
    bg: string;
    panel: string;
    side: string;
    border: string;
    text: string;
    muted: string;
  };
}

export type AppearanceMode = 'light' | 'dark';

export interface Appearance {
  /** 已归一化、已保证对比度的 #rrggbb */
  accent: string;
  base: string;
  /** 浅色 / 夜间。夜间模式的背景由主题色色相派生（明显着色） */
  mode: AppearanceMode;
}

export interface ApplyResult {
  appearance: Appearance;
  /** 用户选的颜色太浅，实际用的是加深后的颜色 */
  adjusted: boolean;
}

export const DEFAULT_ACCENT = '#d9536b';

export const ACCENT_PRESETS = [
  { name: '玫红', color: '#d9536b' },
  { name: '朱砂', color: '#c94f3d' },
  { name: '琥珀', color: '#a86a12' },
  { name: '松绿', color: '#2e7d54' },
  { name: '湖蓝', color: '#2b6f8f' },
  { name: '靛青', color: '#4a5bb5' },
  { name: '紫罗兰', color: '#7a4f9e' },
  { name: '石墨', color: '#5c5a56' },
];

/** 底色都是浅色：深色模式会牵动大量写死的白底组件，不在这一版里松口子 */
export const BASE_TONES: BaseTone[] = [
  {
    key: 'warm',
    name: '暖白',
    hint: '默认，微暖的纸感',
    vars: {
      bg: '#f6f5f3',
      panel: '#ffffff',
      side: '#fbfaf8',
      border: '#e6e3dd',
      text: '#2b2a28',
      muted: '#8a857c',
    },
  },
  {
    key: 'paper',
    name: '米色',
    hint: '偏黄，像旧纸',
    vars: {
      bg: '#f4efe6',
      panel: '#fffdf9',
      side: '#faf5ec',
      border: '#e3d9c9',
      text: '#2e2a23',
      muted: '#8b8272',
    },
  },
  {
    key: 'cool',
    name: '冷白',
    hint: '偏蓝，干净',
    vars: {
      bg: '#f2f4f7',
      panel: '#ffffff',
      side: '#f7f9fc',
      border: '#dfe4ea',
      text: '#262b33',
      muted: '#7c8695',
    },
  },
  {
    key: 'gray',
    name: '浅灰',
    hint: '低饱和，最安静',
    vars: {
      bg: '#eeeeec',
      panel: '#ffffff',
      side: '#f6f6f5',
      border: '#dededb',
      text: '#2a2a28',
      muted: '#83837c',
    },
  },
  {
    key: 'rose',
    name: '雾粉',
    hint: '很淡的粉调',
    vars: {
      bg: '#faf4f5',
      panel: '#ffffff',
      side: '#fdf7f8',
      border: '#eddfe2',
      text: '#2d2829',
      muted: '#8a7c7f',
    },
  },
];

const KEY = 'dr.appearance.v1';
/** 给 index.html 的首屏脚本用：HTML 比主包先到，先按这份把 CSS 变量点上 */
const VARS_KEY = 'dr.appearance.vars.v1';

const DEFAULT_APPEARANCE: Appearance = { accent: DEFAULT_ACCENT, base: 'warm', mode: 'light' };

function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return `#${s
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const p = (n: number) => {
    const v = Math.max(0, Math.min(255, Math.round(n)));
    return v < 16 ? `0${v.toString(16)}` : v.toString(16);
  };
  return `#${p(r)}${p(g)}${p(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function luminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 白字压在这个颜色上的对比度；3:1 是 WCAG 对大字号/图形的最低要求 */
export function contrastOnWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/**
 * 把过浅的颜色压暗到白字可读。
 *
 * 先砍掉过高的亮度，再逐步下压直到对比度达标；只动亮度，色相饱和度保留，
 * 所以用户仍能认出自己选的是什么颜色。
 */
function readableAccent(input: string): { hex: string; adjusted: boolean } {
  const norm = normalizeHex(input);
  if (!norm) return { hex: DEFAULT_ACCENT, adjusted: false };
  const [h, s, l0] = rgbToHsl(...parseHex(norm));
  let l = Math.min(l0, 0.62);
  let hex = hslToHex(h, s, l);
  let guard = 0;
  while (contrastOnWhite(hex) < 3 && l > 0.16 && guard++ < 80) {
    l -= 0.01;
    hex = hslToHex(h, s, l);
  }
  return { hex, adjusted: hex !== norm };
}

function darken(hex: string, amount: number): string {
  const [h, s, l] = rgbToHsl(...parseHex(hex));
  return hslToHex(h, s, Math.max(0.1, l - amount));
}

/**
 * 默认色的悬停色沿用 base.css 原值。
 *
 * 用统一算法从 #d9536b 推到 #c04457 会偏艳（亮度降了、饱和度没降），
 * 没改过设置的用户不该看到一个和从前不一样的悬停色。
 */
const PRIMARY_DARK_OVERRIDES: Record<string, string> = {
  '#d9536b': '#c04457',
};

function primaryDark(accent: string): string {
  return PRIMARY_DARK_OVERRIDES[accent] ?? darken(accent, 0.09);
}

function baseTone(key: string): BaseTone {
  return BASE_TONES.find((b) => b.key === key) ?? BASE_TONES[0];
}

/**
 * 夜间模式的中性色：由主题色的色相派生，明显着色。
 *
 * 取 accent 的色相 h 与饱和度 s，背景压到低亮度、保留中高饱和，于是深夜底色
 * 也带着主题色色调（湖蓝主题→蓝调夜景，朱砂主题→暗红夜景）；文字接近白、只
 * 微微着色，保证可读。灰度主题（石墨）饱和本来就低，自然落到近中性深灰。
 * --primary 在深色底上提亮，链接 / 标记 / 边框才看得清。
 */
function darkVarsFor(accent: string): Record<string, string> {
  const [h, s] = rgbToHsl(...parseHex(accent));
  const dark = (l: number, sat = s) => hslToHex(h, Math.min(0.5, sat + 0.06), l);
  return {
    '--bg': dark(0.13, Math.min(0.5, s + 0.04)),
    '--panel': dark(0.18),
    '--side': dark(0.15),
    '--border': dark(0.3),
    '--text': dark(0.93, Math.min(0.2, s + 0.1)),
    '--muted': dark(0.6, Math.min(0.22, s + 0.08)),
    '--primary': dark(0.66, Math.min(0.7, s + 0.12)),
    '--primary-dark': dark(0.58, Math.min(0.7, s + 0.12)),
    '--fg': dark(0.93, Math.min(0.2, s + 0.1)),
  };
}

/** base.css 里的同名变量；--fg 是日历等零星位置用的别名 */
function varsFor(a: Appearance): Record<string, string> {
  if (a.mode === 'dark') return darkVarsFor(a.accent);
  const base = baseTone(a.base).vars;
  return {
    '--primary': a.accent,
    '--primary-dark': primaryDark(a.accent),
    '--bg': base.bg,
    '--panel': base.panel,
    '--side': base.side,
    '--border': base.border,
    '--text': base.text,
    '--muted': base.muted,
    '--fg': base.text,
  };
}

function paint(vars: Record<string, string>, mode: AppearanceMode): void {
  const root = document.documentElement;
  root.setAttribute('data-mode', mode);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  // 手机浏览器地址栏/状态栏跟随主色，别让顶部还留着旧粉
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--primary']);
}

/** 读当前偏好；没存过或存坏了都回默认 */
export function getAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    const accent = typeof parsed.accent === 'string' ? normalizeHex(parsed.accent) : null;
    const base = BASE_TONES.some((b) => b.key === parsed.base) ? (parsed.base as string) : 'warm';
    const mode = parsed.mode === 'dark' ? 'dark' : 'light';
    return { accent: accent ?? DEFAULT_ACCENT, base, mode };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** 应用并落盘；返回实际生效的值（浅色可能被自动加深） */
export function applyAppearance(next: Appearance): ApplyResult {
  const { hex, adjusted } = readableAccent(next.accent);
  const appearance: Appearance = {
    accent: hex,
    base: baseTone(next.base).key,
    mode: next.mode === 'dark' ? 'dark' : 'light',
  };
  const vars = varsFor(appearance);
  paint(vars, appearance.mode);
  try {
    localStorage.setItem(KEY, JSON.stringify(appearance));
    localStorage.setItem(VARS_KEY, JSON.stringify(vars));
  } catch {
    // 存储被禁（无痕/配额满）时至少本次会话仍然生效
  }
  return { appearance, adjusted };
}

/**
 * 启动时调用：把上次的偏好贴到 :root 上。
 *
 * 没存过就什么都不做——默认值仍以 base.css 为准，免得同一套颜色在
 * 两个文件里各写一份、改了一处忘了另一处。
 */
export function initAppearance(): void {
  try {
    if (!localStorage.getItem(KEY)) {
      // 主 key 没了而 vars 还在，是清数据只清了一半；一并清掉，别留旧色
      localStorage.removeItem(VARS_KEY);
      return;
    }
  } catch {
    return;
  }
  paint(varsFor(getAppearance()), getAppearance().mode);
}

export function resetAppearance(): ApplyResult {
  return applyAppearance(DEFAULT_APPEARANCE);
}

export function isDefaultAppearance(a: Appearance): boolean {
  return a.accent === DEFAULT_ACCENT && a.base === 'warm' && a.mode === 'light';
}
