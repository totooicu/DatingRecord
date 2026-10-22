// 内联 SVG 图标：不依赖 emoji 字体，各平台渲染一致，且能跟随 currentColor 变色

export type TabKey = 'persons' | 'collections' | 'timeline' | 'calendar' | 'settings';

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'persons', label: '人物' },
  { key: 'collections', label: '事件集' },
  { key: 'timeline', label: '时间线' },
  { key: 'calendar', label: '日历' },
  { key: 'settings', label: '设置' },
];

const COMMON = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function TabIcon({ k }: { k: TabKey }) {
  switch (k) {
    case 'persons':
      return (
        <svg {...COMMON}>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M4.5 20c0-3.6 3.4-5.6 7.5-5.6s7.5 2 7.5 5.6" />
        </svg>
      );
    case 'collections':
      return (
        <svg {...COMMON}>
          <path d="M3.5 7.5a2 2 0 0 1 2-2h3.2l1.8 2h7.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'timeline':
      return (
        <svg {...COMMON}>
          <circle cx="12" cy="12" r="8.4" />
          <path d="M12 7.6V12l3 1.8" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...COMMON}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
          <path d="M3.5 9.8h17" />
          <path d="M8 3.4v3.2M16 3.4v3.2" />
          {/* 一个「有记录」的小点，跟日历格子里的样子呼应 */}
          <circle cx="8.2" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="15.8" cy="13.4" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...COMMON}>
          <circle cx="12" cy="12" r="2.8" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
        </svg>
      );
  }
}
