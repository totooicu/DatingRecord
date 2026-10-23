// 文件行用的小图标：16px，跟随 currentColor。
//
// 用内联 SVG 而不是 emoji：部分安卓机型把 emoji 渲染成空心方块，
// 而且 emoji 没法跟随主题色。
import type { ReactNode } from 'react';

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="file-icon-btn" onClick={onClick} title={label} aria-label={label}>
      {children}
    </button>
  );
}

export function EyeIcon() {
  return (
    <svg {...ICON}>
      <path d="M2.6 12s3.5-6 9.4-6 9.4 6 9.4 6-3.5 6-9.4 6-9.4-6-9.4-6z" />
      <circle cx="12" cy="12" r="2.7" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M13.8 6.2l3 3" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg {...ICON}>
      <path d="M10 13.8a4 4 0 0 0 5.6 0l2.8-2.8a4 4 0 1 0-5.6-5.6L11.6 6.6" />
      <path d="M14 10.2a4 4 0 0 0-5.6 0l-2.8 2.8a4 4 0 1 0 5.6 5.6l1.2-1.2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...ICON} strokeWidth={2.6}>
      <path d="M5 12.5l4.6 4.6L19 6.8" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...ICON}>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5h5v2" />
      <path d="M6.5 7l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** 未设隐私：开着的锁 */
export function UnlockIcon() {
  return (
    <svg {...ICON}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.6a4 4 0 0 1 7.6-1.7" />
    </svg>
  );
}

/** 已设隐私：合上的锁 */
export function LockIcon() {
  return (
    <svg {...ICON}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    </svg>
  );
}

/** 取消删除 */
export function CloseIcon() {
  return (
    <svg {...ICON}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
