// 播放器的线条图标。
//
// 之前用 🔁 ⏮ ⏸ ⏭ 这些 emoji：不同手机渲染出来的字重、留白、颜色都不一样，
// 有的还是彩色贴纸，和界面其他线性图标完全不是一套。这里统一成内联 SVG，
// 跟随 currentColor。

const STROKE = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function PlayIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M8 5.4v13.2L18.8 12z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <rect x="7" y="5.2" width="3.6" height="13.6" rx="1.4" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5.2" width="3.6" height="13.6" rx="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PrevIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M18.6 5.6v12.8L9.4 12z" fill="currentColor" stroke="none" />
      <rect x="5" y="5.6" width="2.4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function NextIcon() {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="M5.4 5.6v12.8L14.6 12z" fill="currentColor" stroke="none" />
      <rect x="16.6" y="5.6" width="2.4" height="12.8" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 播放顺序：列表循环 / 单曲循环 / 不循环 */
export function LoopIcon({ mode }: { mode: 'list' | 'one' | 'off' }) {
  return (
    <svg {...STROKE} aria-hidden="true">
      <path d="m17 2.6 3.6 3.6L17 9.8" />
      <path d="M3.4 11.4V10a3.8 3.8 0 0 1 3.8-3.8h13" />
      <path d="m7 21.4-3.6-3.6L7 14.2" />
      <path d="M20.6 12.6V14a3.8 3.8 0 0 1-3.8 3.8h-13" />
      {mode === 'one' && (
        <text
          x="12"
          y="15.1"
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="700"
          fill="currentColor"
          stroke="none"
        >
          1
        </text>
      )}
      {mode === 'off' && <path d="M4.4 4.4l15.2 15.2" />}
    </svg>
  );
}
