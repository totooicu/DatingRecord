// 播放器的线条图标。
//
// 之前用 🔁 ⏮ ⏸ ⏭ 这些 emoji：不同手机渲染出来的字重、留白、颜色都不一样，
// 有的还是彩色贴纸，和界面其他线性图标完全不是一套。这里统一成内联 SVG，
// 跟随 currentColor。
//
// 造型纪律（v1.1.x 第二版）：
//   · 全部走「实心 + 圆角」：三角形用同色描边 + 圆角接头把尖角磨圆，
//     和暂停的圆角竖条是同一套笔画粗细，缩到 20px 也不会糊成一团；
//   · 播放顺序用实心 repeat 字形（两条带箭头的横杠），三种状态共用这一个字形：
//     单曲循环在中间空白处画「1」，关闭循环用「挖空斜杠」——先画背景色粗线
//     再叠细线，斜杠穿过字形时不会被同色糊住；
//   · 不在 SVG 里写 <text>：数字的字形跟着系统字体走，和图标不是一套，
//     而且缩到 20px 会糊；「1」用一两笔描出来，带横底，小尺寸也认得出。

const BASE = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** 实心图形统一加一圈同色描边，借 round join 把尖角磨圆 */
const SOLID = {
  fill: 'currentColor',
  stroke: 'currentColor',
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
};

export function PlayIcon() {
  return (
    <svg {...BASE} aria-hidden="true">
      <path d="M9.6 7.1 17.6 12l-8 4.9z" {...SOLID} strokeWidth={2.6} />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg {...BASE} aria-hidden="true">
      <rect x="7.6" y="5.6" width="3.4" height="12.8" rx="1.7" fill="currentColor" stroke="none" />
      <rect x="13" y="5.6" width="3.4" height="12.8" rx="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PrevIcon() {
  return (
    <svg {...BASE} aria-hidden="true">
      <rect x="5.2" y="6.6" width="2.4" height="10.8" rx="1.2" fill="currentColor" stroke="none" />
      <path d="M18.6 6.9 10.9 12l7.7 5.1z" {...SOLID} strokeWidth={2.4} />
    </svg>
  );
}

export function NextIcon() {
  return (
    <svg {...BASE} aria-hidden="true">
      <rect x="16.4" y="6.6" width="2.4" height="10.8" rx="1.2" fill="currentColor" stroke="none" />
      <path d="M5.4 6.9 13.1 12l-7.7 5.1z" {...SOLID} strokeWidth={2.4} />
    </svg>
  );
}

/**
 * 播放顺序：列表循环 / 单曲循环 / 关闭循环。
 * 三种状态用同一个实心 repeat 字形（两条带箭头的横杠）：
 * 「单曲」在中间空白处描一个带横底的 1，「关闭」用挖空斜杠划掉。
 */
export function LoopIcon({ mode }: { mode: 'list' | 'one' | 'off' }) {
  return (
    <svg {...BASE} aria-hidden="true">
      {/* repeat：上横杠向右带箭头，下横杠向左带箭头 */}
      <path
        d="M7 6.4h9.1v2.5l3.9-3.6-3.9-3.5v2.5H5.5a1 1 0 0 0-1 1v5.1h2.5z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M17 17.6H7.9v-2.5l-3.9 3.6 3.9 3.5v-2.5h10.6a1 1 0 0 0 1-1v-5.1H17z"
        fill="currentColor"
        stroke="none"
      />
      {mode === 'one' && (
        <path
          d="M10.2 10.9 12.5 8.8v6.6M9.9 15.5h4.9"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
      {mode === 'off' && (
        <>
          {/* 先画背景色粗线把字形切开，再叠同色细线：斜杠不会和实心字糊成一片 */}
          <path d="M4.6 19.4 19.4 4.6" stroke="var(--panel)" strokeWidth={4.4} />
          <path d="M4.6 19.4 19.4 4.6" stroke="currentColor" strokeWidth={1.6} />
        </>
      )}
    </svg>
  );
}
