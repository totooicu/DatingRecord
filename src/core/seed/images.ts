// 示例数据用的配图。
//
// 刻意不联网、不打包二进制：每张图就是一段程序化生成的 SVG 风景，
// 只为了在事件列表 / 回忆录里有个像样的色块，不当真实照片看。
// 右下角标了「示例配图」，避免用户误以为库里真有这些照片。

export interface Scene {
  key: string;
  /** 场景名，也用作文件名 */
  label: string;
  sky: [string, string];
  hill: [string, string];
  glow: string;
  night?: boolean;
}

export const SCENES: Scene[] = [
  { key: 'cafe', label: '米仓咖啡', sky: ['#f6e7d3', '#d9b08c'], hill: ['#8c5a3c', '#5b3722'], glow: '#ffe0b8' },
  { key: 'movie', label: '万象城影城', sky: ['#1b1b2f', '#3b2f5e'], hill: ['#12121f', '#07070d'], glow: '#ffd166', night: true },
  { key: 'riverside', label: '江边', sky: ['#2a4a6b', '#7aa7c7'], hill: ['#18314a', '#0c1c2b'], glow: '#ffd9a0', night: true },
  { key: 'gallery', label: '浙江美术馆', sky: ['#f4f4f2', '#deded8'], hill: ['#b9b9b2', '#8f8f88'], glow: '#ffffff' },
  { key: 'picnic', label: '太子湾公园', sky: ['#cfe8ff', '#f7fbe8'], hill: ['#86b06a', '#4f7a44'], glow: '#fff3c4' },
  { key: 'ferris', label: '杭州乐园', sky: ['#221b3d', '#4b2c63'], hill: ['#151024', '#0a0714'], glow: '#ffb3d9', night: true },
  { key: 'sea', label: '象山石浦', sky: ['#bfe9f7', '#f4f1d6'], hill: ['#4ea3b8', '#1f6a7d'], glow: '#fff6c9' },
  { key: 'mountain', label: '莫干山', sky: ['#dbe7ef', '#a9c6d8'], hill: ['#40624f', '#22382c'], glow: '#ffffff' },
];

/** 文件名的字符集尽量老实：中文标点在部分系统上会被替换成下划线 */
function fileNameOf(s: Scene): string {
  return `${s.label}.svg`;
}

function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hillPath(rnd: () => number, baseY: number, amp: number): string {
  const phase = rnd() * Math.PI * 2;
  const parts: string[] = ['M0 800', `L0 ${baseY.toFixed(1)}`];
  for (let x = 0; x <= 1200; x += 80) {
    const y = baseY + Math.sin((x / 1200) * Math.PI * 2 + phase) * amp * (0.55 + rnd() * 0.9);
    parts.push(`L${x} ${y.toFixed(1)}`);
  }
  parts.push('L1200 800', 'Z');
  return parts.join(' ');
}

function stars(rnd: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < 46; i += 1) {
    const x = rnd() * 1200;
    const y = rnd() * 420;
    const r = 0.8 + rnd() * 1.8;
    out.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`);
  }
  return out.join('');
}

export function sceneSvg(s: Scene): string {
  const rnd = makeRng(hashOf(s.key));
  const glowX = 260 + rnd() * 680;
  const glowY = s.night ? 140 + rnd() * 90 : 190 + rnd() * 120;
  const glowR = s.night ? 60 : 90;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${s.sky[0]}"/><stop offset="1" stop-color="${s.sky[1]}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${s.glow}" stop-opacity="0.95"/>
    <stop offset="1" stop-color="${s.glow}" stop-opacity="0"/>
  </radialGradient>
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${hashOf(s.key) % 97}"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer>
  </filter>
</defs>
<rect width="1200" height="800" fill="url(#sky)"/>
${s.night ? stars(rnd) : ''}
<circle cx="${glowX.toFixed(0)}" cy="${glowY.toFixed(0)}" r="${glowR * 3}" fill="url(#glow)"/>
<circle cx="${glowX.toFixed(0)}" cy="${glowY.toFixed(0)}" r="${glowR * 0.55}" fill="${s.glow}" opacity="0.8"/>
<path d="${hillPath(rnd, 470, 46)}" fill="${s.hill[0]}" opacity="0.55"/>
<path d="${hillPath(rnd, 570, 34)}" fill="${s.hill[0]}" opacity="0.8"/>
<path d="${hillPath(rnd, 680, 26)}" fill="${s.hill[1]}"/>
<rect width="1200" height="800" filter="url(#grain)" opacity="0.6"/>
<g>
  <rect x="56" y="672" rx="18" ry="18" width="${Math.max(220, s.label.length * 44 + 56)}" height="76" fill="#000" opacity="0.28"/>
  <text x="88" y="722" font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="40" fill="#ffffff" opacity="0.95">${s.label}</text>
  <text x="1144" y="770" text-anchor="end" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="22" fill="#ffffff" opacity="0.55">示例配图</text>
</g>
</svg>`;
}

export function sceneFile(s: Scene): File {
  return new File([sceneSvg(s)], fileNameOf(s), { type: 'image/svg+xml' });
}
